/*
 * WHO DAT online rooms — logic only (storage is store.js, HTTP is api/[[path]].js).
 * A room is a plain JSON object. The server is the only source of truth: membership, both secret characters,
 * both boards, turns, the official Q&A history and the private chat all live here.
 * Each browser only ever receives what that player is allowed to see (see viewFor).
 */
import * as Engine from "../../site/js/engine.js";
import { cleanName } from "./names.js";

export const MAX_PLAYERS = 2;
export const ONLINE_MS = 15_000;      // no check-in for this long → shown as offline
export const CHAT_KEEP = 100;         // messages kept per room
const ACT_WINDOW_MS = 5_000, ACT_MAX = 40;
const CHAT_WINDOW_MS = 10_000, CHAT_MAX_IN_WINDOW = 8, CHAT_MIN_GAP_MS = 400;

export class RoomError extends Error {
  constructor(message, code) { super(message); this.code = code || null; }
}

function hex(bytes) { return [...bytes].map((x) => x.toString(16).padStart(2, "0")).join(""); }
export function newToken() { const b = new Uint8Array(24); crypto.getRandomValues(b); return hex(b); }
function newId() { const b = new Uint8Array(6); crypto.getRandomValues(b); return "p_" + hex(b); }
function coin() { const b = new Uint8Array(1); crypto.getRandomValues(b); return b[0] & 1; }

export function newRoom(code, now = Date.now()) {
  return { code, created: now, players: [], names: {}, match: null, matchNo: 0, rematch: [], chat: [], chatSeq: 0, rev: 0 };
}

export function playerByToken(s, token) {
  return typeof token === "string" && token.length === 48 ? s.players.find((p) => p.token === token) || null : null;
}
const online = (p, now) => now - (p.seen || 0) < ONLINE_MS;

/** New match for the two seated players. Who asks first alternates; the very first match is a coin flip. */
function startMatch(s) {
  const ids = s.players.map((p) => p.id);
  const prev = ids.indexOf(s.lastFirst);
  const first = prev >= 0 ? 1 - prev : coin();
  s.match = Engine.newMatch(ids, first);
  s.lastFirst = ids[first];
  s.matchNo += 1;
  s.rematch = [];
}

export function join(s, { name, token }, now = Date.now()) {
  let p = playerByToken(s, token);
  if (!p) {
    if (token && !name) throw new RoomError("Your seat in this room is gone. Enter your name to join again.", "rejoin");
    const n = cleanName(name);
    if (!n.ok) throw new RoomError(n.error, "name");
    if (s.players.length >= MAX_PLAYERS) throw new RoomError("This room already has two players.", "full");
    p = { id: newId(), token: newToken(), name: n.name, seen: now, rate: [], chatRate: [] };
    s.players.push(p);
    s.names[p.id] = p.name;
    if (s.players.length === MAX_PLAYERS && (!s.match || s.match.status === "over")) startMatch(s);
  }
  p.seen = now;
  return p;
}

function rate(list, now, windowMs, max) {
  const kept = list.filter((t) => now - t < windowMs);
  kept.push(now);
  return { kept, over: kept.length > max };
}

/** Game moves. Engine errors become RoomErrors with the same friendly message. */
export function act(s, me, msg, now = Date.now()) {
  if (!msg || typeof msg.t !== "string") throw new RoomError("Bad message.");
  const r = rate(me.rate || [], now, ACT_WINDOW_MS, ACT_MAX);
  me.rate = r.kept;
  if (r.over) throw new RoomError("Slow down a little.");
  me.seen = now;
  if (msg.t === "leave") return leave(s, me);
  if (msg.t === "rematch") return rematch(s, me);
  const m = s.match;
  if (!m) throw new RoomError("Waiting for a second player to join.", "waiting");
  try {
    switch (msg.t) {
      case "select": Engine.select(m, me.id, msg.id); break;
      case "ask": Engine.ask(m, me.id, msg.text); break;
      case "answer": Engine.answer(m, me.id, msg.yes); break;
      case "toggle": Engine.toggle(m, me.id, msg.id); break;
      case "end": Engine.endTurn(m, me.id); break;
      case "guess": Engine.guess(m, me.id, msg.id); break;
      default: throw new RoomError("Unknown action.");
    }
  } catch (e) {
    if (e instanceof Engine.GameError) throw new RoomError(e.message, e.code);
    throw e;
  }
}

function leave(s, me) {
  if (s.match && s.match.status !== "over") Engine.forfeit(s.match, me.id);
  s.players = s.players.filter((p) => p.id !== me.id);
  s.rematch = [];
  if (!s.players.length) s.match = null;
}

function rematch(s, me) {
  if (!s.match || s.match.status !== "over") throw new RoomError("The match isn't over yet.");
  if (s.players.length < MAX_PLAYERS) throw new RoomError("Your opponent left. Wait here for someone new or start a new room.", "alone");
  if (!s.rematch.includes(me.id)) s.rematch.push(me.id);
  if (s.players.every((p) => s.rematch.includes(p.id))) startMatch(s);
}

/** Private room chat. Never touches the match. */
export function chat(s, me, raw, now = Date.now()) {
  let text;
  try { text = Engine.cleanText(raw, Engine.CHAT_MAX, "message"); }
  catch (e) { throw new RoomError(e.message, e.code); }
  const last = (me.chatRate || [])[(me.chatRate || []).length - 1] || 0;
  const r = rate(me.chatRate || [], now, CHAT_WINDOW_MS, CHAT_MAX_IN_WINDOW);
  if (r.over || now - last < CHAT_MIN_GAP_MS) throw new RoomError("Whoa, slow down on the chat for a sec.", "rate");
  me.chatRate = r.kept;
  me.seen = now;
  s.chatSeq += 1;
  s.chat.push({ id: s.chatSeq, by: me.id, text, at: now });
  if (s.chat.length > CHAT_KEEP) s.chat.splice(0, s.chat.length - CHAT_KEEP);
  return s.chatSeq;
}

/** Everything one player may see. The opponent's secret only appears once the match is over. */
export function viewFor(s, pid, now = Date.now()) {
  const m = s.match && s.match.players.includes(pid) ? Engine.viewFor(s.match, pid) : null;
  return {
    t: "state", now, version: s.rev || 0,
    room: {
      code: s.code, max: MAX_PLAYERS,
      players: s.players.map((p) => ({ id: p.id, name: p.name, connected: online(p, now) })),
    },
    you: pid,
    names: { ...s.names },
    matchNo: s.matchNo,
    rematch: s.rematch.slice(),
    match: m,
    chat: s.chat.map((c) => ({ id: c.id, by: c.by, text: c.text, at: c.at })),
  };
}
