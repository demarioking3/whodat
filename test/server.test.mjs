/*
 * Online tests: real HTTP requests against the real Pages Function (functions/)
 * in the local Pages stand-in. Covers rooms, privacy of secrets, the full turn loop, manual elimination,
 * chat privacy/limits/XSS, reconnects, leaving, rematch and access control.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./local-server.mjs";

let srv, base;
before(async () => {
  srv = await startServer(0, { WHODAT_POLL_MS: "1200" });
  base = `http://localhost:${srv.port}/api`;
});
after(async () => { await srv.close(); });

class Player {
  constructor(code) { this.code = code; this.token = ""; this.state = null; }
  async req(path, { method = "GET", body, headers = {} } = {}) {
    const r = await fetch(`${base}/rooms/${this.code}${path}`, {
      method, headers: { "X-WhoDat-Token": this.token, ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: r.status === 204 ? null : await r.json() };
  }
  async join(name, token) {
    const r = await this.req("/join", { method: "POST", body: { name, token } });
    if (r.status === 200) { this.id = r.data.id; this.token = r.data.token; this.state = r.data.state; }
    return r;
  }
  async act(msg) { const r = await this.req("/act", { method: "POST", body: msg }); if (r.data?.state) this.state = r.data.state; return r; }
  async chat(text) { const r = await this.req("/chat", { method: "POST", body: { text } }); if (r.data?.state) this.state = r.data.state; return r; }
  async refresh() { const r = await this.req(`/state?since=-1`); if (r.status === 200) this.state = r.data.state; return r; }
}
async function newRoom(headers = {}) {
  const r = await fetch(base + "/rooms", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  return r.status === 200 ? (await r.json()).code : r.status;
}
async function pair() {
  const code = await newRoom();
  const a = new Player(code), b = new Player(code);
  assert.equal((await a.join("Dee")).status, 200);
  assert.equal((await b.join("Kay")).status, 200);
  await a.refresh();
  return { code, a, b };
}
async function started() {
  const p = await pair();
  await p.a.act({ t: "select", id: 3 });
  await p.b.act({ t: "select", id: 17 });
  await p.a.refresh();
  const active = p.a.state.match.turn === p.a.id ? p.a : p.b;
  const other = active === p.a ? p.b : p.a;
  return { ...p, active, other };
}

test("rooms: create, look up, bad codes, cross-site blocked", async () => {
  const code = await newRoom();
  assert.match(code, /^[A-Z2-9]{5}$/);
  const info = await (await fetch(`${base}/rooms/${code}`)).json();
  assert.deepEqual(info, { exists: true, players: 0, max: 2 });
  assert.equal((await fetch(`${base}/rooms/ZZZZZ`)).status, 404);
  assert.equal((await fetch(`${base}/rooms/%3Cscript%3E`)).status, 404);
  assert.equal(await newRoom({ Origin: "https://evil.example" }), 403);
});

test("two players max; names validated; match starts when the second joins", async () => {
  const code = await newRoom();
  const a = new Player(code);
  assert.equal((await a.join("<b>hi</b>")).status, 400);
  assert.equal((await a.join("Dee")).status, 200);
  assert.equal(a.state.match, null, "waiting room");
  const b = new Player(code);
  await b.join("Kay");
  assert.equal(b.state.match.status, "select");
  const c = new Player(code);
  const r = await c.join("Third");
  assert.equal(r.status, 400);
  assert.match(r.data.error, /two players/);
});

test("secrets stay private until the match is over", async () => {
  const { a, b } = await pair();
  await a.act({ t: "select", id: 3 });
  await b.refresh();
  assert.equal(b.state.match.oppSelected, true);
  assert.equal(b.state.match.mySecret, null);
  await b.act({ t: "select", id: 17 });
  await a.refresh();
  const raw = JSON.stringify(a.state);
  assert.equal(a.state.match.mySecret, 3);
  assert.ok(!/"secrets"/.test(raw), "no secrets object sent during play");
  assert.equal(a.state.match.result, null);
});

test("full turn loop over the network with manual elimination only", async () => {
  const { active, other } = await started();
  // the opponent can't ask, and you can't end before asking
  assert.equal((await other.act({ t: "ask", text: "Beard?" })).status, 400);
  assert.equal((await active.act({ t: "end" })).status, 400);
  assert.equal((await active.act({ t: "ask", text: "Does the player have a beard?" })).status, 200);
  assert.equal((await active.act({ t: "ask", text: "Another?" })).status, 400, "only one unanswered question");
  await other.refresh();
  assert.equal(other.state.match.question.text, "Does the player have a beard?");
  assert.equal((await active.act({ t: "answer", yes: true })).status, 400, "asker can't answer own question");
  assert.equal((await other.act({ t: "answer", yes: false })).status, 200);
  await active.refresh();
  assert.equal(active.state.match.lastAnswer.answer, "no");
  assert.deepEqual(active.state.match.myBoard, [], "nothing knocked down automatically");
  await active.act({ t: "toggle", id: 0 });
  await active.act({ t: "toggle", id: 10 });
  await active.act({ t: "toggle", id: 10 });
  assert.deepEqual(active.state.match.myBoard, [0]);
  await other.refresh();
  assert.deepEqual(other.state.match.myBoard, [], "boards independent");
  assert.equal(other.state.match.oppRemaining, 23);
  assert.equal((await active.act({ t: "end" })).status, 200);
  await other.refresh();
  assert.equal(other.state.match.turn, other.id);
  assert.equal(other.state.match.history.length, 1);
});

test("final guess ends the match and reveals both secrets; rematch starts fresh", async () => {
  const { a, b, active, other } = await started();
  const target = active === a ? 17 : 3;
  await active.act({ t: "guess", id: target });
  await other.refresh();
  assert.equal(other.state.match.result.winner, active.id);
  assert.deepEqual(Object.values(other.state.match.result.secrets).sort((x, y) => x - y), [3, 17]);
  await a.act({ t: "rematch" });
  await b.refresh();
  assert.equal(b.state.match.status, "over", "needs both players");
  await b.act({ t: "rematch" });
  assert.equal(b.state.match.status, "select");
  assert.equal(b.state.match.history.length, 0);
  assert.deepEqual(b.state.match.myBoard, []);
  assert.equal(b.state.matchNo, 2);
});

test("chat: private to the room, separate from gameplay, cleaned, limited", async () => {
  const { a, b, active } = await started();
  const before = JSON.stringify(active.state.match);
  assert.equal((await a.chat("  You already know who it is 😂  ")).status, 200);
  await b.refresh();
  const msg = b.state.chat.at(-1);
  assert.equal(msg.text, "You already know who it is 😂");
  assert.equal(msg.by, a.id);
  assert.equal(b.state.match.question, null, "chat never becomes a game question");
  await active.refresh();
  assert.equal(JSON.stringify(active.state.match), before, "chat doesn't change the match");
  // stored as plain text; the page renders with textContent
  await b.chat("<img src=x onerror=alert(1)>");
  await a.refresh();
  assert.equal(a.state.chat.at(-1).text, "<img src=x onerror=alert(1)>");
  assert.equal((await a.chat("   ")).status, 400);
  assert.equal((await a.chat("x".repeat(281))).status, 400);
  // outsiders: no token / wrong token / another room's token
  const outsider = new Player(a.code);
  assert.equal((await outsider.chat("hi")).status, 403);
  assert.equal((await outsider.refresh()).status, 403);
  const other = await pair();
  const spy = new Player(a.code); spy.token = other.a.token;
  assert.equal((await spy.refresh()).status, 403);
  assert.ok(!other.a.state.chat.some((c) => c.text.includes("already know")), "other rooms never see it");
  // spam
  let blocked = 0;
  for (let i = 0; i < 12; i++) { if ((await a.chat("spam " + i)).status === 400) blocked++; }
  assert.ok(blocked > 0, "rate limit kicks in");
});

test("reconnect with token keeps seat, board and chat; leaving forfeits", async () => {
  const { a, b, code } = await started();
  await a.act({ t: "toggle", id: 5 });
  await a.chat("brb");
  const again = new Player(code);
  const r = await again.join(undefined, a.token);
  assert.equal(r.status, 200);
  assert.equal(again.id, a.id);
  assert.deepEqual(again.state.match.myBoard, [5]);
  assert.equal(again.state.chat.at(-1).text, "brb");
  assert.equal(again.state.match.mySecret, 3);
  const lv = await b.act({ t: "leave" });
  assert.deepEqual(lv.data, { left: true });
  await a.refresh();
  assert.equal(a.state.match.result.winner, a.id);
  assert.equal(a.state.match.result.reason, "forfeit");
  assert.equal((await b.refresh()).status, 403, "left player is out");
});

test("long poll wakes up for the opponent's move", async () => {
  const { active, other } = await started();
  await other.refresh();
  const v = other.state.version;
  const conn = other.state.room.players.map((p) => p.connected).join();
  const waiting = other.req(`/state?since=${v}&conn=${conn}`);
  await new Promise((r) => setTimeout(r, 300));
  await active.act({ t: "ask", text: "Hat?" });
  const r = await waiting;
  assert.equal(r.status, 200);
  assert.equal(r.data.state.match.question.text, "Hat?");
  const idle = await other.req(`/state?since=${r.data.state.version}&conn=${conn}`);
  assert.equal(idle.status, 204, "nothing new → empty answer after the wait");
});
