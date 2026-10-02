// SPDX-License-Identifier: AGPL-3.0-only
// Hard mode's knowledge, shared by ID mode (game.js) and ABC mode (abc.js):
// everything the feedback so far says about the answer, so that a hard-mode
// guess must be one that could still BE the answer.
//
// The feedback is kept per tile and per character, not as one colour per
// character: a 1 that is green in tile 6 and grey in tile 5 is both "the 1 is
// in tile 6" and "there is exactly one 1, and none in tile 5". Summarising it
// as "1 = green" (the keyboard colour) loses the rest and lets impossible
// guesses through, a repeat of an earlier guess among them.
//
//   fixed[i]   the character a green fixed in tile i (undefined if none)
//   banned[i]  characters tile i can't hold: every grey or yellow it showed
//   min[c]     c appears at least this often (its greens + yellows in one guess)
//   max[c]     c appears at most this often: once a guess shows a c grey, the
//              answer holds exactly as many as that guess had green + yellow
//              (0 = absent everywhere, the old grey ban)
//
// A word meets all four exactly when, scored against every earlier guess, it
// gives the colours the answer gave (standard Wordle scoring), i.e. when it
// could still be the answer; tools/test_logic.mjs checks that equivalence.
// Pure functions, no DOM. A classic-script global loaded before game.js and
// abc.js (test sandboxes prepend this file).
const MuldleHints = (function () {
"use strict";

// scored: [{ guess, score }] with score[i] in "correct" | "present" | "absent"
function knowledge(scored) {
  const len = scored.length ? scored[0].guess.length : 0;
  const fixed = new Array(len);
  const banned = Array.from({ length: len }, () => new Set());
  const min = new Map(), max = new Map(); // Maps keep first-seen order for messages
  for (const { guess, score } of scored) {
    const shown = new Map(), grey = new Set(); // per char: greens + yellows, any grey
    for (let i = 0; i < guess.length; i++) {
      const c = guess[i];
      if (score[i] === "correct") fixed[i] = c;
      else banned[i].add(c);
      if (score[i] === "absent") grey.add(c);
      else shown.set(c, (shown.get(c) || 0) + 1);
      if (!shown.has(c)) shown.set(c, 0);
    }
    for (const [c, n] of shown) {
      if (n > (min.get(c) || 0)) min.set(c, n);
      if (grey.has(c) && !(max.get(c) <= n)) max.set(c, n);
    }
  }
  return { len, fixed, banned, min, max };
}

// the knowledge from earlier guesses and the answer, scored by the mode's own
// `score(guess, answer)` (both modes score the same standard way)
function fromGuesses(prevGuesses, answer, score) {
  return knowledge(prevGuesses.map(guess => ({ guess, score: score(guess, answer) })));
}

const count = (chars, c) => chars.reduce((n, x) => n + (x === c), 0);

// Typing c into tile i of a row (`row`: the row's characters so far, sparse;
// the one at i is replaced). Only what a partial row can already break:
// the min counts wait for Enter. i = -1 means the row is full (nothing is
// typed): only "absent" is reported. Returns null or a violation.
function typeBlock(k, i, c, row) {
  if (!k.len) return null;
  if (k.max.get(c) === 0) return { code: "absent", ch: c };
  if (i < 0) return null;
  if (k.banned[i].has(c)) return { code: "not-here", ch: c, tile: i };
  const others = row.filter((x, j) => j !== i && x !== undefined);
  if (k.max.has(c) && count(others, c) + 1 > k.max.get(c)) return { code: "too-many", ch: c, n: k.max.get(c) };
  return null;
}

// The first rule a whole word breaks, or null if it could still be the answer.
// { code: "fixed", tile, ch } green tile changed; { code: "absent", ch } a
// character the answer doesn't have; { code: "not-here", tile, ch } a
// character back in a tile where it showed grey or yellow; { code:
// "too-many" | "too-few", ch, n } a count outside what the feedback allows.
function violation(k, word) {
  if (!k.len) return null;
  for (let i = 0; i < k.len; i++) {
    if (k.fixed[i] !== undefined && word[i] !== k.fixed[i]) return { code: "fixed", tile: i, ch: k.fixed[i] };
  }
  for (const c of word) if (k.max.get(c) === 0) return { code: "absent", ch: c };
  for (let i = 0; i < k.len; i++) {
    if (k.banned[i].has(word[i])) return { code: "not-here", tile: i, ch: word[i] };
  }
  const chars = [...word];
  for (const [c, n] of k.max) if (count(chars, c) > n) return { code: "too-many", ch: c, n };
  for (const [c, n] of k.min) if (count(chars, c) < n) return { code: "too-few", ch: c, n };
  return null;
}

return { knowledge, fromGuesses, typeBlock, violation };
})();
