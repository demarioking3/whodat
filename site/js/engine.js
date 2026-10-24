/*
 * WHO DAT — rules engine.
 * Pure functions on a plain JSON match object. No DOM, no network.
 * Used by the browser for local (same-device) play and by the server (functions/) for online play,
 * so both modes follow exactly the same rules.
 *
 * IMPORTANT DESIGN RULE: the engine never eliminates characters for a player. The only way a portrait is
 * knocked down (or restored) is the owner's own `toggle` call. Answers never touch the boards.
 *
 * Turn flow:  ask  →  answer (opponent)  →  eliminate (asker toggles portraits)  →  endTurn  →  next player
 * A final guess can be made by the active player when no question is waiting for an answer. One guess per match:
 * right = win, wrong = loss.
 */

export const BOARD_SIZE = 24;
export const QUESTION_MAX = 140;
export const CHAT_MAX = 280;
export const HISTORY_MAX = 200;

export class GameError extends Error {
  constructor(message, code) { super(message); this.code = code || null; }
}

/* Remove control and text-direction characters (keeps emoji joiners), collapse spaces, trim, length-check. */
const STRIP = /[\u0000-\u001F\u007F-\u009F​‎‏‪-‮⁠⁦-⁩﻿]/g;
export function cleanText(raw, max, what = "message") {
  if (typeof raw !== "string") throw new GameError(`Type a ${what} first.`, "empty");
  const t = raw.normalize("NFC").replace(STRIP, " ").replace(/\s+/g, " ").trim();
  if (!t) throw new GameError(`Type a ${what} first.`, "empty");
  if ([...t].length > max) throw new GameError(`Keep your ${what} under ${max} characters.`, "long");
  return t;
}

function validChar(id) { return Number.isInteger(id) && id >= 0 && id < BOARD_SIZE; }
function other(m, pid) { return m.players[0] === pid ? m.players[1] : m.players[0]; }
function need(cond, msg, code) { if (!cond) throw new GameError(msg, code); }
export function activePlayer(m) { return m.status === "play" ? m.players[m.turn] : null; }
export function opponentOf(m, pid) { return other(m, pid); }

/** Start a match. `first` (0 or 1) is who asks first. */
export function newMatch(players, first = 0) {
  need(Array.isArray(players) && players.length === 2 && players[0] !== players[1], "A match needs two players.");
  return {
    status: "select",                       // select → play → over
    players: players.slice(),
    secrets: { [players[0]]: null, [players[1]]: null },
    boards: { [players[0]]: [], [players[1]]: [] }, // ids each player has knocked down on THEIR OWN board
    turn: first === 1 ? 1 : 0,
    turnNo: 0,
    step: null,                             // "ask" | "answer" | "eliminate"
    question: null,                         // { by, text, n } while waiting for an answer
    lastAnswer: null,                       // { by, text, answer, n } shown to the asker during "eliminate"
    history: [],                            // official Q&A log: { n, by, q, a }
    result: null,                           // { winner, loser, reason, guess: { by, id, correct } }
  };
}

/** Lock in a player's mystery character. The match starts when both have chosen. */
export function select(m, pid, id) {
  need(m.status === "select", "Mystery players are already locked in.");
  need(m.players.includes(pid), "You're not in this match.");
  need(validChar(id), "Pick a character from the board.");
  need(m.secrets[pid] === null, "You already locked in your mystery player.");
  m.secrets[pid] = id;
  if (m.players.every((p) => m.secrets[p] !== null)) {
    m.status = "play";
    m.step = "ask";
    m.turnNo = 1;
  }
}

export function ask(m, pid, text) {
  need(m.status === "play", "The match isn't in progress.");
  need(activePlayer(m) === pid, "It's not your turn to ask.", "turn");
  need(m.step === "ask", m.step === "answer" ? "Wait for your opponent to answer first." : "You already asked this turn. Knock down characters, then end your turn.", "step");
  const q = cleanText(text, QUESTION_MAX, "question");
  m.question = { by: pid, text: q, n: m.turnNo };
  m.lastAnswer = null;
  m.step = "answer";
}

export function answer(m, pid, yes) {
  need(m.status === "play", "The match isn't in progress.");
  need(m.step === "answer" && m.question, "There's no question to answer.", "step");
  need(pid === other(m, m.question.by), "Only your opponent can answer your question.", "turn");
  need(typeof yes === "boolean", "Answer Yes or No.");
  const entry = { n: m.question.n, by: m.question.by, q: m.question.text, a: yes ? "yes" : "no" };
  m.history.push(entry);
  if (m.history.length > HISTORY_MAX) m.history.shift();
  m.lastAnswer = { by: entry.by, text: entry.q, answer: entry.a, n: entry.n };
  m.question = null;
  m.step = "eliminate";
  // Deliberately NO board changes here: the asker knocks characters down manually.
}

/** Knock down / restore one portrait on the player's OWN board. Allowed any time during play; never ends a turn. */
export function toggle(m, pid, id) {
  need(m.status === "play", "The match isn't in progress.");
  need(m.players.includes(pid), "You're not in this match.");
  need(validChar(id), "That character isn't on the board.");
  const b = m.boards[pid];
  const i = b.indexOf(id);
  if (i >= 0) b.splice(i, 1); else b.push(id);
  return i < 0; // true = now knocked down
}

export function endTurn(m, pid) {
  need(m.status === "play", "The match isn't in progress.");
  need(activePlayer(m) === pid, "It's not your turn.", "turn");
  need(m.step !== "answer", "Your question still needs an answer.", "step");
  need(m.step === "eliminate", "Ask a question before ending your turn.", "step");
  m.turn = 1 - m.turn;
  m.turnNo += 1;
  m.step = "ask";
  m.lastAnswer = null;
}

/** Final guess. One shot: correct wins, wrong loses. */
export function guess(m, pid, id) {
  need(m.status === "play", "The match isn't in progress.");
  need(activePlayer(m) === pid, "You can only guess on your own turn.", "turn");
  need(m.step !== "answer", "Wait for the answer before guessing.", "step");
  need(validChar(id), "Pick a character to guess.");
  const opp = other(m, pid);
  const correct = m.secrets[opp] === id;
  finish(m, correct ? pid : opp, correct ? "guessed" : "missed", { by: pid, id, correct });
}

/** A player left / gave up: the other player wins. */
export function forfeit(m, pid) {
  if (m.status === "over") return;
  need(m.players.includes(pid), "You're not in this match.");
  finish(m, other(m, pid), "forfeit", null);
}

function finish(m, winner, reason, g) {
  m.status = "over";
  m.step = null;
  m.question = null;
  m.result = { winner, loser: other(m, winner), reason, guess: g };
}

/**
 * What one player is allowed to know. The opponent's secret is only included once the match is over,
 * and the opponent's board is reduced to a count.
 */
export function viewFor(m, pid) {
  const opp = other(m, pid);
  const over = m.status === "over";
  return {
    status: m.status,
    you: pid,
    opponent: opp,
    turn: activePlayer(m),
    turnNo: m.turnNo,
    step: m.step,
    question: m.question ? { ...m.question } : null,
    lastAnswer: m.lastAnswer ? { ...m.lastAnswer } : null,
    history: m.history.map((h) => ({ ...h })),
    mySecret: m.secrets[pid],
    mySelected: m.secrets[pid] !== null,
    oppSelected: m.secrets[opp] !== null,
    myBoard: m.boards[pid].slice(),
    oppRemaining: BOARD_SIZE - m.boards[opp].length,
    result: over ? { ...m.result, secrets: { ...m.secrets } } : null,
  };
}
