// SPDX-License-Identifier: AGPL-3.0-only
// ABC mode: a Wordle over the common NAME of a deep-sky object (e.g. "ORION
// NEBULA"). Self-contained and additive — ID mode (game.js) is untouched.
// Reads ABC_NAMES (names.js) for the answer pool and CAT_* (data.js) for the
// sky reveal. Also owns the ID<->ABC flip at the bottom of the file.
//
// Wrapped in an IIFE: game.js and abc.js are both classic scripts sharing one
// global lexical scope, and many top-level names (ANSWER, scoreGuess, guesses,
// buildBoard, ...) exist in both — without this they'd collide. The only thing
// shared across the boundary is window.__muldleMode (read by game.js's keydown).
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

const KEY_RANK = { absent: 0, present: 1, correct: 2 };

// hard mode: greens stay, yellows must be reused, greys are banned. Fixed
// punctuation always matches, so it never trips these.
function hardModeViolation(prevGuesses, answer, guess) {
  const rank = {};
  for (const prev of prevGuesses) {
    const score = scoreGuess(prev, answer);
    for (let i = 0; i < answer.length; i++) {
      if (score[i] === "correct" && guess[i] !== prev[i])
        return `Hard mode: keep ${prev[i]} in place`;
    }
    for (let i = 0; i < answer.length; i++) {
      if (score[i] !== "present") continue;
      // a yellow char must be reused somewhere...
      if (!guess.includes(prev[i]))
        return `Hard mode: name must contain ${prev[i]}`;
      // ...but not back in the same tile — a yellow at i means "in the name,
      // but not at position i" (holds even with repeated letters)
      if (guess[i] === prev[i])
        return `Hard mode: ${prev[i]} is not in that spot`;
    }
    for (let i = 0; i < answer.length; i++) {
      const r = KEY_RANK[score[i]];
      if (!(prev[i] in rank) || r > rank[prev[i]]) rank[prev[i]] = r;
    }
  }
  for (const ch of guess) {
    if (rank[ch] === 0) return `Hard mode: there is no ${ch} in the name`;
  }
  return null;
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
const ABC_STORAGE_KEY = "muldle-abc-v1";
// off-day puzzles browsed via the navigator, keyed by number: { [day]: guesses[] }.
// Separate from muldle-abc-v1 so browsing never clobbers today's daily.
const ABC_ARCHIVE_KEY = "muldle-abc-archive-v1";

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

const ABC_ORDER = shuffledOrder(ABC_NAMES, ABC_SEED);
const DAY = dayIndex(ABC_EPOCH);
const POOL = ABC_ORDER.length;
const TODAY = ABC_ORDER[((DAY % POOL) + POOL) % POOL];

// the {name, id} entry for any ABC puzzle number (the navigator plays past ones)
function entryForDay(d) { return ABC_ORDER[((d % POOL) + POOL) % POOL]; }

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

// every known name -> its representative id (so a guessed real name can be
// shown in the sky view), and id -> proper-case name (for reveal captions).
// NAME_BY_KEY stays on ABC_NAMES (unique name -> representative id); NAME_BY_ID
// uses ID_NAMES (every id) so ids that share a name resolve too.
const NAME_BY_KEY = new Map(ABC_NAMES.map(e => [nameKey(e.name), e.id]));
const NAME_BY_ID = new Map();
for (const e of ID_NAMES) if (!NAME_BY_ID.has(e.id)) NAME_BY_ID.set(e.id, e.name);

function isHardMode() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && typeof s.hardMode === "boolean") return s.hardMode;
  } catch (e) { /* ignore */ }
  return true; // default on, matching game.js
}

/* ============ state (the active puzzle: today's, or a random practice one) === */

let activeName = TODAY.name;
let activeId = TODAY.id;
let MODEL = buildAnswerModel(activeName);
let ANSWER = MODEL.answer;
let randomName = null; // when practising a random named object

let guesses = [];   // submitted spaceless uppercase strings (length ANSWER.length)
let current = [];   // per-slot typed chars (fixed slots pre-filled)
let locked = [];    // per-slot: fixed punctuation or a hard-mode known green
let finished = false;
let abcViewDay = DAY; // puzzle number in play: today's (DAY) or an archived one (< DAY)

function setActive(name, id, isRandom) {
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
    for (const g of guesses) {
      for (let i = 0; i < ANSWER.length; i++) {
        if (g[i] === ANSWER[i]) { current[i] = ANSWER[i]; locked[i] = true; }
      }
    }
  }
}

// today's daily (and the random object) live in muldle-abc-v1, keyed on DAY;
// an off-day puzzle browsed via the navigator goes to the archive store
function saveState() {
  if (randomName || abcViewDay === DAY) {
    localStorage.setItem(ABC_STORAGE_KEY,
      JSON.stringify({ day: DAY, name: activeName, guesses, randomName }));
  } else {
    const a = loadAbcArchive();
    a[abcViewDay] = guesses;
    localStorage.setItem(ABC_ARCHIVE_KEY, JSON.stringify(a));
  }
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
  try {
    const s = JSON.parse(localStorage.getItem(ABC_STORAGE_KEY));
    if (s && s.day === DAY && !s.randomName && s.name === TODAY.name && Array.isArray(s.guesses)) {
      return s.guesses.filter(g => typeof g === "string" && g.length === ANSWER.length);
    }
  } catch (e) { /* corrupt: fresh */ }
  return [];
}

// off-day guesses for <day>: the navigator's archive store, or — for a past
// daily played live but never replayed here — the persistent results store
function loadArchivedAbcGuesses(day) {
  const valid = g => typeof g === "string" && g.length === ANSWER.length;
  const gs = loadAbcArchive()[day];
  if (Array.isArray(gs)) return gs.filter(valid);
  const rec = loadAbcResults()[day];
  return rec && Array.isArray(rec.guesses) ? rec.guesses.filter(valid) : [];
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(ABC_STORAGE_KEY));
    if (!s || s.day !== DAY) return;
    // restore a random-practice name if one was in play and still known
    if (typeof s.randomName === "string" && NAME_BY_KEY.has(nameKey(s.randomName))) {
      setActive(s.randomName, NAME_BY_KEY.get(nameKey(s.randomName)), true);
    }
    if (s.name === activeName && Array.isArray(s.guesses)) {
      guesses = s.guesses.filter(g => typeof g === "string" && g.length === ANSWER.length);
    }
  } catch (e) { /* corrupt: start fresh */ }
}

/* ============ local play history + stats (no backend) ============ */

// Persistent ABC results, keyed by puzzle number (mirrors game.js's ID store):
//   { [day]: { guesses, solved, tries, playedOnDay } }. Outlives day rollover;
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
// by a later archive replay or a reset-and-replay.
function recordAbcResult(day, entry) {
  const store = loadAbcResults();
  if (store[day] && store[day].playedOnDay) return;
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
    const s = JSON.parse(localStorage.getItem(ABC_STORAGE_KEY));
    if (!s || typeof s.day !== "number" || s.day >= DAY || s.randomName) return;
    if (typeof s.name !== "string" || !Array.isArray(s.guesses)) return;
    const ans = buildAnswerModel(s.name).answer;
    const gs = s.guesses.filter(g => typeof g === "string" && g.length === ans.length);
    if (!gs.length) return;
    const solved = gs[gs.length - 1] === ans;
    if (!solved && gs.length < MAX_GUESSES) return; // unfinished
    recordAbcResult(s.day, { guesses: gs, solved, tries: solved ? gs.length : null, playedOnDay: true });
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

function renderCurrent() {
  const r = guesses.length;
  if (r >= MAX_GUESSES) return;
  for (let i = 0; i < MODEL.slots.length; i++) {
    const t = tiles[r][i];
    t.classList.remove("filled", "locked");
    if (!MODEL.slots[i].playable) { t.textContent = MODEL.slots[i].ch; continue; }
    const ch = current[i];
    if (ch === undefined) { t.textContent = ""; }
    else { t.textContent = ch; t.classList.add(locked[i] ? "locked" : "filled"); }
  }
}

function renderGuessRow(r, guess) {
  const rowEl = boardEl.children[r];
  rowEl.classList.add("guessed");
  const id = NAME_BY_KEY.get(guess);
  rowEl.title = id ? "Show " + (NAME_BY_ID.get(id) || simbadIdent(id)) + " in the sky view"
    : "Not a known object name";
  const score = scoreGuess(guess, ANSWER);
  for (let i = 0; i < MODEL.slots.length; i++) {
    const t = tiles[r][i];
    if (!MODEL.slots[i].playable) { t.textContent = MODEL.slots[i].ch; continue; }
    t.textContent = guess[i];
    t.classList.remove("filled", "locked");
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
function showMessage(text, sticky = false) {
  messageEl.textContent = text;
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
  infoEl.textContent = randomName
    ? `Random name · ${POOL} named objects`
    : abcViewDay !== DAY
      ? `Archive · ${POOL} named objects`
      : `${POOL} named objects`;
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

// "NGC0224" -> "NGC 224", "IC1023A" -> "IC 1023A"
function simbadIdent(id) {
  const m = /^([A-Z]+)(\d{4})([A-F]?)$/.exec(id);
  return m ? m[1] + " " + parseInt(m[2], 10) + m[3] : id;
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
  if (infoCache.has(ident)) return infoCache.get(ident);
  const q = "SELECT basic.otype_txt, basic.galdim_majaxis FROM ident JOIN basic " +
    "ON ident.oidref = basic.oid WHERE ident.id = '" + ident + "'";
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
      r < guesses.length && NAME_BY_KEY.get(guesses[r]) === shownId && shownId !== null);
  }
}

function renderCaption(id, otype) {
  const isTarget = id === activeId;
  const role = document.createElement("span");
  role.className = "object-role" + (isTarget ? " target" : "");
  role.textContent = isTarget ? "target" : "guess";
  const link = document.createElement("a");
  const ident = simbadIdent(id);
  link.href = "https://simbad.cds.unistra.fr/simbad/sim-basic?Ident=" +
    encodeURIComponent(ident);
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = NAME_BY_ID.get(id) || ident;
  captionEl.replaceChildren(role, " ", link, " · ", ident);
  if (otype) captionEl.append(" · " + otype);
  // constellation, for parity with ID mode's richer caption (CONSTELLATION_NAMES
  // is a game.js top-level const, shared across the two classic scripts)
  const conIdx = CAT_IDENTIFIERS.indexOf(id);
  const con = conIdx >= 0 ? CAT_CONSTELLATIONS[conIdx] : "";
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

  const ident = simbadIdent(id);
  const idx = CAT_IDENTIFIERS.indexOf(id);
  const pos = idx >= 0 ? CAT_POSITIONS[idx] : null;
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

// clicking a submitted guess shows that object if it's a real named object;
// clicking the shown one again returns to the target (game over) or closes it
function rowClicked(r) {
  if (r >= guesses.length) return;
  const id = NAME_BY_KEY.get(guesses[r]);
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

function handleKey(k) {
  if (finished) return;
  if (k === "Enter") { submitGuess(); return; }
  if (k === "Back") {
    for (let i = MODEL.slots.length - 1; i >= 0; i--) {
      if (MODEL.slots[i].playable && current[i] !== undefined && !locked[i]) {
        delete current[i]; renderCurrent(); return;
      }
    }
    return;
  }
  if (!/^[0-9A-Z]$/.test(k)) return;
  // hard mode bans greyed-out characters (absent everywhere tried) at type time,
  // not only on Enter — the key carries .absent exactly when it is grey
  if (isHardMode() && keyEls[k] && keyEls[k].classList.contains("absent")) {
    showMessage(`Hard mode: there is no ${k} in the name`);
    return;
  }
  for (let i = 0; i < MODEL.slots.length; i++) {
    if (MODEL.slots[i].playable && current[i] === undefined) {
      current[i] = k; renderCurrent(); return;
    }
  }
}

function submitGuess() {
  for (let i = 0; i < MODEL.slots.length; i++) {
    if (MODEL.slots[i].playable && current[i] === undefined) {
      showMessage("Fill in the name"); shakeRow(); return;
    }
  }
  let guess = "";
  for (let i = 0; i < MODEL.slots.length; i++) guess += current[i];

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
    showMessage(`${WIN_MESSAGES[guesses.length - 1]} It was the ${activeName}.`, true);
    showObject(activeId);
    showPostGame();
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    recordCurrentAbcResult(false);
    showMessage(`Out of guesses — it was the ${activeName}.`, true);
    showObject(activeId);
    showPostGame();
  }
  resetCurrent();
  renderCurrent();
}

document.addEventListener("keydown", (e) => {
  if (window.__muldleMode !== "abc") return;
  if (settingsDialog.open || statsDialog.open) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter") handleKey("Enter");
  else if (e.key === "Backspace") handleKey("Back");
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
  settingsDialog.showModal();
});
settingsDialog.addEventListener("close", () => setTimeout(() => abcSettingsBtn.blur(), 0));

// re-derive prefill when hard mode is toggled (game.js owns the checkbox)
hardModeToggle.addEventListener("change", () => {
  if (!finished) { resetCurrent(); renderCurrent(); }
});

function startAbcPuzzle(name, id, isRandom, msg) {
  setActive(name, id, isRandom);
  // a random object has no puzzle number: snap to today's slot so the URL drops
  // any archived ?p (else a reload re-enters the archive, discarding the random)
  if (isRandom) abcViewDay = DAY;
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
    showMessage(`Already solved — it was the ${activeName}.`, true);
    showObject(activeId);
    showPostGame();
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    recordCurrentAbcResult(false);
    showMessage(`Out of guesses — it was the ${activeName}.`, true);
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
  setActive(entry.name, entry.id, false);
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

function randomEntry() {
  let e;
  do { e = ABC_NAMES[Math.floor(Math.random() * ABC_NAMES.length)]; }
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

pruneFutureAbcEntries(ABC_RESULTS_KEY); // drop stale entries from the epoch re-index
pruneFutureAbcEntries(ABC_ARCHIVE_KEY);
migrateStaleAbcDaily(); // rescue a finished daily from a past day before it's lost

// initial puzzle: a ?p=<day> for the active mode opens that archived puzzle;
// otherwise restore today's daily (or the random object) from muldle-abc-v1
const urlDay = readUrlDay();
if (urlDay != null && urlDay !== DAY && activeModeOnLoad() === "abc") {
  abcViewDay = urlDay;
  const entry = entryForDay(urlDay);
  setActive(entry.name, entry.id, false);
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
}

window.__abc = { get NAME() { return activeName; }, get ANSWER() { return ANSWER; },
  DAY, POOL, get viewDay() { return abcViewDay; }, get model() { return MODEL; } }; // e2e/debug hook

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
