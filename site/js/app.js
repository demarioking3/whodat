/*
 * WHO DAT — page controller.
 *  - Local mode: the rules engine runs right here; pass-the-device screens hide private info between players.
 *  - Online mode: the server (functions/) runs the same engine and only ever sends this player
 *    what they're allowed to see. Updates arrive by long polling, like TURK.
 * Everything players type is inserted with textContent only (never as HTML).
 */
import * as E from "./engine.js";
import { CHARACTERS, portraitSVG } from "./characters.js";
import * as Sound from "./sound.js";

const API = "/api";
const SESSION_KEY = "whodat:session";
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wide = window.matchMedia("(min-width: 900px)");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function pic(id, cls = "pic") { const d = el("span", cls); d.innerHTML = portraitSVG(id); return d; } // trusted, generated SVG
function store(key, val) { try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch {} }
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
const charName = (id) => (CHARACTERS[id] ? CHARACTERS[id].name : "?");

/* ---------------- state ---------------- */
const S = {
  mode: null,              // "local" | "online"
  // local
  m: null, names: {}, holder: null, localChat: [], localFirst: 0, chatSeq: 0, localMatchNo: 0,
  // online
  code: null, token: null, view: null, pollGen: 0, pollAbort: null, connOk: true, busy: false,
  // ui
  optimistic: new Map(),   // online: portraits tapped but not yet confirmed by the server (id → down?)
  guessMode: false, selectPick: null, lastRead: 0, matchKey: null, prevView: null, lastChatSent: 0,
};

/* ---------------- screens ---------------- */
const SCREENS = ["s-home", "s-local", "s-online", "s-wait", "s-pass", "s-select", "s-game", "s-results"];
function show(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  document.body.dataset.screen = id;
  const inMatch = S.mode && !["s-home", "s-local", "s-online"].includes(id);
  $("btn-leave").hidden = !inMatch || id === "s-results";
  $("conn").hidden = S.mode !== "online" || !inMatch;
  $("roomtag").hidden = S.mode !== "online" || !inMatch || id === "s-wait";
  if (S.mode === "online" && S.code) $("roomtag").textContent = "Room " + S.code;
  if (id !== "s-game") closeChat();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------------- shared view helpers ---------------- */
/** { v: engine view for the person looking at the screen, me, opp, names } */
function ctx() {
  if (S.mode === "local") {
    const v = E.viewFor(S.m, S.holder);
    return { v, me: S.holder, opp: v.opponent, names: S.names };
  }
  const v = S.view && S.view.match;
  return { v, me: S.view ? S.view.you : null, opp: v ? v.opponent : null, names: S.view ? S.view.names : {} };
}
const nm = (names, id) => (names && names[id]) || "Opponent";

/* =========================================================
   BOARD (game + select)
   ========================================================= */
function buildCards(container, onClick) {
  container.textContent = "";
  for (const c of CHARACTERS) {
    const b = el("button", "card");
    b.type = "button";
    b.dataset.id = c.id;
    b.append(pic(c.id, "card__pic"), el("span", "card__name", c.name), el("span", "card__x"));
    b.addEventListener("click", () => onClick(c.id, b));
    container.appendChild(b);
  }
}

/* =========================================================
   SELECT SCREEN
   ========================================================= */
buildCards($("select-board"), (id) => {
  const { v } = ctx();
  if (!v || v.mySelected) return;
  S.selectPick = id;
  Sound.play("select");
  renderSelect();
});
for (const b of $("select-board").children) b.setAttribute("role", "radio");

function renderSelect() {
  const { v, names, opp, me } = ctx();
  const locked = v.mySelected;
  const pick = locked ? v.mySecret : S.selectPick;
  $("select-who").textContent = S.mode === "local" ? nm(names, me) : "Room " + S.code;
  $("select-sub").textContent = locked
    ? `Locked in! Waiting for ${nm(names, opp)} to pick theirs…`
    : (v.oppSelected ? `${nm(names, opp)} already locked in. Your turn to pick.` : "Your opponent has to figure out who it is. Keep it secret.");
  for (const b of $("select-board").children) {
    const id = Number(b.dataset.id);
    b.classList.toggle("is-picked", id === pick);
    b.setAttribute("aria-checked", String(id === pick));
    b.disabled = locked && id !== pick;
  }
  $("select-pick").textContent = pick == null ? "Tap a character" : (locked ? "Your mystery player: " : "Selected: ") + charName(pick);
  $("btn-lock").disabled = pick == null || locked || S.busy;
  $("btn-lock").textContent = locked ? "Locked In ✓" : "Lock In";
}

$("btn-lock").addEventListener("click", async () => {
  if (S.selectPick == null) return;
  const id = S.selectPick;
  if (S.mode === "local") {
    E.select(S.m, S.holder, id);
    Sound.play("send");
    S.selectPick = null;
    const other = S.m.players.find((p) => S.m.secrets[p] === null);
    if (other) passTo(other, "Pick your mystery player", "Make sure the other player can't see the screen.", () => { S.holder = other; show("s-select"); renderSelect(); });
    else startLocalTurn();
  } else {
    await act({ t: "select", id });
    S.selectPick = null;
  }
});

/* =========================================================
   GAME SCREEN
   ========================================================= */
buildCards($("board"), (id, btn) => {
  const { v } = ctx();
  if (!v || v.status !== "play") return;
  if (S.guessMode) return openGuess(id);
  const down = !btn.classList.contains("is-down");
  Sound.play(down ? "knock" : "restore");
  btn.classList.toggle("is-down", down); // instant feedback; the real state follows
  btn.setAttribute("aria-pressed", String(down));
  if (S.mode === "local") { E.toggle(S.m, S.holder, id); renderGame(); return; }
  S.optimistic.set(id, down);
  act({ t: "toggle", id }, { quiet: true }).then((ok) => { if (!ok) { S.optimistic.delete(id); renderCurrent(); } });
});
for (const b of $("board").children) b.setAttribute("aria-pressed", "false");

/* ---- action panel: built once, so typing isn't lost when updates arrive ---- */
const A = (() => {
  const root = $("action");
  const ask = el("form", "ask");
  ask.noValidate = true;
  const lab = el("label", "ask__label", "Ask Your Question");
  lab.htmlFor = "ask-input";
  const input = el("input", "ask__input");
  Object.assign(input, { id: "ask-input", maxLength: E.QUESTION_MAX, placeholder: "e.g. Does your player wear glasses?", autocomplete: "off", enterKeyHint: "send" });
  const meta = el("div", "ask__meta");
  const counter = el("span", "ask__count", `0/${E.QUESTION_MAX}`);
  const submit = el("button", "btn btn--gold", "Submit Question");
  submit.type = "submit";
  meta.append(counter, submit);
  ask.append(lab, input, meta);
  input.addEventListener("input", () => { counter.textContent = `${[...input.value].length}/${E.QUESTION_MAX}`; });

  const waiting = el("div", "pending");
  const waitQ = el("p", "qcard"); const waitMsg = el("p", "pending__msg");
  waiting.append(el("p", "eyebrow", "You asked"), waitQ, waitMsg);

  const result = el("div", "answer-box");
  const resQ = el("p", "qcard"); const resA = el("p", "answer-badge"); const resHint = el("p", "answer-hint");
  const endBtn = el("button", "btn btn--red btn--wide", "Done — End Turn"); endBtn.type = "button";
  result.append(el("p", "eyebrow", "They answered"), resQ, resA, resHint, endBtn);

  const respond = el("div", "respond");
  const respQ = el("p", "qcard qcard--big"); const respWho = el("p", "eyebrow");
  const yn = el("div", "yn");
  const yes = el("button", "yn__btn yn__btn--yes", "YES"); yes.type = "button";
  const no = el("button", "yn__btn yn__btn--no", "NO"); no.type = "button";
  yn.append(yes, no);
  respond.append(respWho, respQ, el("p", "respond__hint", "Answer for YOUR mystery player (shown above the board)."), yn);

  const idle = el("p", "idle");
  const guessBtn = el("button", "btn btn--ghost btn--wide guess-btn", "🎯 Make Final Guess"); guessBtn.type = "button";
  root.append(ask, waiting, result, respond, idle, guessBtn);
  return { root, ask, input, counter, submit, waiting, waitQ, waitMsg, result, resQ, resA, resHint, endBtn, respond, respQ, respWho, yes, no, idle, guessBtn };
})();

A.ask.addEventListener("submit", async (e) => {
  e.preventDefault();
  let text;
  try { text = E.cleanText(A.input.value, E.QUESTION_MAX, "question"); } catch (err) { toast(err.message); Sound.play("error"); return; }
  if (S.mode === "local") {
    try { E.ask(S.m, S.holder, text); } catch (err) { toast(err.message); return; }
    A.input.value = ""; A.counter.textContent = `0/${E.QUESTION_MAX}`;
    Sound.play("send");
    const opp = E.opponentOf(S.m, S.holder);
    passTo(opp, `${S.names[S.holder]} asked you a question`, "Pass the device so they can answer.", () => { S.holder = opp; show("s-game"); renderGame(); Sound.play("receive"); });
  } else {
    A.submit.disabled = true;
    const ok = await act({ t: "ask", text });
    A.submit.disabled = false;
    if (ok) { A.input.value = ""; A.counter.textContent = `0/${E.QUESTION_MAX}`; Sound.play("send"); }
  }
});

async function answerQ(yes) {
  if (S.mode === "local") {
    const asker = S.m.question && S.m.question.by;
    try { E.answer(S.m, S.holder, yes); } catch (err) { toast(err.message); return; }
    Sound.play("send");
    passTo(asker, `${S.names[S.holder]} answered your question`, "Pass the device back to see the answer.", () => { S.holder = asker; show("s-game"); renderGame(); Sound.play("receive"); });
  } else {
    A.yes.disabled = A.no.disabled = true;
    if (await act({ t: "answer", yes })) Sound.play("send");
    A.yes.disabled = A.no.disabled = false;
  }
}
A.yes.addEventListener("click", () => answerQ(true));
A.no.addEventListener("click", () => answerQ(false));

A.endBtn.addEventListener("click", async () => {
  if (S.mode === "local") {
    try { E.endTurn(S.m, S.holder); } catch (err) { toast(err.message); return; }
    S.guessMode = false;
    startLocalTurn();
  } else {
    S.guessMode = false;
    await act({ t: "end" });
  }
});

A.guessBtn.addEventListener("click", () => { S.guessMode = !S.guessMode; renderGame(); });
$("btn-guess-cancel").addEventListener("click", () => { S.guessMode = false; renderGame(); });

function openGuess(id) {
  const box = $("guess-pick");
  box.textContent = "";
  box.append(pic(id, "guess-pick__pic"), el("strong", "guess-pick__name", charName(id)));
  const dlg = $("dlg-guess");
  dlg.returnValue = "";
  dlg.onclose = async () => {
    if (dlg.returnValue !== "ok") return;
    S.guessMode = false;
    if (S.mode === "local") {
      try { E.guess(S.m, S.holder, id); } catch (err) { toast(err.message); return; }
      showResults();
    } else {
      await act({ t: "guess", id });
    }
  };
  dlg.showModal();
}

function stepText(v, me, opp, names) {
  const o = nm(names, opp);
  if (v.turn === me) {
    if (v.step === "ask") return "Type a yes/no question about their mystery player — or make your final guess.";
    if (v.step === "answer") return `Waiting for ${o} to answer…`;
    return `They said ${v.lastAnswer ? v.lastAnswer.answer.toUpperCase() : ""}. Knock down the characters you think are out, then end your turn.`;
  }
  if (v.step === "ask") return `${o} is thinking of a question…`;
  if (v.step === "answer") return `${o} asked you a question — answer it!`;
  return `${o} is knocking down characters…`;
}

function renderGame() {
  const { v, me, opp, names } = ctx();
  if (!v) return;
  const mine = v.turn === me;
  if (v.status !== "play" || !mine || v.step === "answer") S.guessMode = false;

  // turn banner
  const t = $("turn");
  t.classList.toggle("turn--mine", mine);
  t.classList.toggle("turn--theirs", !mine);
  t.classList.toggle("turn--alert", !mine && v.step === "answer");
  $("turn-who").textContent = mine ? (S.mode === "local" ? `${nm(names, me)}'s turn` : "Your turn") : `${nm(names, opp)}'s turn`;
  $("turn-step").textContent = stepText(v, me, opp, names);

  // my mystery player + counts
  $("mine-pic").textContent = "";
  if (v.mySecret != null) { $("mine-pic").appendChild(pic(v.mySecret, "mine__svg")); $("mine-name").textContent = charName(v.mySecret); }
  $("count-me").textContent = E.BOARD_SIZE - v.myBoard.length;
  $("count-opp").textContent = v.oppRemaining;
  $("count-opp-name").textContent = nm(names, opp) + "'s";

  // board (online taps stay as tapped until the server's state agrees)
  const down = new Set(v.myBoard);
  for (const [id, want] of S.optimistic) { if (down.has(id) === want) S.optimistic.delete(id); }
  for (const b of $("board").children) {
    const id = Number(b.dataset.id);
    const isDown = S.optimistic.has(id) ? S.optimistic.get(id) : down.has(id);
    if (b.classList.contains("is-down") !== isDown) b.classList.toggle("is-down", isDown);
    b.setAttribute("aria-pressed", String(isDown));
    b.setAttribute("aria-label", `${charName(id)}${isDown ? " (knocked down)" : ""}`);
    b.classList.toggle("is-secret", id === v.mySecret);
  }
  $("board").classList.toggle("board--guess", S.guessMode);
  $("guess-banner").hidden = !S.guessMode;

  // action panel
  const panel = mine ? (v.step === "ask" ? "ask" : v.step === "answer" ? "waiting" : "result") : (v.step === "answer" ? "respond" : "idle");
  A.ask.hidden = panel !== "ask";
  A.waiting.hidden = panel !== "waiting";
  A.result.hidden = panel !== "result";
  A.respond.hidden = panel !== "respond";
  A.idle.hidden = panel !== "idle";
  A.guessBtn.hidden = !(mine && v.step !== "answer");
  A.guessBtn.textContent = S.guessMode ? "Cancel guess" : "🎯 Make Final Guess";
  A.guessBtn.classList.toggle("is-on", S.guessMode);
  if (panel === "waiting") { A.waitQ.textContent = v.question.text; A.waitMsg.textContent = `Waiting for ${nm(names, opp)} to answer…`; }
  if (panel === "result" && v.lastAnswer) {
    A.resQ.textContent = v.lastAnswer.text;
    A.resA.textContent = v.lastAnswer.answer.toUpperCase();
    A.resA.className = "answer-badge answer-badge--" + v.lastAnswer.answer;
    A.resHint.textContent = "Now tap the portraits this answer rules out. Tap again to undo.";
  }
  if (panel === "respond") { A.respWho.textContent = `${nm(names, opp)} asks:`; A.respQ.textContent = v.question.text; }
  if (panel === "idle") A.idle.textContent = stepText(v, me, opp, names);

  renderHistory(v, names);
  renderChat();
}

function renderHistory(v, names) {
  const list = $("history");
  list.textContent = "";
  $("history-count").textContent = `(${v.history.length})`;
  if (!v.history.length) { list.appendChild(el("li", "history__empty", "No questions yet.")); return; }
  for (const h of v.history.slice().reverse()) {
    const li = el("li", "history__item");
    li.append(el("span", "history__n", "#" + h.n), el("span", "history__who", nm(names, h.by)), el("span", "history__q", h.q), el("span", "answer-badge answer-badge--sm answer-badge--" + h.a, h.a.toUpperCase()));
    list.appendChild(li);
  }
}

/* =========================================================
   CHAT (separate from gameplay — it never touches the match)
   ========================================================= */
function chatMessages() { return S.mode === "local" ? S.localChat : (S.view ? S.view.chat : []); }
function chatMe() { return S.mode === "local" ? S.holder : S.view && S.view.you; }
function chatOpen() { return wide.matches || document.body.classList.contains("chat-open"); }
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function renderChat() {
  const list = $("chat-list");
  const msgs = chatMessages();
  const me = chatMe();
  const names = S.mode === "local" ? S.names : (S.view ? S.view.names : {});
  $("chat-note").hidden = S.mode !== "local";
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const lastId = list.dataset.last ? Number(list.dataset.last) : 0;
  const newestId = msgs.length ? msgs[msgs.length - 1].id : 0;
  const firstShown = list.firstElementChild && list.firstElementChild.dataset.id ? Number(list.firstElementChild.dataset.id) : null;
  const sameStart = msgs.length && firstShown === msgs[0].id && list.dataset.me === String(me);
  if (newestId !== lastId || list.dataset.me !== String(me) || !sameStart) {
    // Only add the new bubbles when we can (re-drawing everything would replay every bubble's animation)
    let fresh = msgs;
    if (sameStart && lastId) fresh = msgs.filter((c) => c.id > lastId);
    else list.textContent = "";
    if (!msgs.length) list.appendChild(el("li", "chat__empty", S.mode === "local" ? "Say something. Both players see this screen." : "Say something to your opponent…"));
    for (const c of fresh) {
      const li = el("li", "msg " + (c.by === me ? "msg--me" : "msg--them"));
      li.dataset.id = c.id;
      const head = el("span", "msg__head");
      head.append(el("span", "msg__name", c.by === me ? (S.mode === "local" ? nm(names, c.by) : "You") : nm(names, c.by)), el("time", "msg__time", fmtTime(c.at)));
      li.append(head, el("span", "msg__text", c.text));
      list.appendChild(li);
    }
    list.dataset.last = newestId;
    list.dataset.me = String(me);
    const mineNewest = msgs.length && msgs[msgs.length - 1].by === me;
    if (nearBottom || mineNewest || !lastId) list.scrollTop = list.scrollHeight;
  }
  // unread badge (mobile drawer closed)
  if (chatOpen() && !$("s-game").hidden) S.lastRead = newestId;
  const unread = msgs.filter((c) => c.id > S.lastRead && c.by !== me).length;
  const badge = $("chat-badge");
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? "9+" : String(unread);
}

function openChat() {
  document.body.classList.add("chat-open");
  $("btn-chat").setAttribute("aria-expanded", "true");
  $("chat-scrim").hidden = false;
  renderChat();
  const list = $("chat-list"); list.scrollTop = list.scrollHeight;
  setTimeout(() => $("chat-input").focus({ preventScroll: true }), 50);
}
function closeChat() {
  document.body.classList.remove("chat-open");
  $("btn-chat").setAttribute("aria-expanded", "false");
  $("chat-scrim").hidden = true;
}
$("btn-chat").addEventListener("click", () => (document.body.classList.contains("chat-open") ? closeChat() : openChat()));
$("btn-chat-close").addEventListener("click", closeChat);
$("chat-scrim").addEventListener("click", closeChat);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("chat-open")) closeChat(); });
wide.addEventListener("change", () => { closeChat(); renderChat(); });

for (const b of document.querySelectorAll("[data-emoji]")) {
  b.addEventListener("click", () => {
    const inp = $("chat-input");
    const pos = inp.selectionStart ?? inp.value.length;
    inp.value = (inp.value.slice(0, pos) + b.dataset.emoji + inp.value.slice(inp.selectionEnd ?? pos)).slice(0, E.CHAT_MAX);
    inp.focus();
  });
}

function chatStatus(text, cls = "") {
  const s = $("chat-status");
  s.textContent = text; s.className = "chat__status " + cls;
}

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inp = $("chat-input");
  let text;
  try { text = E.cleanText(inp.value, E.CHAT_MAX, "message"); } catch (err) { if (inp.value.trim()) chatStatus(err.message, "is-bad"); return; }
  const now = Date.now();
  if (now - S.lastChatSent < 400) { chatStatus("Slow down a sec…", "is-bad"); return; }
  S.lastChatSent = now;
  inp.value = "";
  if (S.mode === "local") {
    S.localChat.push({ id: ++S.chatSeq, by: S.holder, text, at: now });
    if (S.localChat.length > 100) S.localChat.shift();
    Sound.play("chat");
    renderChat();
    return;
  }
  chatStatus("Sending…");
  try {
    const r = await post(`/rooms/${S.code}/chat`, { text });
    if (r.ok && r.data.state) { applyView(r.data.state); chatStatus("Sent ✓", "is-ok"); Sound.play("chat"); setTimeout(() => { if ($("chat-status").textContent === "Sent ✓") chatStatus(""); }, 1500); }
    else { chatStatus(r.data.error || "Message not sent.", "is-bad"); if (!inp.value) inp.value = text; }
  } catch {
    chatStatus("Not sent — check your connection.", "is-bad");
    if (!inp.value) inp.value = text;
  }
});

/* =========================================================
   RESULTS
   ========================================================= */
function showResults() {
  const { v, me, names } = ctx();
  const r = v.result;
  show("s-results");
  const winName = nm(names, r.winner), loseName = nm(names, r.loser);
  const iWon = r.winner === me;
  if (S.mode === "local") { $("res-eyebrow").textContent = "Match over"; $("res-title").textContent = `${winName} wins!`; }
  else { $("res-eyebrow").textContent = iWon ? "Winner winner" : "Match over"; $("res-title").textContent = iWon ? "YOU WIN!" : "YOU LOSE"; }
  $("s-results").classList.toggle("is-loss", S.mode === "online" && !iWon);
  const g = r.guess;
  $("res-sub").textContent =
    r.reason === "guessed" ? `${nm(names, g.by)} guessed ${charName(g.id)} — correct!`
    : r.reason === "missed" ? `${nm(names, g.by)} guessed ${charName(g.id)}… wrong! It was ${charName(r.secrets[E.opponentOf({ players: [r.winner, r.loser] }, g.by)])}.`
    : `${loseName} left the match.`;
  const reveal = $("reveal");
  reveal.textContent = "";
  for (const pid of [me, E.opponentOf({ players: [r.winner, r.loser] }, me)]) {
    const id = r.secrets[pid];
    const card = el("figure", "reveal__card" + (pid === r.winner ? " is-winner" : ""));
    if (id != null) card.appendChild(pic(id, "reveal__pic"));
    else card.appendChild(el("span", "reveal__none", "?"));
    const cap = el("figcaption", "reveal__cap");
    cap.append(el("span", "reveal__who", `${S.mode === "online" && pid === me ? "Your" : nm(names, pid) + "'s"} mystery player`), el("strong", "reveal__name", id != null ? charName(id) : "Not picked"));
    card.appendChild(cap);
    reveal.appendChild(card);
  }
  renderResultsActions();
  if (S.mode === "local" || iWon) { confetti(); Sound.play("win"); } else Sound.play("lose");
}

function renderResultsActions() {
  const note = $("res-note");
  const replay = $("btn-replay");
  replay.disabled = false;
  replay.textContent = "Replay";
  note.textContent = "";
  if (S.mode !== "online" || !S.view) return;
  const opp = S.view.room.players.find((p) => p.id !== S.view.you);
  if (!opp) { replay.disabled = true; note.textContent = `Your opponent left. Share code ${S.code} to play someone new, or start a new match.`; return; }
  const wantMe = S.view.rematch.includes(S.view.you), wantThem = S.view.rematch.includes(opp.id);
  if (wantMe) { replay.disabled = true; replay.textContent = "Waiting…"; note.textContent = `Waiting for ${opp.name} to accept the rematch…`; }
  else if (wantThem) { replay.textContent = "Accept Rematch"; note.textContent = `${opp.name} wants a rematch!`; }
}

function confetti() {
  const box = $("confetti");
  box.textContent = "";
  if (reduceMotion.matches) return;
  const colors = ["#ffc93c", "#ff2a3d", "#1fb6ff", "#f6f6f8"];
  for (let i = 0; i < 70; i++) {
    const p = el("i", "confetti__p");
    p.style.setProperty("--x", Math.random() * 100 + "vw");
    p.style.setProperty("--d", (2.2 + Math.random() * 2.2).toFixed(2) + "s");
    p.style.setProperty("--delay", (Math.random() * 0.8).toFixed(2) + "s");
    p.style.setProperty("--r", Math.round(Math.random() * 720 - 360) + "deg");
    p.style.setProperty("--c", colors[i % colors.length]);
    box.appendChild(p);
  }
  setTimeout(() => { box.textContent = ""; }, 5500);
}

$("btn-replay").addEventListener("click", async () => {
  if (S.mode === "local") return localReplay();
  await act({ t: "rematch" });
});
$("btn-new").addEventListener("click", async () => {
  if (S.mode === "local") { S.mode = null; show("s-local"); return; }
  await leaveOnline();
  show("s-online");
});

/* =========================================================
   PASS-THE-DEVICE (local)
   ========================================================= */
let passNext = null;
function passTo(pid, eyebrow, msg, next) {
  passNext = next;
  $("pass-eyebrow").textContent = eyebrow;
  $("pass-title").textContent = `Pass to ${S.names[pid]}`;
  $("pass-msg").textContent = msg;
  $("btn-pass").textContent = `I'm ${S.names[pid]} — show me`;
  show("s-pass");
  $("btn-pass").focus({ preventScroll: true });
}
$("btn-pass").addEventListener("click", () => { const n = passNext; passNext = null; if (n) n(); });

/* =========================================================
   LOCAL MODE
   ========================================================= */
function localName(raw, fallback) {
  try { return E.cleanText(raw || "", 20, "name"); } catch { return fallback; }
}
$("form-local").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  let a = localName(f.p1.value, "Player 1"), b = localName(f.p2.value, "Player 2");
  if (a === b) b += " (2)";
  S.mode = "local";
  S.names = { p1: a, p2: b };
  S.localChat = []; S.chatSeq = 0; S.lastRead = 0;
  S.localFirst = Math.random() < 0.5 ? 0 : 1;
  newLocalMatch();
});
function newLocalMatch() {
  S.m = E.newMatch(["p1", "p2"], S.localFirst);
  S.localMatchNo += 1;
  S.guessMode = false; S.selectPick = null;
  passTo("p1", "Pick your mystery player", "Make sure the other player can't see the screen.", () => { S.holder = "p1"; show("s-select"); renderSelect(); });
}
function localReplay() {
  S.localFirst = 1 - S.localFirst;
  newLocalMatch();
}
function startLocalTurn() {
  const active = E.activePlayer(S.m);
  passTo(active, `Turn ${S.m.turnNo}`, "Your turn to ask a question.", () => { S.holder = active; show("s-game"); renderGame(); Sound.play("turn"); });
}

/* =========================================================
   ONLINE MODE
   ========================================================= */
async function post(path, body, token = S.token) {
  const r = await fetch(API + path, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", ...(token ? { "X-WhoDat-Token": token } : {}) },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data };
}

async function act(msg, { quiet = false } = {}) {
  if (S.busy && !quiet) return false;
  if (!quiet) S.busy = true;
  try {
    const r = await post(`/rooms/${S.code}/act`, msg);
    if (r.ok && r.data.state) { applyView(r.data.state); return true; }
    if (r.ok && r.data.left) return true;
    if (r.status === 403 || r.status === 404) { endOnline(r.data.error || "That room is gone."); return false; }
    toast(r.data.error || "That didn't work. Try again.");
    Sound.play("error");
    renderCurrent(); // undo any instant feedback
    return false;
  } catch {
    toast("Couldn't reach the game server. Check your connection.");
    renderCurrent();
    return false;
  } finally { if (!quiet) S.busy = false; }
}

function saveSession(name) { store(SESSION_KEY, JSON.stringify({ code: S.code, token: S.token, name })); }
function loadSession() { try { return JSON.parse(read(SESSION_KEY) || "null"); } catch { return null; } }

async function joinOnline(code, name, token) {
  const r = await post(`/rooms/${code}/join`, { name, token }, null);
  if (!r.ok) return r;
  S.mode = "online";
  S.code = code;
  S.token = r.data.token;
  S.view = null; S.prevView = null; S.matchKey = null; S.lastRead = 0;
  saveSession(name || (r.data.state.names && r.data.state.names[r.data.id]) || "");
  history.replaceState(null, "", "/?room=" + code);
  applyView(r.data.state);
  startPolling();
  return r;
}

function onlineError(msg) { const e = $("form-online").querySelector(".form__error"); e.textContent = msg || ""; }

$("form-online").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = e.target.name.value;
  onlineError("");
  if (!name.trim()) return onlineError("Enter your name first.");
  const btn = e.submitter || e.target.querySelector("[name=create]");
  btn.disabled = true;
  try {
    const r = await post("/rooms", {}, null);
    if (!r.ok) return onlineError(r.data.error || "Couldn't create a room.");
    const j = await joinOnline(r.data.code, name);
    if (!j.ok) onlineError(j.data.error);
  } catch { onlineError("Couldn't reach the game server. Check your connection."); }
  finally { btn.disabled = false; }
});
$("btn-join").addEventListener("click", async () => {
  const f = $("form-online");
  const code = f.code.value.trim().toUpperCase();
  onlineError("");
  if (!f.name.value.trim()) return onlineError("Enter your name first.");
  if (!CODE_RE.test(code)) return onlineError("Room codes are 5 letters/numbers.");
  $("btn-join").disabled = true;
  try {
    const j = await joinOnline(code, f.name.value);
    if (!j.ok) onlineError(j.data.error || "Couldn't join that room.");
  } catch { onlineError("Couldn't reach the game server. Check your connection."); }
  finally { $("btn-join").disabled = false; }
});
$("form-online").code.addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });

function setConn(ok) {
  S.connOk = ok;
  const c = $("conn");
  const opp = S.view && S.view.room.players.find((p) => p.id !== S.view.you);
  let cls = "ok", text = "Connected";
  if (!ok) { cls = "bad"; text = "Reconnecting…"; }
  else if (S.view && S.view.match && opp && !opp.connected) { cls = "warn"; text = `${opp.name} offline`; }
  else if (S.view && S.view.match && !opp) { cls = "warn"; text = "Opponent left"; }
  c.className = "conn conn--" + cls;
  c.querySelector(".conn__text").textContent = text;
}

function startPolling() {
  const gen = ++S.pollGen;
  if (S.pollAbort) S.pollAbort.abort();
  pollLoop(gen);
}
async function pollLoop(gen) {
  let backoff = 1000;
  while (S.pollGen === gen && S.mode === "online") {
    const since = S.view ? S.view.version : 0;
    const conn = S.view ? S.view.room.players.map((p) => p.connected).join() : "";
    try {
      S.pollAbort = new AbortController();
      const r = await fetch(`${API}/rooms/${S.code}/state?since=${since}&conn=${encodeURIComponent(conn)}`, {
        headers: { "X-WhoDat-Token": S.token }, cache: "no-store", signal: S.pollAbort.signal,
      });
      if (S.pollGen !== gen) return;
      if (r.status === 204) { setConn(true); backoff = 1000; continue; }
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.state) { setConn(true); backoff = 1000; applyView(data.state, true); continue; }
      if (r.status === 403 || r.status === 404) { endOnline(data.error || "That room has closed."); return; }
      throw new Error("bad response");
    } catch (e) {
      if (S.pollGen !== gen) return;
      setConn(false);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 8000);
    }
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.mode === "online" && S.code) startPolling();
});

function endOnline(msg) {
  S.pollGen++;
  if (S.pollAbort) S.pollAbort.abort();
  store(SESSION_KEY, null);
  S.mode = null; S.view = null; S.code = null; S.token = null;
  history.replaceState(null, "", "/");
  show("s-online");
  onlineError(msg);
}
async function leaveOnline() {
  const code = S.code, token = S.token;
  S.pollGen++;
  if (S.pollAbort) S.pollAbort.abort();
  store(SESSION_KEY, null);
  S.mode = null; S.view = null; S.code = null; S.token = null;
  history.replaceState(null, "", "/");
  if (code && token) { try { await post(`/rooms/${code}/act`, { t: "leave" }, token); } catch {} }
}

/** New state from the server: play sounds for what changed, then redraw. */
function applyView(nv, fromPoll = false) {
  if (S.view && nv.version < S.view.version) return;
  const pv = S.view;
  S.view = nv;
  const me = nv.you, m = nv.match, pm = pv && pv.match;
  if (pv && m && pm && nv.matchNo === pv.matchNo) {
    if (m.question && !pm.question && m.question.by !== me) Sound.play("receive");
    if (m.lastAnswer && !pm.lastAnswer && m.lastAnswer.by === me) Sound.play("receive");
    if (m.status === "play" && m.turn === me && pm.turn !== me) Sound.play("turn");
  }
  if (pv && fromPoll) {
    const lastPrev = pv.chat.length ? pv.chat[pv.chat.length - 1].id : 0;
    if (nv.chat.some((c) => c.id > lastPrev && c.by !== me)) Sound.play("chat");
  }
  if (pv && m && pm && m.status === "play" && pm.status === "select") Sound.play("turn");
  setConn(S.connOk);
  routeOnline(pv);
}

function routeOnline(pv) {
  const v = S.view;
  const m = v.match;
  const key = m ? `${v.matchNo}:${m.status}` : "wait";
  const changed = key !== S.matchKey;
  S.matchKey = key;
  if (!m) { show("s-wait"); renderWait(); return; }
  if (changed && m.status === "select") { S.selectPick = null; S.guessMode = false; S.optimistic.clear(); }
  if (m.status === "select") { if (changed) show("s-select"); renderSelect(); return; }
  if (m.status === "play") { if (changed) show("s-game"); renderGame(); return; }
  if (m.status === "over") { if (changed) showResults(); else renderResultsActions(); }
}

function renderWait() {
  $("wait-code").textContent = S.code;
  const seats = $("wait-seats");
  seats.textContent = "";
  for (const p of S.view.room.players) {
    const li = el("li", "seat" + (p.connected ? " is-on" : ""));
    li.append(el("span", "seat__dot"), el("span", "seat__name", p.name + (p.id === S.view.you ? " (you)" : "")));
    seats.appendChild(li);
  }
  if (S.view.room.players.length < 2) seats.appendChild(el("li", "seat seat--empty", "Open seat…"));
  $("wait-msg").textContent = S.view.room.players.length < 2 ? "Waiting for a second player to join" : "Player joined! Starting…";
}

$("btn-copy").addEventListener("click", async () => {
  const link = `${location.origin}/?room=${S.code}`;
  try { await navigator.clipboard.writeText(link); $("copy-note").textContent = "Invite link copied!"; }
  catch { $("copy-note").textContent = link; }
});

function renderCurrent() {
  if (S.mode === "online" && S.view) routeOnline();
  else if (S.mode === "local" && !$("s-game").hidden) renderGame();
}

/* =========================================================
   NAV, LEAVE, MUTE, HOW-TO, STARTUP
   ========================================================= */
for (const b of document.querySelectorAll("[data-go=home]")) b.addEventListener("click", () => show("s-home"));
$("btn-local").addEventListener("click", () => { show("s-local"); $("form-local").p1.focus(); });
$("btn-online").addEventListener("click", () => {
  show("s-online");
  const f = $("form-online");
  const sess = loadSession();
  if (!f.name.value && sess && sess.name) f.name.value = sess.name;
  f.name.focus();
});
const openHow = () => $("dlg-how").showModal();
$("btn-how").addEventListener("click", openHow);
$("btn-how2").addEventListener("click", openHow);

function askLeave() {
  const dlg = $("dlg-leave");
  $("leave-msg").textContent = S.mode === "online"
    ? "If a match is in progress, leaving counts as a loss. You can always come back to a room you didn't leave."
    : "This ends the local match.";
  dlg.returnValue = "";
  dlg.onclose = async () => {
    if (dlg.returnValue !== "ok") return;
    if (S.mode === "online") await leaveOnline();
    S.mode = null;
    show("s-home");
  };
  dlg.showModal();
}
$("btn-leave").addEventListener("click", askLeave);
for (const b of document.querySelectorAll("[data-act=leave]")) b.addEventListener("click", askLeave);

function renderMute() {
  const m = Sound.isMuted();
  $("btn-mute").setAttribute("aria-pressed", String(m));
  $("btn-mute").setAttribute("aria-label", m ? "Unmute sounds" : "Mute sounds");
  $("btn-mute").querySelector(".ico-sound").textContent = m ? "🔇" : "🔊";
}
$("btn-mute").addEventListener("click", () => { Sound.setMuted(!Sound.isMuted()); renderMute(); if (!Sound.isMuted()) Sound.play("select"); });
renderMute();

(async function start() {
  const params = new URLSearchParams(location.search);
  const room = (params.get("room") || "").toUpperCase();
  const sess = loadSession();
  // Reconnect to a room this browser is already in (reload, phone locked, lost signal...)
  if (sess && sess.code && sess.token && (!room || room === sess.code)) {
    try {
      const r = await joinOnline(sess.code, undefined, sess.token);
      if (r.ok) return;
    } catch {}
    store(SESSION_KEY, null);
  }
  if (CODE_RE.test(room)) {
    show("s-online");
    const f = $("form-online");
    f.code.value = room;
    if (sess && sess.name) f.name.value = sess.name;
    onlineError("");
    (f.name.value ? $("btn-join") : f.name).focus();
    return;
  }
  show("s-home");
})();
