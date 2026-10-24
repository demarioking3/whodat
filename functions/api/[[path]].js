/*
 * WHO DAT game API (Cloudflare Pages Function) — everything under /api/.
 *
 *   POST /api/rooms                     create a room → { code }
 *   GET  /api/rooms/CODE                does this room exist / is there a seat?
 *   POST /api/rooms/CODE/join           { name, token? } → { id, token, state }
 *   POST /api/rooms/CODE/act            { t: "select"|"ask"|"answer"|"toggle"|"end"|"guess"|"rematch"|"leave", ... } → { state }
 *   POST /api/rooms/CODE/chat           { text } → { state }
 *   GET  /api/rooms/CODE/state?since=V&conn=C  waits (up to ~20s) for a change newer than version V,
 *                                              or for an online/offline change versus what the page shows (C)
 *
 * A player's secret token travels in the X-WhoDat-Token header; only the two seated players can read or act
 * in a room (including its chat). Rooms live in the D1 database bound as WHODAT_DB (whodat-game).
 */
import * as Room from "../_lib/room.js";
import * as Store from "../_lib/store.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;
const POLL_STEP_MS = 500;
const HEARTBEAT_MS = 8_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function newCode() {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}
function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}
async function body(request) {
  const text = await request.text();
  if (text.length > 4000) throw new Room.RoomError("Message too large.");
  if (!text) return {};
  try { const v = JSON.parse(text); return v && typeof v === "object" ? v : {}; } catch { throw new Room.RoomError("Bad message."); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bump = (s) => { s.rev = (s.rev || 0) + 1; };

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.WHODAT_DB;
  if (!db) return json({ error: "The game server isn't set up yet (missing database)." }, 503);
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = request.method;

  try {
    await Store.ensureSchema(db);
    if (method === "POST" && !sameOrigin(request)) return json({ error: "Forbidden" }, 403);
    if (parts[0] !== "rooms") return json({ error: "Not found" }, 404);

    // /rooms
    if (parts.length === 1) {
      if (method !== "POST") return json({ error: "Method not allowed" }, 405);
      const now = Date.now();
      for (let i = 0; i < 6; i++) {
        const code = newCode();
        if (await Store.insert(db, code, Room.newRoom(code, now), now)) {
          if (Math.random() < 0.05) context.waitUntil?.(Store.cleanup(db));
          return json({ code });
        }
      }
      return json({ error: "Couldn't create a room. Try again." }, 503);
    }

    const code = String(parts[1]).toUpperCase();
    if (!CODE_RE.test(code)) return json({ exists: false, error: "No room with that code." }, 404);

    // /rooms/CODE — public info only: whether it exists and whether a seat is open
    if (parts.length === 2 && method === "GET") {
      const cur = await Store.load(db, code);
      if (!cur) return json({ exists: false, error: "No room with that code." }, 404);
      return json({ exists: true, players: cur.s.players.length, max: Room.MAX_PLAYERS });
    }

    const action = parts[2];
    const token = request.headers.get("X-WhoDat-Token") || "";
    const member = (s) => {
      const me = Room.playerByToken(s, token);
      if (!me) throw new Room.RoomError("You're not in this room.", "rejoin");
      return me;
    };

    if (action === "join" && method === "POST") {
      const b = await body(request);
      const out = await Store.update(db, code, (s, now) => {
        const p = Room.join(s, { name: b.name, token: typeof b.token === "string" ? b.token : "" }, now);
        bump(s);
        return { changed: true, result: p };
      });
      if (!out) return json({ error: "No room with that code.", code: "gone" }, 404);
      const p = out.result;
      return json({ id: p.id, token: p.token, code, state: Room.viewFor(out.s, p.id, Date.now()) });
    }

    if ((action === "act" || action === "chat") && method === "POST") {
      const b = await body(request);
      const out = await Store.update(db, code, (s, now) => {
        const me = member(s);
        if (action === "chat") Room.chat(s, me, b.text, now);
        else Room.act(s, me, b, now);
        bump(s);
        return { changed: true, result: me.id };
      });
      if (!out) return json({ error: "No room with that code.", code: "gone" }, 404);
      // after "leave" the player is no longer in the room
      if (!out.s.players.some((p) => p.id === out.result)) return json({ left: true });
      return json({ state: Room.viewFor(out.s, out.result, Date.now()) });
    }

    // long poll
    if (action === "state" && method === "GET") {
      const since = Number(url.searchParams.get("since")) || 0;
      const waitMs = Math.min(25_000, Number(env.WHODAT_POLL_MS) || 20_000);
      const until = Date.now() + waitMs;
      // what the browser currently shows for each seat's online dot, e.g. "true,false"
      let lastConnected = url.searchParams.get("conn");
      for (;;) {
        const out = await Store.update(db, code, (s, now) => {
          const me = member(s);
          let changed = false;
          // "still here" heartbeat — saved, and bumps the version only if it changes someone's online dot
          if (now - (me.seen || 0) > HEARTBEAT_MS) {
            const wasOnline = now - (me.seen || 0) < Room.ONLINE_MS;
            me.seen = now; changed = true;
            if (!wasOnline) bump(s);
          }
          return { changed, result: me.id };
        });
        if (!out) return json({ error: "That room has closed.", code: "gone" }, 404);
        const rev = out.s.rev || 0;
        // also wake up when the opponent's online/offline status flips
        const now = Date.now();
        const conn = out.s.players.map((p) => now - (p.seen || 0) < Room.ONLINE_MS).join();
        if (lastConnected === null) lastConnected = conn;
        const connChanged = conn !== lastConnected;
        if (rev > since || connChanged || now >= until || request.signal?.aborted) {
          if (rev <= since && !connChanged) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
          return json({ state: Room.viewFor(out.s, out.result, now) });
        }
        await sleep(POLL_STEP_MS);
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof Room.RoomError) return json({ error: e.message, code: e.code }, e.code === "rejoin" ? 403 : 400);
    console.error(e);
    return json({ error: "The game server hit a problem. Please try again." }, 500);
  }
}
