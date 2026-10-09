// SPDX-License-Identifier: AGPL-3.0-only
// OMNI, the third mode (Backlog #17 Steps 2 and 3; the design and its
// decisions: notes/omni-design.md): any identifier or name in the game can be
// the answer. Unlimited only for now (a daily OMNI comes later, with an era of
// its own): once today's ID or ABC daily is solved, OMNI plays random puzzles
// one after another, and Mini, its other option, the short ones (at most 6
// tiles and 3 digits). Its pool is built here at runtime from the data every
// mode loads, so it has no era: a new catalogue or name joins at once.
//   - The pool: every v2 id, every alias (NGC224, never the answer when M31 is:
//     a valid wrong guess), the split alias C14, every ABC name (deep-sky and
//     sky), and the other names (aka.js, SKY_INFO's), which are valid wrong
//     guesses and never answers.
//   - Tiles: upper-cased, a space a blank tile (typed and scored), the marks
//     ' - . never tiles: the answer's marks show on the board from the start,
//     between tiles; a guess is typed without them and found by its tiles.
//   - Hints: ID's four cells for every guess, from each entry's object.
// Sessions, stopwatch, totals and the gate's plumbing come from unlimited.js;
// the flip from flip.js. Wrapped in an IIFE like abc.js: it reuses game.js's
// top-level helpers (poolFor, simbadQuery, fetchObjectInfo, the hint cells'
// setHint, the sky view's loaders) and keeps its own names to itself.
(function () {
"use strict";

/* ============ the pool ============ */

const MAX_GUESSES = 6;
const BLANK = " ";
const MINI_LEN = 6;
const MARKS = /['.\-]/;
const V2P = poolFor("v2", 2); // game.js: v2 ids, positions, constellations, names
const CAT_RE = /^(NGC|IC|Mel|Cr|M|C|B)\d/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const sky = key => (has(SKY_INFO, key) ? SKY_INFO[key] : undefined);

// an entry's tiles: upper-cased, a space a blank tile, the marks dropped
function tilesOf(text) {
  return text.toUpperCase().replace(/['.\-]/g, "");
}
// an entry's marks: { at, ch }, `at` the tile the mark stands before
// ("Cat's Eye Nebula": ' before tile 3, between T and S)
function marksOf(text) {
  const out = [];
  let n = 0;
  for (const ch of text.toUpperCase()) {
    if (MARKS.test(ch)) out.push({ at: n, ch });
    else n++;
  }
  return out;
}
const pad = (tiles, len) => tiles.padEnd(len, BLANK);

// Every entry: { text (as shown), kind (id, alias, split, name, other),
// group (its catalogue, or a name's kind: the practice weighting's groups),
// primary (the object its hints and sky view use: a v2 id or a SKY_INFO key;
// null for C14, whose two objects are both used), objects (every object it
// names: the daily check), answer (false for other names), tiles, marks }
function buildEntries() {
  const out = [];
  const add = (text, kind, group, primary, objects, answer) =>
    out.push({ text, kind, group, primary, objects, answer, tiles: tilesOf(text), marks: marksOf(text) });
  for (const id of V2_IDS) add(id, "id", CAT_RE.exec(id)[1], id, [id], true);
  for (const [a, t] of Object.entries(V2_ALIASES)) add(a, "alias", CAT_RE.exec(a)[1], t, [t], true);
  for (const [a, ts] of Object.entries(V2_SPLIT_ALIASES)) add(a, "split", CAT_RE.exec(a)[1], null, ts.slice(), true);
  // a deep-sky name stands for every id that carries it (Stephan's Quintet:
  // five); its hints and sky view are ABC's one (the entry's id)
  const idsOf = new Map();
  for (const e of ID_NAMES_V2) {
    if (!idsOf.has(e.name)) idsOf.set(e.name, []);
    idsOf.get(e.name).push(e.id);
  }
  for (const e of ABC_NAMES_V2) add(e.name, "name", "deep-sky", e.id, idsOf.get(e.name) || [e.id], true);
  for (const e of ABC_SKY_V3) add(e.name, "name", sky(e.id).kind, e.id, [e.id], true);
  // other names: valid wrong guesses, never answers (#17 Q5)
  for (const [id, list] of Object.entries(ALSO_KNOWN_AS)) for (const n of list) add(n, "other", "other", id, [id], false);
  for (const [key, s] of Object.entries(SKY_INFO)) for (const n of s.aka || []) add(n, "other", "other", key, [key], false);
  return out;
}

// The pool is built the first time it is needed (OMNI's face showing, a
// saved OMNI or Mini session resuming, a test hook), not at load: a player
// who never opens OMNI doesn't pay for it (~70 ms, 4x that on a slow phone;
// release 2's review, R2-16). Then:
//   ENTRIES; LEN, the board's width: the longest entry (28 tiles: the Small
//   and Large Sagittarius Star Clouds); BY_WORD, the valid guesses by their
//   tiles (four other names name two objects each, Lobster Nebula: M17 and
//   NGC6357; the first keeps the word and lists the other object in `also`,
//   its caption names both); ANSWERS; Mini's answers (at most 6 tiles and 3
//   digits, #17 Q10: 3213) and valid guesses (any entry that fits 6 tiles:
//   also IC1000+, short other names); VARIANTS, the two boards (OMNI's 28
//   tiles, Mini's 6).
let POOL = null;
const digits = t => (t.match(/\d/g) || []).length;
function pool() {
  if (POOL) return POOL;
  const ENTRIES = buildEntries();
  const LEN = ENTRIES.reduce((m, e) => Math.max(m, e.tiles.length), 0);
  const BY_WORD = new Map();
  for (const e of ENTRIES) {
    e.word = pad(e.tiles, LEN);
    const first = BY_WORD.get(e.word);
    if (first) (first.also = first.also || []).push(e.primary);
    else BY_WORD.set(e.word, e);
  }
  const ANSWERS = ENTRIES.filter(e => e.answer && BY_WORD.get(e.word) === e);
  const MINI_ANSWERS = ANSWERS.filter(e => e.tiles.length <= MINI_LEN && digits(e.tiles) <= 3);
  const MINI_BY_WORD = new Map();
  for (const e of BY_WORD.values()) if (e.tiles.length <= MINI_LEN) MINI_BY_WORD.set(pad(e.tiles, MINI_LEN), e);
  const VARIANTS = {
    omni: { key: "omni", len: LEN, byWord: BY_WORD, answers: ANSWERS, wordOf: e => e.word },
    mini: { key: "mini", len: MINI_LEN, byWord: MINI_BY_WORD, answers: MINI_ANSWERS, wordOf: e => pad(e.tiles, MINI_LEN) },
  };
  POOL = { ENTRIES, LEN, BY_WORD, ANSWERS, MINI_ANSWERS, MINI_BY_WORD, VARIANTS };
  return POOL;
}
const poolBuilt = () => POOL !== null;

// The practice weighting's groups (on by default in OMNI and Mini, #17 Q3):
// OMNI's are ID's catalogues (an alias in its own: NGC224 is NGC) and ABC's
// name kinds, 12, each equally likely; Mini's kinds are lopsided (deep-sky
// names: the Hyades alone), so its names make one group: 8. Off: one group.
function groupsOf(list, weighted, namesTogether) {
  if (!weighted) return [list];
  const by = new Map();
  for (const e of list) {
    const g = namesTogether && e.kind === "name" ? "names" : e.group;
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(e);
  }
  return [...by.values()];
}

// OMNI's and Mini's weighting setting (omniByKind in muldle-settings-v1;
// absent = on)
function omniByKind() {
  try {
    const s = JSON.parse(localStorage.getItem("muldle-settings-v1"));
    return !(s && s.omniByKind === false);
  } catch (e) { return true; }
}

/* ---- an entry's object: where it is, for the hints and the sky view ---- */

const DEG = Math.PI / 180;
// the point midway between positions on the sky (C14's two clusters)
function midpoint(ps) {
  let x = 0, y = 0, z = 0;
  for (const [ra, dec] of ps) {
    x += Math.cos(dec * DEG) * Math.cos(ra * DEG);
    y += Math.cos(dec * DEG) * Math.sin(ra * DEG);
    z += Math.sin(dec * DEG);
  }
  const ra = ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
  return [ra, Math.atan2(z, Math.hypot(x, y)) / DEG];
}

function v2Object(id) {
  const word = fullWord(id), i = V2P.index.get(word);
  return i === undefined ? null
    : { pos: V2P.positions[i], cons: [V2P.constellations[i]].filter(Boolean), ident: simbadQuery(word, V2P), word, id };
}

// { pos, cons, ident (SIMBAD's id, or null), sky (SKY_INFO's entry, for a sky
// name), word (the v2 pool word, for viewFov), key (the object: alike keys
// are the same object) }
const objectCache = new Map();
function objectOf(e) {
  if (objectCache.has(e)) return objectCache.get(e);
  let o;
  if (e.primary === null) {
    const parts = e.objects.map(v2Object).filter(Boolean);
    o = { pos: midpoint(parts.map(p => p.pos)), cons: [...new Set(parts.flatMap(p => p.cons))], ident: null, key: e.objects.join("+") };
  } else if (sky(e.primary)) {
    const s = sky(e.primary);
    o = { pos: s.pos, cons: s.cons || [], ident: s.simbad || null, sky: s, key: e.primary };
  } else {
    o = { ...(v2Object(e.primary) || { pos: null, cons: [], ident: null }), key: e.primary };
  }
  objectCache.set(e, o);
  return o;
}

// Whether a guess names the answer's object (its hint shows 0°): the same
// primary object, or a name that stands for several objects against one of
// them: a deep-sky name of several ids (Pipe Nebula: B59, B65, B66, B67, B78)
// or an other name two objects share, the second kept in `also` (Lobster
// Nebula: M17 and NGC6357; the re-check's R3). C14 keeps the midpoint of its
// two clusters (§10 Q4), so NGC869 against it shows its own distance.
const namedObjects = e => e.also ? e.objects.concat(e.also) : e.objects;
function sameObject(g, a) {
  if (objectOf(g).key === objectOf(a).key) return true;
  if (g.kind === "split" || a.kind === "split") return false;
  const theirs = namedObjects(a);
  return namedObjects(g).some(o => theirs.includes(o));
}

/* ---- the gate and the sessions (unlimited.js) ---- */

// OMNI has no daily yet: it opens once today's ID or ABC daily is solved
// (#17 Q2), by their own gates (a live solve of an older puzzle counts too)
function gateOpen() {
  return ["id", "abc"].some(m => {
    const c = MuldleUnlimited.controller(m);
    return !!c && c.gateOpen();
  });
}
// never an entry naming a daily object of today, in any mode (#17, R1-1)
const skip = e => e.objects.some(MuldleUnlimited.isDaily);
const OMNI_DAY = todayIndex(); // game.js: ID's numbers; OMNI's day is the same day

// OMNI: a best rate counts from a 30-minute run, Mini's from 10 (#17 Q6:
// about 10 solves of ~3 and ~1 minutes; notes/unlimited-estimates.md §1,
// recalibrated from the time-spent totals later)
const omniUnlimited = MuldleUnlimited.create({
  mode: "omni", face: "omni", today: OMNI_DAY, minRunMs: 30 * 60000, maxGuesses: MAX_GUESSES,
  solvedToday: gateOpen, groups: w => groupsOf(pool().ANSWERS, w, false), skip,
  labels: { any: "any entry", weighted: "each kind equally" },
  liveDay: todayIndex, recheck: () => recheck(), onLost: ended => lost(ended),
});
const miniUnlimited = MuldleUnlimited.create({
  mode: "mini", face: "omni", title: "Mini", today: OMNI_DAY, minRunMs: 10 * 60000, maxGuesses: MAX_GUESSES,
  solvedToday: gateOpen, groups: w => groupsOf(pool().MINI_ANSWERS, w, true), skip,
  labels: { any: "any entry", weighted: "each kind equally" },
  liveDay: todayIndex, recheck: () => recheck(), onLost: ended => lost(ended),
});

/* ---- scoring, hard mode and refusals ---- */

// standard Wordle scoring over two equal-length words (blanks are characters)
function scoreGuess(guess, answer) {
  const n = answer.length, result = new Array(n).fill("absent"), remaining = {};
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

const revealedHints = (prev, answer) => MuldleHints.fromGuesses(prev, answer, scoreGuess);

// a hints.js violation in OMNI's words
function hintMessage(v) {
  if (!v) return null;
  const times = n => (n === 2 ? "twice" : `${n} times`);
  const blank = v.ch === BLANK, tile = `tile ${v.tile + 1}`, s = v.n === 1 ? "" : "s";
  switch (v.code) {
    case "fixed": return blank ? `Hard mode: ${tile} must stay blank` : `Hard mode: ${tile} must be ${v.ch}`;
    case "absent": return blank ? "Hard mode: the answer has no blank tiles" : `Hard mode: there is no ${v.ch} in the answer`;
    case "not-here": return blank ? `Hard mode: ${tile} must not be blank` : `Hard mode: ${tile} is not ${v.ch}`;
    case "too-many": return blank ? `Hard mode: the answer has only ${v.n} blank tile${s}`
      : v.n === 1 ? `Hard mode: there is only one ${v.ch} in the answer` : `Hard mode: ${v.ch} appears only ${times(v.n)} in the answer`;
    case "too-few": return blank ? `Hard mode: the guess needs ${v.n} blank tile${s}`
      : v.n === 1 ? `Hard mode: the guess must contain ${v.ch}` : `Hard mode: the guess must contain ${v.ch} ${times(v.n)}`;
  }
  return null;
}

// why a typed word isn't a valid guess (every refusal counts toward ✖)
function refusalMessage(word, variant) {
  const typed = word.trim(), where = variant.key === "mini" ? "Mini" : "OMNI";
  const known = t => variant.byWord.get(pad(t, variant.len));
  if (word[0] === BLANK && known(typed)) return `Guesses start in the first tile: ${known(typed).text}`;
  const m = /^([A-Z]+)0+(\d+)([A-Z]?)$/.exec(typed);
  if (m && known(m[1] + m[2] + m[3])) return `Ids have no leading zeros now: ${known(m[1] + m[2] + m[3]).text}`;
  if (V2P.excluded.has(fullWord(typed))) {
    return `${typed} is a real catalogue entry, but SIMBAD has no data on it — not in the game`;
  }
  return `${typed} is not an identifier or name in ${where}`;
}

// the reveal's words for an entry: an id with its common name, a deep-sky
// name with its id, a sky name as it is written (Boötes)
function describe(e) {
  if (e.kind === "name") {
    const s = sky(e.primary);
    return s ? (s.show || e.text) : `${e.text} (${e.primary})`;
  }
  if (e.kind === "split") return `${e.text} (${e.objects.join(" and ")})`;
  const id = e.kind === "alias" ? e.primary : e.text, common = commonName(fullWord(id), V2P);
  const inner = [e.kind === "alias" ? id : null, common].filter(Boolean).join(", ");
  return inner ? `${e.text} (${inner})` : e.text;
}

const WIN_MESSAGES = ["Stellar!", "Supernova!", "Brilliant!", "Well spotted!", "Good eye!", "Phew, just in orbit!"];
function revealText(e, won, tries) {
  return won ? `${WIN_MESSAGES[tries - 1]} It was ${describe(e)}.` : `Out of guesses — it was ${describe(e)}.`;
}

/* ============ DOM ============ */

const faceEl = document.getElementById("face-omni");
const boardEl = document.getElementById("omni-board");
const messageEl = document.getElementById("omni-message");
const keyboardEl = document.getElementById("omni-keyboard");
const infoEl = document.getElementById("omni-puzzle-info");
const hintPanelEl = document.getElementById("omni-hint-panel");
const closedEl = document.getElementById("omni-closed");
const playToggleEl = document.getElementById("omni-play-toggle");
const playSegs = playToggleEl.querySelectorAll(".play-seg");
const clockEl = document.getElementById("omni-unlimited-clock");
const settingsBtn = document.getElementById("omni-settings-button");
const settingsDialog = document.getElementById("settings-dialog");
const statsDialog = document.getElementById("stats-dialog");
const statsContent = document.getElementById("stats-content");
const panelEl = document.getElementById("omni-object-panel");
const captionEl = document.getElementById("omni-object-caption");
const aladinDiv = document.getElementById("omni-aladin-div");
const surveyPickerEl = document.getElementById("omni-survey-picker");
const byOmniRow = document.getElementById("by-omni-row");
const byOmniToggle = document.getElementById("by-omni-toggle");

/* ---- state ---- */

const VIEW_FIELD = "omniView"; // which option the face shows, in muldle-unlimited-v1
function storedView() {
  try {
    const s = JSON.parse(localStorage.getItem(MuldleUnlimited.STATE_KEY));
    return s && s[VIEW_FIELD] === "mini" ? "mini" : "omni";
  } catch (e) { return "omni"; }
}
function saveView() {
  try {
    const raw = JSON.parse(localStorage.getItem(MuldleUnlimited.STATE_KEY));
    const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    s[VIEW_FIELD] = view;
    localStorage.setItem(MuldleUnlimited.STATE_KEY, JSON.stringify(s));
  } catch (e) { /* ignore */ }
}

let view = storedView();        // "omni" (OMNI's Unlimited) | "mini"
const ctl = () => (view === "mini" ? miniUnlimited : omniUnlimited);
const variant = () => pool().VARIANTS[view];
let entry = null;               // the answer's entry
let answer = "";                // its tiles as a word of the board's width
let guesses = [];               // submitted words
let guessEntries = [];          // their entries
let current = [];               // the row being typed (sparse, by tile)
let locked = [];                // hard mode's prefilled greens
let cursor = 0;
let rejected = 0;
let lastRejected = null;
let showing = false;            // a puzzle is on the board (else the closed card)
let gen = 0;                    // bumped per puzzle: late SIMBAD replies are dropped
let tiles = [];                 // tiles[row][col]
let boardLen = 0;
// a session restored at load, its puzzle shown when the face first shows (so
// a load on another face builds no pool and no board): { saved }
let deferred = null;

/* ---- board, hints and keyboard ---- */

function buildBoard(len) {
  boardLen = len;
  boardEl.replaceChildren();
  boardEl.classList.toggle("mini", len === MINI_LEN);
  boardEl.style.setProperty("--omni-len", len);
  boardEl.style.setProperty("--omni-half", Math.ceil(len / 2));
  tiles = [];
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement("div");
    row.className = "omni-row";
    row.setAttribute("role", "group"); // its label reads the row (rowLabel)
    row.addEventListener("click", () => rowClicked(r));
    const rowTiles = [];
    for (let c = 0; c < len; c++) {
      const t = document.createElement("div");
      t.className = "tile";
      t.setAttribute("aria-hidden", "true");
      t.addEventListener("click", () => tileClicked(r, c));
      row.appendChild(t);
      rowTiles.push(t);
    }
    tiles.push(rowTiles);
    boardEl.appendChild(row);
  }
}

const hintCells = [];
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

// every letter, the digits, * (always: shown only for Sagittarius A* it would
// give that answer away) and a blank key; Enter and Back a little wider
const KEY_ROWS = [[..."1234567890"], [..."QWERTYUIOP"], [..."ASDFGHJKL", "*"], ["Enter", ..."ZXCVBNM", "Space", "Back"]];
let keyEls = {};
function buildKeyboard() {
  keyboardEl.replaceChildren();
  keyEls = {};
  for (const rowKeys of KEY_ROWS) {
    const row = document.createElement("div");
    row.className = "krow";
    for (const k of rowKeys) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key" + (k === "Enter" || k === "Back" ? " wide" : "");
      b.textContent = k === "Back" ? "⌫" : k === "Space" ? "␣" : k;
      if (k === "Space") b.setAttribute("aria-label", "Blank tile");
      if (k === "Back") b.setAttribute("aria-label", "Delete");
      b.addEventListener("click", () => { handleKey(k === "Space" ? BLANK : k); b.blur(); });
      keyEls[k === "Space" ? BLANK : k] = b;
      row.appendChild(b);
    }
    keyboardEl.appendChild(row);
  }
}

const shownMark = ch => (ch === "'" ? "’" : ch);

// What a row says to a screen reader (its tiles are hidden): a guessed row its
// guess and each tile's colour up to the last letter (then how many blanks
// and their colour); the row being typed what is typed; the others empty.
const VERDICT = { correct: "green", present: "yellow", absent: "grey" };
function guessLabel(r, word, e) {
  const score = scoreGuess(word, answer), n = e.tiles.length;
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(`${word[i] === BLANK ? "blank" : word[i]} ${VERDICT[score[i]]}`);
  const rest = score.slice(n);
  if (rest.length) {
    const colours = [...new Set(rest)].map(v => VERDICT[v]).join(" and ");
    parts.push(`then ${rest.length} blank${rest.length === 1 ? "" : "s"} ${colours}`);
  }
  return `Guess ${r + 1}: ${e.text}. ${parts.join(", ")}`;
}
function rowLabel(r) {
  const row = boardEl.children[r];
  if (!row || r < guesses.length) return;
  if (r > guesses.length) { row.setAttribute("aria-label", `Row ${r + 1}, empty`); return; }
  let typed = "";
  for (let i = 0; i < boardLen; i++) typed += current[i] ?? BLANK;
  typed = typed.trimEnd();
  row.setAttribute("aria-label", typed ? `Row ${r + 1}, typing: ${typed.replace(/ /g, " blank ")}` : `Row ${r + 1}, empty`);
}
// a row's marks, drawn between its tiles (data-mark, style.css)
function paintMarks(r, marks) {
  for (const t of tiles[r]) t.removeAttribute("data-mark");
  for (const m of marks) if (tiles[r][m.at]) tiles[r][m.at].dataset.mark = shownMark(m.ch);
}

function resetCurrent() {
  current = [];
  locked = [];
  if (hardMode && guesses.length) {
    const { fixed } = revealedHints(guesses, answer);
    for (let i = 0; i < boardLen; i++) if (fixed[i] !== undefined) { current[i] = fixed[i]; locked[i] = true; }
  }
  skipped = null;
  moveCursor(0);
  lastRejected = null;
}

// Hard mode's locked greens are skipped by the cursor, so a player typing a
// name as written (ORION NEBULA, its space locked green after CIGAR GALAXY)
// would type the locked character again into the next tile. The run of
// locked tiles the cursor just skipped is remembered: a typed character equal
// to the next of them is that tile, already in place (release 2's review,
// R2-20). Any other key forgets it.
let skipped = null; // { at, end }: the locked run just skipped
function moveCursor(from) {
  cursor = nextFree(from);
  skipped = cursor > from ? { at: from, end: cursor - 1 } : null;
}
function nextFree(i) { while (i < boardLen && locked[i]) i++; return i; }
function prevFree(i) { i--; while (i >= 0 && locked[i]) i--; return i; }

function renderCurrent() {
  const r = guesses.length;
  if (r >= MAX_GUESSES) return;
  for (let c = 0; c < boardLen; c++) {
    const t = tiles[r][c], ch = current[c];
    t.classList.remove("filled", "locked", "cursor", "editable", "typed-blank");
    t.textContent = ch === undefined || ch === BLANK ? "" : ch;
    if (ch !== undefined) t.classList.add(locked[c] ? "locked" : "filled");
    if (ch === BLANK && !locked[c]) t.classList.add("typed-blank");
    if (!locked[c]) t.classList.add("editable");
    if (c === cursor) t.classList.add("cursor");
  }
  // the answer's marks, from the start, on the row being typed and those to come
  for (let rr = r; rr < MAX_GUESSES; rr++) { paintMarks(rr, entry.marks); rowLabel(rr); }
}

function upgradeKey(k, status) {
  const el = keyEls[k];
  if (!el) return;
  const rank = { absent: 0, present: 1, correct: 2 };
  const prev = ["correct", "present", "absent"].find(s => el.classList.contains(s));
  if (!prev || rank[status] > rank[prev]) {
    el.classList.remove("correct", "present", "absent");
    el.classList.add(status);
  }
}

function renderGuessRow(r, word, e) {
  const rowEl = boardEl.children[r];
  rowEl.classList.add("guessed");
  rowEl.title = "Show " + e.text + " in the sky view";
  const score = scoreGuess(word, answer);
  for (let c = 0; c < boardLen; c++) {
    const t = tiles[r][c];
    t.textContent = word[c] === BLANK ? "" : word[c];
    t.classList.remove("filled", "locked", "cursor", "editable", "typed-blank");
    t.classList.add(score[c]);
    upgradeKey(word[c], score[c]);
  }
  paintMarks(r, e.marks); // a submitted row shows its own guess's marks
  rowEl.setAttribute("aria-label", guessLabel(r, word, e));
  for (const c of MuldleHints.placed(revealedHints([...guesses.slice(0, r), word], answer))) {
    if (keyEls[c]) keyEls[c].classList.add("done");
  }
}

function clearBoard() {
  for (const row of tiles) for (const t of row) {
    t.textContent = "";
    t.className = "tile";
    t.removeAttribute("data-mark");
  }
  for (const rowEl of boardEl.children) {
    rowEl.classList.remove("guessed", "viewing");
    rowEl.removeAttribute("title");
    rowEl.removeAttribute("aria-label");
  }
  for (const k in keyEls) keyEls[k].classList.remove("correct", "present", "absent", "done");
  gen++;
  for (const cells of hintCells) for (const key in cells) setHint(cells[key], "", ""); // game.js
}

/* ---- hints: ID's four cells, from each entry's object ---- */

const consName = c => CONSTELLATION_NAMES[c] || c;
function renderHintRow(r, e) {
  const cells = hintCells[r], g = objectOf(e), a = objectOf(entry);
  // constellation: the first (and how many more); green when one is shared
  const shared = g.cons.some(c => a.cons.includes(c));
  setHint(cells.con, g.cons.length ? consName(g.cons[0]) + (g.cons.length > 1 ? ` +${g.cons.length - 1}` : "") : "n/a",
    shared ? "match" : "");
  if (g.pos && a.pos) {
    const sep = angularSeparation(g.pos, a.pos);
    const same = sameObject(e, entry) || sep < 1e-6;
    const arrow = same ? "●" : DIR_ARROWS[compassDir(positionAngle(g.pos, a.pos))];
    setHint(cells.dist, `${arrow} ${formatSeparation(same ? 0 : sep)}`, closeness(same ? 0 : sep, DIST_MATCH, DIST_NEAR));
  } else setHint(cells.dist, "n/a", "");
  // type and magnitude: SIMBAD's where the object has an id there, else a sky
  // name's own kind word and magnitude
  const kindWord = o => (o.sky ? o.sky.type || o.sky.kind : "");
  setHintSpinner(cells.type);
  setHintSpinner(cells.mag);
  const myGen = gen;
  Promise.all([fetchObjectInfo(g.ident), fetchObjectInfo(a.ident)]).then(([gi, ai]) => {
    if (myGen !== gen) return;
    const gType = gi.otype || kindWord(g), aType = ai.otype || kindWord(a);
    setHint(cells.type, gType || (gi.found === null ? "?" : "n/a"), gType && gType === aType ? "match" : "");
    if (gi.otype) {
      const link = document.createElement("a");
      link.href = "https://vizier.cds.unistra.fr/cgi-bin/OType?" + encodeURIComponent(gi.otype);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = gi.otype;
      link.title = gi.typeDesc || gi.otype;
      cells.type.val.replaceChildren(link);
    }
    const gMag = gi.mag ?? (g.sky && g.sky.mag != null ? g.sky.mag : null);
    const aMag = ai.mag ?? (a.sky && a.sky.mag != null ? a.sky.mag : null);
    if (gMag == null) setHint(cells.mag, gi.found === null ? "?" : "n/a", "");
    else setHint(cells.mag, gMag.toFixed(1) + (gi.band ? " " + gi.band : ""),
      aMag == null ? "" : closeness(Math.abs(gMag - aMag), MAG_MATCH, MAG_NEAR));
  });
}

/* ---- the sky view of a guessed row (game.js's loaders) ---- */

let aladinView = null, shownKey = null, surveyCtl = null, skyOverlay = null, linesReady = null;
function loadSkyLines() {
  if (!linesReady) {
    linesReady = new Promise(resolve => {
      if (typeof SKY_LINES !== "undefined") { resolve(); return; }
      const s = document.createElement("script");
      s.src = "skylines.js" + ASSET_QUERY;
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
  return linesReady;
}
function hideObjectPanel() {
  shownKey = null;
  aladinView = null;
  skyOverlay = null;
  for (const rowEl of boardEl.children) rowEl.classList.remove("viewing");
  panelEl.hidden = true;
  aladinDiv.replaceChildren();
  aladinDiv.removeAttribute("style");
  captionEl.replaceChildren();
}
function caption(e, o, otype) {
  const role = document.createElement("span");
  role.className = "object-role";
  role.textContent = "guess";
  const link = document.createElement("a");
  link.target = "_blank";
  link.rel = "noopener";
  link.href = o.sky ? o.sky.link : o.ident ? "https://simbad.cds.unistra.fr/simbad/sim-basic?Ident=" + encodeURIComponent(o.ident)
    : "https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=" + encodeURIComponent(`${o.pos[0]} ${o.pos[1] >= 0 ? "+" : ""}${o.pos[1]}`) +
      "&Radius=2&Radius.unit=arcmin";
  link.textContent = e.text;
  captionEl.replaceChildren(role, " ", link);
  const bits = [];
  if (e.kind !== "name" && e.primary && !o.sky) bits.push(spacedId(e.primary));
  if (e.also) bits.push("also " + e.also.map(spacedId).join(", "));
  const what = o.sky ? o.sky.type || o.sky.kind : otype;
  if (what) bits.push(what);
  if (o.cons.length) bits.push(o.cons.map(consName).join(", "));
  for (const b of bits) captionEl.append(" · " + b);
}
function showObject(r) {
  const e = guessEntries[r], o = objectOf(e);
  shownKey = r;
  for (let i = 0; i < boardEl.children.length; i++) boardEl.children[i].classList.toggle("viewing", i === r);
  if (panelEl.hidden) {
    const n = window.MuldleSurveys ? window.MuldleSurveys.count : 0;
    const maxByWidth = n ? (document.documentElement.clientWidth - 16 - 7) / (1 + 1 / n) : document.documentElement.clientWidth - 16;
    const size = Math.min(360, maxByWidth);
    aladinDiv.style.width = size + "px";
    aladinDiv.style.height = size + "px";
    panelEl.hidden = false;
    if (window.MuldleSurveys && !surveyCtl) surveyCtl = window.MuldleSurveys.mount(surveyPickerEl, () => aladinView);
  }
  caption(e, o, "");
  if (!o.pos) return;
  const myGen = gen;
  const extras = o.sky ? [Promise.resolve({ otype: "" }), loadSkyLines()] : [fetchObjectInfo(o.ident), loadViewSizes()];
  Promise.all([loadAladin(), ...extras]).then(([, info]) => {
    if (myGen !== gen || shownKey !== r) return;
    const fov = o.sky ? o.sky.fov : o.word ? viewFov(o.word, V2P) : DEFAULT_FOV;
    if (surveyCtl) surveyCtl.suggest((o.sky && o.sky.survey) ||
      (fov >= 50 ? window.MuldleSurveys.WIDE_ID : window.MuldleSurveys.DEFAULT_ID));
    if (aladinView) aimSkyView(aladinView, o.pos, fov);
    else {
      aladinView = A.aladin("#omni-aladin-div", {
        survey: surveyCtl ? surveyCtl.current() : "P/DSS2/color", target: o.pos[0] + " " + o.pos[1], fov,
        showFullscreenControl: false, showLayersControl: false, showFrame: false,
        showCooGridControl: false, showProjectionControl: false,
      });
    }
    if (!skyOverlay) { skyOverlay = A.graphicOverlay({ color: "#ffcf4d", lineWidth: 1.5 }); aladinView.addOverlay(skyOverlay); }
    skyOverlay.removeAll();
    const lines = o.sky && typeof SKY_LINES !== "undefined" && SKY_LINES[e.primary];
    if (lines) {
      for (const flat of lines) {
        const pts = [];
        for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
        skyOverlay.add(A.polyline(pts));
      }
    } else if (o.sky && o.sky.kind === "star") skyOverlay.add(A.circle(o.pos[0], o.pos[1], o.sky.fov * 0.08));
    if (surveyCtl) { surveyCtl.apply(aladinView); window.MuldleSurveys.updateCoverage(surveyCtl, o.pos[0], o.pos[1]); }
    caption(e, o, info.otype);
  }).catch(() => {
    if (myGen !== gen || shownKey !== r) return;
    aladinDiv.textContent = "sky view unavailable";
  });
}
function rowClicked(r) {
  if (r >= guesses.length) return;
  if (shownKey === r) { hideObjectPanel(); return; }
  showObject(r);
  panelEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---- messages and the info line ---- */

let messageTimer = null;
function showMessage(text, sticky = false) {
  messageEl.textContent = text;
  clearTimeout(messageTimer);
  if (!sticky && text) messageTimer = setTimeout(() => { messageEl.textContent = ""; }, 2500);
}
function shakeRow() {
  const row = boardEl.children[guesses.length];
  if (!row) return;
  row.classList.add("shake");
  setTimeout(() => row.classList.remove("shake"), 450);
}

let legalMemo = { key: null, n: 0 };
function legalCount() {
  const key = view + "|" + answer + "|" + guesses.join("|");
  if (legalMemo.key !== key) {
    const hints = revealedHints(guesses, answer), v = variant();
    let n = 0;
    for (const e of v.answers) if (!MuldleHints.violation(hints, v.wordOf(e))) n++;
    legalMemo = { key, n };
  }
  return legalMemo.n;
}
function updateInfo() {
  if (!showing) { infoEl.textContent = ""; return; }
  const v = variant();
  let size = `${v.answers.length} answers in play`;
  if (hardMode && guesses.length) {
    const n = legalCount();
    size = `${n} answer${n === 1 ? "" : "s"} left`;
  }
  infoEl.replaceChildren(`${view === "mini" ? "Mini" : "Unlimited"} · ${size}`);
  if (rejected) {
    const rej = document.createElement("span");
    rej.className = "rejected-count";
    rej.title = "Rejected guesses this puzzle (not an identifier or name, a repeat or a hard-mode break)";
    rej.textContent = `✖ ${rejected}`;
    infoEl.append(" · ", rej);
  }
}
function updateToggle() {
  playToggleEl.hidden = !showing;
  for (const b of playSegs) b.setAttribute("aria-pressed", String(b.dataset.play === view));
}
// the clock shows the session in play (each option has its own)
function attachClock() {
  (view === "mini" ? omniUnlimited : miniUnlimited).setClock(null);
  ctl().setClock(clockEl);
  if (!showing) clockEl.hidden = true;
}

/* ---- puzzles ---- */

function save() {
  if (entry) ctl().savePuzzle({ tiles: entry.tiles, guesses, rejected });
}

// On a phone (and any short screen) the message and the keyboard are pinned
// to the bottom together (#omni-dock, style.css): keep the row being typed in
// view above them. Once scrolled, the pinned dock sits at the screen's bottom,
// so the room for the row is the screen less the dock's height (not where the
// dock is now: before the page scrolls it can sit lower, held by its
// container).
const dockEl = document.getElementById("omni-dock");
function keepRowInView() {
  const row = boardEl.children[Math.min(guesses.length, MAX_GUESSES - 1)];
  // mid-flip the face is turned: flip.js says when it has settled
  if (!row || faceEl.inert || document.getElementById("flipper").classList.contains("flip-anim")) return;
  const kb = dockEl.getBoundingClientRect(), rr = row.getBoundingClientRect();
  const room = Math.min(kb.top, window.innerHeight - kb.height);
  if (rr.bottom > room - 4) window.scrollBy(0, rr.bottom - room + 8);
  else if (rr.top < 0) window.scrollBy(0, rr.top - 8);
}

function showPuzzle(e, gs = [], rej = 0) {
  deferred = null;
  const v = variant();
  if (boardLen !== v.len) buildBoard(v.len);
  showing = true;
  faceEl.classList.remove("omni-closed-state");
  closedEl.hidden = true;
  entry = e;
  answer = v.wordOf(e);
  guesses = gs.slice();
  guessEntries = guesses.map(w => v.byWord.get(w));
  rejected = rej;
  clearBoard();
  hideObjectPanel();
  guesses.forEach((w, r) => { renderGuessRow(r, w, guessEntries[r]); renderHintRow(r, guessEntries[r]); });
  resetCurrent();
  renderCurrent();
  updateInfo();
  updateToggle();
  attachClock();
  save();
  // the row being typed above the pinned keyboard (a phone, landscape too)
  if (window.__muldleMode === "omni") requestAnimationFrame(keepRowInView);
}

// OMNI is closed (today's ID and ABC dailies unsolved, or a new day): a card
// in place of the board
function showClosed(text = "") {
  showing = false;
  entry = null;
  faceEl.classList.add("omni-closed-state");
  closedEl.hidden = false;
  // the card's first line says how to play here: solve a daily, or (the gate
  // open, the session gone to another tab) come back to OMNI
  closedEl.querySelector(".omni-closed-lead").textContent = gateOpen() && !ctl().stale()
    ? "OMNI is open: flip to another mode and back to carry on here."
    : "OMNI opens once you've solved today's ID or ABC puzzle.";
  hideObjectPanel();
  updateInfo();
  updateToggle();
  showMessage(text, true);
}

// a session saved by an earlier page: its puzzle comes back as it was (one
// over, a daily object, unknown, or none saved gives the next)
function resume(saved) {
  const v = variant();
  const e = saved && typeof saved.tiles === "string" ? v.byWord.get(pad(saved.tiles, v.len)) : null;
  if (e && e.answer && v.answers.includes(e) && !skip(e)) {
    const word = v.wordOf(e);
    const gs = (Array.isArray(saved.guesses) ? saved.guesses : []).filter(g => typeof g === "string" && v.byWord.has(g));
    if (!gs.includes(word) && gs.length < MAX_GUESSES) {
      showPuzzle(e, gs, Number.isInteger(saved.rejected) && saved.rejected > 0 ? saved.rejected : 0);
      return;
    }
  }
  showPuzzle(ctl().next());
}

const NEW_DAY = "A new day has started: reload for today's puzzles.";

// a new session of the option in view (a fresh seed, the stopwatch waiting
// for the first key), or the card if the gate is closed
function beginSession(msg) {
  // after midnight the page's day is over: the session in play ends too
  // (counted), as ID's and ABC's do (release 2's review, R2-1)
  if (ctl().stale()) { if (ctl().on) ctl().end(); showClosed(NEW_DAY); return; }
  if (!gateOpen()) { showClosed(); return; }
  ctl().begin(omniByKind(), null);
  showPuzzle(ctl().next());
  showMessage(msg);
}

// the face arrives (a flip to OMNI, or a load in OMNI): the session in play
// goes on, or one begins; the card while the gate is closed
function arrive() {
  // the option another tab may have chosen since this page loaded, so the
  // face keeps one session (release 2's review, R2-5)
  const stored = storedView();
  if (stored !== view && !ctl().on) { view = stored; attachClock(); }
  // a session stored by another tab goes on here, as a reload would take it,
  // rather than a new one replacing it (R2-3; one a new day has closed ends)
  if (!ctl().on && takeOver()) return;
  if (ctl().on) {
    if (!showing) {
      // no draw from yesterday's pool after midnight (R2-4)
      if (ctl().stale()) { ctl().end(); showClosed(NEW_DAY); return; }
      resume(deferred ? deferred.saved : null);
    } else requestAnimationFrame(keepRowInView);
    // on a load, again once the browser has put back its own scroll position
    if (document.readyState !== "complete") {
      window.addEventListener("load", () => setTimeout(keepRowInView, 0), { once: true });
    }
    return;
  }
  beginSession(view === "mini" ? "Mini: short answers only. The stopwatch starts at your first key."
    : "The stopwatch starts at your first key.");
}

// the option's session stored by another tab (or an earlier page) goes on
// here; false if there is none (or a new day ended it)
function takeOver() {
  const saved = ctl().restore();
  if (!ctl().on) return false;
  resume(saved);
  return true;
}

// Unlimited <-> Mini: a plain swap; the option left ends its session, also
// one another tab plays (the face keeps one session, R2-5), and the option
// chosen takes over its stored one, if another tab has it
function setView(v) {
  if (v === view) return;
  if (!ctl().on) ctl().restore();
  if (ctl().on) ctl().end();
  view = v;
  saveView();
  attachClock();
  if (takeOver()) return;
  beginSession(v === "mini" ? "Mini: short answers only, up to 6 tiles." : "Unlimited: any identifier or name.");
}

function finish(won) {
  const tries = guesses.length, text = revealText(entry, won, tries);
  ctl().finish(won, tries);
  if (ctl().stale()) { ctl().end(); showClosed(`${text} ${NEW_DAY}`); return; }
  showPuzzle(ctl().next());
  messageEl.textContent = text; // the reveal, in full, until the next message
  clearTimeout(messageTimer);
  // a solve shows (user, 08-10-2026): the reveal glows, the clock's count
  // pops (unlimited.js; none on a load or resume)
  if (won) MuldleUnlimited.celebrate(messageEl, clockEl);
  keepRowInView();
}

// another mode registered its daily object: the puzzle shown can't be one
function recheck() {
  if (showing && entry && skip(entry)) showPuzzle(ctl().next());
}
// another tab took the session over (or ended it)
function lost(ended) {
  deferred = null;
  const what = view === "mini" ? "Mini" : "OMNI";
  showClosed(ended ? `${what} ended in another tab.` : `${what} goes on in another tab.`);
}

/* ---- input ---- */

function handleKey(k) {
  if (!showing || faceEl.inert) return;
  ctl().key(); // the stopwatch starts at the first key
  if (k === "Enter") { submit(); return; }
  if (/^[0-9A-Z* ]$/.test(k) && skipped && current[skipped.at] === k) {
    skipped = skipped.at < skipped.end ? { at: skipped.at + 1, end: skipped.end } : null;
    return; // the locked tile just skipped: already typed
  }
  skipped = null;
  if (k === "Left") { const p = prevFree(cursor); if (p >= 0) cursor = p; renderCurrent(); return; }
  if (k === "Right") { if (cursor < boardLen) cursor = nextFree(cursor + 1); renderCurrent(); return; }
  if (k === "Back") {
    if (cursor < boardLen && current[cursor] !== undefined && !locked[cursor]) delete current[cursor];
    else {
      for (let i = Math.min(cursor, boardLen) - 1; i >= 0; i--) {
        if (current[i] !== undefined && !locked[i]) { delete current[i]; cursor = i; break; }
      }
    }
    renderCurrent();
    return;
  }
  if (!/^[0-9A-Z* ]$/.test(k)) return;
  let at = cursor;
  if (at >= boardLen) { at = 0; while (at < boardLen && current[at] !== undefined) at++; }
  const full = at >= boardLen;
  if (hardMode) {
    const block = MuldleHints.typeBlock(revealedHints(guesses, answer), full ? -1 : at, k, current);
    if (block) { showMessage(hintMessage(block)); return; }
  }
  if (full) return;
  current[at] = k;
  moveCursor(at + 1);
  renderCurrent();
}

function tileClicked(r, c) {
  if (!showing || r !== guesses.length || locked[c]) return;
  skipped = null;
  cursor = c;
  renderCurrent();
}

function reject(word) {
  shakeRow();
  if (word === lastRejected) return;
  lastRejected = word;
  rejected++;
  save();
  updateInfo();
}

function submit() {
  const v = variant();
  let word = "";
  for (let i = 0; i < boardLen; i++) word += current[i] ?? BLANK;
  if (!current.some((ch, i) => ch !== undefined && !locked[i]) && !v.byWord.has(word)) {
    showMessage("Type a guess first");
    shakeRow();
    return;
  }
  const e = v.byWord.get(word);
  if (!e) { showMessage(refusalMessage(word, v)); reject(word); return; }
  if (guesses.includes(word)) { showMessage(`${e.text} was already guessed`); reject(word); return; }
  if (hardMode) {
    const msg = hintMessage(MuldleHints.violation(revealedHints(guesses, answer), word));
    if (msg) { showMessage(msg); reject(word); return; }
  }
  renderGuessRow(guesses.length, word, e);
  renderHintRow(guesses.length, e);
  guesses.push(word);
  guessEntries.push(e);
  save();
  if (word === answer || guesses.length >= MAX_GUESSES) { finish(word === answer); return; }
  updateInfo();
  resetCurrent();
  renderCurrent();
  keepRowInView();
}

document.addEventListener("keydown", (e) => {
  if (window.__muldleMode !== "omni") return;
  if (settingsDialog.open || statsDialog.open) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTextField(e.target)) return; // a text field (the sky view's) keeps its keys
  // Enter or Space on a focused control only works it (game.js's isControl)
  if ((e.key === "Enter" || e.key === " ") && isControl(e.target)) return;
  if (e.key === "Enter") handleKey("Enter");
  else if (e.key === "Backspace") {
    if (!isTextField(e.target)) e.preventDefault();
    handleKey("Back");
  } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && showing && !isTextField(e.target)) {
    e.preventDefault();
    handleKey(e.key === "ArrowLeft" ? "Left" : "Right");
  } else if (e.key === " ") { e.preventDefault(); handleKey(BLANK); } // a blank tile, typed
  else if (/^[0-9*]$/.test(e.key)) handleKey(e.key);
  else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
});

for (const b of playSegs) {
  b.addEventListener("click", () => { b.blur(); setView(b.dataset.play); });
}

/* ---- settings and Stats & history (the shared dialogs) ---- */

settingsBtn.addEventListener("click", () => {
  // OMNI is always Unlimited: no daily to go back to, nothing to reset
  for (const id of ["back-to-daily", "reset-puzzle", "reset-random", "by-catalogue-row", "by-kind-row"]) {
    document.getElementById(id).hidden = true;
  }
  byOmniRow.hidden = false;
  byOmniToggle.checked = omniByKind();
  settingsDialog.showModal();
});
settingsDialog.addEventListener("close", () => setTimeout(() => settingsBtn.blur(), 0));

byOmniToggle.addEventListener("change", () => {
  let s = {};
  try {
    const v = JSON.parse(localStorage.getItem("muldle-settings-v1"));
    if (v && typeof v === "object" && !Array.isArray(v)) s = v;
  } catch (e) { /* corrupt: start over */ }
  try { localStorage.setItem("muldle-settings-v1", JSON.stringify({ ...s, omniByKind: byOmniToggle.checked })); } catch (e) { /* ignore */ }
  // the totals are per weighting, so a session has one: a new one starts
  if (showing) beginSession("A new session, with the new practice weighting.");
});

// hard mode toggled (game.js owns the checkbox): the row's prefill again
document.getElementById("hard-mode-toggle").addEventListener("change", () => {
  if (!showing) return;
  resetCurrent();
  renderCurrent();
  updateInfo();
});

// OMNI's Stats & history: OMNI's and Mini's totals (no daily part yet)
function renderOmniStats(container) {
  container.replaceChildren();
  const h = document.createElement("h2");
  h.textContent = "Stats & history — OMNI";
  container.appendChild(h);
  const before = container.childElementCount;
  omniUnlimited.renderStats(container, omniByKind());
  miniUnlimited.renderStats(container, omniByKind());
  if (container.childElementCount === before) {
    const empty = document.createElement("p");
    empty.className = "stats-empty";
    empty.textContent = "No games yet: OMNI's and Mini's totals show here once you play.";
    container.appendChild(empty);
  }
  const note = document.createElement("p");
  note.className = "stats-note";
  note.textContent = "Stored only in this browser — nothing is ever sent anywhere.";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "stats-clear";
  clear.textContent = "Clear OMNI's stats";
  let armed = false;
  clear.addEventListener("click", () => {
    if (!armed) { armed = true; clear.textContent = "Click again to clear — can't be undone"; clear.classList.add("armed"); return; }
    omniUnlimited.clearStats();
    miniUnlimited.clearStats();
    renderOmniStats(container);
  });
  container.append(note, clear);
}
// the dialog's Stats button, while OMNI is the face (a capture listener, as
// abc.js's, so game.js's own handler never sees it)
settingsDialog.addEventListener("click", (e) => {
  if (window.__muldleMode !== "omni") return;
  const btn = e.target && e.target.closest && e.target.closest("button");
  if (btn && btn.id === "stats-button") {
    e.stopPropagation();
    settingsDialog.close();
    renderOmniStats(statsContent);
    statsDialog.showModal();
  }
}, true);

/* ---- init ---- */

buildHintPanel();
buildKeyboard();
{
  // a session saved by an earlier page goes on (one per face: the other ends)
  const savedOmni = omniUnlimited.restore(), savedMini = miniUnlimited.restore();
  if (omniUnlimited.on && miniUnlimited.on) (view === "mini" ? omniUnlimited : miniUnlimited).end();
  if (!ctl().on && (view === "mini" ? omniUnlimited : miniUnlimited).on) { view = view === "mini" ? "omni" : "mini"; saveView(); }
  attachClock();
  // its puzzle shows when the face does (arrive; flip.js runs next, so a load
  // on OMNI's face shows it at once)
  if (ctl().on) deferred = { saved: view === "mini" ? savedMini : savedOmni };
  showClosed();
}
// flip.js says which face shows; OMNI's arrival begins (or resumes) a session,
// and once the flip has settled the row being typed is brought into view
window.addEventListener("muldle:mode", (ev) => { if (ev.detail === "omni") arrive(); });
window.addEventListener("muldle:settled", (ev) => { if (ev.detail === "omni" && showing) requestAnimationFrame(keepRowInView); });

const muldle = (window.__muldle = window.__muldle || {});
muldle.started = muldle.started || {};
muldle.started.omni = () => true; // never a fresh daily: no start screen

window.__omni = { // e2e/debug hook (asking for the pool builds it)
  get answer() { return answer; }, get entry() { return entry; }, get view() { return view; },
  get guesses() { return guesses.slice(); }, get showing() { return showing; }, get rejected() { return rejected; },
  get poolBuilt() { return poolBuilt(); }, MINI_LEN,
  get LEN() { return pool().LEN; },
  get counts() { const P = pool(); return { entries: P.ENTRIES.length, answers: P.ANSWERS.length, mini: P.MINI_ANSWERS.length, words: P.BY_WORD.size }; },
  entryOf: text => pool().ENTRIES.find(e => e.text === text), byTiles: t => pool().BY_WORD.get(pad(t, pool().LEN)),
  objectOf, describe, gateOpen, sameObject, session: () => ctl().session,
  get skyLines() { return skyOverlay && skyOverlay.overlayItems ? skyOverlay.overlayItems.length : null; },
  // what the sky view draws: "line" (an outline, a figure), "ring" (round a star)
  get skyShapes() {
    return skyOverlay && skyOverlay.overlayItems
      ? skyOverlay.overlayItems.map(i => (i.raDecArray ? "line" : i.radiusDegrees !== undefined ? "ring" : "?")) : null;
  },
  get aladin() { return aladinView; },
};
})();
