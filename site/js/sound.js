/*
 * WHO DAT sound effects — tiny synthesized blips (Web Audio), so there are no audio files to load.
 * Muting is remembered on this device. Sounds only start after the player's first tap (browser rule).
 */
let ctx = null;
let muted = false;
try { muted = localStorage.getItem("whodat:muted") === "1"; } catch {}

function ac() {
  if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
function tone(freq, start, dur, { type = "square", vol = 0.06, to = null } = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + start;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const SOUNDS = {
  select:  () => { tone(660, 0, .08); tone(990, .07, .1); },
  send:    () => { tone(420, 0, .12, { type: "triangle", to: 880, vol: .08 }); },
  receive: () => { tone(880, 0, .09, { type: "triangle", vol: .08 }); tone(1320, .1, .14, { type: "triangle", vol: .08 }); },
  knock:   () => { tone(300, 0, .16, { type: "sawtooth", to: 90, vol: .07 }); },
  restore: () => { tone(220, 0, .12, { type: "triangle", to: 520, vol: .07 }); },
  turn:    () => { tone(523, 0, .09, { type: "triangle" }); tone(784, .09, .12, { type: "triangle" }); },
  chat:    () => { tone(1200, 0, .05, { type: "sine", vol: .05 }); },
  win:     () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .12, .22, { type: "square", vol: .07 })); tone(1568, .5, .5, { type: "triangle", vol: .06 }); },
  lose:    () => { [392, 330, 262, 196].forEach((f, i) => tone(f, i * .16, .26, { type: "sawtooth", vol: .05 })); },
  error:   () => { tone(160, 0, .14, { type: "square", vol: .05 }); },
};
export function play(name) { if (!muted && SOUNDS[name]) { try { SOUNDS[name](); } catch {} } }
export function isMuted() { return muted; }
export function setMuted(v) { muted = !!v; try { localStorage.setItem("whodat:muted", muted ? "1" : "0"); } catch {} }
