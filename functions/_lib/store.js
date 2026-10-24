/*
 * WHO DAT rooms in Cloudflare D1.
 * Uses the table whodat_rooms in the free D1 database whodat-game (binding WHODAT_DB).
 * One row per room: JSON state + a version number. A save only succeeds if nobody wrote in between
 * (optimistic locking), so two players acting at the same moment can never overwrite each other.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS whodat_rooms (
     code TEXT PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS whodat_rooms_updated ON whodat_rooms (updated_at)`,
];
const STALE_ROOM_MS = 24 * 60 * 60_000; // rooms untouched for a day are deleted
let schemaReady = false;

export async function ensureSchema(db) {
  if (schemaReady) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  schemaReady = true;
}

export async function load(db, code) {
  const row = await db.prepare("SELECT state, version FROM whodat_rooms WHERE code = ?").bind(code).first();
  return row ? { s: JSON.parse(row.state), version: row.version } : null;
}

export async function insert(db, code, s, now = Date.now()) {
  const res = await db.prepare("INSERT OR IGNORE INTO whodat_rooms (code, state, version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)")
    .bind(code, JSON.stringify(s), now, now).run();
  return res.meta && res.meta.changes === 1;
}

async function save(db, code, s, version, now) {
  const res = await db.prepare("UPDATE whodat_rooms SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?")
    .bind(JSON.stringify(s), now, code, version).run();
  return res.meta && res.meta.changes === 1 ? version + 1 : null;
}

/** Load → change → save, retrying on a conflict. `fn(s, now)` returns { changed, result } or throws. */
export async function update(db, code, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await load(db, code);
    if (!cur) return null;
    const now = Date.now();
    const out = fn(cur.s, now) || {};
    if (!out.changed) return { s: cur.s, version: cur.version, result: out.result };
    const v = await save(db, code, cur.s, cur.version, now);
    if (v !== null) return { s: cur.s, version: v, result: out.result };
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 40));
  }
  throw new Error("Too many moves at once — try again.");
}

export async function cleanup(db, now = Date.now()) {
  await db.prepare("DELETE FROM whodat_rooms WHERE updated_at < ?").bind(now - STALE_ROOM_MS).run();
}
