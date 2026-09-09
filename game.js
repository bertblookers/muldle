// SPDX-License-Identifier: AGPL-3.0-only
"use strict";

/* ============ configuration ============ */

// identifier anatomy: catalogue prefix letters + 4-digit zero-padded number +
// optional component letter, e.g. "NGC0042", "IC1023A"
const ID_RE = /^([A-Z]+)(\d{4})([A-F]?)$/;
const MAX_GUESSES = 6;
const BLANK = " ";             // internal representation of an empty tile

// the longest identifier sets the board width; shorter ones (plain NGC,
// everything IC) pad with trailing blanks, all WORD_LEN tiles are playable
const WORD_LEN = CAT_IDENTIFIERS.reduce((m, id) => Math.max(m, id.length), 0);

// Daily puzzle: a fixed seed defines one fixed shuffled order of the
// identifier list. EPOCH is day 0 of that order.
const SHUFFLE_SEED = 20260908;
const EPOCH = { y: 2026, m: 9, d: 8 }; // 2026-09-08 = puzzle #0

const SUFFIX_LETTERS = [...new Set(
  CAT_IDENTIFIERS.map(id => ID_RE.exec(id)[3]).filter(Boolean)
)].sort();

// every letter that can appear somewhere in a guess (prefix or suffix)
const LETTER_KEYS = [...new Set(
  CAT_IDENTIFIERS.flatMap(id => [...ID_RE.exec(id)[1]]).concat(SUFFIX_LETTERS)
)].sort();

// catalogue id "NGC0042" / "IC1023A" -> padded playable word
function fullWord(id) {
  return id.padEnd(WORD_LEN, BLANK);
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

const ORDER = shuffledOrder(CAT_IDENTIFIERS, SHUFFLE_SEED);
const DAY = todayIndex();
const N = ORDER.length;
const ANSWER = fullWord(ORDER[((DAY % N) + N) % N]);
const ALLOWED = new Set(CAT_IDENTIFIERS.map(fullWord));

function displayName(padded) {
  return padded.trim();
}

/* ============ state ============ */

const STORAGE_KEY = "muldle-v1";

let guesses = [];          // array of padded guess strings already submitted
let current = [];          // characters of the guess being typed
let finished = false;      // won or lost
let randomId = null;       // identifier overriding the daily answer (random-object mode)
let answer = ANSWER;       // answer of the puzzle being played (padded)

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ day: DAY, guesses, randomId }));
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.day === DAY && Array.isArray(s.guesses)) {
      return {
        guesses: s.guesses.filter(g => typeof g === "string" && g.length === WORD_LEN),
        randomId: typeof s.randomId === "string" &&
          ALLOWED.has(fullWord(s.randomId)) ? s.randomId : null,
      };
    }
  } catch (e) { /* corrupt state: start fresh */ }
  return { guesses: [], randomId: null };
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

/* ============ hard mode (standard Wordle rules, plus grey ban) ============ */

const KEY_RANK = { absent: 0, present: 1, correct: 2 };

// All revealed hints must be used: green tiles must stay in place, yellow
// characters must appear somewhere in the new guess, and characters that
// are greyed out (absent everywhere they were tried, never green/yellow)
// may not be used again. Returns a message describing the first violation,
// or null if the guess is acceptable.
function hardModeViolation(prevGuesses, answer, guess) {
  const rank = {}; // char -> best score it ever received (keyboard colouring)
  for (const prev of prevGuesses) {
    const score = scoreGuess(prev, answer);
    for (let i = 0; i < WORD_LEN; i++) {
      if (score[i] === "correct" && guess[i] !== prev[i]) {
        return prev[i] === BLANK
          ? `Hard mode: tile ${i + 1} must stay blank`
          : `Hard mode: tile ${i + 1} must be ${prev[i]}`;
      }
    }
    for (let i = 0; i < WORD_LEN; i++) {
      if (score[i] === "present" && !guess.includes(prev[i])) {
        return `Hard mode: guess must contain ${prev[i]}`;
      }
    }
    for (let i = 0; i < WORD_LEN; i++) {
      const r = KEY_RANK[score[i]];
      if (!(prev[i] in rank) || r > rank[prev[i]]) rank[prev[i]] = r;
    }
  }
  for (const ch of guess) {
    if (rank[ch] === 0) {
      return ch === BLANK
        ? "Hard mode: the identifier has no blank tiles"
        : `Hard mode: there is no ${ch} in the identifier`;
    }
  }
  return null;
}

/* ============ object-property hints (pure helpers) ============ */

// padded playable word "NGC1023A" / "IC0434  " -> index into the data arrays
function catalogueIndex(word) {
  return CAT_IDENTIFIERS.indexOf(word.trim());
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

const KEY_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  [...LETTER_KEYS],
  ["Enter", "Back"],
];

const keyEls = {};

function buildKeyboard() {
  for (const rowKeys of KEY_ROWS) {
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
    t.classList.remove("filled");
    if (ch === undefined) {
      t.textContent = "";
    } else {
      t.textContent = ch;
      t.classList.add("filled");
    }
  }
}

function renderGuessRow(r, guess) {
  const rowEl = boardEl.children[r];
  rowEl.classList.add("guessed");
  rowEl.title = "Show " + simbadIdent(guess.trim()) + " in the sky view";
  const score = scoreGuess(guess, answer);
  for (let c = 0; c < WORD_LEN; c++) {
    const t = tiles[r][c];
    t.textContent = guess[c] === BLANK ? "" : guess[c];
    t.classList.remove("filled");
    t.classList.add(score[c]);
    if (guess[c] !== BLANK) upgradeKey(guess[c], score[c]);
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
  if (!sticky && text) {
    messageTimer = setTimeout(() => { messageEl.textContent = ""; }, 2500);
  }
}

function shakeCurrentRow() {
  const row = boardEl.children[guesses.length];
  row.classList.add("shake");
  setTimeout(() => row.classList.remove("shake"), 450);
}

/* ============ object reveal (Aladin Lite viewer) ============ */

const ALADIN_SRC = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js";
const SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";
const DEFAULT_FOV = 0.3; // degrees, used when SIMBAD has no angular size
const MIN_FOV = 0.03;

const panelEl = document.getElementById("object-panel");
const captionEl = document.getElementById("object-caption");
const aladinDiv = document.getElementById("aladin-lite-div");

let shownId = null;    // catalogue id currently in the object panel, or null
let aladinView = null; // Aladin Lite instance, reused when switching objects

// "NGC0042" -> "NGC 42", "IC1023A" -> "IC 1023A"
function simbadIdent(id) {
  const [, prefix, num, letter] = ID_RE.exec(id);
  return prefix + " " + parseInt(num, 10) + letter;
}

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

// Object type, angular size (-> field of view, SIMBAD-style: 2x major axis)
// and magnitude (V, else B). Cached per identifier; a failed fetch is not
// cached so a later guess retries. `found` distinguishes an object SIMBAD
// doesn't know (false — ~12% of Corwin's identifiers, mostly IC entries
// that turned out to be stars/lost) from a failed fetch (null).
const objectInfoCache = new Map();

function fetchObjectInfo(ident) {
  if (objectInfoCache.has(ident)) return objectInfoCache.get(ident);
  const q = "SELECT basic.otype_txt, basic.galdim_majaxis, allfluxes.V, allfluxes.B, " +
    "otypedef.description " +
    "FROM ident JOIN basic ON ident.oidref = basic.oid " +
    "LEFT JOIN allfluxes ON allfluxes.oidref = basic.oid " +
    "LEFT JOIN otypedef ON otypedef.otype = basic.otype " +
    "WHERE ident.id = '" + ident + "'";
  const url = SIMBAD_TAP + "?request=doQuery&lang=adql&format=json&query=" +
    encodeURIComponent(q);
  const p = fetch(url)
    .then(r => r.json())
    .then(j => {
      const found = !!(j.data && j.data.length);
      const row = (j.data && j.data[0]) || [];
      const majArcmin = row[1];
      const mag = row[2] ?? row[3];
      return {
        found,
        otype: row[0] || "",
        fov: majArcmin ? Math.max((majArcmin * 2) / 60, MIN_FOV) : DEFAULT_FOV,
        mag: mag ?? null,
        band: row[2] != null ? "V" : row[3] != null ? "B" : "",
        typeDesc: row[4] || "",
      };
    })
    .catch(() => {
      objectInfoCache.delete(ident);
      return { found: null, fov: DEFAULT_FOV, otype: "", mag: null, band: "", typeDesc: "" };
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

function renderHintRow(r, guess) {
  const gi = catalogueIndex(guess), ai = catalogueIndex(answer);
  const cells = hintCells[r];
  const gPos = CAT_POSITIONS[gi], aPos = CAT_POSITIONS[ai];

  const gCon = CAT_CONSTELLATIONS[gi];
  setHint(cells.con, CONSTELLATION_NAMES[gCon] || gCon,
    gCon === CAT_CONSTELLATIONS[ai] ? "match" : "");

  const sep = angularSeparation(gPos, aPos);
  const arrow = gi === ai ? "●" : DIR_ARROWS[compassDir(positionAngle(gPos, aPos))];
  setHint(cells.dist, `${arrow} ${formatSeparation(sep)}`,
    closeness(sep, DIST_MATCH, DIST_NEAR));

  setHint(cells.type, "…", "");
  setHint(cells.mag, "…", "");
  const gen = puzzleGen;
  const gId = guess.trim();
  const aId = answer.trim();
  Promise.all([fetchObjectInfo(simbadIdent(gId)), fetchObjectInfo(simbadIdent(aId))])
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
      r < guesses.length && guesses[r].trim() === shownId);
  }
}

function renderCaption(id, ident, otype, found) {
  const isTarget = fullWord(id) === answer;
  const role = document.createElement("span");
  role.className = "object-role" + (isTarget ? " target" : "");
  role.textContent = isTarget ? "target" : "guess";
  const link = document.createElement("a");
  if (found === false) {
    // SIMBAD has no entry for this identifier (mostly IC entries that turned
    // out to be stars/lost) — link a coordinate search at Corwin's position
    // instead of a dead sim-basic page
    const idx = catalogueIndex(fullWord(id));
    const [ra, dec] = CAT_POSITIONS[idx];
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
  link.textContent = ident;
  captionEl.replaceChildren(role, " ", link);
  if (otype) captionEl.append(" · " + otype);
  else if (found === false) captionEl.append(" · not in SIMBAD");
  if (finished && !isTarget) {
    const back = document.createElement("a");
    back.href = "#";
    back.textContent = "show target";
    back.addEventListener("click", (e) => {
      e.preventDefault();
      showObject(answer.trim());
    });
    captionEl.append(" · ", back);
  }
}

// Show a catalogue object (id like "NGC1023A") in the panel right of the
// board: the answer when the game ends, or any clicked guess row.
function showObject(id) {
  if (shownId === id) return;
  shownId = id;
  markShownRow();

  if (panelEl.hidden) {
    // the viewer box matches the height of the six guess rows,
    // capped to the viewport width on narrow (phone) screens
    const size = Math.min(boardEl.offsetHeight,
      document.documentElement.clientWidth - 16);
    aladinDiv.style.width = size + "px";
    aladinDiv.style.height = size + "px";
    panelEl.hidden = false;
  }

  const ident = simbadIdent(id);
  const idx = CAT_IDENTIFIERS.indexOf(id);
  const pos = idx >= 0 ? CAT_POSITIONS[idx] : null;

  renderCaption(id, ident, "");

  if (!pos) return;
  const gen = puzzleGen;
  Promise.all([loadAladin(), fetchObjectInfo(ident)])
    .then(([, info]) => {
      // skip if the puzzle was reset or another object was clicked meanwhile
      if (gen !== puzzleGen || shownId !== id) return;
      if (aladinView) {
        aladinView.gotoRaDec(pos[0], pos[1]);
        aladinView.setFov(info.fov);
      } else {
        aladinView = A.aladin("#aladin-lite-div", {
          survey: "P/DSS2/color",
          target: pos[0] + " " + pos[1],
          fov: info.fov,
          showFullscreenControl: false,
          showLayersControl: false,
          showFrame: false,
          showCooGridControl: false,
          showProjectionControl: false,
        });
      }
      renderCaption(id, ident, info.otype, info.found);
    })
    .catch(() => {
      if (gen !== puzzleGen || shownId !== id) return;
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
  const id = guesses[r].trim();
  if (id !== shownId) {
    showObject(id);
    // on stacked (phone) layouts the panel lives below the keyboard
    panelEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else if (finished) {
    showObject(answer.trim());
  } else {
    hideObjectPanel();
  }
}

/* ============ input handling ============ */

const WIN_MESSAGES = ["Stellar!", "Supernova!", "Brilliant!", "Well spotted!", "Good eye!", "Phew, just in orbit!"];

function handleKey(k) {
  if (finished) return;
  if (k === "Enter") { submitGuess(); return; }
  if (k === "Back") {
    if (current.length > 0) { current.pop(); renderCurrentRow(); }
    return;
  }
  // any character goes anywhere; validity is checked on Enter
  if (current.length >= WORD_LEN) return;
  if (/^[0-9A-Z]$/.test(k)) { current.push(k); renderCurrentRow(); }
}

function submitGuess() {
  if (current.length === 0) {
    showMessage("Type an identifier first");
    shakeCurrentRow();
    return;
  }
  // tiles left empty count as blanks, e.g. "NGC0042" -> "NGC0042 "
  const guess = current.join("").padEnd(WORD_LEN, BLANK);
  if (!ALLOWED.has(guess)) {
    showMessage(`${displayName(guess)} is not a known object identifier`);
    shakeCurrentRow();
    return;
  }
  if (hardMode) {
    const violation = hardModeViolation(guesses, answer, guess);
    if (violation) {
      showMessage(violation);
      shakeCurrentRow();
      return;
    }
  }
  renderGuessRow(guesses.length, guess);
  renderHintRow(guesses.length, guess);
  guesses.push(guess);
  current = [];
  saveState();

  if (guess === answer) {
    finished = true;
    showMessage(`${WIN_MESSAGES[guesses.length - 1]} It was ${displayName(answer)}.`, true);
    showObject(answer.trim());
  } else if (guesses.length >= MAX_GUESSES) {
    finished = true;
    showMessage(`Out of guesses — it was ${displayName(answer)}.`, true);
    showObject(answer.trim());
  }
}

document.addEventListener("keydown", (e) => {
  if (settingsDialog.open) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter") { handleKey("Enter"); }
  else if (e.key === "Backspace") { handleKey("Back"); }
  else if (e.key === " ") { e.preventDefault(); } // blanks are implicit now
  else if (/^[0-9]$/.test(e.key)) { handleKey(e.key); }
  else if (/^[a-zA-Z]$/.test(e.key)) { handleKey(e.key.toUpperCase()); }
});

/* ============ settings ============ */

const settingsBtn = document.getElementById("settings-button");
const settingsDialog = document.getElementById("settings-dialog");
const backToDailyBtn = document.getElementById("back-to-daily");
const hardModeToggle = document.getElementById("hard-mode-toggle");

// preferences survive across days, unlike the per-day game state
const SETTINGS_KEY = "muldle-settings-v1";
let hardMode = true; // default on

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && typeof s.hardMode === "boolean") hardMode = s.hardMode;
  } catch (e) { /* corrupt settings: keep defaults */ }
}

hardModeToggle.addEventListener("change", () => {
  hardMode = hardModeToggle.checked;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ hardMode }));
});

function updateInfo() {
  infoEl.textContent = randomId
    ? `Random object · ${N} identifiers in play`
    : `Puzzle #${DAY} · ${N} identifiers in play`;
}

function clearBoardUI() {
  for (const row of tiles) {
    for (const t of row) {
      t.textContent = "";
      t.classList.remove("filled", "correct", "present", "absent");
    }
  }
  for (const rowEl of boardEl.children) {
    rowEl.classList.remove("guessed", "viewing");
    rowEl.removeAttribute("title");
  }
  for (const k in keyEls) keyEls[k].classList.remove("correct", "present", "absent");
  puzzleGen++; // invalidate in-flight hint fetches
  for (const cells of hintCells) {
    for (const key in cells) setHint(cells[key], "", "");
  }
}

function randomIdentifier() {
  let id;
  do {
    id = CAT_IDENTIFIERS[Math.floor(Math.random() * CAT_IDENTIFIERS.length)];
  } while (fullWord(id) === answer);
  return id;
}

function startPuzzle(newRandomId, msg) {
  randomId = newRandomId;
  answer = randomId ? fullWord(randomId) : ANSWER;
  guesses = [];
  current = [];
  finished = false;
  clearBoardUI();
  hideObjectPanel();
  updateInfo();
  showMessage(msg);
  saveState();
  settingsDialog.close();
}

settingsBtn.addEventListener("click", () => {
  backToDailyBtn.hidden = !randomId;
  settingsDialog.showModal();
});
// <dialog> refocuses the opener on close; blur it so Enter/space for the next
// guess doesn't reopen the settings panel. The refocus can land after the
// close event, so blur on the next tick.
settingsDialog.addEventListener("close", () => setTimeout(() => settingsBtn.blur(), 0));
document.getElementById("settings-close").addEventListener("click", () => settingsDialog.close());
document.getElementById("reset-puzzle").addEventListener("click", () =>
  startPuzzle(randomId, "Puzzle reset — same object, fresh guesses."));
document.getElementById("reset-random").addEventListener("click", () =>
  startPuzzle(randomIdentifier(), "Random object loaded — this is not today's puzzle."));
backToDailyBtn.addEventListener("click", () =>
  startPuzzle(null, "Back to today's puzzle."));

/* ============ init ============ */

buildBoard();
buildHintPanel();
buildKeyboard();
loadSettings();
hardModeToggle.checked = hardMode;

const loaded = loadState();
guesses = loaded.guesses;
randomId = loaded.randomId;
answer = randomId ? fullWord(randomId) : ANSWER;
updateInfo();
guesses.forEach((g, r) => { renderGuessRow(r, g); renderHintRow(r, g); });
if (guesses.length && guesses[guesses.length - 1] === answer) {
  finished = true;
  showMessage(`Already solved — it was ${displayName(answer)}.`, true);
  showObject(answer.trim());
} else if (guesses.length >= MAX_GUESSES) {
  finished = true;
  showMessage(`Out of guesses — it was ${displayName(answer)}.`, true);
  showObject(answer.trim());
}
