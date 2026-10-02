// SPDX-License-Identifier: AGPL-3.0-only
// ABC mode: a Wordle over the common NAME of a deep-sky object (e.g. "ORION
// NEBULA"). Self-contained and additive — ID mode (game.js) is untouched.
// Reads ABC_NAMES (names.js, v1) and ABC_NAMES_V2 (names_v2.js, v2) for the
// answer pools, and game.js's era switch (ERA_V2_START) and catalogue pools
// (poolFor, simbadQuery) for the sky reveal. Also owns the ID<->ABC flip at
// the bottom of the file.
//
// Wrapped in an IIFE: game.js and abc.js are both classic scripts sharing one
// global lexical scope, and many top-level names (ANSWER, scoreGuess, guesses,
// buildBoard, ...) exist in both — without this they'd collide. Shared across
// the boundary: window.__muldleMode (read by game.js's keydown) and game.js's
// top-level helpers named above.
(function () {
"use strict";

/* ============ shared pure helpers (duplicated from game.js so ABC mode
   stays independent — merge-friendly while both are worked on) ============ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledOrder(list, seed) {
  const arr = list.slice();
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dayIndex(epoch) {
  const now = new Date();
  const e = new Date(epoch.y, epoch.m - 1, epoch.d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - e) / 86400000);
}

// standard Wordle scoring over two equal-length strings
function scoreGuess(guess, answer) {
  const n = answer.length;
  const result = new Array(n).fill("absent");
  const remaining = {};
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) result[i] = "correct";
    else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < n; i++) {
    if (result[i] === "correct") continue;
    if (remaining[guess[i]] > 0) { result[i] = "present"; remaining[guess[i]]--; }
  }
  return result;
}

// Orders the keyboard colours only (display). Hard mode's rules come from the
// per-tile, per-character knowledge in hints.js, shared with ID mode.
const KEY_RANK = { absent: 0, present: 1, correct: 2 };

// what the previous guesses revealed (see hints.js). Fixed punctuation is
// always green, so it never trips a rule.
function revealedHints(prevGuesses, answer) {
  return MuldleHints.fromGuesses(prevGuesses, answer, scoreGuess);
}

// a hints.js violation in ABC-mode words (null stays null)
function hintMessage(v) {
  if (!v) return null;
  const times = n => (n === 2 ? "twice" : `${n} times`);
  switch (v.code) {
    case "fixed": return `Hard mode: keep ${v.ch} in place`;
    case "absent": return `Hard mode: there is no ${v.ch} in the name`;
    case "not-here": return `Hard mode: ${v.ch} is not in that spot`;
    case "too-many": return v.n === 1 ? `Hard mode: there is only one ${v.ch} in the name`
      : `Hard mode: ${v.ch} appears only ${times(v.n)} in the name`;
    case "too-few": return v.n === 1 ? `Hard mode: name must contain ${v.ch}`
      : `Hard mode: name must contain ${v.ch} ${times(v.n)}`;
  }
  return null;
}

// hard mode: the guess must be one that could still be the answer (greens
// stay, a letter never goes back to a slot where it showed grey or yellow,
// letter counts stay within what the feedback allows). Message or null.
function hardModeViolation(prevGuesses, answer, guess) {
  return hintMessage(MuldleHints.violation(revealedHints(prevGuesses, answer), guess));
}

/* ============ configuration & answer model ============ */

const MAX_GUESSES = 6;
// ABC has its own seed/order so the two modes' daily sequences don't correlate
const ABC_SEED = 20260916;
// ABC mode launched 2026-09-16 (commit 8f45950), so its puzzle #0 is that day —
// its own epoch, independent of ID mode's 2026-09-08 start. (Was mistakenly
// 09-08, which made ABC read the same puzzle number as ID.)
const ABC_EPOCH = { y: 2026, m: 9, d: 16 }; // 2026-09-16 = ABC puzzle #0
const SETTINGS_KEY = "muldle-settings-v1"; // shared with game.js (read-only here)
// today's daily (or the random name): { day, name, guesses, randomName, fmt }
const ABC_STORAGE_KEY = "muldle-abc-v1";
// off-day puzzles browsed via the navigator, keyed by number: { [day]: { guesses, fmt } }
// (bare guesses[] arrays before the format flag; stampAbcFormats converts them).
// Separate from muldle-abc-v1 so browsing never clobbers today's daily.
const ABC_ARCHIVE_KEY = "muldle-abc-archive-v1";

// Every ABC save carries `fmt`, from its own table (mirrored in CLAUDE.md); a
// new format is a new row and a row never changes meaning. A stored entry whose
// fmt isn't a row valid for its era is skipped and left untouched in storage.
const ABC_FORMATS = {
  // the common name as tiles: letters and digits upper-cased, punctuation kept,
  // spaces dropped ("ORIONNEBULA", "CODDINGTON'SNEBULA"). Every era so far.
  1: { eras: ["v1", "v2"] },
};
const ABC_FMT_CURRENT = 1;
function abcKnownFormat(fmt, era) {
  return Number.isInteger(fmt) && Object.prototype.hasOwnProperty.call(ABC_FORMATS, fmt) &&
    ABC_FORMATS[fmt].eras.includes(era);
}

// name -> slots (one per non-space char), words (slot-index groups for layout),
// and the spaceless uppercased answer string
function buildAnswerModel(name) {
  const slots = [];   // {ch, playable}
  const words = [];   // arrays of slot indices, in reading order
  for (const word of name.split(" ")) {
    if (!word) continue;
    const wi = [];
    for (const raw of word) {
      const ch = raw.toUpperCase();
      slots.push({ ch, playable: /[A-Z0-9]/.test(ch) });
      wi.push(slots.length - 1);
    }
    words.push(wi);
  }
  return { slots, words, answer: slots.map(s => s.ch).join("") };
}

// spaceless uppercase key ("Orion Nebula" -> "ORIONNEBULA") for name<->id lookup
const nameKey = (name) => buildAnswerModel(name).answer;

// Eras switch on game.js's ERA_V2_START, the same date as ID mode (ABC puzzle
// #19). v1: the 134 v1 names in their frozen order (tools/test_golden.mjs pins
// it). v2: names_v2.js's 179 names (v1's plus the new catalogues' objects) in a
// new seeded order, also pinned once it ships. An entry's `id` is in its era's
// catalogue format: v1 "NGC0224" (format 1), v2 "M31".
// the first seed from 20261008 on whose order never has the same object on the
// same date as ID mode in the first 10 years (tools/test_golden.mjs checks)
const ABC_V2_SEED = 20261013;
const ABC_V2_FIRST_DAY = daysBetween(ABC_EPOCH, ERA_V2_START);
function abcEraOfDay(d) { return d >= ABC_V2_FIRST_DAY ? "v2" : "v1"; }
const ABC_ERAS = {
  v1: { names: ABC_NAMES, idNames: ID_NAMES, catFmt: 1 },
  v2: { names: ABC_NAMES_V2, idNames: ID_NAMES_V2, catFmt: 2 },
};

const ABC_ORDER = shuffledOrder(ABC_NAMES, ABC_SEED); // v1, frozen
// the v1 {name, id} entry for any ABC puzzle number (wraps mod 134)
function v1EntryForDay(d) { return ABC_ORDER[((d % ABC_ORDER.length) + ABC_ORDER.length) % ABC_ORDER.length]; }
// v2: the names v1 already played (ABC #0-#18) close the first cycle, so the
// switch doesn't bring back a name from days before; each part is shuffled
const ABC_V1_PLAYED = new Set(Array.from({ length: ABC_V2_FIRST_DAY }, (_, d) => v1EntryForDay(d).name));
const ABC_V2_ORDER = shuffledOrder(ABC_NAMES_V2.filter(e => !ABC_V1_PLAYED.has(e.name)), ABC_V2_SEED)
  .concat(shuffledOrder(ABC_NAMES_V2.filter(e => ABC_V1_PLAYED.has(e.name)), ABC_V2_SEED));
const DAY = dayIndex(ABC_EPOCH);
// the {name, id} entry for any ABC puzzle number (the navigator plays past ones)
function entryForDay(d) {
  if (abcEraOfDay(d) === "v1") return v1EntryForDay(d);
  const k = d - ABC_V2_FIRST_DAY, n = ABC_V2_ORDER.length;
  return ABC_V2_ORDER[((k % n) + n) % n];
}
const TODAY = entryForDay(DAY);

// which face is active on load (game.js's flip owns it later). Read the
// persisted key directly — MODE_KEY isn't defined until the flip section.
function activeModeOnLoad() {
  try {
    const m = localStorage.getItem("muldle-mode-v1");
    if (m === "abc" || m === "id") return m;
  } catch (e) { /* ignore */ }
  return "id";
}

// ?p=<day> from the URL, clamped to <= today (spoiler-free). null = absent.
function readUrlDay() {
  try {
    const p = new URL(location.href).searchParams.get("p");
    if (p == null) return null;
    const n = parseInt(p, 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(DAY, n));
  } catch (e) { return null; }
}

// per era: every known name -> its representative id (so a guessed real name
// can be shown in the sky view), and id -> proper-case name (for reveal
// captions). byKey stays on the era's unique names (name -> representative
// id); byId uses its per-answer list (every id) so ids that share a name
// resolve too.
for (const e of Object.values(ABC_ERAS)) {
  e.byKey = new Map(e.names.map(n => [nameKey(n.name), n.id]));
  e.byId = new Map();
  for (const n of e.idNames) if (!e.byId.has(n.id)) e.byId.set(n.id, n.name);
}

function isHardMode() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && typeof s.hardMode === "boolean") return s.hardMode;
  } catch (e) { /* ignore */ }
  return true; // default on, matching game.js
}

/* ============ state (the active puzzle: today's, or a random practice one) === */

let abcEra = abcEraOfDay(DAY); // era of the puzzle in play (a random name: today's)
let activeName = TODAY.name;
let activeId = TODAY.id;
let MODEL = buildAnswerModel(activeName);
let ANSWER = MODEL.answer;
let randomName = null; // when practising a random named object

// the era in play: its names, name/id lookups and catalogue format
const era = () => ABC_ERAS[abcEra];

let guesses = [];   // submitted spaceless uppercase strings (length ANSWER.length)
let current = [];   // per-slot typed chars (fixed slots pre-filled)
let locked = [];    // per-slot: fixed punctuation or a hard-mode known green
let cursor = 0;     // slot the next typed char goes into; slots.length = past the end
let finished = false;
let abcViewDay = DAY; // puzzle number in play: today's (DAY) or an archived one (< DAY)

function setActive(name, id, isRandom, eraKey) {
  abcEra = eraKey;
  activeName = name;
  activeId = id;
  randomName = isRandom ? name : null;
  MODEL = buildAnswerModel(name);
  ANSWER = MODEL.answer;
}

// prefill fixed punctuation (always) and, in hard mode, known green letters
function resetCurrent() {
  current = [];
  locked = [];
  for (let i = 0; i < MODEL.slots.length; i++) {
    if (!MODEL.slots[i].playable) { current[i] = MODEL.slots[i].ch; locked[i] = true; }
  }
  if (isHardMode() && !finished) {
    const { fixed } = revealedHints(guesses, ANSWER); // the same greens hard mode enforces
    for (let i = 0; i < ANSWER.length; i++) {
      if (fixed[i] !== undefined) { current[i] = fixed[i]; locked[i] = true; }
    }
  }
  cursor = nextFreeSlot(0);
}

// the first slot at or after i that can be typed into (not punctuation, not a
// locked green); slots.length if none
function nextFreeSlot(i) {
  while (i < MODEL.slots.length && locked[i]) i++;
  return i;
}

// the last typable slot before i (-1 if none)
function prevFreeSlot(i) {
  i--;
  while (i >= 0 && locked[i]) i--;
  return i;
}

// A stored entry of ABC puzzle `day` as this code reads it. A save without
// `fmt` was written by pre-release code, so it is format 1 (a bare-array
// archive entry is { guesses, fmt: 1 }) — unless its day is in a later era:
// then pre-release code was still running after the switch and played that
// day's v1 name, which no longer is the day's answer, and ABC saves (unlike
// ID's formats) can't say which era they were played in. Such an entry reads
// as absent (null), and stampAbcFormats drops it.
function normAbcEntry(e, day) {
  if (Array.isArray(e)) e = { guesses: e };
  if (!e || typeof e !== "object" || "fmt" in e) return e;
  return abcEraOfDay(day) === "v1" ? { ...e, fmt: 1 } : null;
}

// Writes normAbcEntry's reading back to every store on load, like game.js's
// stampFormats. Idempotent; the readers apply the same rule, so a failed write
// changes nothing. A present but unknown fmt is left alone.
function stampAbcFormats() {
  const update = (key, fn) => {
    try {
      const raw = localStorage.getItem(key);
      const v = JSON.parse(raw);
      if (!v || typeof v !== "object") return;
      const out = fn(v);
      if (out === null) localStorage.removeItem(key);
      else if (JSON.stringify(out) !== raw) localStorage.setItem(key, JSON.stringify(out));
    } catch (e) { /* corrupt or full: the readers normalise anyway */ }
  };
  update(ABC_STORAGE_KEY, s => normAbcEntry(s, s.day));
  for (const key of [ABC_ARCHIVE_KEY, ABC_RESULTS_KEY]) {
    update(key, store => {
      for (const k of Object.keys(store)) {
        const e = normAbcEntry(store[k], Number(k));
        if (e === null) delete store[k]; else store[k] = e;
      }
      return store;
    });
  }
}

// a stored entry of ABC puzzle `day` this code must leave alone: its fmt isn't
// one ABC_FORMATS allows in that puzzle's era
function foreignAbcEntry(e, day) {
  e = normAbcEntry(e, day);
  return !!e && typeof e === "object" && !abcKnownFormat(e.fmt, abcEraOfDay(day));
}

// the guesses of a stored entry of puzzle `day` that fit this board, or null
// if there's no usable entry (none, foreign, or no guesses array)
function entryGuesses(e, day) {
  e = normAbcEntry(e, day);
  if (!e || typeof e !== "object" || !Array.isArray(e.guesses) || foreignAbcEntry(e, day)) return null;
  return e.guesses.filter(g => typeof g === "string" && g.length === ANSWER.length);
}

// today's daily (and the random object) live in muldle-abc-v1, keyed on DAY;
// an off-day puzzle browsed via the navigator goes to the archive store.
// Neither overwrites a foreign entry.
function saveState() {
  if (randomName || abcViewDay === DAY) {
    if (foreignAbcEntry(loadAbcToday(), DAY)) return;
    localStorage.setItem(ABC_STORAGE_KEY,
      JSON.stringify({ day: DAY, name: activeName, guesses, randomName, fmt: ABC_FMT_CURRENT }));
  } else {
    const a = loadAbcArchive();
    if (foreignAbcEntry(a[abcViewDay], abcViewDay)) return;
    a[abcViewDay] = { guesses, fmt: ABC_FMT_CURRENT };
    localStorage.setItem(ABC_ARCHIVE_KEY, JSON.stringify(a));
  }
}

// muldle-abc-v1's entry if it is today's, else null
function loadAbcToday() {
  try {
    const s = JSON.parse(localStorage.getItem(ABC_STORAGE_KEY));
    return s && s.day === DAY ? s : null;
  } catch (e) { return null; }
}

function loadAbcArchive() {
  try {
    const a = JSON.parse(localStorage.getItem(ABC_ARCHIVE_KEY));
    return a && typeof a === "object" ? a : {};
  } catch (e) { return {}; }
}

// today's daily guesses from muldle-abc-v1 (empty if a random save sits there
// or the stored name no longer matches today's), filtered to this board's width
function loadTodayAbcGuesses() {
  const s = loadAbcToday();
  return (s && !s.randomName && s.name === TODAY.name && entryGuesses(s, DAY)) || [];
}

// off-day guesses for <day>: the navigator's archive store, or — for a past
// daily played live but never replayed here — the persistent results store
function loadArchivedAbcGuesses(day) {
  return entryGuesses(loadAbcArchive()[day], day) || entryGuesses(loadAbcResults()[day], day) || [];
}

function loadState() {
  const s = normAbcEntry(loadAbcToday(), DAY);
  if (!s || foreignAbcEntry(s, DAY)) return;
  // restore a random-practice name if one was in play and still known
  const key = typeof s.randomName === "string" ? nameKey(s.randomName) : null;
  if (key && era().byKey.has(key)) setActive(s.randomName, era().byKey.get(key), true, abcEraOfDay(DAY));
  if (s.name === activeName) guesses = entryGuesses(s, DAY) || [];
}

/* ============ local play history + stats (no backend) ============ */

// Persistent ABC results, keyed by puzzle number (mirrors game.js's ID store):
//   { [day]: { guesses, solved, tries, playedOnDay, fmt } }. Outlives day rollover;
// a finished daily is recorded at finish and migrated from a stale
// muldle-abc-v1 on load. Local-only — nothing is transmitted.
const ABC_RESULTS_KEY = "muldle-abc-results-v1";

function loadAbcResults() {
  try {
    const r = JSON.parse(localStorage.getItem(ABC_RESULTS_KEY));
    return r && typeof r === "object" ? r : {};
  } catch (e) { return {}; }
}
function saveAbcResults(store) {
  try { localStorage.setItem(ABC_RESULTS_KEY, JSON.stringify(store)); } catch (e) { /* quota */ }
}

// A live-daily record (playedOnDay) is canonical & permanent — never overwritten
// by a later archive replay or a reset-and-replay. Nor is a foreign record.
function recordAbcResult(day, entry) {
  const store = loadAbcResults();
  const cur = normAbcEntry(store[day], day);
  if (cur && (cur.playedOnDay || foreignAbcEntry(cur, day))) return;
  store[day] = entry;
  saveAbcResults(store);
}

// Snapshot the just-finished puzzle. Random practice has no number → not recorded.
function recordCurrentAbcResult(solved) {
  if (randomName) return;
  recordAbcResult(abcViewDay, {
    guesses: guesses.slice(),
    solved,
    tries: solved ? guesses.length : null,
    playedOnDay: abcViewDay === DAY,
    fmt: ABC_FMT_CURRENT,
  });
}

// Drop results/archive entries for impossible puzzle numbers (day > today or a
// bad key). Self-heals stale ABC data left after the epoch fix (which re-indexed
// ABC's day→answer), so stats/history never show future numbers like #14.
function pruneFutureAbcEntries(key) {
  try {
    const store = JSON.parse(localStorage.getItem(key));
    if (!store || typeof store !== "object") return;
    let changed = false;
    for (const k of Object.keys(store)) {
      const d = Number(k);
      if (!Number.isInteger(d) || d < 0 || d > DAY) { delete store[k]; changed = true; }
    }
    if (changed) localStorage.setItem(key, JSON.stringify(store));
  } catch (e) { /* corrupt: leave it */ }
}

// Rescue a finished daily left in muldle-abc-v1 from a previous day before
// loadState() would ignore it (day rollover). Runs once on load.
function migrateStaleAbcDaily() {
  try {
    const raw = JSON.parse(localStorage.getItem(ABC_STORAGE_KEY));
    const s = raw && typeof raw.day === "number" ? normAbcEntry(raw, raw.day) : null;
    if (!s || s.day >= DAY || s.randomName) return;
    if (typeof s.name !== "string" || !Array.isArray(s.guesses) || foreignAbcEntry(s, s.day)) return;
    const ans = buildAnswerModel(s.name).answer;
    const gs = s.guesses.filter(g => typeof g === "string" && g.length === ans.length);
    if (!gs.length) return;
    const solved = gs[gs.length - 1] === ans;
    if (!solved && gs.length < MAX_GUESSES) return; // unfinished
    recordAbcResult(s.day, { guesses: gs, solved, tries: solved ? gs.length : null, playedOnDay: true, fmt: s.fmt });
  } catch (e) { /* nothing to migrate */ }
}

// streaks count consecutive on-day dailies only; archive replays don't extend
// them (played / win % / distribution cover every saved puzzle — see below)
function abcCurrentStreak(store) {
  const t = store[DAY];
  if (t && t.playedOnDay && !t.solved) return 0;
  const start = (t && t.playedOnDay && t.solved) ? DAY : DAY - 1;
  let n = 0;
  for (let d = start; d >= 0; d--) {
    const e = store[d];
    if (e && e.playedOnDay && e.solved) n++; else break;
  }
  return n;
}
function computeAbcStats() {
  const store = loadAbcResults();
  // played / win % / distribution cover EVERY saved puzzle (dailies + archive),
  // matching the history list; only streaks are daily-only
  const all = Object.keys(store).map(Number).filter(d => d >= 0 && d <= DAY && store[d]);
  const solved = all.filter(d => store[d].solved);
  const dist = [0, 0, 0, 0, 0, 0];
  for (const d of solved) { const t = store[d].tries; if (t >= 1 && t <= MAX_GUESSES) dist[t - 1]++; }
  const dailySolved = all.filter(d => store[d].playedOnDay && store[d].solved).sort((a, b) => a - b);
  let max = 0, run = 0, prev = null;
  for (const d of dailySolved) { run = (prev !== null && d === prev + 1) ? run + 1 : 1; if (run > max) max = run; prev = d; }
  const played = all.length, wins = solved.length;
  return { played, wins, winPct: played ? Math.round((100 * wins) / played) : 0, dist, cur: abcCurrentStreak(store), max };
}

/* ============ DOM ============ */

const boardEl = document.getElementById("abc-board");
const messageEl = document.getElementById("abc-message");
const keyboardEl = document.getElementById("abc-keyboard");
const infoEl = document.getElementById("abc-puzzle-info");

const navEl = document.getElementById("abc-puzzle-nav");
const navPrevBtn = document.getElementById("abc-nav-prev");
const navTodayBtn = document.getElementById("abc-nav-today");
const navNextBtn = document.getElementById("abc-nav-next");
const navNumEl = document.getElementById("abc-nav-num-val");

let tiles = []; // tiles[row][slotIndex]

function buildBoard() {
  boardEl.replaceChildren();
  tiles = [];
  // size tiles to fit the whole name on ONE line (no wrap): cols = tiles,
  // wgaps = extra between-word gaps (see --abc-tile-size in style.css)
  boardEl.style.setProperty("--abc-cols", MODEL.slots.length);
  boardEl.style.setProperty("--abc-fixed", MODEL.slots.filter(s => !s.playable).length);
  boardEl.style.setProperty("--abc-wgaps", Math.max(0, MODEL.words.length - 1));
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement("div");
    row.className = "abc-row";
    row.addEventListener("click", () => rowClicked(r));
    const rowTiles = [];
    for (const wi of MODEL.words) {
      const word = document.createElement("div");
      word.className = "abc-word";
      for (const si of wi) {
        const t = document.createElement("div");
        t.className = "tile" + (MODEL.slots[si].playable ? "" : " fixed");
        t.addEventListener("click", () => tileClicked(r, si));
        rowTiles[si] = t;
        word.appendChild(t);
      }
      row.appendChild(word);
    }
    tiles.push(rowTiles);
    boardEl.appendChild(row);
  }
}

let keyEls = {};

function buildKeyboard() {
  keyboardEl.replaceChildren();
  keyEls = {};
  const rows = [];
  // a digit row only when the day's name actually has a number (only
  // "47 Tucanae" does) — otherwise the keyboard is letters only
  if (/[0-9]/.test(ANSWER)) rows.push([..."1234567890"]);
  rows.push([..."QWERTYUIOP"]);
  rows.push([..."ASDFGHJKL"]);
  rows.push(["Enter", ..."ZXCVBNM", "Back"]);
  for (const rowKeys of rows) {
    const row = document.createElement("div");
    row.className = "krow";
    for (const k of rowKeys) {
      const b = document.createElement("button");
      b.className = "key" + (k.length > 1 ? " wide" : "");
      b.textContent = k === "Back" ? "⌫" : k;
      b.addEventListener("click", () => { handleKey(k); b.blur(); });
      keyEls[k] = b;
      row.appendChild(b);
    }
    keyboardEl.appendChild(row);
  }
}

/* ============ rendering ============ */

// a fixed punctuation slot as shown: the typographic apostrophe reads as one
// on a narrow tile, where a straight ' looks like a dot (the stored answer and
// guesses keep the plain character)
function shownPunct(ch) {
  return ch === "'" ? "’" : ch;
}

function renderCurrent() {
  const r = guesses.length;
  if (r >= MAX_GUESSES) return;
  for (let i = 0; i < MODEL.slots.length; i++) {
    const t = tiles[r][i];
    t.classList.remove("filled", "locked", "cursor", "editable");
    if (!MODEL.slots[i].playable) { t.textContent = shownPunct(MODEL.slots[i].ch); continue; }
    const ch = current[i];
    if (ch === undefined) { t.textContent = ""; }
    else { t.textContent = ch; t.classList.add(locked[i] ? "locked" : "filled"); }
    // free slots can be clicked to move the cursor there (see handleKey)
    if (!finished && !locked[i]) t.classList.add("editable");
    if (!finished && i === cursor) t.classList.add("cursor");
  }
}

function renderGuessRow(r, guess) {
  const rowEl = boardEl.children[r];
  rowEl.classList.add("guessed");
  const id = era().byKey.get(guess);
  rowEl.title = id ? "Show " + (era().byId.get(id) || spacedId(id)) + " in the sky view"
    : "Not a known object name";
  const score = scoreGuess(guess, ANSWER);
  for (let i = 0; i < MODEL.slots.length; i++) {
    const t = tiles[r][i];
    if (!MODEL.slots[i].playable) { t.textContent = shownPunct(MODEL.slots[i].ch); continue; }
    t.textContent = guess[i];
    t.classList.remove("filled", "locked", "cursor", "editable");
    t.classList.add(score[i]);
    upgradeKey(guess[i], score[i]);
  }
}

function upgradeKey(key, status) {
  const el = keyEls[key];
  if (!el) return;
  const prev = ["correct", "present", "absent"].find(s => el.classList.contains(s));
  if (!prev || KEY_RANK[status] > KEY_RANK[prev]) {
    el.classList.remove("correct", "present", "absent");
    el.classList.add(status);
  }
}

let messageTimer = null;
function showMessage(text, sticky = false, others = []) {
  messageEl.textContent = text;
  appendOtherNames(messageEl, others); // game.js
  messageEl.classList.toggle("reveal", sticky);
  clearTimeout(messageTimer);
  if (!sticky && text) messageTimer = setTimeout(() => { messageEl.textContent = ""; }, 2500);
}

function shakeRow() {
  const row = boardEl.children[guesses.length];
  if (!row) return;
  row.classList.add("shake");
  setTimeout(() => row.classList.remove("shake"), 450);
}

function updateInfo() {
  // the puzzle number now lives in the navigator; the info line carries context
  const size = era().names.length;
  infoEl.textContent = randomName
    ? `Random name · ${size} named objects`
    : abcViewDay !== DAY
      ? `Archive · ${size} named objects`
      : `${size} named objects`;
}

function updateNav() {
  navEl.classList.toggle("hidden", !!randomName); // a random object has no number
  navNumEl.textContent = abcViewDay;
  navPrevBtn.disabled = abcViewDay <= 0;
  navNextBtn.disabled = abcViewDay >= DAY;   // clamp to <= today (spoiler-free)
  // the middle number button is never greyed — on today it's just a no-op jump
}

/* ============ sky view (Aladin Lite) — a clicked known name or the target === */

const ALADIN_SRC = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js";
const SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";
const DEFAULT_FOV = 0.4, MIN_FOV = 0.03;
const panelEl = document.getElementById("abc-object-panel");
const captionEl = document.getElementById("abc-object-caption");
const aladinDiv = document.getElementById("abc-aladin-div");
const surveyPickerEl = document.getElementById("abc-survey-picker");
let aladinView = null;
let shownId = null; // catalogue id currently in the panel, or null
let surveyCtl = null; // survey picker controller (surveys.js), built on first show

// an entry id's catalogue data (game.js's pool of the era in play): position,
// constellation and the id SIMBAD knows the object by (null: none of its own)
function catalogueEntry(id) {
  const p = poolFor(abcEra, era().catFmt), w = fullWord(id), i = p.index.get(w);
  return i === undefined ? { pos: null, con: "", ident: null }
    : { pos: p.positions[i], con: p.constellations[i], ident: simbadQuery(w, p) };
}

let aladinReady = null;
function loadAladin() {
  if (!aladinReady) {
    aladinReady = new Promise((resolve, reject) => {
      if (window.A) { A.init.then(resolve, reject); return; }
      const s = document.createElement("script");
      s.src = ALADIN_SRC;
      s.onload = () => A.init.then(resolve, reject);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return aladinReady;
}

// object type + field of view (2x SIMBAD major axis, like its own page)
const infoCache = new Map();
function fetchInfo(ident) {
  if (ident === null) return Promise.resolve({ otype: "", fov: DEFAULT_FOV });
  if (infoCache.has(ident)) return infoCache.get(ident);
  const q = "SELECT basic.otype_txt, basic.galdim_majaxis FROM ident JOIN basic " +
    "ON ident.oidref = basic.oid WHERE ident.id = '" + ident.replace(/'/g, "''") + "'";
  const url = SIMBAD_TAP + "?request=doQuery&lang=adql&format=json&query=" +
    encodeURIComponent(q);
  const p = fetch(url).then(r => r.json()).then(j => {
    const row = (j.data && j.data[0]) || [];
    const maj = row[1];
    return { otype: row[0] || "", fov: maj ? Math.max((maj * 2) / 60, MIN_FOV) : DEFAULT_FOV };
  }).catch(() => { infoCache.delete(ident); return { otype: "", fov: DEFAULT_FOV }; });
  infoCache.set(ident, p);
  return p;
}

function markViewingRow() {
  for (let r = 0; r < MAX_GUESSES; r++) {
    boardEl.children[r].classList.toggle("viewing",
      r < guesses.length && era().byKey.get(guesses[r]) === shownId && shownId !== null);
  }
}

function renderCaption(id, otype) {
  const isTarget = id === activeId;
  const { pos, con, ident } = catalogueEntry(id);
  const role = document.createElement("span");
  role.className = "object-role" + (isTarget ? " target" : "");
  role.textContent = isTarget ? "target" : "guess";
  const link = document.createElement("a");
  if (ident === null && pos) {
    // no SIMBAD object of its own: a coordinate search instead of a dead page
    link.href = "https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=" +
      encodeURIComponent(`${pos[0]} ${pos[1] >= 0 ? "+" : ""}${pos[1]}`) + "&Radius=2&Radius.unit=arcmin";
  } else {
    link.href = "https://simbad.cds.unistra.fr/simbad/sim-basic?Ident=" +
      encodeURIComponent(ident || spacedId(id));
  }
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = era().byId.get(id) || spacedId(id);
  captionEl.replaceChildren(role, " ", link, " · ", spacedId(id));
  if (otype) captionEl.append(" · " + otype);
  // constellation, for parity with ID mode's richer caption (CONSTELLATION_NAMES
  // is a game.js top-level const, shared across the two classic scripts)
  if (con) captionEl.append(" · " + (CONSTELLATION_NAMES[con] || con));
  if (finished && !isTarget) {
    const back = document.createElement("a");
    back.href = "#";
    back.textContent = "show target";
    back.addEventListener("click", (e) => { e.preventDefault(); showObject(activeId); });
    captionEl.append(" · ", back);
  }
}

function hideObjectPanel() {
  shownId = null;
  aladinView = null;
  markViewingRow();
  panelEl.hidden = true;
  aladinDiv.replaceChildren();
  aladinDiv.removeAttribute("style");
  captionEl.replaceChildren();
}

function showObject(id) {
  if (shownId === id) return;
  shownId = id;
  markViewingRow();

  if (panelEl.hidden) {
    // leave room beside the image for the survey picker column (its square
    // buttons are ~ size / N wide) so nothing overflows on narrow screens
    const n = window.MuldleSurveys ? window.MuldleSurveys.count : 0;
    const maxByWidth = n
      ? (document.documentElement.clientWidth - 16 - 7) / (1 + 1 / n)
      : document.documentElement.clientWidth - 16;
    const size = Math.min(boardEl.offsetHeight, 360, maxByWidth);
    aladinDiv.style.width = size + "px";
    aladinDiv.style.height = size + "px";
    panelEl.hidden = false;
    if (window.MuldleSurveys && !surveyCtl) {
      surveyCtl = window.MuldleSurveys.mount(surveyPickerEl, () => aladinView);
    }
  }

  const { pos, ident } = catalogueEntry(id);
  renderCaption(id, "");
  if (!pos) return;
  // spinner in the caption while the object's SIMBAD data is on its way
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  captionEl.append(" ", spinner);

  Promise.all([loadAladin(), fetchInfo(ident)]).then(([, info]) => {
    if (shownId !== id) return; // another row clicked meanwhile
    if (aladinView) { aladinView.gotoRaDec(pos[0], pos[1]); aladinView.setFov(info.fov); }
    else {
      aladinView = A.aladin("#abc-aladin-div", {
        survey: surveyCtl ? surveyCtl.current() : "P/DSS2/color",
        target: pos[0] + " " + pos[1],
        fov: info.fov,
        showFullscreenControl: false, showLayersControl: false,
        showFrame: false, showCooGridControl: false, showProjectionControl: false,
      });
    }
    if (surveyCtl) {
      surveyCtl.apply(aladinView);
      window.MuldleSurveys.updateCoverage(surveyCtl, pos[0], pos[1]);
    }
    renderCaption(id, info.otype);
  }).catch(() => {
    if (shownId !== id) return;
    spinner.remove();
    aladinDiv.textContent = "sky view unavailable";
    aladinDiv.style.display = "flex";
    aladinDiv.style.alignItems = "center";
    aladinDiv.style.justifyContent = "center";
  });
}

// the target's other established names for the reveal (game.js's otherNames
// over the era's catalogue pool), never the name just played
function revealOthers() {
  const p = poolFor(abcEra, era().catFmt);
  return otherNames(fullWord(activeId), p).filter(n => n !== activeName);
}

// clicking a submitted guess shows that object if it's a real named object;
// clicking the shown one again returns to the target (game over) or closes it
function rowClicked(r) {
  if (r >= guesses.length) return;
  const id = era().byKey.get(guesses[r]);
  if (!id) { showMessage("That guess isn't a known object — nothing to show"); return; }
  if (id !== shownId) {
    showObject(id);
    panelEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else if (finished) {
    showObject(activeId);
  } else {
    hideObjectPanel();
  }
}

/* ============ input ============ */

const WIN_MESSAGES = ["Stellar!", "Nailed it!", "Brilliant!", "Well named!", "Good eye!", "Phew!"];

// Same cursor model as ID mode (game.js handleKey): typing writes at the
// cursor, overwriting a filled slot, then moves to the next free slot; a click
// on a free slot moves the cursor there. Locked slots are never under it.
function handleKey(k) {
  if (finished) return;
  const len = MODEL.slots.length;
  if (k === "Enter") { submitGuess(); return; }
  if (k === "Left") { const p = prevFreeSlot(cursor); if (p >= 0) cursor = p; renderCurrent(); return; }
  if (k === "Right") { if (cursor < len) cursor = nextFreeSlot(cursor + 1); renderCurrent(); return; }
  if (k === "Back") {
    // clear the slot under the cursor if filled, else the nearest typed slot
    // before it (moving there) — "delete the last char" when typing in order
    if (cursor < len && current[cursor] !== undefined) {
      delete current[cursor];
    } else {
      for (let i = Math.min(cursor, len) - 1; i >= 0; i--) {
        if (current[i] !== undefined && !locked[i]) { delete current[i]; cursor = i; break; }
      }
    }
    renderCurrent();
    return;
  }
  if (!/^[0-9A-Z]$/.test(k)) return;
  // cursor past the end: fall back to the first empty playable slot, if any
  let at = cursor;
  if (at >= len) {
    at = 0;
    while (at < len && current[at] !== undefined) at++;
  }
  const full = at >= len;
  // hard mode refuses at type time what a partial row can already break (a
  // letter the name lacks, one back in a slot where it showed grey or yellow,
  // one too many); Enter checks the rest, from the same knowledge. A full row
  // still says when a letter isn't in the name at all.
  if (isHardMode()) {
    const block = MuldleHints.typeBlock(revealedHints(guesses, ANSWER), full ? -1 : at, k, current);
    if (block) { showMessage(hintMessage(block)); return; }
  }
  if (full) return;
  current[at] = k;
  cursor = nextFreeSlot(at + 1);
  renderCurrent();
}

// clicking a free slot of the row being typed puts the cursor there
function tileClicked(r, i) {
  if (finished || r !== guesses.length || locked[i]) return;
  cursor = i;
  renderCurrent();
}

function submitGuess() {
  for (let i = 0; i < MODEL.slots.length; i++) {
    if (MODEL.slots[i].playable && current[i] === undefined) {
      showMessage("Fill in the name"); shakeRow(); return;
    }
  }
  let guess = "";
  for (let i = 0; i < MODEL.slots.length; i++) guess += current[i];

  // a repeat can't reveal anything new. Hard mode refuses it anyway (it can't
  // be the answer); this covers normal mode, which has no hint rules
  if (guesses.includes(guess)) { showMessage("You already guessed that"); shakeRow(); return; }

  if (isHardMode()) {
    const violation = hardModeViolation(guesses, ANSWER, guess);
    if (violation) { showMessage(violation); shakeRow(); return; }
  }

  renderGuessRow(guesses.length, guess);
  guesses.push(guess);
  saveState();

  if (guess === ANSWER) {
    finished = true;
    recordCurrentAbcResult(true);
    showMessage(`${WIN_MESSAGES[guesses.length - 1]} It was the ${activeName}.`, true, revealOthers());
    showObject(activeId);
    showPostGame();
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    recordCurrentAbcResult(false);
    showMessage(`Out of guesses — it was the ${activeName}.`, true, revealOthers());
    showObject(activeId);
    showPostGame();
  }
  resetCurrent();
  renderCurrent();
}

// a focused text input (e.g. in the sky viewer) keeps its own arrow keys
function isTextField(el) {
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

document.addEventListener("keydown", (e) => {
  if (window.__muldleMode !== "abc") return;
  if (settingsDialog.open || statsDialog.open) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter") handleKey("Enter");
  else if (e.key === "Backspace") handleKey("Back");
  else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !finished && !isTextField(e.target)) {
    e.preventDefault(); // only while a row is being typed: a long finished name
    handleKey(e.key === "ArrowLeft" ? "Left" : "Right"); // still arrow-scrolls
  }
  else if (/^[0-9]$/.test(e.key)) handleKey(e.key);
  else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
});

/* ============ shared settings dialog (same menu as ID mode) ============ */

const settingsDialog = document.getElementById("settings-dialog");
const backToDailyBtn = document.getElementById("back-to-daily");
const hardModeToggle = document.getElementById("hard-mode-toggle");
const abcSettingsBtn = document.getElementById("abc-settings-button");
const statsDialog = document.getElementById("stats-dialog");
const statsContent = document.getElementById("stats-content");

abcSettingsBtn.addEventListener("click", () => {
  backToDailyBtn.hidden = !randomName;
  document.getElementById("by-catalogue-row").hidden = true; // ID mode's practice weighting
  settingsDialog.showModal();
});
settingsDialog.addEventListener("close", () => setTimeout(() => abcSettingsBtn.blur(), 0));

// re-derive prefill when hard mode is toggled (game.js owns the checkbox)
hardModeToggle.addEventListener("change", () => {
  if (!finished) { resetCurrent(); renderCurrent(); }
});

function startAbcPuzzle(name, id, isRandom, msg) {
  // a random object has no puzzle number: snap to today's slot so the URL drops
  // any archived ?p (else a reload re-enters the archive, discarding the random)
  if (isRandom) abcViewDay = DAY;
  setActive(name, id, isRandom, abcEraOfDay(abcViewDay));
  guesses = [];
  finished = false;
  buildBoard();
  buildKeyboard();
  hideObjectPanel();
  hidePostGame();
  resetCurrent();
  renderCurrent();
  updateInfo();
  updateNav();
  showMessage(msg);
  saveState();
  if (window.__muldle) {
    window.__muldle.view.abc = abcViewDay;
    if (window.__muldle.syncUrl) window.__muldle.syncUrl();
  }
  settingsDialog.close();
}

// render a loaded ABC puzzle whose guesses + active name are already set:
// replay scored rows, restore finished/reveal, prefill. Shared by init + nav.
function renderAbcState() {
  guesses.forEach((g, r) => renderGuessRow(r, g));
  finished = false;
  if (guesses.length && guesses[guesses.length - 1] === ANSWER) {
    finished = true;
    recordCurrentAbcResult(true);
    showMessage(`Already solved — it was the ${activeName}.`, true, revealOthers());
    showObject(activeId);
    showPostGame();
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    recordCurrentAbcResult(false);
    showMessage(`Out of guesses — it was the ${activeName}.`, true, revealOthers());
    showObject(activeId);
    showPostGame();
  }
  resetCurrent();
  renderCurrent();
}

// switch to ABC puzzle <day> (today's daily or an archived one), loading its
// saved progress. Leaves random practice. day is clamped to [0, today].
function goToAbcPuzzle(day) {
  day = Math.max(0, Math.min(DAY, day | 0));
  abcViewDay = day;
  const entry = entryForDay(day);
  setActive(entry.name, entry.id, false, abcEraOfDay(day));
  guesses = (day === DAY) ? loadTodayAbcGuesses() : loadArchivedAbcGuesses(day);
  buildBoard();
  buildKeyboard();
  hideObjectPanel();
  hidePostGame();
  showMessage("");
  renderAbcState();
  if (!finished) showMessage(day === DAY ? "" : `Puzzle #${day}`);
  updateInfo();
  updateNav();
  if (window.__muldle) {
    window.__muldle.view.abc = abcViewDay;
    if (window.__muldle.syncUrl) window.__muldle.syncUrl();
  }
  saveState();
  settingsDialog.close();
}

// a random named object of today's era (practice), never the current answer
function randomEntry() {
  const names = ABC_ERAS[abcEraOfDay(DAY)].names;
  let e;
  do { e = names[Math.floor(Math.random() * names.length)]; }
  while (nameKey(e.name) === ANSWER);
  return e;
}

// Intercept the dialog's reset actions while ABC is the active mode: a capture
// listener on the dialog runs before game.js's per-button handlers, so ABC can
// claim the click (stopPropagation keeps it from reaching game.js / ID mode).
settingsDialog.addEventListener("click", (e) => {
  if (window.__muldleMode !== "abc") return; // let game.js handle it in ID mode
  // each action button wraps a description <span>; a click can land on it, so
  // resolve to the enclosing button rather than reading e.target.id directly
  // (otherwise the click falls through to game.js and resets the ID puzzle)
  const btn = e.target && e.target.closest && e.target.closest("button");
  const id = btn && btn.id;
  if (id === "reset-puzzle") {
    e.stopPropagation();
    startAbcPuzzle(activeName, activeId, !!randomName, "Puzzle reset — same object, fresh guesses.");
  } else if (id === "reset-random") {
    e.stopPropagation();
    const en = randomEntry();
    startAbcPuzzle(en.name, en.id, true, "Random named object — this is not today's puzzle.");
  } else if (id === "back-to-daily") {
    e.stopPropagation();
    goToAbcPuzzle(DAY);
  } else if (id === "stats-button") {
    e.stopPropagation();
    openAbcStats();
  }
}, true);

/* ============ stats & history (ABC) — rendered into the shared dialog ======= */

function abcStatTile(label, value) {
  const t = document.createElement("div"); t.className = "stat-tile";
  const v = document.createElement("div"); v.className = "stat-val"; v.textContent = String(value);
  const l = document.createElement("div"); l.className = "stat-label"; l.textContent = label;
  t.append(v, l);
  return t;
}

// Render the ABC stats + history into <container>. includeClear:false (the
// inline post-game view below a finished board) omits the clear control + note.
function renderAbcStats(container, { includeClear = true } = {}) {
  const s = computeAbcStats();
  const store = loadAbcResults();
  container.replaceChildren();

  const h = document.createElement("h2"); h.textContent = "Stats & history — ABC";
  container.appendChild(h);

  const tiles = document.createElement("div"); tiles.className = "stats-tiles";
  tiles.append(
    abcStatTile("Played", s.played),
    abcStatTile("Win %", s.winPct),
    abcStatTile("Streak", s.cur),
    abcStatTile("Max streak", s.max),
  );
  container.appendChild(tiles);

  const distHead = document.createElement("h3"); distHead.textContent = "Guess distribution";
  container.appendChild(distHead);
  const dist = document.createElement("div"); dist.className = "stats-dist";
  const maxCount = Math.max(1, ...s.dist);
  const todayTries = (store[DAY] && store[DAY].playedOnDay && store[DAY].solved) ? store[DAY].tries : null;
  s.dist.forEach((count, i) => {
    const row = document.createElement("div"); row.className = "dist-row";
    const num = document.createElement("span"); num.className = "dist-num"; num.textContent = String(i + 1);
    const bar = document.createElement("span"); bar.className = "dist-bar";
    if (i + 1 === todayTries) bar.classList.add("current");
    bar.style.width = (count / maxCount) * 100 + "%";
    bar.textContent = String(count);
    row.append(num, bar);
    dist.appendChild(row);
  });
  container.appendChild(dist);

  const histHead = document.createElement("h3"); histHead.textContent = "History";
  container.appendChild(histHead);
  const days = Object.keys(store).map(Number).filter(d => d <= DAY).sort((a, b) => b - a);
  if (!days.length) {
    const empty = document.createElement("p"); empty.className = "stats-empty";
    empty.textContent = "No games recorded yet — finish a puzzle and it shows up here.";
    container.appendChild(empty);
  } else {
    const list = document.createElement("div"); list.className = "history-list";
    for (const d of days) {
      const e = store[d];
      const row = document.createElement("button");
      row.type = "button"; row.className = "history-row";
      row.title = "Open puzzle #" + d;
      row.addEventListener("click", () => { statsDialog.close(); goToAbcPuzzle(d); });
      const swatch = document.createElement("span");
      swatch.className = "history-swatch " + (e.solved ? "solved" : "lost");
      const label = document.createElement("span"); label.className = "history-label";
      label.textContent = "Puzzle #" + d;
      const outcome = document.createElement("span"); outcome.className = "history-outcome";
      outcome.textContent = (e.solved ? e.tries : "X") + "/" + MAX_GUESSES;
      row.append(swatch, label, outcome);
      if (!e.playedOnDay) {
        const tag = document.createElement("span"); tag.className = "history-tag"; tag.textContent = "archive";
        row.appendChild(tag);
      }
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  if (!includeClear) return;

  const note = document.createElement("p"); note.className = "stats-note";
  note.textContent = "Stored only in this browser — nothing is ever sent anywhere.";
  container.appendChild(note);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button"; clearBtn.className = "stats-clear";
  clearBtn.textContent = "Clear history & stats";
  let armed = false;
  clearBtn.addEventListener("click", () => {
    if (!armed) { armed = true; clearBtn.textContent = "Click again to clear — can't be undone"; clearBtn.classList.add("armed"); return; }
    // also drop today's saved game so a finished daily isn't re-recorded on load
    try {
      localStorage.removeItem(ABC_RESULTS_KEY);
      localStorage.removeItem(ABC_ARCHIVE_KEY);
      localStorage.removeItem(ABC_STORAGE_KEY);
    } catch (e) { /* ignore */ }
    renderAbcStats(container, { includeClear });
  });
  container.appendChild(clearBtn);
}

function openAbcStats() { settingsDialog.close(); renderAbcStats(statsContent); statsDialog.showModal(); }

// puzzle navigator (ABC): step through past puzzles (clamped to <= today), or
// the middle button jumps straight back to today's
navPrevBtn.addEventListener("click", () => { if (abcViewDay > 0) goToAbcPuzzle(abcViewDay - 1); navPrevBtn.blur(); });
navNextBtn.addEventListener("click", () => { if (abcViewDay < DAY) goToAbcPuzzle(abcViewDay + 1); navNextBtn.blur(); });
navTodayBtn.addEventListener("click", () => { if (abcViewDay !== DAY) goToAbcPuzzle(DAY); navTodayBtn.blur(); });

/* ============ post-game: emoji-grid share + next-puzzle countdown ============ */

const postGameEl = document.getElementById("abc-post-game");
const postGameStatsEl = document.getElementById("abc-post-game-stats");
const shareBtn = document.getElementById("abc-share-button");
const countdownEl = document.getElementById("abc-countdown");
const SHARE_EMOJI = { correct: "🟩", present: "🟨", absent: "⬛" };

// emoji grid of the scored rows: one square per playable slot, words spaced
// (fixed punctuation slots are skipped)
function buildShareText() {
  const solved = guesses.length && guesses[guesses.length - 1] === ANSWER;
  const tries = solved ? guesses.length : "X";
  const head = randomName ? "Muldle ABC (practice)" : `Muldle ABC #${abcViewDay}`;
  const grid = guesses.map(g => {
    const score = scoreGuess(g, ANSWER);
    return MODEL.words
      .map(wi => wi.filter(i => MODEL.slots[i].playable).map(i => SHARE_EMOJI[score[i]]).join(""))
      .filter(Boolean)
      .join(" ");
  }).join("\n");
  return `${head} ${tries}/${MAX_GUESSES}\n${grid}`;
}

shareBtn.addEventListener("click", () => {
  const text = buildShareText();
  window.__lastShareAbc = text; // fallback + e2e hook
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showMessage("Copied to clipboard!"),
      () => showMessage("Copy failed — try again"));
  } else {
    showMessage("Copied to clipboard!");
  }
  shareBtn.blur();
});

let countdownTimer = null;

function msToMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = n => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function startCountdown() {
  clearInterval(countdownTimer);
  const tick = () => {
    const ms = msToMidnight();
    if (ms <= 0) {
      countdownEl.textContent = "A new puzzle is ready — reload.";
      clearInterval(countdownTimer);
    } else {
      countdownEl.textContent = "Next puzzle in " + fmtDuration(ms);
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function showPostGame() {
  postGameEl.hidden = false;
  // the keyboard is no use once the puzzle is over — hide it and surface the
  // stats & history (no clear control) below the board in its place
  keyboardEl.hidden = true;
  renderAbcStats(postGameStatsEl, { includeClear: false });
  // countdown only for today's daily — a practice or archived puzzle doesn't roll over
  const isDaily = !randomName && abcViewDay === DAY;
  countdownEl.hidden = !isDaily;
  if (isDaily) startCountdown();
  else clearInterval(countdownTimer);
}

function hidePostGame() {
  postGameEl.hidden = true;
  keyboardEl.hidden = false; // back to an unfinished puzzle: keyboard returns
  clearInterval(countdownTimer);
}

/* ============ init ============ */

stampAbcFormats(); // every save gets its fmt before anything reads it
pruneFutureAbcEntries(ABC_RESULTS_KEY); // drop stale entries from the epoch re-index
pruneFutureAbcEntries(ABC_ARCHIVE_KEY);
migrateStaleAbcDaily(); // rescue a finished daily from a past day before it's lost

// initial puzzle: a ?p=<day> for the active mode opens that archived puzzle;
// otherwise restore today's daily (or the random object) from muldle-abc-v1
const urlDay = readUrlDay();
if (urlDay != null && urlDay !== DAY && activeModeOnLoad() === "abc") {
  abcViewDay = urlDay;
  const entry = entryForDay(urlDay);
  setActive(entry.name, entry.id, false, abcEraOfDay(urlDay));
  guesses = loadArchivedAbcGuesses(urlDay);
} else {
  loadState();
}
if (window.__muldle) {
  // ABC's today is its own puzzle number (its epoch differs from ID's), so
  // register it for syncUrl's per-mode "is this today?" check
  window.__muldle.today = window.__muldle.today || {};
  window.__muldle.today.abc = DAY;
  window.__muldle.view.abc = abcViewDay;
  window.__muldle.started = window.__muldle.started || {};
  // for start.js: a guess made, or random practice (not a fresh daily)
  window.__muldle.started.abc = () => guesses.length > 0 || !!randomName;
}

window.__abc = { get NAME() { return activeName; }, get ANSWER() { return ANSWER; },
  DAY, get POOL() { return era().names.length; }, get era() { return abcEra; }, entryForDay,
  get viewDay() { return abcViewDay; }, get model() { return MODEL; } }; // e2e/debug hook

buildBoard();
buildKeyboard();
updateInfo();
updateNav();

renderAbcState();

/* ============ ID <-> ABC flip ============ */

const flipper = document.getElementById("flipper");
const faceId = document.getElementById("face-id");
const faceAbc = document.getElementById("face-abc");
const MODE_KEY = "muldle-mode-v1";
let mode = "id";

function setInert(el, on) {
  el.inert = on;
  if (on) el.setAttribute("aria-hidden", "true");
  else el.removeAttribute("aria-hidden");
}

function applyMode(m, animate) {
  mode = m;
  window.__muldleMode = m;
  // the active face flows (drives #flipper's height); the other overlays it
  faceId.classList.toggle("face-active", m === "id");
  faceAbc.classList.toggle("face-active", m === "abc");
  // a transition only runs when we animate AND motion isn't reduced; when it
  // does, .flip-anim defers each face's show/hide to the midpoint so neither
  // ghosts through (Firefox doesn't cull the backface — see style.css)
  const willAnimate = animate && !(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  flipper.classList.toggle("flip-anim", willAnimate);
  if (!animate) flipper.classList.add("no-anim");
  flipper.classList.toggle("flipped", m === "abc");
  if (!animate) { void flipper.offsetWidth; flipper.classList.remove("no-anim"); }
  // hide whichever face is now rotated away (deferred to the flip midpoint by
  // .flip-anim when animating, instant otherwise)
  faceId.classList.toggle("face-back", m !== "id");
  faceAbc.classList.toggle("face-back", m !== "abc");
  setInert(faceId, m !== "id");
  setInert(faceAbc, m !== "abc");
  document.querySelectorAll(".mode-seg").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  // keep the shareable ?p= in sync with whichever mode is now active
  if (window.__muldle && window.__muldle.syncUrl) window.__muldle.syncUrl();
}

// once the spin settles, drop the midpoint delay (steady-state visibility is
// already correct, so this changes nothing visible)
flipper.addEventListener("transitionend", (e) => {
  if (e.target === flipper && e.propertyName === "transform")
    flipper.classList.remove("flip-anim");
});

function setMode(m) {
  if (m === mode) return;
  try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* ignore */ }
  applyMode(m, true);
}

document.querySelectorAll(".mode-seg").forEach(b =>
  b.addEventListener("click", () => { setMode(b.dataset.mode); b.blur(); }));

try {
  const saved = localStorage.getItem(MODE_KEY);
  if (saved === "abc" || saved === "id") mode = saved;
} catch (e) { /* ignore */ }
applyMode(mode, false);

})();
