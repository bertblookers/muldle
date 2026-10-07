// SPDX-License-Identifier: AGPL-3.0-only
"use strict";

/* ============ configuration ============ */

// identifier anatomy: catalogue prefix + number + optional component letter,
// e.g. "NGC0042" (format 1), "NGC42", "Mel25", "IC1023A" (format 2). How the
// number is written is a save's format (ID_FORMATS below).
const ID_RE = /^([A-Za-z]+)(\d+)([A-Z]?)$/;
const MAX_GUESSES = 6;
const BLANK = " ";             // internal representation of an empty tile

// the longest identifier (NGC####L, in either era) sets the board width;
// shorter ones pad with trailing blanks, all WORD_LEN tiles are playable
const WORD_LEN = CAT_IDENTIFIERS.concat(V2_IDS).reduce((m, id) => Math.max(m, id.length), 0);

// puzzle numbers count days from EPOCH, across every era
const EPOCH = { y: 2026, m: 9, d: 8 }; // 2026-09-08 = puzzle #0

// an id as a row of tiles: uppercase ("Mel25" -> "MEL25"), trailing blanks
function fullWord(id) {
  return id.toUpperCase().padEnd(WORD_LEN, BLANK);
}

// "NGC0042" -> "NGC42": a format-1 id in format 2 (format-2 ids pass through)
function unpadId(id) {
  return id.replace(/^([A-Za-z]+)0+(?=\d)/, "$1");
}

/* ============ daily answer selection ============ */

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

function todayIndex() {
  const now = new Date();
  const epoch = new Date(EPOCH.y, EPOCH.m - 1, EPOCH.d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - epoch) / 86400000);
}

// whole calendar days from date a to date b (local midnights; the rounding
// absorbs a DST hour)
function daysBetween(a, b) {
  return Math.round((new Date(b.y, b.m - 1, b.d) - new Date(a.y, a.m - 1, a.d)) / 86400000);
}

const mod = (n, m) => ((n % m) + m) % m;

/* ---- eras ---- */

// An era freezes one answer pool, its order and its seeds. Eras start on a
// calendar date at local midnight, the same date in ID and ABC mode (each with
// its own puzzle numbers; abc.js reads ERA_V2_START). A new catalogue snapshot
// or new names add an era and never edit one: players' history, archives and
// ?p=N links depend on every past answer staying put. A switch date must come
// after the deploy that introduces it, so no daily in progress changes answer.
const ERA_V2_START = { y: 2026, m: 10, d: 5 }; // a Monday: v2's weeks start here
// ABC mode only: from this Monday ABC's answers reach beyond deep-sky objects
// (constellations, stars, asterisms, objects outside the catalogues; abc.js,
// names_v3.js). ID mode stays v2. abc.js and start.js read it.
const ERA_ABC_V3_START = { y: 2026, m: 10, d: 12 };
const ID_ERAS = [
  { key: "v1", firstDay: 0 },
  { key: "v2", firstDay: daysBetween(EPOCH, ERA_V2_START) }, // puzzle #27
];

function eraOfDay(d) {
  let era = ID_ERAS[0].key;
  for (const e of ID_ERAS) if (d >= e.firstDay) era = e.key;
  return era;
}

// The era a save of puzzle d in format fmt was played in. Format 1 exists
// only in v1, so a format-1 save is a v1 game even on a later day: pre-release
// code still running after the switch (a deploy that lands after some
// player's midnight) played that day's v1 answer, and the save stays as played.
function eraOf(d, fmt) {
  return fmt === 1 ? "v1" : eraOfDay(d);
}

// v1 (puzzles #0-#26): NGC + IC. One seeded shuffle of the sorted, zero-padded
// 12001-id list in data.js. Never change the list, the seed or shuffledOrder:
// tools/test_golden.mjs pins every v1 answer. The order always comes from the
// padded list (unpadding changes the sort: NGC100 < NGC31) and is then shown
// in the save's format.
const SHUFFLE_SEED = 20260908;
const ORDER = shuffledOrder(CAT_IDENTIFIERS, SHUFFLE_SEED);
const N = ORDER.length;
// the v1 answer of puzzle d as a format-1 id ("NGC0042"); wraps mod N
function v1AnswerForDay(d) { return ORDER[mod(d, N)]; }

// v2 (from puzzle #27, 2026-10-05): M, NGC, IC, Mel, Cr, C and B, one answer
// per object (data_v2.js). In every Monday-Sunday week two days, drawn by a
// seeded RNG, come from the famous tier (Messier + Caldwell + every named
// object, names_v2.js) and the other five from the rest. The k-th famous day
// of the era takes the k-th object of a seeded shuffle of the tier, rest days
// likewise; each sequence wraps mod its length. tools/test_golden.mjs pins it.
const V2_FAMOUS_SEED = 20261005;
const V2_REST_SEED = 20261006;
const V2_WEEK_SEED = 20261007;
const V2_FIRST_DAY = ID_ERAS[1].firstDay;
const V2_FAMOUS_ORDER = shuffledOrder(V2_FAMOUS, V2_FAMOUS_SEED);
const V2_FAMOUS_SET = new Set(V2_FAMOUS);
const V2_REST_ORDER = shuffledOrder(V2_IDS.filter(id => !V2_FAMOUS_SET.has(id)), V2_REST_SEED);

// the two famous days (0 = Monday ... 6 = Sunday) of v2 week w, ascending
function famousDaysOfWeek(w) {
  const rand = mulberry32((V2_WEEK_SEED + Math.imul(w, 0x9E3779B1)) >>> 0);
  const a = Math.floor(rand() * 7);
  let b = Math.floor(rand() * 6);
  if (b >= a) b++;
  return a < b ? [a, b] : [b, a];
}

// the v2 answer of puzzle d as a v2 id ("M31", "Mel25")
function v2AnswerForDay(d) {
  const k = d - V2_FIRST_DAY, w = Math.floor(k / 7), day = k - 7 * w;
  const [a, b] = famousDaysOfWeek(w);
  if (day === a || day === b) return V2_FAMOUS_ORDER[mod(2 * w + (day === b), V2_FAMOUS_ORDER.length)];
  return V2_REST_ORDER[mod(5 * w + day - (a < day) - (b < day), V2_REST_ORDER.length)];
}

/* ---- formats ---- */

// Every ID-mode save carries `fmt`: how its ids are written. One row per
// format; a new format is a new row, and a row never changes meaning
// (mirrored in CLAUDE.md). A save without one is from before the release, so
// format 1 (normEntry); a stored entry whose fmt isn't a row is skipped and
// left untouched in storage, never guessed at.
const ID_FORMATS = {
  // NGC/IC: prefix + 4 zero-padded digits + optional component letter
  // ("NGC0031", "IC1023A"). Everything saved before the v2 release.
  1: { eras: ["v1"] },
  // catalogue prefix + unpadded number + optional component letter
  // ("M31", "NGC31", "Mel25", "IC1023A")
  2: { eras: ["v1", "v2"] },
};
const FMT_CURRENT = 2; // a puzzle with no guesses saved plays in this one

function knownFormat(fmt, era) {
  return Number.isInteger(fmt) && Object.prototype.hasOwnProperty.call(ID_FORMATS, fmt) &&
    ID_FORMATS[fmt].eras.includes(era);
}

/* ---- pools: one era's guessable words in one format ---- */

// SIMBAD's name for each catalogue (Caldwell has none: data_v2.js gives C9
// and C99 their own query ids)
const SIMBAD_CAT = { M: "M", NGC: "NGC", IC: "IC", Mel: "Cl Melotte", Cr: "Cl Collinder", B: "Barnard" };

function makePool(era, fmt) {
  const v1 = era === "v1";
  const ids = !v1 ? V2_IDS : fmt === 1 ? CAT_IDENTIFIERS : CAT_IDENTIFIERS.map(unpadId);
  const words = ids.map(fullWord);
  const index = new Map(words.map((w, i) => [w, i]));
  const asWord = id => fullWord(fmt === 1 ? id : unpadId(id)); // a v1 id in this format
  // common names (names.js = v1, names_v2.js = v2) by word; the first wins
  const names = new Map();
  for (const e of v1 ? ID_NAMES : ID_NAMES_V2) {
    const w = v1 ? asWord(e.id) : fullWord(e.id);
    if (!names.has(w)) names.set(w, e.name);
  }
  // practice's catalogue weighting: per catalogue, the indices of its members
  let members = V2_MEMBERS;
  if (v1) {
    members = { NGC: [], IC: [] };
    CAT_IDENTIFIERS.forEach((id, i) => members[ID_RE.exec(id)[1]].push(i));
  }
  return {
    era, fmt, ids, words, index, names, members,
    positions: v1 ? CAT_POSITIONS : V2_POSITIONS,
    constellations: v1 ? CAT_CONSTELLATIONS : V2_CONSTELLATIONS,
    // real catalogue entries kept out of the game (no SIMBAD data, mostly IC
    // numbers that turned out to be stars or lost), refused with an honest
    // message rather than "not a known object identifier"
    excluded: new Set((v1 ? CAT_EXCLUDED : CAT_EXCLUDED.concat(V2_EXCLUDED)).map(asWord)),
    // the keyboard's letters: every letter of the pool's ids
    letters: [...new Set(words.join("").replace(/[^A-Z]/g, ""))].sort(),
  };
}

const POOLS = new Map();
function poolFor(era, fmt) {
  const key = era + "/" + fmt;
  if (!POOLS.has(key)) POOLS.set(key, makePool(era, fmt));
  return POOLS.get(key);
}

// the pool of puzzle d in format fmt, and its answer as a word
function poolForDay(d, fmt) { return poolFor(eraOf(d, fmt), fmt); }
function answerForDay(d, fmt = FMT_CURRENT) {
  if (eraOf(d, fmt) === "v2") return fullWord(v2AnswerForDay(d));
  const id = v1AnswerForDay(d);
  return fullWord(fmt === 1 ? id : unpadId(id));
}

// the same object's id in another format of the pool's era (undefined if none)
function idInFormat(p, id, fmt) {
  const i = p.index.get(fullWord(id));
  return i === undefined ? undefined : poolFor(p.era, fmt).ids[i];
}

const DAY = todayIndex();
const ANSWER = answerForDay(DAY); // today's daily, in the current format

// a word as its id ("MEL25   " -> "Mel25"); a word outside the pool as typed
function displayName(word, p = pool) {
  const i = p.index.get(word);
  return i === undefined ? word.trim() : p.ids[i];
}

// "Mel25" -> "Mel 25", "NGC0042" -> "NGC 42": the id as astronomers write it
function spacedId(id) {
  const m = ID_RE.exec(id);
  return m ? m[1] + " " + parseInt(m[2], 10) + m[3] : id;
}

// The identifier SIMBAD knows the object by, for the runtime hint query:
// "NGC 42", "M 31", "Cl Melotte 25". data_v2.js lists the v2 answers where
// that isn't the mechanical form; null = SIMBAD has no object of its own.
function simbadQuery(word, p = pool) {
  const id = p.ids[p.index.get(word)];
  if (id === undefined) return null;
  if (p.era === "v2" && Object.prototype.hasOwnProperty.call(V2_QUERY, id)) return V2_QUERY[id];
  const [, cat, num, letter] = ID_RE.exec(id);
  return (SIMBAD_CAT[cat] || cat) + " " + parseInt(num, 10) + letter;
}

// A minority of in-game objects have a well-known common name (curated per
// era, see names.js / names_v2.js). Returns the name or null; used by the
// end-of-game reveal and the sky-view caption.
function commonName(word, p = pool) {
  return p.names.get(word) || null;
}

// The v2 answer an entry of pool p is (aka.js and sizes.js are keyed by it):
// the entry itself in v2, a v1 id through its object's v2 answer.
function v2Answer(word, p = pool) {
  const id = p.ids[p.index.get(word)];
  if (id === undefined) return null;
  if (p.era === "v2") return id;
  const u = unpadId(id);
  return V2_BY_UPPER.get(u) || V2_ALIASES[u] || null;
}

// The object's other established names (aka.js, keyed by v2 answer: display
// only, not frozen by an era), shown in the reveal beside its common name.
// Only for an object that has a common name in the puzzle's era, and never
// repeating it.
function otherNames(word, p = pool) {
  const v2 = v2Answer(word, p), common = commonName(word, p);
  if (!v2 || !common || typeof ALSO_KNOWN_AS === "undefined") return [];
  return (ALSO_KNOWN_AS[v2] || []).filter(n => n !== common);
}

// The sky view's field of view in degrees (both modes): how much sky the whole
// object needs around its position (sizes.js's VIEW_SIZES, arcmin, keyed by v2
// answer; it loads with the sky view) times VIEW_MARGIN, so it fills about 80%
// of the view. DEFAULT_FOV where no source has a size (or sizes.js didn't load).
const VIEW_MARGIN = 1.25;
const MIN_FOV = 0.05, MAX_FOV = 30, DEFAULT_FOV = 0.3; // degrees
function viewFov(word, p = pool) {
  const a = v2Answer(word, p);
  const arcmin = a && typeof VIEW_SIZES !== "undefined" ? VIEW_SIZES[a] : undefined;
  return arcmin ? Math.min(Math.max((VIEW_MARGIN * arcmin) / 60, MIN_FOV), MAX_FOV) : DEFAULT_FOV;
}

/* ---- refusals: why a word that isn't in the puzzle's pool was refused ---- */

// v2 ids, aliases and split aliases by their tile form ("MEL25")
const V2_BY_UPPER = new Map(V2_IDS.map(id => [id.toUpperCase(), id]));
const V2_ALIAS_BY_UPPER = new Map(Object.entries(V2_ALIASES).map(([a, t]) => [a.toUpperCase(), [a, t]]));
const V2_SPLIT_BY_UPPER = new Map(Object.entries(V2_SPLIT_ALIASES).map(([a, ts]) => [a.toUpperCase(), [a, ts]]));

// v2 answer -> the v1 ids (format 1) of that object, built on first use
let v1IdsByV2 = null;
function v1IdsOf(v2Id) {
  if (!v1IdsByV2) {
    v1IdsByV2 = new Map();
    for (const id of CAT_IDENTIFIERS) {
      const u = unpadId(id);
      const t = V2_BY_UPPER.has(u) ? u : V2_ALIASES[u];
      if (!t) continue;
      if (!v1IdsByV2.has(t)) v1IdsByV2.set(t, []);
      v1IdsByV2.get(t).push(id);
    }
  }
  return v1IdsByV2.get(v2Id) || [];
}

// The message for a refused word (every refusal counts toward ✖): the same id
// in the puzzle's format, a SIMBAD-less catalogue entry, an alias ("NGC224 is
// M31 in Muldle"; in a v1 puzzle "M31 is NGC224 in this puzzle"), an object
// that joined in a later era, or simply unknown.
function refusalMessage(word, p = pool) {
  const typed = word.trim();
  // typed from the second tile on: the id itself may be fine
  if (word[0] === BLANK && p.index.has(fullWord(typed))) {
    return `Identifiers start in the first tile: ${displayName(fullWord(typed), p)}`;
  }
  const m = /^([A-Z]+)(\d+)([A-Z]?)$/.exec(typed);
  if (!m) return `${typed} is not a known object identifier`;
  const [, cat, num, letter] = m;
  const n = String(parseInt(num, 10));
  const key = cat + n + letter; // format 2, tile form
  // the same number written the way this puzzle writes it (only a padding
  // difference gets the format hint)
  const same = fullWord(cat + (p.fmt === 1 ? n.padStart(4, "0") : n) + letter);
  if (same !== fullWord(typed) && p.index.has(same)) {
    return p.fmt === 1
      ? `This puzzle was started with zero-padded ids: ${displayName(same, p)}`
      : `Ids have no leading zeros now: ${displayName(same, p)}`;
  }
  if (p.excluded.has(same)) {
    return `${same.trim()} is a real catalogue entry, but SIMBAD has no data on it — not in the game`;
  }
  const alias = V2_ALIAS_BY_UPPER.get(key), split = V2_SPLIT_BY_UPPER.get(key);
  if (p.era === "v2") {
    if (alias) return `${alias[0]} is ${alias[1]} in Muldle`;
    if (split) return `${split[0]} is ${split[1].join(" and ")} in Muldle`;
  } else {
    // the v2 object(s) behind the typed id, then their ids in this puzzle
    const named = alias ? alias[0] : split ? split[0] : V2_BY_UPPER.get(key);
    const targets = alias ? [alias[1]] : split ? split[1] : named ? [named] : [];
    if (targets.length) {
      const here = targets.map(t => v1IdsOf(t).map(id => (p.fmt === 1 ? id : unpadId(id))));
      return here.every(ids => ids.length)
        ? `${named} is ${here.map(ids => ids.join(" or ")).join(" and ")} in this puzzle`
        : `${named} joined Muldle after this puzzle`;
    }
  }
  return `${typed} is not a known object identifier`;
}

/* ============ state ============ */

// today's daily (or the random-practice object): { day, guesses, randomId, rejected, fmt }
const STORAGE_KEY = "muldle-v1";
// past puzzles replayed via the navigator, keyed by number:
// { [day]: { guesses, rejected, fmt } } (bare guesses[] arrays before the
// rejected count existed; stampFormats converts them). Separate from muldle-v1
// so browsing an off-day puzzle never clobbers today's daily progress (or the
// random-practice object).
const ARCHIVE_KEY = "muldle-archive-v1";

let pool = poolForDay(DAY, FMT_CURRENT); // the puzzle's era + format: its words,
                           // object data and keyboard letters
let guesses = [];          // array of padded guess strings already submitted
let current = [];          // characters of the guess being typed, indexed by
                           // tile position (sparse: holes are empty tiles)
let lockedTiles = [];      // hard mode: positions prefilled with known greens
let cursor = 0;            // tile the next typed character goes into; WORD_LEN =
                           // past the end (row full, or moved off with →)
let rejected = 0;          // guesses refused this puzzle (unknown identifier,
                           // SIMBAD-less entry, a repeat, or a hard-mode violation)
let lastRejected = null;   // the row's last refused guess: re-submitting it
                           // unchanged (held / double-tapped Enter) isn't a new try
let finished = false;      // won or lost
let randomId = null;       // identifier overriding the daily answer (random-object
                           // mode), written in the pool's format
let answer = ANSWER;       // answer of the puzzle being played (padded)
let viewDay = DAY;         // puzzle number in play: today's (DAY) or an archived one (< DAY)

// start a fresh guess row; in hard mode every known-green tile (one a previous
// guess already matched, blanks included) starts filled in and locked —
// typing fills only the free tiles and Backspace skips the locked ones
function resetCurrentRow() {
  current = [];
  lockedTiles = [];
  if (hardMode && !finished) {
    const { fixed } = revealedHints(guesses, answer); // the same greens hard mode enforces
    for (let i = 0; i < WORD_LEN; i++) {
      if (fixed[i] !== undefined) { current[i] = fixed[i]; lockedTiles[i] = true; }
    }
  }
  cursor = nextFreeTile(0);
  lastRejected = null;
}

// the first tile at or after i that isn't a locked green (WORD_LEN if none)
function nextFreeTile(i) {
  while (i < WORD_LEN && lockedTiles[i]) i++;
  return i;
}

// the last tile before i that isn't a locked green (-1 if none)
function prevFreeTile(i) {
  i--;
  while (i >= 0 && lockedTiles[i]) i--;
  return i;
}

// a stored rejected-guess count, sanitised (absent / corrupt -> 0)
function rejectedCount(v) {
  return Number.isInteger(v) && v > 0 ? v : 0;
}

// A stored entry as this code reads it. A save without `fmt` was written by
// pre-release code (before every load stamps it, or by a stale tab since), so
// it is format 1; a bare-array archive entry is { guesses, rejected: 0, fmt: 1 }.
function normEntry(e) {
  if (Array.isArray(e)) return { guesses: e, rejected: 0, fmt: 1 };
  return e && typeof e === "object" && !("fmt" in e) ? { ...e, fmt: 1 } : e;
}

// Writes normEntry's reading back to every store on load, so the saves carry
// their flag. Idempotent; the readers apply the same rule, so a failed write
// (or a stale tab writing an unflagged entry later) changes nothing. A present
// but unknown fmt is left alone (see foreignEntry).
function stampFormats() {
  const update = (key, fn) => {
    try {
      const raw = localStorage.getItem(key);
      const v = JSON.parse(raw);
      if (!v || typeof v !== "object") return;
      const out = JSON.stringify(fn(v));
      if (out !== raw) localStorage.setItem(key, out);
    } catch (e) { /* corrupt or full: the readers normalise anyway */ }
  };
  update(STORAGE_KEY, normEntry);
  for (const key of [ARCHIVE_KEY, RESULTS_KEY]) {
    update(key, store => {
      for (const k of Object.keys(store)) store[k] = normEntry(store[k]);
      return store;
    });
  }
}

// a stored entry of puzzle `day` this code must leave alone: its fmt isn't one
// ID_FORMATS knows for the era it was played in (newer code wrote it, or it's
// corrupt)
function foreignEntry(e, day) {
  e = normEntry(e);
  return !!e && typeof e === "object" && !knownFormat(e.fmt, eraOf(day, e.fmt));
}

// a stored { guesses, rejected, fmt } entry of puzzle `day`, sanitised, or null
// if there's none or it's foreign. With no guess saved there is nothing to keep
// in an older format, so such a puzzle plays (and saves) in the current one.
function readEntry(e, day) {
  e = normEntry(e);
  if (!e || typeof e !== "object" || !Array.isArray(e.guesses) || foreignEntry(e, day)) return null;
  const gs = e.guesses.filter(g => typeof g === "string" && g.length === WORD_LEN);
  return { guesses: gs, rejected: rejectedCount(e.rejected), fmt: gs.length ? e.fmt : FMT_CURRENT };
}

// today's daily (and the random-practice object) live in muldle-v1, keyed on
// DAY; an off-day puzzle browsed via the navigator goes to the archive store so
// it never overwrites today's daily. Neither overwrites a foreign entry.
function saveState() {
  const entry = { guesses, rejected, fmt: pool.fmt };
  if (randomId || viewDay === DAY) {
    if (foreignEntry(loadToday(), DAY)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day: DAY, ...entry, randomId }));
  } else {
    const a = loadArchive();
    if (foreignEntry(a[viewDay], viewDay)) return;
    a[viewDay] = entry;
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(a));
  }
}

// muldle-v1's entry if it is today's, else null
function loadToday() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return s && s.day === DAY ? s : null;
  } catch (e) { return null; }
}

function loadState() {
  const s = normEntry(loadToday());
  const e = readEntry(s, DAY);
  if (e) {
    if (typeof s.randomId !== "string") return { ...e, randomId: null };
    // the random object moves to the current format with its guesses (none)
    const rid = idInFormat(poolForDay(DAY, s.fmt), s.randomId, e.fmt);
    if (rid) return { ...e, randomId: rid };
  }
  return { guesses: [], randomId: null, rejected: 0, fmt: FMT_CURRENT };
}

function loadArchive() {
  try {
    const a = JSON.parse(localStorage.getItem(ARCHIVE_KEY));
    return a && typeof a === "object" ? a : {};
  } catch (e) { return {}; }
}

// saved { guesses, rejected, fmt } for the puzzle currently in view: today's
// daily from muldle-v1 (unless a random save sits there, in which case today's
// daily is fresh), an off-day puzzle from the archive store, or — for a past
// daily you played live but never replayed in the archive — the persistent
// results store
function loadViewState() {
  const fresh = { guesses: [], rejected: 0, fmt: FMT_CURRENT };
  if (viewDay === DAY) {
    const s = loadState();
    return s.randomId ? fresh : { guesses: s.guesses, rejected: s.rejected, fmt: s.fmt };
  }
  return readEntry(loadArchive()[viewDay], viewDay) || readEntry(idResults.load()[viewDay], viewDay) || fresh;
}

/* ============ local play history + stats (no backend) ============ */

// ID mode's persistent results, keyed by puzzle number (the store, streaks and
// the Stats & history view live in stats.js):
//   { [day]: { guesses, solved, tries, playedOnDay, rejected, fmt } }.
// muldle-v1 is keyed on today's DAY and discarded once the day turns, so a
// finished daily is recorded here at finish time (and migrated from a stale
// muldle-v1 on load). A live daily's record and a foreign one (see
// foreignEntry) are never overwritten.
const RESULTS_KEY = "muldle-results-v1";
const idResults = MuldleStats.create({
  key: RESULTS_KEY, today: DAY, maxGuesses: MAX_GUESSES,
  keep: (e, day) => !!e && (e.playedOnDay || foreignEntry(e, day)),
  heading: "Stats & history — ID",
  alsoClear: [ARCHIVE_KEY, STORAGE_KEY],
  openPuzzle: day => { statsDialog.close(); goToPuzzle(day); },
});

// Snapshot the just-finished puzzle in view into the results store. Random
// practice has no puzzle number, so it is never recorded (stays ephemeral).
function recordCurrentResult(solved) {
  if (randomId) return;
  idResults.record(viewDay, {
    guesses: guesses.slice(),
    solved,
    tries: solved ? guesses.length : null,
    playedOnDay: viewDay === DAY,
    rejected,
    fmt: pool.fmt,
  });
}

// Recover a finished daily left in muldle-v1 from a previous day before the
// day-rollover check in loadState() discards it. Runs once on load.
function migrateStaleDaily() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!s || !Number.isInteger(s.day) || s.day < 0 || s.day >= DAY || s.randomId) return;
    const e = readEntry(s, s.day);
    if (!e || !e.guesses.length) return;
    const gs = e.guesses;
    const solved = gs[gs.length - 1] === answerForDay(s.day, e.fmt);
    if (!solved && gs.length < MAX_GUESSES) return; // unfinished — not a result
    idResults.record(s.day, {
      guesses: gs, solved, tries: solved ? gs.length : null, playedOnDay: true,
      rejected: e.rejected, fmt: e.fmt,
    });
  } catch (e) { /* corrupt: nothing to migrate */ }
}

/* ============ scoring (standard Wordle rules) ============ */

function scoreGuess(guess, answer) {
  const result = new Array(WORD_LEN).fill("absent");
  const remaining = {};
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === answer[i]) {
      result[i] = "correct";
    } else {
      remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
    }
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (result[i] === "correct") continue;
    if (remaining[guess[i]] > 0) {
      result[i] = "present";
      remaining[guess[i]]--;
    }
  }
  return result;
}

/* ============ hard mode: a guess must be one that could still be the answer ============ */

// Orders the keyboard colours only (display). Hard mode's rules come from the
// per-tile, per-character knowledge in hints.js, shared with ABC mode.
const KEY_RANK = { absent: 0, present: 1, correct: 2 };

// what the previous guesses revealed (see hints.js)
function revealedHints(prevGuesses, answer) {
  return MuldleHints.fromGuesses(prevGuesses, answer, scoreGuess);
}

// a hints.js violation in ID-mode words (null stays null)
function hintMessage(v) {
  if (!v) return null;
  const times = n => (n === 2 ? "twice" : `${n} times`);
  const blank = v.ch === BLANK, tile = `tile ${v.tile + 1}`, s = v.n === 1 ? "" : "s";
  switch (v.code) {
    case "fixed": return blank ? `Hard mode: ${tile} must stay blank` : `Hard mode: ${tile} must be ${v.ch}`;
    case "absent": return blank ? "Hard mode: the identifier has no blank tiles"
      : `Hard mode: there is no ${v.ch} in the identifier`;
    case "not-here": return blank ? `Hard mode: ${tile} must not be blank` : `Hard mode: ${tile} is not ${v.ch}`;
    case "too-many": return blank ? `Hard mode: the identifier has only ${v.n} blank tile${s}`
      : v.n === 1 ? `Hard mode: there is only one ${v.ch} in the identifier`
      : `Hard mode: ${v.ch} appears only ${times(v.n)} in the identifier`;
    case "too-few": return blank ? `Hard mode: guess needs ${v.n} blank tile${s}`
      : v.n === 1 ? `Hard mode: guess must contain ${v.ch}` : `Hard mode: guess must contain ${v.ch} ${times(v.n)}`;
  }
  return null;
}

// Every revealed hint must be kept: greens stay, a character never goes back
// to a tile where it showed grey or yellow, and each character's count stays
// within what the feedback allows (so greyed-out characters are banned, and an
// earlier guess can't come back). Returns a message for the first broken rule,
// or null if the guess could still be the answer.
function hardModeViolation(prevGuesses, answer, guess) {
  return hintMessage(MuldleHints.violation(revealedHints(prevGuesses, answer), guess));
}

// How many identifiers hard mode would accept as the next guess: every one in
// the puzzle's pool that could still be the answer (never an earlier guess,
// never an alias). Shown in the info line, as lettered answers can leave only a
// handful (2 of 12001 is not unusual). The hints are built once, not once per
// candidate.
function legalGuessCount(prevGuesses, answer, p = pool) {
  const hints = revealedHints(prevGuesses, answer);
  let n = 0;
  for (const w of p.words) if (!MuldleHints.violation(hints, w)) n++;
  return n;
}

/* ============ object-property hints (pure helpers) ============ */

// padded playable word "NGC1023A" / "MEL25   " -> index into the pool's data
// arrays (-1 if the word isn't in the pool)
function catalogueIndex(word, p = pool) {
  const i = p.index.get(word);
  return i === undefined ? -1 : i;
}

const DEG = Math.PI / 180;

// great-circle separation in degrees between two [ra, dec] J2000 positions
function angularSeparation(p1, p2) {
  const de1 = p1[1] * DEG, de2 = p2[1] * DEG;
  const s = Math.sin((de2 - de1) / 2) ** 2 +
    Math.cos(de1) * Math.cos(de2) * Math.sin((p2[0] - p1[0]) * DEG / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s))) / DEG;
}

// position angle from p1 towards p2: 0 = north, 90 = east, degrees in [0, 360)
function positionAngle(p1, p2) {
  const dRa = (p2[0] - p1[0]) * DEG;
  const de1 = p1[1] * DEG, de2 = p2[1] * DEG;
  const y = Math.sin(dRa) * Math.cos(de2);
  const x = Math.cos(de1) * Math.sin(de2) - Math.sin(de1) * Math.cos(de2) * Math.cos(dRa);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}

function compassDir(pa) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((pa % 360) + 360) % 360) / 45) % 8];
}

// arrows drawn as on the sky (and the Aladin view): north up, EAST LEFT
const DIR_ARROWS = { N: "↑", NE: "↖", E: "←", SE: "↙", S: "↓", SW: "↘", W: "→", NW: "↗" };

function formatSeparation(deg) {
  return (deg >= 10 ? Math.round(deg) : deg.toFixed(1)) + "°";
}

// "match" (green) / "near" (yellow) / "" from how far a property is off
function closeness(delta, matchTol, nearTol) {
  return delta <= matchTol ? "match" : delta <= nearTol ? "near" : "";
}

const MAG_MATCH = 0.5, MAG_NEAR = 2;    // magnitudes
const DIST_MATCH = 2.5, DIST_NEAR = 15; // degrees on the sky

// IAU abbreviation (as in CAT_CONSTELLATIONS) -> full constellation name
const CONSTELLATION_NAMES = {
  And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aqr: "Aquarius", Aql: "Aquila",
  Ara: "Ara", Ari: "Aries", Aur: "Auriga", Boo: "Boötes", Cae: "Caelum",
  Cam: "Camelopardalis", Cnc: "Cancer", CVn: "Canes Venatici",
  CMa: "Canis Major", CMi: "Canis Minor", Cap: "Capricornus", Car: "Carina",
  Cas: "Cassiopeia", Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus",
  Cha: "Chamaeleon", Cir: "Circinus", Col: "Columba", Com: "Coma Berenices",
  CrA: "Corona Australis", CrB: "Corona Borealis", Crv: "Corvus",
  Crt: "Crater", Cru: "Crux", Cyg: "Cygnus", Del: "Delphinus", Dor: "Dorado",
  Dra: "Draco", Equ: "Equuleus", Eri: "Eridanus", For: "Fornax",
  Gem: "Gemini", Gru: "Grus", Her: "Hercules", Hor: "Horologium",
  Hya: "Hydra", Hyi: "Hydrus", Ind: "Indus", Lac: "Lacerta", Leo: "Leo",
  LMi: "Leo Minor", Lep: "Lepus", Lib: "Libra", Lup: "Lupus", Lyn: "Lynx",
  Lyr: "Lyra", Men: "Mensa", Mic: "Microscopium", Mon: "Monoceros",
  Mus: "Musca", Nor: "Norma", Oct: "Octans", Oph: "Ophiuchus", Ori: "Orion",
  Pav: "Pavo", Peg: "Pegasus", Per: "Perseus", Phe: "Phoenix", Pic: "Pictor",
  Psc: "Pisces", PsA: "Piscis Austrinus", Pup: "Puppis", Pyx: "Pyxis",
  Ret: "Reticulum", Sge: "Sagitta", Sgr: "Sagittarius", Sco: "Scorpius",
  Scl: "Sculptor", Sct: "Scutum", Ser: "Serpens", Sex: "Sextans",
  Tau: "Taurus", Tel: "Telescopium", Tri: "Triangulum",
  TrA: "Triangulum Australe", Tuc: "Tucana", UMa: "Ursa Major",
  UMi: "Ursa Minor", Vel: "Vela", Vir: "Virgo", Vol: "Volans",
  Vul: "Vulpecula",
};

/* ============ DOM setup ============ */

const boardEl = document.getElementById("board");
const messageEl = document.getElementById("message");
const keyboardEl = document.getElementById("keyboard");
const infoEl = document.getElementById("puzzle-info");

const navEl = document.getElementById("puzzle-nav");
const navPrevBtn = document.getElementById("nav-prev");
const navTodayBtn = document.getElementById("nav-today");
const navNextBtn = document.getElementById("nav-next");
const navNumEl = document.getElementById("nav-num-val");

/* ---- navigator plumbing: URL param + cross-mode bridge (kept below the DOM
   marker so tools/test_logic.mjs's pre-DOM sandbox never touches window) ---- */

// the active mode is owned by abc.js's flip; game.js runs before it sets
// window.__muldleMode, so on load we read the persisted preference directly
function activeModeOnLoad() {
  try {
    const m = localStorage.getItem("muldle-mode-v1");
    if (m === "abc" || m === "id") return m;
  } catch (e) { /* ignore */ }
  return "id";
}

// a shareable, reload-safe ?p=<day> for the active mode's puzzle. Clamped to
// <= today so future dailies stay out of reach (spoiler-free). null = absent.
function readUrlDay() {
  try {
    const p = new URL(location.href).searchParams.get("p");
    if (p == null) return null;
    const n = parseInt(p, 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(DAY, n));
  } catch (e) { return null; }
}

// one URL shared by both modes; it always reflects the ACTIVE mode's view day.
// replaceState (not push) keeps the address bar current without history spam.
const muldle = (window.__muldle = window.__muldle || {});
// each mode's "today" is a DIFFERENT puzzle number (ID and ABC have their own
// epochs), so ?p is dropped only when the viewed day equals the ACTIVE mode's
// today. muldle.today[mode] is filled by each mode (abc.js sets .abc).
muldle.today = muldle.today || {};
muldle.today.id = DAY;
muldle.view = muldle.view || { id: DAY, abc: DAY };
// whether the puzzle in play has a guess yet (start.js shows its start screen
// only for a fresh one); abc.js sets .abc
// (random practice counts as started: it isn't a fresh daily). Also whether
// the page was opened with a ?p=N link, read before any syncUrl drops it.
muldle.started = muldle.started || {};
muldle.started.id = () => guesses.length > 0 || !!randomId;
muldle.linked = new URLSearchParams(location.search).has("p");
muldle.syncUrl = function () {
  try {
    const m = window.__muldleMode || activeModeOnLoad();
    const day = muldle.view[m];
    const today = muldle.today[m];
    const url = new URL(location.href);
    if (day == null || day === today) url.searchParams.delete("p");
    else url.searchParams.set("p", String(day));
    history.replaceState(history.state, "", url);
  } catch (e) { /* history API unavailable (e.g. file://) */ }
};

const tiles = []; // tiles[row][col] for the WORD_LEN playable tiles per row

function buildBoard() {
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement("div");
    row.className = "row";
    row.addEventListener("click", () => rowClicked(r));
    const rowTiles = [];
    for (let c = 0; c < WORD_LEN; c++) {
      const t = document.createElement("div");
      t.className = "tile";
      t.addEventListener("click", () => tileClicked(r, c));
      row.appendChild(t);
      rowTiles.push(t);
    }
    tiles.push(rowTiles);
    boardEl.appendChild(row);
  }
}

const hintPanelEl = document.getElementById("hint-panel");
const hintCells = []; // hintCells[row] = {con, type, mag, dist} -> {cell, val}
const HINT_COLS = [["con", "Con"], ["type", "Type"], ["mag", "Mag"], ["dist", "Dist"]];

function buildHintPanel() {
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement("div");
    row.className = "hint-row";
    const cells = {};
    for (const [key, label] of HINT_COLS) {
      const cell = document.createElement("div");
      cell.className = "hint-cell " + key;
      const lab = document.createElement("span");
      lab.className = "hint-label";
      lab.textContent = label;
      const val = document.createElement("span");
      val.className = "hint-value";
      cell.append(lab, val);
      cells[key] = { cell, val };
      row.appendChild(cell);
    }
    hintCells.push(cells);
    hintPanelEl.appendChild(row);
  }
}

// digits, the pool's letters (v1: NGC/IC + component letters A-F; v2 adds L,
// M and R), Enter + Back. More than 10 letters split into two rows, with
// Enter and Back around the second, so the keys keep their size and the
// keyboard its three rows on a phone (.split in style.css).
function keyRows(letters) {
  const digits = [..."1234567890"];
  if (letters.length <= 10) return [digits, letters, ["Enter", "Back"]];
  const half = Math.ceil(letters.length / 2);
  return [digits, letters.slice(0, half), ["Enter", ...letters.slice(half), "Back"]];
}

let keyEls = {};
let keyLetters = ""; // the letters the keyboard was built for

// (re)build the keyboard for the pool in play; a no-op while its letters stay
// the same, so key colours survive (the navigator crossing an era rebuilds it)
function buildKeyboard() {
  if (keyLetters === pool.letters.join("")) return;
  keyLetters = pool.letters.join("");
  keyboardEl.replaceChildren();
  keyboardEl.classList.toggle("split", pool.letters.length > 10);
  keyEls = {};
  for (const rowKeys of keyRows(pool.letters)) {
    const row = document.createElement("div");
    row.className = "krow";
    for (const k of rowKeys) {
      const b = document.createElement("button");
      b.className = "key" + (k.length > 1 ? " wide" : "");
      b.textContent = k === "Back" ? "⌫" : k;
      // blur so a later physical Enter doesn't re-activate the clicked key
      b.addEventListener("click", () => { handleKey(k); b.blur(); });
      keyEls[k] = b;
      row.appendChild(b);
    }
    keyboardEl.appendChild(row);
  }
}

/* ============ rendering ============ */

function renderCurrentRow() {
  const r = guesses.length;
  if (r >= MAX_GUESSES) return;
  for (let c = 0; c < WORD_LEN; c++) {
    const t = tiles[r][c];
    const ch = current[c];
    t.classList.remove("filled", "locked", "cursor", "editable");
    if (ch === undefined) {
      t.textContent = "";
    } else {
      t.textContent = ch === BLANK ? "" : ch;
      t.classList.add(lockedTiles[c] ? "locked" : "filled");
    }
    // free tiles of the row being typed can be clicked to move the cursor there
    if (!finished && !lockedTiles[c]) t.classList.add("editable");
    if (!finished && c === cursor) t.classList.add("cursor");
  }
}

function renderGuessRow(r, guess) {
  const rowEl = boardEl.children[r];
  rowEl.classList.add("guessed");
  rowEl.title = "Show " + spacedId(displayName(guess)) + " in the sky view";
  const score = scoreGuess(guess, answer);
  for (let c = 0; c < WORD_LEN; c++) {
    const t = tiles[r][c];
    t.textContent = guess[c] === BLANK ? "" : guess[c];
    // locked text color would hide the char; a scored row is no longer editable
    t.classList.remove("filled", "locked", "cursor", "editable");
    t.classList.add(score[c]);
    if (guess[c] !== BLANK) upgradeKey(guess[c], score[c]);
  }
  markDoneKeys([...guesses.slice(0, r), guess]);
}

// a key whose every copy is found (hints.js `placed`) is marked done; it only
// looks different with the "Mark completed keys" setting on (a class on
// <body>), so toggling the setting needs no re-render
function markDoneKeys(scored) {
  for (const c of MuldleHints.placed(revealedHints(scored, answer))) {
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

function showMessage(text, sticky = false, alsoKnownAs = null, others = []) {
  messageEl.textContent = text;
  if (alsoKnownAs) {
    // reveal a curated common name in italics: "… It was NGC5194. Also known
    // as: <em>Whirlpool Galaxy</em>." (colon avoids the article guessing game —
    // "the 47 Tucanae" / "the Barnard's Galaxy" would read wrong)
    messageEl.append(" Also known as: ");
    const em = document.createElement("em");
    em.textContent = alsoKnownAs;
    messageEl.append(em, ".");
  }
  appendOtherNames(messageEl, others);
  messageEl.classList.toggle("reveal", sticky);
  clearTimeout(messageTimer);
  if (!sticky && text) {
    messageTimer = setTimeout(() => { messageEl.textContent = ""; }, 2500);
  }
}

// "Other names: Swan Nebula, Checkmark Nebula." as a quieter second line of
// a reveal (both modes; abc.js calls this too)
function appendOtherNames(el, others) {
  if (!others || !others.length) return;
  const line = document.createElement("span");
  line.className = "other-names";
  line.textContent = `Other names: ${others.join(", ")}.`;
  el.append(line);
}

function shakeCurrentRow() {
  const row = boardEl.children[guesses.length];
  row.classList.add("shake");
  setTimeout(() => row.classList.remove("shake"), 450);
}

/* ============ object reveal (Aladin Lite viewer) ============ */

const ALADIN_SRC = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js";
const SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";
// The release's asset version: the public index.html asks for game.js?v=<hash>
// (tools/export_public.py) so a release is never served from cache under an
// old URL; the files loaded later (sizes.js, abc.js's skylines.js) ask with the
// same query. Empty in the development repo.
const ASSET_QUERY = (() => {
  try { return new URL(document.currentScript.src).search; } catch (e) { return ""; }
})();

const panelEl = document.getElementById("object-panel");
const captionEl = document.getElementById("object-caption");
const aladinDiv = document.getElementById("aladin-lite-div");
const surveyPickerEl = document.getElementById("survey-picker");

let shownId = null;    // word of the object in the panel ("NGC0042 "), or null
let aladinView = null; // Aladin Lite instance, reused when switching objects
let surveyCtl = null;  // survey picker controller (surveys.js), built on first show

let aladinReady = null; // load the script only once per page life

function loadAladin() {
  if (!aladinReady) {
    aladinReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ALADIN_SRC;
      s.onload = () => A.init.then(resolve, reject);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return aladinReady;
}

// sizes.js (the sky view's object sizes, ~150 KB) loads with the sky view, not
// with the page; shared with ABC. Never rejects: without it, viewFov falls
// back to DEFAULT_FOV.
let viewSizesReady = null;
function loadViewSizes() {
  if (!viewSizesReady) {
    viewSizesReady = new Promise(resolve => {
      if (typeof VIEW_SIZES !== "undefined") { resolve(); return; }
      const s = document.createElement("script");
      s.src = "sizes.js" + ASSET_QUERY;
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
  return viewSizesReady;
}

// point a reused Aladin view (shared with ABC): north up again first — a
// two-finger twist on a phone rotates the view and gotoRaDec keeps it (Aladin
// 3.8 ignores setRotation(0); 360 is the same angle and works)
function aimSkyView(view, pos, fov) {
  if (typeof view.getRotation === "function" && view.getRotation() % 360) view.setRotation(360);
  view.gotoRaDec(pos[0], pos[1]);
  view.setFov(fov);
}

// Object type and magnitude (V, else B); the sky view's size comes from
// sizes.js, not from here. Cached per identifier; a failed fetch is not
// cached so a later guess retries. `found` distinguishes an object SIMBAD
// doesn't know (false: a null ident, i.e. a v2 answer with no SIMBAD object of
// its own, or an id SIMBAD doesn't resolve) from a failed fetch (null).
const objectInfoCache = new Map();
const NOT_IN_SIMBAD = { found: false, otype: "", mag: null, band: "", typeDesc: "" };

function fetchObjectInfo(ident) {
  if (ident === null) return Promise.resolve(NOT_IN_SIMBAD);
  if (objectInfoCache.has(ident)) return objectInfoCache.get(ident);
  const q = "SELECT basic.otype_txt, allfluxes.V, allfluxes.B, " +
    "otypedef.description " +
    "FROM ident JOIN basic ON ident.oidref = basic.oid " +
    "LEFT JOIN allfluxes ON allfluxes.oidref = basic.oid " +
    "LEFT JOIN otypedef ON otypedef.otype = basic.otype " +
    "WHERE ident.id = '" + ident.replace(/'/g, "''") + "'";
  const url = SIMBAD_TAP + "?request=doQuery&lang=adql&format=json&query=" +
    encodeURIComponent(q);
  const p = fetch(url)
    .then(r => r.json())
    .then(j => {
      const found = !!(j.data && j.data.length);
      const row = (j.data && j.data[0]) || [];
      const mag = row[1] ?? row[2];
      return {
        found,
        otype: row[0] || "",
        mag: mag ?? null,
        band: row[1] != null ? "V" : row[2] != null ? "B" : "",
        typeDesc: row[3] || "",
      };
    })
    .catch(() => {
      objectInfoCache.delete(ident);
      return { found: null, otype: "", mag: null, band: "", typeDesc: "" };
    });
  objectInfoCache.set(ident, p);
  return p;
}

/* ============ per-guess hint rendering ============ */

let puzzleGen = 0; // bumped on puzzle reset so stale fetches don't fill cleared cells

function setHint(ref, text, cls) {
  ref.val.textContent = text;
  ref.val.title = text;
  ref.cell.classList.remove("match", "near");
  if (cls) ref.cell.classList.add(cls);
}

// a spinning placeholder while the SIMBAD query for this cell is in flight
function setHintSpinner(ref) {
  ref.cell.classList.remove("match", "near");
  const sp = document.createElement("span");
  sp.className = "spinner";
  ref.val.replaceChildren(sp);
  ref.val.title = "Loading from SIMBAD…";
}

function renderHintRow(r, guess) {
  const gi = catalogueIndex(guess), ai = catalogueIndex(answer);
  const cells = hintCells[r];
  const gPos = pool.positions[gi], aPos = pool.positions[ai];

  const gCon = pool.constellations[gi];
  setHint(cells.con, CONSTELLATION_NAMES[gCon] || gCon,
    gCon === pool.constellations[ai] ? "match" : "");

  const sep = angularSeparation(gPos, aPos);
  const arrow = gi === ai ? "●" : DIR_ARROWS[compassDir(positionAngle(gPos, aPos))];
  setHint(cells.dist, `${arrow} ${formatSeparation(sep)}`,
    closeness(sep, DIST_MATCH, DIST_NEAR));

  setHintSpinner(cells.type);
  setHintSpinner(cells.mag);
  const gen = puzzleGen;
  Promise.all([fetchObjectInfo(simbadQuery(guess)), fetchObjectInfo(simbadQuery(answer))])
    .then(([g, a]) => {
      if (gen !== puzzleGen) return; // puzzle was reset meanwhile
      setHint(cells.type, g.otype || (g.found === false ? "n/a" : "?"),
        g.otype && g.otype === a.otype ? "match" : "");
      if (g.found === false) cells.type.val.title = "Not in SIMBAD";
      if (g.otype) {
        // link the type code to its explanation on the SIMBAD object-types page
        const link = document.createElement("a");
        link.href = "https://vizier.cds.unistra.fr/cgi-bin/OType?" +
          encodeURIComponent(g.otype);
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = g.otype;
        link.title = g.typeDesc || g.otype;
        cells.type.val.replaceChildren(link);
        cells.type.val.title = g.typeDesc || g.otype;
      }
      if (g.mag == null) {
        setHint(cells.mag, g.found === false ? "n/a" : "?", "");
        if (g.found === false) cells.mag.val.title = "Not in SIMBAD";
      } else {
        setHint(cells.mag, g.mag.toFixed(1) + " " + g.band,
          a.mag == null ? "" : closeness(Math.abs(g.mag - a.mag), MAG_MATCH, MAG_NEAR));
      }
    });
}

function hideObjectPanel() {
  shownId = null;
  aladinView = null;
  markShownRow();
  panelEl.hidden = true;
  aladinDiv.replaceChildren();
  aladinDiv.removeAttribute("style");
  captionEl.replaceChildren();
}

// outline the submitted row whose object is in the panel (if any)
function markShownRow() {
  for (let r = 0; r < MAX_GUESSES; r++) {
    boardEl.children[r].classList.toggle("viewing",
      r < guesses.length && guesses[r] === shownId);
  }
}

function renderCaption(word, ident, otype, found) {
  const isTarget = word === answer;
  const idx = catalogueIndex(word);
  const role = document.createElement("span");
  role.className = "object-role" + (isTarget ? " target" : "");
  role.textContent = isTarget ? "target" : "guess";
  const link = document.createElement("a");
  if (found === false || ident === null) {
    // SIMBAD has no object of its own for this id (a v1 IC entry that turned
    // out to be a star, or a v2 answer SIMBAD merged away) — link a coordinate
    // search at the catalogue position instead of a dead sim-basic page
    const [ra, dec] = pool.positions[idx];
    link.href = "https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=" +
      encodeURIComponent(`${ra} ${dec >= 0 ? "+" : ""}${dec}`) +
      "&Radius=2&Radius.unit=arcmin";
    link.title = "Not in SIMBAD — search this position instead";
  } else {
    link.href = "https://simbad.cds.unistra.fr/simbad/sim-basic?Ident=" +
      encodeURIComponent(ident);
  }
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = spacedId(displayName(word));
  captionEl.replaceChildren(role, " ", link);
  // common name (if the object has one) and constellation, alongside the type
  const common = commonName(word);
  if (common) captionEl.append(" · " + common);
  if (otype) captionEl.append(" · " + otype);
  else if (found === false) captionEl.append(" · not in SIMBAD");
  const con = idx >= 0 ? pool.constellations[idx] : "";
  if (con) captionEl.append(" · " + (CONSTELLATION_NAMES[con] || con));
  if (finished && !isTarget) {
    const back = document.createElement("a");
    back.href = "#";
    back.textContent = "show target";
    back.addEventListener("click", (e) => {
      e.preventDefault();
      showObject(answer);
    });
    captionEl.append(" · ", back);
  }
}

// Show a catalogue object (a word of the pool, like "NGC1023A") in the panel
// right of the board: the answer when the game ends, or any clicked guess row.
function showObject(word) {
  if (shownId === word) return;
  shownId = word;
  markShownRow();

  if (panelEl.hidden) {
    // the viewer box matches the height of the six guess rows, capped to the
    // viewport width on narrow screens — leaving room for the survey picker
    // column beside it (its square buttons are ~ size / N wide)
    const n = window.MuldleSurveys ? window.MuldleSurveys.count : 0;
    const maxByWidth = n
      ? (document.documentElement.clientWidth - 16 - 7) / (1 + 1 / n)
      : document.documentElement.clientWidth - 16;
    const size = Math.min(boardEl.offsetHeight, maxByWidth);
    aladinDiv.style.width = size + "px";
    aladinDiv.style.height = size + "px";
    panelEl.hidden = false;
    if (window.MuldleSurveys && !surveyCtl) {
      surveyCtl = window.MuldleSurveys.mount(surveyPickerEl, () => aladinView);
    }
  }

  const ident = simbadQuery(word);
  const idx = catalogueIndex(word);
  const pos = idx >= 0 ? pool.positions[idx] : null;

  renderCaption(word, ident, "");

  if (!pos) return;
  // spinner in the caption while the object's SIMBAD data is on its way
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  captionEl.append(" ", spinner);
  const gen = puzzleGen;
  Promise.all([loadAladin(), fetchObjectInfo(ident), loadViewSizes()])
    .then(([, info]) => {
      // skip if the puzzle was reset or another object was clicked meanwhile
      if (gen !== puzzleGen || shownId !== word) return;
      const fov = viewFov(word);
      if (aladinView) {
        aimSkyView(aladinView, pos, fov);
      } else {
        aladinView = A.aladin("#aladin-lite-div", {
          survey: surveyCtl ? surveyCtl.current() : "P/DSS2/color",
          target: pos[0] + " " + pos[1],
          fov,
          showFullscreenControl: false,
          showLayersControl: false,
          showFrame: false,
          showCooGridControl: false,
          showProjectionControl: false,
        });
      }
      if (surveyCtl) {
        surveyCtl.apply(aladinView);
        window.MuldleSurveys.updateCoverage(surveyCtl, pos[0], pos[1]);
      }
      renderCaption(word, ident, info.otype, info.found);
    })
    .catch(() => {
      if (gen !== puzzleGen || shownId !== word) return;
      spinner.remove();
      aladinDiv.textContent = "sky view unavailable";
      aladinDiv.style.display = "flex";
      aladinDiv.style.alignItems = "center";
      aladinDiv.style.justifyContent = "center";
    });
}

// clicking a submitted guess shows that object; clicking the shown one again
// switches back to the target (game over) or closes the panel (mid-game)
function rowClicked(r) {
  if (r >= guesses.length) return;
  const word = guesses[r];
  if (word !== shownId) {
    showObject(word);
    // on stacked (phone) layouts the panel lives below the keyboard
    panelEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else if (finished) {
    showObject(answer);
  } else {
    hideObjectPanel();
  }
}

/* ============ input handling ============ */

const WIN_MESSAGES = ["Stellar!", "Supernova!", "Brilliant!", "Well spotted!", "Good eye!", "Phew, just in orbit!"];

// The row being typed has a cursor (highlighted tile). Typing writes at the
// cursor — overwriting a filled tile — then moves it to the next free tile, so
// after a rejected guess you click the tile to change and just type over it.
// Locked greens are never under the cursor.
function handleKey(k) {
  if (finished) return;
  if (k === "Enter") { submitGuess(); return; }
  if (k === "Left") { const p = prevFreeTile(cursor); if (p >= 0) cursor = p; renderCurrentRow(); return; }
  if (k === "Right") { if (cursor < WORD_LEN) cursor = nextFreeTile(cursor + 1); renderCurrentRow(); return; }
  if (k === "Back") {
    // clear the tile under the cursor if it holds a character; otherwise the
    // nearest typed tile before the cursor (moving there). With the cursor at
    // the end of what was typed this is the classic "delete the last char".
    if (cursor < WORD_LEN && current[cursor] !== undefined) {
      delete current[cursor];
    } else {
      for (let i = Math.min(cursor, WORD_LEN) - 1; i >= 0; i--) {
        if (current[i] !== undefined && !lockedTiles[i]) { delete current[i]; cursor = i; break; }
      }
    }
    renderCurrentRow();
    return;
  }
  // any character goes anywhere; validity is checked on Enter
  if (!/^[0-9A-Z]$/.test(k)) return;
  // cursor past the end: fall back to the first empty tile (if any is left)
  let at = cursor;
  if (at >= WORD_LEN) {
    at = 0;
    while (at < WORD_LEN && current[at] !== undefined) at++;
  }
  const full = at >= WORD_LEN;
  // hard mode refuses at type time what a partial row can already break (a
  // character the answer lacks, one back in a tile where it showed grey or
  // yellow, one too many); Enter checks the rest, from the same knowledge. A
  // full row still says when a character isn't in the identifier at all.
  if (hardMode) {
    const block = MuldleHints.typeBlock(revealedHints(guesses, answer), full ? -1 : at, k, current);
    if (block) { showMessage(hintMessage(block)); return; }
  }
  if (full) return;
  current[at] = k;
  cursor = nextFreeTile(at + 1);
  renderCurrentRow();
}

// clicking a free tile of the row being typed puts the cursor there
function tileClicked(r, c) {
  if (finished || r !== guesses.length || lockedTiles[c]) return;
  cursor = c;
  renderCurrentRow();
}

function submitGuess() {
  // tiles left empty count as blanks, e.g. "NGC0042" -> "NGC0042 "
  let guess = "";
  for (let i = 0; i < WORD_LEN; i++) guess += current[i] ?? BLANK;
  // sparse iteration: only typed tiles are visited, so this asks for input
  // until the player has typed at least one character beyond the prefill —
  // unless the prefill is itself an identifier: hard mode's greens NGC244 +
  // blanks can be the answer with nothing left to type
  if (!current.some((ch, i) => !lockedTiles[i]) && !pool.index.has(guess)) {
    showMessage("Type an identifier first");
    shakeCurrentRow();
    return;
  }
  if (!pool.index.has(guess)) {
    showMessage(refusalMessage(guess));
    rejectGuess(guess);
    return;
  }
  // a repeat can't reveal anything new. Hard mode refuses it anyway (it can't
  // be the answer); this covers normal mode, which has no hint rules
  if (guesses.includes(guess)) {
    showMessage(`${displayName(guess)} was already guessed`);
    rejectGuess(guess);
    return;
  }
  if (hardMode) {
    const violation = hardModeViolation(guesses, answer, guess);
    if (violation) {
      showMessage(violation);
      rejectGuess(guess);
      return;
    }
  }
  renderGuessRow(guesses.length, guess);
  renderHintRow(guesses.length, guess);
  guesses.push(guess);
  saveState();

  if (guess === answer) {
    finished = true;
    recordCurrentResult(true);
    showMessage(`${WIN_MESSAGES[guesses.length - 1]} It was ${displayName(answer)}.`, true, commonName(answer), otherNames(answer));
    showObject(answer);
    showPostGame();
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    recordCurrentResult(false);
    showMessage(`Out of guesses — it was ${displayName(answer)}.`, true, commonName(answer), otherNames(answer));
    showObject(answer);
    showPostGame();
  }
  updateInfo();            // fewer identifiers stay legal with every new hint
  resetCurrentRow();       // prefill the next row's greens (no-op if finished)
  renderCurrentRow();
}

// a refused guess: shake the row and count it (shown in the info line and the
// share text). The row keeps its characters so one tile can be fixed and
// retried; re-submitting the same refused guess unchanged doesn't count again.
function rejectGuess(guess) {
  shakeCurrentRow();
  if (guess === lastRejected) return;
  lastRejected = guess;
  rejected++;
  saveState();
  updateInfo();
}

// a focused text input (e.g. in the sky viewer) keeps its own arrow keys
function isTextField(el) {
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

document.addEventListener("keydown", (e) => {
  if (window.__muldleMode && window.__muldleMode !== "id") return; // ABC face active
  if (settingsDialog.open || statsDialog.open) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter") { handleKey("Enter"); }
  else if (e.key === "Backspace") {
    // always ours outside a text field: a browser set to "Backspace = Back"
    // (Firefox's browser.backspace_action = 0) would otherwise leave the game
    if (!isTextField(e.target)) e.preventDefault();
    handleKey("Back");
  }
  else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !finished && !isTextField(e.target)) {
    e.preventDefault(); // only while a row is being typed: scrolling / carets keep working
    handleKey(e.key === "ArrowLeft" ? "Left" : "Right");
  }
  else if (e.key === " ") { e.preventDefault(); } // blanks are implicit now
  else if (/^[0-9]$/.test(e.key)) { handleKey(e.key); }
  else if (/^[a-zA-Z]$/.test(e.key)) { handleKey(e.key.toUpperCase()); }
});

/* ============ settings ============ */

const settingsBtn = document.getElementById("settings-button");
const settingsDialog = document.getElementById("settings-dialog");
const backToDailyBtn = document.getElementById("back-to-daily");
const hardModeToggle = document.getElementById("hard-mode-toggle");
const byCatalogueRow = document.getElementById("by-catalogue-row");
const byCatalogueToggle = document.getElementById("by-catalogue-toggle");
const doneKeysToggle = document.getElementById("done-keys-toggle");

// preferences survive across days, unlike the per-day game state
const SETTINGS_KEY = "muldle-settings-v1";
let hardMode = true;      // default on
let byCatalogue = false;  // random practice: each catalogue equally likely (ID only)
let doneKeys = true;      // completed keys dark green (both modes; display only)

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && typeof s.hardMode === "boolean") hardMode = s.hardMode;
    if (s && typeof s.byCatalogue === "boolean") byCatalogue = s.byCatalogue;
    if (s && typeof s.doneKeys === "boolean") doneKeys = s.doneKeys;
  } catch (e) { /* corrupt settings: keep defaults */ }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ hardMode, byCatalogue, doneKeys })); } catch (e) { /* ignore */ }
}

// both keyboards carry the done marks always; this class shows them
function applyDoneKeys() {
  document.body.classList.toggle("done-keys", doneKeys);
}

hardModeToggle.addEventListener("change", () => {
  hardMode = hardModeToggle.checked;
  saveSettings();
  // re-derive the prefill for the row being typed (on: lock known greens,
  // off: free all tiles); partial input is discarded to avoid collisions
  resetCurrentRow();
  renderCurrentRow();
  updateInfo(); // the legal-guess count only applies in hard mode
});

byCatalogueToggle.addEventListener("change", () => {
  byCatalogue = byCatalogueToggle.checked;
  saveSettings();
});

doneKeysToggle.addEventListener("change", () => {
  doneKeys = doneKeysToggle.checked;
  saveSettings();
  applyDoneKeys();
});

// legalGuessCount scans all identifiers, so remember the last result; it only
// changes when the puzzle or its guesses do
let legalMemo = { key: null, n: 0 };
function legalCountNow() {
  const key = pool.era + pool.fmt + "|" + answer + "|" + guesses.join("|");
  if (legalMemo.key !== key) legalMemo = { key, n: legalGuessCount(guesses, answer) };
  return legalMemo.n;
}

function updateInfo() {
  // the puzzle number lives in the navigator, so the info line carries the
  // context (random / archive), the pool size — or, mid-game in hard mode, how
  // many identifiers are still legal — and the rejected-guess count
  const ctx = randomId ? "Random object · " : viewDay !== DAY ? "Archive · " : "";
  let size = `${pool.words.length} identifiers in play`;
  if (hardMode && !finished && guesses.length) {
    const n = legalCountNow();
    size = `${n} legal identifier${n === 1 ? "" : "s"} left`;
  }
  infoEl.replaceChildren(ctx + size);
  if (rejected) {
    const rej = document.createElement("span");
    rej.className = "rejected-count";
    rej.title = "Rejected guesses this puzzle (unknown identifier, another id of an object in the game, a repeat or a hard-mode break)";
    rej.textContent = `✖ ${rejected}`;
    infoEl.append(" · ", rej);
  }
}

function updateNav() {
  navEl.classList.toggle("hidden", !!randomId); // a random object has no number
  navNumEl.textContent = viewDay;
  navPrevBtn.disabled = viewDay <= 0;
  navNextBtn.disabled = viewDay >= DAY;   // clamp to <= today (spoiler-free)
  // the middle number button is never greyed — on today it's just a no-op jump
}

function clearBoardUI() {
  for (const row of tiles) {
    for (const t of row) {
      t.textContent = "";
      t.classList.remove("filled", "locked", "cursor", "editable", "correct", "present", "absent");
    }
  }
  for (const rowEl of boardEl.children) {
    rowEl.classList.remove("guessed", "viewing");
    rowEl.removeAttribute("title");
  }
  for (const k in keyEls) keyEls[k].classList.remove("correct", "present", "absent", "done");
  puzzleGen++; // invalidate in-flight hint fetches
  for (const cells of hintCells) {
    for (const key in cells) setHint(cells[key], "", "");
  }
}

// A random object of today's era for practice, never the current answer. Off:
// any object of the pool. byCatalogue: one of the era's catalogues first (each
// equally likely), then any object that is a member of it, shown under its
// best-known id (so a Caldwell draw is often shown as NGC).
function randomIdentifier() {
  const p = poolForDay(DAY, FMT_CURRENT);
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const cats = Object.keys(p.members);
  let id;
  do {
    id = p.ids[byCatalogue ? pick(p.members[pick(cats)]) : Math.floor(Math.random() * p.ids.length)];
  } while (fullWord(id) === answer);
  return id;
}

// wipe the current puzzle's guesses and replay it fresh, in the current
// format. Keeps the puzzle in play (random object, today's daily, or an
// archived one via viewDay); newRandomId is in the current format.
function startPuzzle(newRandomId, msg) {
  randomId = newRandomId;
  // a random object has no puzzle number: snap back to today's slot so the URL
  // drops any archived ?p (otherwise a reload would re-enter the archive and
  // discard the random object that was just saved to muldle-v1)
  if (randomId) viewDay = DAY;
  pool = poolForDay(viewDay, FMT_CURRENT);
  answer = randomId ? fullWord(randomId) : answerForDay(viewDay);
  guesses = [];
  rejected = 0;
  finished = false;
  resetCurrentRow(); // no guesses yet, so no prefill — just clears the row
  buildKeyboard();
  clearBoardUI();
  renderCurrentRow(); // show the cursor on the fresh row
  hideObjectPanel();
  hidePostGame();
  updateInfo();
  updateNav();
  showMessage(msg);
  saveState();
  muldle.view.id = viewDay;
  muldle.syncUrl();
  settingsDialog.close();
}

// render a loaded puzzle whose guesses + answer are already set: replay the
// scored rows, restore the finished/reveal state, prefill the current row.
// Shared by init and goToPuzzle (the caller sets the board up beforehand).
function renderPuzzleState() {
  guesses.forEach((g, r) => { renderGuessRow(r, g); renderHintRow(r, g); });
  finished = false;
  if (guesses.length && guesses[guesses.length - 1] === answer) {
    finished = true;
    recordCurrentResult(true);
    showMessage(`Already solved — it was ${displayName(answer)}.`, true, commonName(answer), otherNames(answer));
    showObject(answer);
    showPostGame();
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    recordCurrentResult(false);
    showMessage(`Out of guesses — it was ${displayName(answer)}.`, true, commonName(answer), otherNames(answer));
    showObject(answer);
    showPostGame();
  }
  resetCurrentRow();
  renderCurrentRow();
}

// take over a loaded { guesses, rejected, fmt } of the puzzle in view (viewDay)
function setPuzzle(s) {
  ({ guesses, rejected } = s);
  pool = poolForDay(viewDay, s.fmt);
}

// switch to puzzle <day> (today's daily or an archived one), loading its saved
// progress. Leaves random-practice mode. day is clamped to [0, today].
function goToPuzzle(day) {
  day = Math.max(0, Math.min(DAY, day | 0));
  randomId = null;
  viewDay = day;
  setPuzzle(loadViewState());
  answer = answerForDay(day, pool.fmt);
  buildKeyboard(); // a puzzle of another era brings its own letters
  clearBoardUI();
  hideObjectPanel();
  hidePostGame();
  showMessage("");
  renderPuzzleState();
  if (!finished) showMessage(day === DAY ? "" : `Puzzle #${day}`);
  updateInfo();
  updateNav();
  muldle.view.id = viewDay;
  muldle.syncUrl();
  saveState();
  settingsDialog.close();
}

settingsBtn.addEventListener("click", () => {
  backToDailyBtn.hidden = !randomId;
  byCatalogueRow.hidden = false; // ID mode only (abc.js hides it)
  settingsDialog.showModal();
});
// <dialog> refocuses the opener on close; blur it so Enter/space for the next
// guess doesn't reopen the settings panel. The refocus can land after the
// close event, so blur on the next tick.
settingsDialog.addEventListener("close", () => setTimeout(() => settingsBtn.blur(), 0));
document.getElementById("settings-close").addEventListener("click", () => settingsDialog.close());
document.getElementById("reset-puzzle").addEventListener("click", () =>
  startPuzzle(randomId && idInFormat(pool, randomId, FMT_CURRENT),
    "Puzzle reset — same object, fresh guesses."));
document.getElementById("reset-random").addEventListener("click", () =>
  startPuzzle(randomIdentifier(), "Random object loaded — this is not today's puzzle."));
backToDailyBtn.addEventListener("click", () => goToPuzzle(DAY));

// puzzle navigator: step through past puzzles (clamped to <= today), or the
// middle button jumps straight back to today's
navPrevBtn.addEventListener("click", () => { if (viewDay > 0) goToPuzzle(viewDay - 1); navPrevBtn.blur(); });
navNextBtn.addEventListener("click", () => { if (viewDay < DAY) goToPuzzle(viewDay + 1); navNextBtn.blur(); });
navTodayBtn.addEventListener("click", () => { if (viewDay !== DAY) goToPuzzle(DAY); navTodayBtn.blur(); });

/* ============ stats & history dialog (stats.js renders it; ABC routes the
   shared dialog to its own store — see abc.js) ============ */

const statsDialog = document.getElementById("stats-dialog");
const statsContent = document.getElementById("stats-content");

function openStats() { settingsDialog.close(); idResults.render(statsContent); statsDialog.showModal(); }
document.getElementById("stats-button").addEventListener("click", openStats);
document.getElementById("stats-close").addEventListener("click", () => statsDialog.close());
statsDialog.addEventListener("close", () => setTimeout(() => { try { settingsBtn.blur(); } catch (e) { /* ignore */ } }, 0));

/* ============ post-game: emoji-grid share + next-puzzle countdown ============ */

const postGameEl = document.getElementById("post-game");
const postGameStatsEl = document.getElementById("post-game-stats");
const keyboardWrapEl = document.getElementById("keyboard");
const shareBtn = document.getElementById("share-button");
const countdownEl = document.getElementById("countdown");
const SHARE_EMOJI = { correct: "🟩", present: "🟨", absent: "⬛" };

// a Wordle-style emoji grid of the scored rows (all 8 tiles, blanks included)
function buildShareText() {
  const solved = guesses.length && guesses[guesses.length - 1] === answer;
  const tries = solved ? guesses.length : "X";
  const head = randomId ? "Muldle (practice)" : `Muldle #${viewDay}`;
  const grid = guesses
    .map(g => scoreGuess(g, answer).map(s => SHARE_EMOJI[s]).join(""))
    .join("\n");
  const rej = rejected ? ` ✖ ${rejected}` : ""; // the hunt for a legal guess
  return `${head} ${tries}/${MAX_GUESSES}${rej}\n${grid}`;
}

shareBtn.addEventListener("click", () => {
  const text = buildShareText();
  window.__lastShare = text; // fallback + e2e hook
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

// milliseconds from now until the next local midnight (when the daily rolls)
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
  keyboardWrapEl.hidden = true;
  idResults.render(postGameStatsEl, { includeClear: false });
  // countdown only for today's daily — a practice or archived puzzle doesn't roll over
  const isDaily = !randomId && viewDay === DAY;
  countdownEl.hidden = !isDaily;
  if (isDaily) startCountdown();
  else clearInterval(countdownTimer);
}

function hidePostGame() {
  postGameEl.hidden = true;
  keyboardWrapEl.hidden = false; // back to an unfinished puzzle: keyboard returns
  clearInterval(countdownTimer);
}

/* ============ init ============ */

buildBoard();
buildHintPanel();
loadSettings();
hardModeToggle.checked = hardMode;
byCatalogueToggle.checked = byCatalogue;
doneKeysToggle.checked = doneKeys;
applyDoneKeys();
stampFormats();      // every save gets its fmt before anything reads it
MuldleStats.pruneFuture(RESULTS_KEY, DAY); // drop stale entries for impossible future numbers
MuldleStats.pruneFuture(ARCHIVE_KEY, DAY);
migrateStaleDaily(); // rescue a finished daily from a past day before it's lost

// initial puzzle: a ?p=<day> for the active mode opens that archived puzzle;
// otherwise restore today's daily (or the random-practice object) from muldle-v1
const urlDay = readUrlDay();
if (urlDay != null && urlDay !== DAY && activeModeOnLoad() === "id") {
  viewDay = urlDay;
  setPuzzle(loadViewState());
  answer = answerForDay(viewDay, pool.fmt);
} else {
  const loaded = loadState();
  setPuzzle(loaded);
  randomId = loaded.randomId;
  answer = randomId ? fullWord(randomId) : answerForDay(DAY, pool.fmt);
}
muldle.view.id = viewDay;
buildKeyboard();
updateNav();
renderPuzzleState(); // replays rows, restores finished state, prefills the current row
updateInfo();        // after renderPuzzleState: the info line depends on `finished`
