/* Rules engine tests: the same engine runs local games in the browser and online games on the server. */
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../site/js/engine.js";
import { CHARACTERS, portraitSVG } from "../site/js/characters.js";

const started = (first = 0) => {
  const m = E.newMatch(["a", "b"], first);
  E.select(m, "a", 3);
  E.select(m, "b", 17);
  return m;
};

test("24 unique characters with distinct looks and valid portraits", () => {
  assert.equal(CHARACTERS.length, E.BOARD_SIZE);
  assert.equal(new Set(CHARACTERS.map((c) => c.name)).size, 24);
  const looks = CHARACTERS.map((c) => [c.skin, c.hair, c.hairColor, c.face, c.glasses, c.hat, c.extra, c.top].join("|"));
  assert.equal(new Set(looks).size, 24, "no two characters look the same");
  for (const c of CHARACTERS) {
    const svg = portraitSVG(c.id);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 120 140"/);
    assert.doesNotMatch(svg, /style=|<script|on\w+=|NaN|undefined/, `portrait ${c.name} is clean`);
  }
});

test("secret selection: locked once, match starts only when both chose", () => {
  const m = E.newMatch(["a", "b"]);
  assert.throws(() => E.ask(m, "a", "Beard?"), /isn't in progress/);
  E.select(m, "a", 0);
  assert.equal(m.status, "select");
  assert.throws(() => E.select(m, "a", 1), /already locked/);
  assert.throws(() => E.select(m, "b", 24), /Pick a character/);
  assert.throws(() => E.select(m, "b", "3"), /Pick a character/);
  E.select(m, "b", 5);
  assert.equal(m.status, "play");
  assert.equal(m.step, "ask");
  const va = E.viewFor(m, "a");
  assert.equal(va.mySecret, 0);
  assert.equal(JSON.stringify(va).includes('"b":5'), false, "opponent's secret is not in my view");
  assert.equal(va.result, null);
});

test("typed questions: only the active player, one at a time, cleaned", () => {
  const m = started(0);
  assert.throws(() => E.ask(m, "b", "Hat?"), /not your turn/);
  assert.throws(() => E.ask(m, "a", "   "), /Type a question/);
  assert.throws(() => E.ask(m, "a", "x".repeat(141)), /under 140/);
  E.ask(m, "a", "  Does the player   have a ‮beard?\n");
  assert.equal(m.question.text, "Does the player have a beard?");
  assert.throws(() => E.ask(m, "a", "Glasses?"), /Wait for your opponent/);
  assert.throws(() => E.endTurn(m, "a"), /still needs an answer/);
  assert.throws(() => E.guess(m, "a", 17), /Wait for the answer/);
  assert.throws(() => E.answer(m, "a", true), /Only your opponent/);
  assert.equal(E.viewFor(m, "b").question.text, "Does the player have a beard?");
});

test("answers NEVER knock anyone down: elimination is manual and reversible", () => {
  const m = started(0);
  E.ask(m, "a", "Does the player have a beard?");
  E.answer(m, "b", false);
  assert.deepEqual(m.boards.a, [], "answering changed nobody's board");
  assert.deepEqual(m.boards.b, []);
  assert.equal(m.step, "eliminate");
  assert.equal(E.viewFor(m, "a").lastAnswer.answer, "no");
  assert.equal(E.toggle(m, "a", 0), true);
  assert.equal(E.toggle(m, "a", 4), true);
  assert.equal(E.toggle(m, "a", 4), false, "click again restores");
  assert.deepEqual(m.boards.a, [0]);
  assert.deepEqual(m.boards.b, [], "boards are independent");
  assert.equal(E.viewFor(m, "b").oppRemaining, 23);
});

test("turns: can't end before asking, can end after answer; history kept", () => {
  const m = started(1);
  assert.equal(E.activePlayer(m), "b");
  assert.throws(() => E.endTurn(m, "b"), /Ask a question/);
  assert.throws(() => E.endTurn(m, "a"), /not your turn/);
  E.ask(m, "b", "Glasses?");
  E.answer(m, "a", true);
  E.toggle(m, "b", 9);
  E.endTurn(m, "b");
  assert.equal(E.activePlayer(m), "a");
  assert.equal(m.turnNo, 2);
  assert.deepEqual(m.boards.b, [9], "board persists across turns");
  E.ask(m, "a", "Hat?");
  E.answer(m, "b", true);
  E.endTurn(m, "a");
  assert.deepEqual(E.viewFor(m, "a").history.map((h) => [h.by, h.q, h.a]), [["b", "Glasses?", "yes"], ["a", "Hat?", "yes"]]);
});

test("final guess: right wins, wrong loses, only once, secrets revealed", () => {
  let m = started(0);
  assert.throws(() => E.guess(m, "b", 3), /own turn/);
  E.guess(m, "a", 17);
  assert.equal(m.result.winner, "a");
  assert.equal(m.result.reason, "guessed");
  assert.deepEqual(E.viewFor(m, "b").result.secrets, { a: 3, b: 17 });
  assert.throws(() => E.guess(m, "a", 17), /isn't in progress/);
  assert.throws(() => E.toggle(m, "a", 1), /isn't in progress/);

  m = started(0);
  E.ask(m, "a", "Q?"); E.answer(m, "b", true);
  E.guess(m, "a", 2);
  assert.equal(m.result.winner, "b");
  assert.equal(m.result.reason, "missed");
});

test("forfeit gives the other player the win", () => {
  const m = started(0);
  E.forfeit(m, "a");
  assert.equal(m.result.winner, "b");
  assert.equal(m.result.reason, "forfeit");
});
