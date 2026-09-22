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
const ABC_EPOCH = { y: 2026, m: 9, d: 8 }; // day 0 of the ABC order
const SETTINGS_KEY = "muldle-settings-v1"; // shared with game.js (read-only here)
const ABC_STORAGE_KEY = "muldle-abc-v1";

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

function saveState() {
  localStorage.setItem(ABC_STORAGE_KEY,
    JSON.stringify({ day: DAY, name: activeName, guesses, randomName }));
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

/* ============ DOM ============ */

const boardEl = document.getElementById("abc-board");
const messageEl = document.getElementById("abc-message");
const keyboardEl = document.getElementById("abc-keyboard");
const infoEl = document.getElementById("abc-puzzle-info");

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
  infoEl.textContent = randomName
    ? `Random name · ${POOL} named objects`
    : `Puzzle #${DAY} · ${POOL} named objects`;
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
    showMessage(`${WIN_MESSAGES[guesses.length - 1]} It was the ${activeName}.`, true);
    showObject(activeId);
    showPostGame();
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    showMessage(`Out of guesses — it was the ${activeName}.`, true);
    showObject(activeId);
    showPostGame();
  }
  resetCurrent();
  renderCurrent();
}

document.addEventListener("keydown", (e) => {
  if (window.__muldleMode !== "abc") return;
  if (settingsDialog.open) return;
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
  guesses = [];
  finished = false;
  buildBoard();
  buildKeyboard();
  hideObjectPanel();
  hidePostGame();
  resetCurrent();
  renderCurrent();
  updateInfo();
  showMessage(msg);
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
    startAbcPuzzle(TODAY.name, TODAY.id, false, "Back to today's puzzle.");
  }
}, true);

/* ============ post-game: emoji-grid share + next-puzzle countdown ============ */

const postGameEl = document.getElementById("abc-post-game");
const shareBtn = document.getElementById("abc-share-button");
const countdownEl = document.getElementById("abc-countdown");
const SHARE_EMOJI = { correct: "🟩", present: "🟨", absent: "⬛" };

// emoji grid of the scored rows: one square per playable slot, words spaced
// (fixed punctuation slots are skipped)
function buildShareText() {
  const solved = guesses.length && guesses[guesses.length - 1] === ANSWER;
  const tries = solved ? guesses.length : "X";
  const head = randomName ? "Muldle ABC (practice)" : `Muldle ABC #${DAY}`;
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
  countdownEl.hidden = !!randomName; // no daily countdown for a practice object
  if (randomName) clearInterval(countdownTimer);
  else startCountdown();
}

function hidePostGame() {
  postGameEl.hidden = true;
  clearInterval(countdownTimer);
}

/* ============ init ============ */

loadState();
window.__abc = { get NAME() { return activeName; }, get ANSWER() { return ANSWER; },
  DAY, POOL, get model() { return MODEL; } }; // e2e/debug hook

buildBoard();
buildKeyboard();
updateInfo();

guesses.forEach((g, r) => renderGuessRow(r, g));
if (guesses.length && guesses[guesses.length - 1] === ANSWER) {
  finished = true;
  showMessage(`Already solved — it was the ${activeName}.`, true);
  showObject(activeId);
  showPostGame();
} else if (guesses.length >= MAX_GUESSES) {
  finished = true;
  showMessage(`Out of guesses — it was the ${activeName}.`, true);
  showObject(activeId);
  showPostGame();
}
resetCurrent();
renderCurrent();

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
