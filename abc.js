// SPDX-License-Identifier: AGPL-3.0-only
// ABC mode: a Wordle over the common NAME of a deep-sky object (e.g. "ORION
// NEBULA"), and from the v3 era also of a constellation, star, asterism or
// famous object outside the catalogues ("URSA MAJOR", "SIRIUS"). ABC keeps its
// own state and game logic (board, answer model, saves, scoring); shared,
// mode-neutral pieces live in one place both modes use: hints.js (hard mode),
// stats.js (results store + Stats & history view) and game.js's era switch
// (ERA_V2_START, ERA_ABC_V3_START) and catalogue pools (poolFor, simbadQuery)
// for the sky reveal. Reads ABC_NAMES (names.js, v1), ABC_NAMES_V2
// (names_v2.js, v2) and ABC_SKY_V3 + SKY_INFO (names_v3.js, v3) for the answer
// pools. Also owns the ID<->ABC flip at the bottom of the file.
//
// Wrapped in an IIFE: game.js and abc.js are both classic scripts sharing one
// global lexical scope, and many top-level names (ANSWER, scoreGuess, guesses,
// buildBoard, ...) exist in both — without this they'd collide. Shared across
// the boundary: window.__muldleMode (read by game.js's keydown) and game.js's
// top-level helpers named above.
(function () {
"use strict";

/* ============ small pure helpers, copied from game.js (seeded shuffle, day
   index, scoring: small enough to keep per mode; a larger shared piece goes
   into a shared module like hints.js / stats.js) ============ */

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
  // spaces dropped ("ORIONNEBULA", "CODDINGTON'SNEBULA").
  1: { eras: ["v1", "v2"] },
  // the same tiles, for a v3 puzzle. Its own row because v3 gave its days new
  // answers: v2-era code (a stale tab) reads it as foreign and leaves it alone
  // instead of scoring it against the day's old answer.
  2: { eras: ["v3"] },
};
// the format a save of puzzle d is written in
function abcFmtOfDay(d) { return abcEraOfDay(d) === "v3" ? 2 : 1; }
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
      // letters, digits and the asterisk of Sagittarius A* are typed; other
      // punctuation (apostrophes, hyphens) is a fixed tile
      slots.push({ ch, playable: /[A-Z0-9*]/.test(ch) });
      wi.push(slots.length - 1);
    }
    words.push(wi);
  }
  return { slots, words, answer: slots.map(s => s.ch).join("") };
}

// spaceless uppercase key ("Orion Nebula" -> "ORIONNEBULA") for name<->id lookup
const nameKey = (name) => buildAnswerModel(name).answer;

// Eras switch on game.js's ERA_V2_START, the same date as ID mode (ABC puzzle
// #19), and ERA_ABC_V3_START, ABC only (#26). v1: the 134 v1 names in their
// frozen order (tools/test_golden.mjs pins it). v2: names_v2.js's 179 names
// (v1's plus the new catalogues' objects) in a new seeded order. v3: v2's
// names plus names_v3.js's constellations, stars, asterisms and objects
// outside the catalogues (ABC_SKY_V3) on a weekly schedule (below). Every
// era is pinned once it ships. An entry's `id` is in its era's catalogue
// format: v1 "NGC0224" (format 1), v2 and v3 "M31"; a v3 sky name's id is
// its SKY_INFO key ("con:UMa", "star:HIP32349").
// the first seed from 20261008 on whose order never has the same object on the
// same date as ID mode in the first 10 years (tools/test_golden.mjs checks)
const ABC_V2_SEED = 20261013;
const ABC_V2_FIRST_DAY = daysBetween(ABC_EPOCH, ERA_V2_START);
const ABC_V3_FIRST_DAY = daysBetween(ABC_EPOCH, ERA_ABC_V3_START);
function abcEraOfDay(d) { return d >= ABC_V3_FIRST_DAY ? "v3" : d >= ABC_V2_FIRST_DAY ? "v2" : "v1"; }
// per era: its names, and the catalogue pool of game.js (catEra, catFmt) its
// deep-sky ids live in
const ABC_ERAS = {
  v1: { names: ABC_NAMES, idNames: ID_NAMES, catEra: "v1", catFmt: 1 },
  v2: { names: ABC_NAMES_V2, idNames: ID_NAMES_V2, catEra: "v2", catFmt: 2 },
  v3: { names: ABC_NAMES_V2.concat(ABC_SKY_V3), idNames: ID_NAMES_V2.concat(ABC_SKY_V3), catEra: "v2", catFmt: 2 },
};

const mod = (n, m) => ((n % m) + m) % m;
const ABC_ORDER = shuffledOrder(ABC_NAMES, ABC_SEED); // v1, frozen
// the v1 {name, id} entry for any ABC puzzle number (wraps mod 134)
function v1EntryForDay(d) { return ABC_ORDER[mod(d, ABC_ORDER.length)]; }
// v2: the names v1 already played (ABC #0-#18) close the first cycle, so the
// switch doesn't bring back a name from days before; each part is shuffled
const ABC_V1_PLAYED = new Set(Array.from({ length: ABC_V2_FIRST_DAY }, (_, d) => v1EntryForDay(d).name));
const ABC_V2_ORDER = shuffledOrder(ABC_NAMES_V2.filter(e => !ABC_V1_PLAYED.has(e.name)), ABC_V2_SEED)
  .concat(shuffledOrder(ABC_NAMES_V2.filter(e => ABC_V1_PLAYED.has(e.name)), ABC_V2_SEED));
// the v2 entry for any puzzle number from v2's first day (wraps mod 179)
function v2EntryForDay(d) { return ABC_V2_ORDER[mod(d - ABC_V2_FIRST_DAY, ABC_V2_ORDER.length)]; }

// v3 (from 2026-10-12, a Monday): in every Monday-Sunday week two days, drawn
// by a seeded RNG, come from the sky names (ABC_SKY_V3) and the other five
// from v2's deep-sky names. The k-th sky day of the era takes the k-th name
// of a seeded shuffle of the sky names, deep-sky days likewise; each sequence
// wraps mod its length. The deep-sky names played before v3 (#0-#25) close
// its first cycle, as in v2. The deep-sky seed is the first from 20261012 on
// whose days never have the same object as ID mode on the same date in the
// first 10 years (tools/test_golden.mjs checks); sky names are never ID answers.
const ABC_V3_DEEP_SEED = 20261018;
const ABC_V3_SKY_SEED = 20261014;
const ABC_V3_WEEK_SEED = 20261015;
const ABC_PLAYED_BEFORE_V3 = new Set(Array.from({ length: ABC_V3_FIRST_DAY },
  (_, d) => (d >= ABC_V2_FIRST_DAY ? v2EntryForDay(d) : v1EntryForDay(d)).name));
const ABC_V3_DEEP_ORDER = shuffledOrder(ABC_NAMES_V2.filter(e => !ABC_PLAYED_BEFORE_V3.has(e.name)), ABC_V3_DEEP_SEED)
  .concat(shuffledOrder(ABC_NAMES_V2.filter(e => ABC_PLAYED_BEFORE_V3.has(e.name)), ABC_V3_DEEP_SEED));
const ABC_V3_SKY_ORDER = shuffledOrder(ABC_SKY_V3, ABC_V3_SKY_SEED);

// the two sky days (0 = Monday ... 6 = Sunday) of v3 week w, ascending
function skyDaysOfWeek(w) {
  const rand = mulberry32((ABC_V3_WEEK_SEED + Math.imul(w, 0x9E3779B1)) >>> 0);
  const a = Math.floor(rand() * 7);
  let b = Math.floor(rand() * 6);
  if (b >= a) b++;
  return a < b ? [a, b] : [b, a];
}

// the v3 entry for any puzzle number from v3's first day
function v3EntryForDay(d) {
  const k = d - ABC_V3_FIRST_DAY, w = Math.floor(k / 7), day = k - 7 * w;
  const [a, b] = skyDaysOfWeek(w);
  if (day === a || day === b) return ABC_V3_SKY_ORDER[mod(2 * w + (day === b), ABC_V3_SKY_ORDER.length)];
  return ABC_V3_DEEP_ORDER[mod(5 * w + day - (a < day) - (b < day), ABC_V3_DEEP_ORDER.length)];
}

const DAY = dayIndex(ABC_EPOCH);
// the {name, id} entry for any ABC puzzle number (the navigator plays past ones)
function entryForDay(d) {
  const e = abcEraOfDay(d);
  return e === "v3" ? v3EntryForDay(d) : e === "v2" ? v2EntryForDay(d) : v1EntryForDay(d);
}

// a v3 sky name's reveal and sky-view data (names_v3.js), or undefined for a
// deep-sky id
const skyInfo = id => (Object.prototype.hasOwnProperty.call(SKY_INFO, id) ? SKY_INFO[id] : undefined);
// deep-sky names that read without "the": people's possessives, proper names,
// radio sources, a leading "The" (but "the Cat's Eye Nebula", "the 37 Cluster")
const BARE_DEEP_NAMES = new Set(["47 Tucanae", "Barnard's Galaxy", "Barnard's Merope Nebula", "Bode's Galaxy",
  "Caroline's Cluster", "Caroline's Rose", "Centaurus A", "Cleopatra's Eye", "Coddington's Nebula", "Fornax A",
  "Fornax B", "Hind's Variable Nebula", "Hubble's Variable Nebula", "Mairan's Nebula", "Mirach's Ghost",
  "Omega Centauri", "Perseus A", "Ptolemy's Cluster", "Seyfert's Sextet", "Stephan's Quintet", "The Eyes Galaxies",
  "Thor's Helmet", "Virgo A"]);
// a name as the reveal writes it: a sky name's own form ("Boötes") with or
// without "the" as the data says; a deep-sky name with "the" unless it reads bare
function theName(name, id) {
  const s = skyInfo(id);
  if (!s) return (BARE_DEEP_NAMES.has(name) ? "" : "the ") + name;
  return (s.the ? "the " : "") + (s.show || name);
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

// A format-1 entry of a v3 day was written by v2-era code still running after
// the v3 switch (a stale tab or cached page): a game of that day's v2 name.
// Format 1 isn't a v3 row, so it is foreign there and a v3 board never shows
// it. A played daily's result stays in the results store (its streak and
// history are real); today's save and the archive drop or overwrite it, so it
// never blocks the day's v3 game.
function staleV2AbcEntry(e, day) {
  e = normAbcEntry(e, day);
  return !!e && typeof e === "object" && e.fmt === 1 && abcEraOfDay(day) === "v3";
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
  // a stale v2-era save of today would block today's v3 game: it goes (one of
  // an earlier day stays for migrateStaleAbcDaily to record its result)
  update(ABC_STORAGE_KEY, s => (s.day === DAY && staleV2AbcEntry(s, s.day) ? null : normAbcEntry(s, s.day)));
  for (const key of [ABC_ARCHIVE_KEY, ABC_RESULTS_KEY]) {
    update(key, store => {
      for (const k of Object.keys(store)) {
        const e = normAbcEntry(store[k], Number(k));
        if (e === null || (key === ABC_ARCHIVE_KEY && staleV2AbcEntry(e, Number(k)))) delete store[k];
        else store[k] = e;
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
// Neither overwrites a foreign entry (a stale v2-era one it may).
function saveState() {
  if (randomName || abcViewDay === DAY) {
    const t = loadAbcToday();
    if (foreignAbcEntry(t, DAY) && !staleV2AbcEntry(t, DAY)) return;
    localStorage.setItem(ABC_STORAGE_KEY,
      JSON.stringify({ day: DAY, name: activeName, guesses, randomName, fmt: abcFmtOfDay(DAY) }));
  } else {
    const a = loadAbcArchive();
    if (foreignAbcEntry(a[abcViewDay], abcViewDay) && !staleV2AbcEntry(a[abcViewDay], abcViewDay)) return;
    a[abcViewDay] = { guesses, fmt: abcFmtOfDay(abcViewDay) };
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
  return entryGuesses(loadAbcArchive()[day], day) || entryGuesses(abcResults.load()[day], day) || [];
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

// ABC mode's persistent results, keyed by puzzle number (the store, streaks and
// the Stats & history view live in stats.js, shared with ID mode):
//   { [day]: { guesses, solved, tries, playedOnDay, fmt } }. Outlives day
// rollover; a finished daily is recorded at finish and migrated from a stale
// muldle-abc-v1 on load. A live daily's record and a foreign one are never
// overwritten.
const ABC_RESULTS_KEY = "muldle-abc-results-v1";
const abcResults = MuldleStats.create({
  key: ABC_RESULTS_KEY, today: DAY, maxGuesses: MAX_GUESSES,
  keep: (e, day) => {
    const cur = normAbcEntry(e, day);
    return !!cur && (cur.playedOnDay || foreignAbcEntry(cur, day));
  },
  heading: "Stats & history — ABC",
  alsoClear: [ABC_ARCHIVE_KEY, ABC_STORAGE_KEY],
  openPuzzle: day => { statsDialog.close(); goToAbcPuzzle(day); },
});

// Snapshot the just-finished puzzle. Random practice has no number → not recorded.
function recordCurrentAbcResult(solved) {
  if (randomName) return;
  abcResults.record(abcViewDay, {
    guesses: guesses.slice(),
    solved,
    tries: solved ? guesses.length : null,
    playedOnDay: abcViewDay === DAY,
    fmt: abcFmtOfDay(abcViewDay),
  });
}

// Rescue a finished daily left in muldle-abc-v1 from a previous day before
// loadState() would ignore it (day rollover). Runs once on load.
function migrateStaleAbcDaily() {
  try {
    const raw = JSON.parse(localStorage.getItem(ABC_STORAGE_KEY));
    const s = raw && typeof raw.day === "number" ? normAbcEntry(raw, raw.day) : null;
    if (!s || s.day >= DAY || s.randomName) return;
    // a stale v2-era daily of a v3 day is recorded too (its name is saved
    // with it, so it scores against what was played)
    if (typeof s.name !== "string" || !Array.isArray(s.guesses) ||
      (foreignAbcEntry(s, s.day) && !staleV2AbcEntry(s, s.day))) return;
    const ans = buildAnswerModel(s.name).answer;
    const gs = s.guesses.filter(g => typeof g === "string" && g.length === ans.length);
    if (!gs.length) return;
    const solved = gs[gs.length - 1] === ans;
    if (!solved && gs.length < MAX_GUESSES) return; // unfinished
    abcResults.record(s.day, { guesses: gs, solved, tries: solved ? gs.length : null, playedOnDay: true, fmt: s.fmt });
  } catch (e) { /* nothing to migrate */ }
}

/* ============ DOM ============ */

const boardEl = document.getElementById("abc-board");
const messageEl = document.getElementById("abc-message");
const keyboardEl = document.getElementById("abc-keyboard");
const infoEl = document.getElementById("abc-puzzle-info");
const taglineEl = document.getElementById("abc-tagline");
const helpV3El = document.getElementById("abc-help-v3");

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
  // a digit row only when the day's name actually has a number (47
  // Tucanae, Cygnus X-1), a * key only for Sagittarius A* — otherwise the
  // keyboard is letters only
  if (/[0-9]/.test(ANSWER)) rows.push([..."1234567890"]);
  rows.push([..."QWERTYUIOP"]);
  rows.push([..."ASDFGHJKL", ...(ANSWER.includes("*") ? ["*"] : [])]); // the row with room for a 10th key
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
  markDoneKeys([...guesses.slice(0, r), guess]);
}

// a key whose every copy is found is marked done (shown only with the setting
// on, see game.js's markDoneKeys)
function markDoneKeys(scored) {
  for (const c of MuldleHints.placed(revealedHints(scored, ANSWER))) {
    if (keyEls[c]) keyEls[c].classList.add("done");
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
  // the tagline and How to play speak of sky names only on a v3 puzzle
  const v3 = abcEra === "v3";
  taglineEl.textContent = v3 ? "Name what's in today's sky." : "Name today's deep-sky object.";
  helpV3El.hidden = !v3;
  // the puzzle number now lives in the navigator; the info line carries context
  // (from v3 not every answer is an object: a constellation is a region)
  const size = era().names.length, what = v3 ? "names" : "named objects";
  infoEl.textContent = randomName
    ? `Random name · ${size} ${what}`
    : abcViewDay !== DAY
      ? `Archive · ${size} ${what}`
      : `${size} ${what}`;
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
const panelEl = document.getElementById("abc-object-panel");
const captionEl = document.getElementById("abc-object-caption");
const aladinDiv = document.getElementById("abc-aladin-div");
const surveyPickerEl = document.getElementById("abc-survey-picker");
let aladinView = null;
let shownId = null; // catalogue id currently in the panel, or null
let surveyCtl = null; // survey picker controller (surveys.js), built on first show

let skyOverlay = null; // the lines drawn over the view (sky names only)
const WIDE_VIEW = 50;  // degrees: from this view width on, suggest the wide-view survey

// an entry id's data for the sky view: position, constellations, the id SIMBAD
// knows it by (null: none of its own) and, for a deep-sky id, its pool word
// (for game.js's viewFov). A deep-sky id's come from game.js's pool of the era
// in play, a v3 sky name's from SKY_INFO (`sky`, with its own view width).
function catalogueEntry(id) {
  const s = skyInfo(id);
  if (s) return { pos: s.pos, cons: s.kind === "constellation" ? [] : s.cons, ident: s.simbad || null, sky: s };
  const p = poolFor(era().catEra, era().catFmt), w = fullWord(id), i = p.index.get(w);
  return i === undefined ? { pos: null, cons: [], ident: null }
    : { pos: p.positions[i], cons: [p.constellations[i]].filter(Boolean), ident: simbadQuery(w, p), word: w, pool: p };
}

// skylines.js (a constellation's outline, an asterism's figure; ~130 KB) loads
// with the sky view of a sky name. Never rejects: without it, no lines.
let skyLinesReady = null;
function loadSkyLines() {
  if (!skyLinesReady) {
    skyLinesReady = new Promise(resolve => {
      if (typeof SKY_LINES !== "undefined") { resolve(); return; }
      const s = document.createElement("script");
      s.src = "skylines.js" + ASSET_QUERY; // game.js: this release's version
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
  return skyLinesReady;
}

// draw the shown name's lines over the view: a constellation's outline, an
// asterism's figure, a ring round a star; nothing for anything else
function drawSkyLines(id) {
  if (!skyOverlay) {
    skyOverlay = A.graphicOverlay({ color: "#ffcf4d", lineWidth: 1.5 });
    aladinView.addOverlay(skyOverlay);
  }
  skyOverlay.removeAll();
  const s = skyInfo(id);
  if (!s) return;
  const lines = typeof SKY_LINES !== "undefined" && SKY_LINES[id];
  if (lines) {
    for (const flat of lines) {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
      skyOverlay.add(A.polyline(pts));
    }
  } else if (s.kind === "star") {
    skyOverlay.add(A.circle(s.pos[0], s.pos[1], s.fov * 0.08));
  }
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

// object type for the caption (the view's size comes from sizes.js)
const infoCache = new Map();
function fetchInfo(ident) {
  if (ident === null) return Promise.resolve({ otype: "" });
  if (infoCache.has(ident)) return infoCache.get(ident);
  const q = "SELECT basic.otype_txt FROM ident JOIN basic " +
    "ON ident.oidref = basic.oid WHERE ident.id = '" + ident.replace(/'/g, "''") + "'";
  const url = SIMBAD_TAP + "?request=doQuery&lang=adql&format=json&query=" +
    encodeURIComponent(q);
  const p = fetch(url).then(r => r.json()).then(j => {
    const row = (j.data && j.data[0]) || [];
    return { otype: row[0] || "" };
  }).catch(() => { infoCache.delete(ident); return { otype: "" }; });
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
  const { pos, cons, ident, sky } = catalogueEntry(id);
  const role = document.createElement("span");
  role.className = "object-role" + (isTarget ? " target" : "");
  role.textContent = isTarget ? "target" : "guess";
  const link = document.createElement("a");
  if (sky) {
    link.href = sky.link;
  } else if (ident === null && pos) {
    // no SIMBAD object of its own: a coordinate search instead of a dead page
    link.href = "https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=" +
      encodeURIComponent(`${pos[0]} ${pos[1] >= 0 ? "+" : ""}${pos[1]}`) + "&Radius=2&Radius.unit=arcmin";
  } else {
    link.href = "https://simbad.cds.unistra.fr/simbad/sim-basic?Ident=" +
      encodeURIComponent(ident || spacedId(id));
  }
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = (sky && sky.show) || era().byId.get(id) || spacedId(id);
  captionEl.replaceChildren(role, " ", link);
  const label = sky ? sky.label : spacedId(id); // an asterism has no designation
  if (label) captionEl.append(" · ", label);
  // a sky name says what it is in words (SIMBAD's codes don't fit a
  // constellation or asterism); a star adds its magnitude
  const what = sky ? sky.type || sky.kind : otype;
  if (what) captionEl.append(" · " + what);
  if (sky && sky.mag != null) captionEl.append(" · mag " + String(sky.mag).replace("-", "−"));
  // constellation(s), for parity with ID mode's richer caption (CONSTELLATION_NAMES
  // is a game.js top-level const, shared across the two classic scripts)
  if (cons.length) captionEl.append(" · " + cons.map(c => CONSTELLATION_NAMES[c] || c).join(", "));
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
  skyOverlay = null;
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

  const { pos, ident, word, pool: p, sky } = catalogueEntry(id);
  renderCaption(id, "");
  if (!pos) return;
  // spinner in the caption while the object's SIMBAD data is on its way
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  captionEl.append(" ", spinner);

  // a sky name brings its own type and view width (and lines); a deep-sky
  // object's type comes from SIMBAD, its size from sizes.js
  const extras = sky ? [Promise.resolve({ otype: "" }), loadSkyLines()] : [fetchInfo(ident), loadViewSizes()];
  Promise.all([loadAladin(), ...extras]).then(([, info]) => {
    if (shownId !== id) return; // another row clicked meanwhile
    const fov = sky ? sky.fov : viewFov(word, p);
    // the survey that shows it best: a sky name's own pick (an object only an
    // infrared or X-ray survey shows; a fast-moving star in 2MASS, whose epoch
    // matches its J2000 position), else the clean all-sky mosaic for a view
    // tens of degrees wide (DSS2 shows its plate seams there), else DSS2
    if (surveyCtl) {
      surveyCtl.suggest((sky && sky.survey) ||
        (fov >= WIDE_VIEW ? window.MuldleSurveys.WIDE_ID : window.MuldleSurveys.DEFAULT_ID));
    }
    if (aladinView) aimSkyView(aladinView, pos, fov);
    else {
      aladinView = A.aladin("#abc-aladin-div", {
        survey: surveyCtl ? surveyCtl.current() : "P/DSS2/color",
        target: pos[0] + " " + pos[1],
        fov,
        showFullscreenControl: false, showLayersControl: false,
        showFrame: false, showCooGridControl: false, showProjectionControl: false,
      });
    }
    drawSkyLines(id);
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

// the target's other established names for the reveal (a sky name's own list,
// else game.js's otherNames over the era's catalogue pool), never the name
// just played
function revealOthers() {
  const s = skyInfo(activeId);
  if (s) return (s.aka || []).filter(n => n !== activeName && n !== s.show);
  const p = poolFor(era().catEra, era().catFmt);
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
  if (!/^[0-9A-Z*]$/.test(k)) return;
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
    showMessage(`${WIN_MESSAGES[guesses.length - 1]} It was ${theName(activeName, activeId)}.`, true, revealOthers());
    showObject(activeId);
    showPostGame();
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    recordCurrentAbcResult(false);
    showMessage(`Out of guesses — it was ${theName(activeName, activeId)}.`, true, revealOthers());
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
  else if (/^[0-9*]$/.test(e.key)) handleKey(e.key);
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
    showMessage(`Already solved — it was ${theName(activeName, activeId)}.`, true, revealOthers());
    showObject(activeId);
    showPostGame();
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    recordCurrentAbcResult(false);
    showMessage(`Out of guesses — it was ${theName(activeName, activeId)}.`, true, revealOthers());
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

function openAbcStats() { settingsDialog.close(); abcResults.render(statsContent); statsDialog.showModal(); }

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
  abcResults.render(postGameStatsEl, { includeClear: false });
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
MuldleStats.pruneFuture(ABC_RESULTS_KEY, DAY); // drop stale entries from the epoch re-index
MuldleStats.pruneFuture(ABC_ARCHIVE_KEY, DAY);
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
  get viewDay() { return abcViewDay; }, get model() { return MODEL; },
  get aladin() { return aladinView; }, fmtOf: abcFmtOfDay,
  get skyLines() { return skyOverlay && skyOverlay.overlayItems ? skyOverlay.overlayItems.length : null; } }; // e2e/debug hook

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
