/*
 * Local stand-in for Cloudflare Pages, for testing only.
 * Serves the real game (site/) and runs the real Pages Function (/api/)
 * against an in-memory D1 look-alike built on Node's SQLite.
 *
 *   node test/local-server.mjs [port]      then open http://localhost:8788/
 */
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/** In-memory stand-in for a Cloudflare D1 database, built on Node's SQLite. */
export function makeD1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql), _db: db };
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(REPO, "site");
const FUNCTIONS = {
  "/api/": join(REPO, "functions/api/[[path]].js"),
};
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".mp3": "audio/mpeg", ".md": "text/plain" };

// The real site's security headers, so local testing catches anything the CSP would block.
function siteHeaders() {
  const lines = readFileSync(join(SITE, "_headers"), "utf8").split("\n").filter((l) => /^\s+\S+:/.test(l));
  return Object.fromEntries(lines.map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

function serveStatic(pathname) {
  const file0 = normalize(join(SITE, decodeURIComponent(pathname)));
  if (!file0.startsWith(SITE)) return null;
  let file = file0;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return null;
  return { body: readFileSync(file), type: TYPES[extname(file)] || "application/octet-stream" };
}

export async function startServer(port = 8788, testEnv = {}) {
  const handlers = {};
  for (const [prefix, file] of Object.entries(FUNCTIONS)) handlers[prefix] = (await import(file)).onRequest;
  const env = { WHODAT_DB: makeD1(), ...testEnv };
  const headers = siteHeaders();
  const sockets = new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const prefix = Object.keys(handlers).find((p) => url.pathname.startsWith(p));
    if (prefix) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const ac = new AbortController();
      res.on("close", () => ac.abort());
      const request = new Request(url, {
        method: req.method, headers: req.headers, signal: ac.signal,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      try {
        const r = await handlers[prefix]({ request, env, params: {}, waitUntil: (p) => p.catch(() => {}) });
        if (res.destroyed) return;
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) { console.error(e); if (!res.destroyed) { res.writeHead(500); res.end("error"); } }
      return;
    }
    if (!extname(url.pathname) && !url.pathname.endsWith("/") && existsSync(join(SITE, url.pathname, "index.html"))) {
      res.writeHead(308, { Location: url.pathname + "/" + url.search }); res.end(); return;
    }
    const f = serveStatic(url.pathname);
    if (f) { res.writeHead(200, { "Content-Type": f.type, ...headers }); res.end(f.body); return; }
    const nf = serveStatic("/404.html");
    res.writeHead(404, { "Content-Type": "text/html", ...headers }); res.end(nf ? nf.body : "Not found");
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((ok) => server.listen(port, ok));
  return {
    server, env, port: server.address().port,
    close: () => new Promise((ok) => { for (const s of sockets) s.destroy(); server.close(ok); }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startServer(Number(process.argv[2]) || 8788);
  console.log(`WHO DAT?:  http://localhost:${port}/`);
}
