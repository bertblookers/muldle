// SPDX-License-Identifier: AGPL-3.0-only
// Start screen: a landing state with a Play button over three parts (the
// family's shared design): What's new (the latest update), On the horizon
// (updates to come; only when there are some) and Earlier updates (every
// previous one, newest first, folded, each entry its own fold). One gate for
// both modes, outside the flip. Shown on load only for a fresh puzzle (no
// guess yet in the active mode, no random practice, not in Unlimited: each
// mode's window.__muldle.started says): a puzzle in progress or finished, a
// random object and an Unlimited session go straight to the board, and so
// does a ?p=N link (it already names the puzzle). Whether this browser has seen the latest update is remembered
// (muldle-seen-v1, local only, nothing is sent anywhere): unseen, What's new
// starts open; seen, folded. A returning player (one with play history) who
// missed earlier updates finds Earlier updates open on those. Loaded after
// game.js and abc.js, which register window.__muldle.started.
(function () {
"use strict";

// Every update a player would notice, newest first (the page sorts them by
// date anyway, ties in this order; test_logic checks this order). The latest
// started one is What's new, the others Earlier updates. Only an era's entry
// (era: true, dated by its ERA_* switch constant from game.js, so moving the
// switch moves the entry too) can be still to come: it sits On the horizon
// until the switch's local midnight, by the switch's own day count. Any other
// entry is dated the day it goes live and counts as started whatever the
// player's local date (a player west of the deployer may still be on the day
// before), so it never shows a promised date. Player-facing words only, at
// most 4-5 one-line items; an id never changes (muldle-seen-v1 stores it).
const UPDATES = [
  {
    id: "abc-v3",
    era: true,
    date: ERA_ABC_V3_START,
    title: "Constellations, stars and more in ABC",
    items: [
      "ABC mode reaches beyond deep-sky objects: constellations, bright stars, asterisms and famous objects outside the catalogues.",
      "Two days a week the ABC answer is one of them; the other five stay deep-sky.",
      "The sky view draws a constellation's borders and an asterism's figure.",
      "ID mode: no change in this update.",
    ],
  },
  {
    id: "unlimited",
    date: { y: 2026, m: 10, d: 8 }, // the release day (exported 08-10-2026)
    title: "Unlimited",
    items: [
      "Solved today's puzzle? Switch from Daily to Unlimited, beside the puzzle number, and solve random puzzles one after another, as many as you like.",
      "A stopwatch runs from your first key; it pauses while the page is hidden.",
      "Unlimited keeps its own stats in Stats & history, including your longest session and your best solves per hour.",
      "Your daily streak and history stay as they are.",
    ],
  },
  {
    id: "hub",
    date: { y: 2026, m: 10, d: 8 }, // the release day (live since 08-10-2026)
    title: "Urania's Mirror",
    items: [
      "Muldle is one of the daily sky puzzles of Urania's Mirror: the star top left takes you to all of them.",
      "When a puzzle is done, a line points you to the others, starting with Retractle.",
    ],
  },
  {
    id: "backspace",
    date: { y: 2026, m: 10, d: 7 },
    title: "Backspace stays in the game",
    items: [
      "In browsers set to go back a page on Backspace (Firefox can be), Backspace could take you off the game. Now it only ever clears tiles, in both modes.",
    ],
  },
  {
    id: "surveys",
    date: { y: 2026, m: 10, d: 6 },
    title: "Two more sky surveys",
    items: [
      "The sky view's survey picker adds Mellinger (MELL), a photo of the whole sky that suits the widest views, and Hubble (HST) for the fields it observed.",
    ],
  },
  {
    id: "v2",
    era: true,
    date: ERA_V2_START,
    title: "More catalogues",
    items: [
      "More catalogues: Messier, Caldwell, Melotte, Collinder and Barnard join NGC and IC.",
      "Each object counts once, under the id most people know (M31, Mel25, B33); its other ids point you there.",
      "No more leading zeros: NGC31, not NGC0031.",
      "Some days now feature famous objects (Messier, Caldwell, named ones).",
      "45 new names in ABC mode, from the Pleiades to the Coathanger.",
    ],
  },
  {
    id: "done-keys",
    date: { y: 2026, m: 10, d: 4 },
    title: "Completed keys",
    items: [
      "Once every copy of a letter or digit is found, its key turns dark green, in both modes.",
      "Prefer to work it out yourself? Turn off \"Mark completed keys\" in the settings.",
    ],
  },
  {
    id: "sky-fit",
    date: { y: 2026, m: 10, d: 3 },
    title: "The sky view fits the object",
    items: [
      "The sky view zooms to each object's real size, so large nebulae such as the Heart Nebula fit in.",
      "On a phone, a rotated sky view turns north up again.",
      "Hard mode: Enter accepts a row whose carried-over greens already spell the answer.",
    ],
  },
  {
    id: "hard-mode",
    date: { y: 2026, m: 10, d: 2 },
    title: "Stricter hard mode, other names",
    items: [
      "No repeats: a guess you already made is refused, in both modes.",
      "Hard mode: every guess must be one that could still be the answer; a character never goes back to a tile where it showed yellow or grey.",
      "After a solve, the reveal also lists the object's other names.",
      "Settings: random practice can pick a catalogue first, then an object in it.",
      "ABC: apostrophes and hyphens sit inside their word, so a name no longer looks broken there.",
    ],
  },
  {
    id: "cursor",
    date: { y: 2026, m: 10, d: 1 },
    title: "A typing cursor and two counters",
    items: [
      "A cursor tile: click a tile or use the arrow keys to move it and fix a typo in place.",
      "ID hard mode tells how many identifiers could still be the answer.",
      "ID counts your refused guesses (✖), in the share text too.",
    ],
  },
  {
    id: "stats",
    date: { y: 2026, m: 9, d: 23 },
    title: "Your stats",
    items: [
      "Stats per mode: games played, win %, streaks, your guess distribution and a history of your puzzles. They stay in your browser; nothing is sent.",
      "A finished puzzle shows your stats where the keyboard was.",
      "Hard mode refuses a greyed-out character as you type it.",
      "ABC mode counts its own puzzle numbers.",
    ],
  },
  {
    id: "navigator",
    date: { y: 2026, m: 9, d: 22 },
    title: "Past puzzles, sharing, a countdown",
    items: [
      "Browse and play past puzzles by number with « and », each with its own link.",
      "Share your result as an emoji grid, in both modes.",
      "A countdown to the next daily puzzle.",
      "The reveal gives the object's common name, and the sky view's caption its constellation.",
    ],
  },
  {
    id: "fixes-0917",
    date: { y: 2026, m: 9, d: 17 },
    title: "Fixes",
    items: [
      "Firefox: flipping between ID and ABC no longer shows the other side through the card.",
      "Hard mode no longer accepts a character in a tile where it already showed yellow.",
    ],
  },
  {
    id: "abc",
    date: { y: 2026, m: 9, d: 16 },
    title: "ABC mode",
    items: [
      "ABC mode: guess the object's common name, such as Orion Nebula. Flip between ID and ABC by the title.",
      "The sky view gets a survey picker: see the object in visible light, ultraviolet, infrared or X-rays.",
    ],
  },
  {
    id: "launch",
    date: { y: 2026, m: 9, d: 9 },
    title: "Muldle launches",
    items: [
      "A daily puzzle: find the NGC or IC identifier in six guesses.",
      "Each guess shows the object's constellation, type and magnitude, and how far and in which direction the answer lies.",
      "After the puzzle, a sky view shows the object.",
      "Hard mode, on by default: green tiles carry over into the next row.",
    ],
  },
];
// Planned updates for On the horizon ({ id, title, items }, no date: plans,
// not promises). Only ones the user approved, in the user's words; one moves
// into UPDATES, dated, when it ships. Scheduled UPDATES (a date still to
// come) show there by themselves, before these.
const PLANNED = [
  {
    id: "omni", // approved by the user 08-10-2026
    title: "OMNI",
    items: ["A third mode where any identifier or name in the game can be the answer."],
  },
];
// the first update the start screen announced (it arrived with it): a
// returning player who never saw one missed it and every later one
const FIRST_ANNOUNCED = "v2";
const SEEN_KEY = "muldle-seen-v1";

const screenEl = document.getElementById("start-screen");
const sceneEl = document.getElementById("flip-scene");
const playBtn = document.getElementById("play-button");

const muldle = window.__muldle || {};
const mode = window.__muldleMode === "abc" ? "abc" : "id";
const started = muldle.started && muldle.started[mode] ? muldle.started[mode]() : true;
// game.js reads ?p before the flip's syncUrl drops a ?p that names today
const linked = !!muldle.linked;
// window.__muldleNoGate: e2e hook, so the game suites start on the board
if (started || linked || window.__muldleNoGate) return;

// the updates by date, newest first (a stable sort: ties keep the list's
// order); the started ones: the latest is What's new, the rest are Earlier
// updates; an era still to come goes On the horizon. An era has started by
// its switch's own test (game.js's daysBetween over local midnights); any
// other entry always has
const now = new Date();
const TODAY = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
const dateKey = u => u.date.y * 10000 + u.date.m * 100 + u.date.d;
const byDate = UPDATES.slice().sort((a, b) => dateKey(b) - dateKey(a));
const hasStarted = u => !u.era || daysBetween(u.date, TODAY) >= 0;
const startedUpdates = byDate.filter(hasStarted);
const update = startedUpdates[0];
const earlier = startedUpdates.slice(1);
const scheduled = byDate.filter(u => !hasStarted(u)).reverse(); // soonest first
let seenId = null;
try { seenId = localStorage.getItem(SEEN_KEY); } catch (e) { /* ignore */ }
// a returning player: any play history in either mode
function returning() {
  try {
    return ["muldle-results-v1", "muldle-abc-results-v1", "muldle-v1", "muldle-abc-v1"]
      .some(k => localStorage.getItem(k) !== null);
  } catch (e) { return false; }
}
// the earlier updates a returning player missed: every one newer than the
// last they saw (none seen: from the first the start screen announced on)
function missed() {
  if (!update || seenId === update.id || !returning()) return new Set();
  let i = earlier.findIndex(u => u.id === seenId);
  if (i < 0) i = earlier.findIndex(u => u.id === FIRST_ANNOUNCED) + 1;
  return new Set(earlier.slice(0, i).map(u => u.id));
}
const fmtDate = u => new Date(u.date.y, u.date.m - 1, u.date.d)
  .toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
function fillList(ul, items) {
  for (const text of items) {
    const li = document.createElement("li");
    li.textContent = text;
    ul.appendChild(li);
  }
  return ul;
}
// a title followed by its dim date (or "planned"), a space between so a
// screen reader doesn't run them together
function titled(el, title, when) {
  const span = document.createElement("span");
  span.className = "whats-new-date";
  span.textContent = when;
  el.append(title, " ", span);
  return el;
}
// The parts' elements, looked up first: a page cached from before this
// screen had three parts (GitHub Pages serves the new start.js under the old
// page's URLs for a few minutes after a release) lacks the new ones, and then
// those parts are skipped instead of the whole start screen.
const $ = id => document.getElementById(id);
const newsBox = $("whats-new"), newsDate = $("whats-new-date"), newsList = $("whats-new-list");
const newsTitle = $("whats-new-title");
const horizonBox = $("news-horizon"), horizonList = $("news-horizon-list");
const earlierBox = $("news-earlier"), earlierList = $("news-earlier-list");

document.getElementById("start-puzzle").textContent =
  `${mode === "abc" ? "ABC" : "ID"} · Puzzle #${muldle.today ? muldle.today[mode] : ""}`;

if (update && newsBox && newsList) {
  newsBox.dataset.id = update.id;
  if (newsDate) newsDate.textContent = fmtDate(update);
  if (newsTitle) newsTitle.textContent = update.title;
  fillList(newsList, update.items);
  newsBox.open = seenId !== update.id;
  newsBox.hidden = false;
}
const horizon = scheduled.map(u => ({ id: u.id, title: u.title, when: "from " + fmtDate(u), items: u.items }))
  .concat(PLANNED.map(p => ({ id: p.id, title: p.title, when: "planned", items: p.items || [] })));
if (horizon.length && horizonBox && horizonList) {
  for (const h of horizon) {
    const entry = document.createElement("div");
    entry.className = "news-entry";
    entry.dataset.id = h.id;
    const head = document.createElement("p");
    head.className = "news-title";
    entry.appendChild(titled(head, h.title, h.when));
    if (h.items.length) entry.appendChild(fillList(document.createElement("ul"), h.items));
    horizonList.appendChild(entry);
  }
  horizonBox.hidden = false;
}
if (earlier.length && earlierBox && earlierList) {
  const open = missed();
  for (const u of earlier) {
    const entry = document.createElement("details");
    entry.className = "news-entry";
    entry.dataset.id = u.id;
    entry.open = open.has(u.id);
    entry.appendChild(titled(document.createElement("summary"), u.title, fmtDate(u)));
    entry.appendChild(fillList(document.createElement("ul"), u.items));
    earlierList.appendChild(entry);
  }
  earlierBox.open = open.size > 0;
  earlierBox.hidden = false;
}

// while the gate is up, keys belong to it: Enter or Space plays (unless they
// work the What's new toggle), nothing reaches the boards (game.js and abc.js
// listen on document; this capture listener on window runs first)
function onKey(e) {
  const own = e.target && e.target.closest && e.target.closest("summary, a");
  if ((e.key === "Enter" || e.key === " ") && !own) { e.preventDefault(); play(true); }
  e.stopImmediatePropagation();
}

// after Play, a held Enter/Space keeps auto-repeating: those repeats belong
// to the press that played, not to the board, until the key comes up
function onRepeat(e) {
  if (e.repeat) e.stopImmediatePropagation();
}
function onKeyUp() {
  window.removeEventListener("keydown", onRepeat, true);
  window.removeEventListener("keyup", onKeyUp, true);
}

function play(byKey) {
  if (screenEl.hidden) return;
  window.removeEventListener("keydown", onKey, true);
  if (byKey) {
    window.addEventListener("keydown", onRepeat, true);
    window.addEventListener("keyup", onKeyUp, true);
  }
  if (update) { try { localStorage.setItem(SEEN_KEY, update.id); } catch (e) { /* ignore */ } }
  screenEl.hidden = true;
  sceneEl.hidden = false;
  window.scrollTo(0, 0);
}

sceneEl.hidden = true;
screenEl.hidden = false;
window.addEventListener("keydown", onKey, true);
playBtn.addEventListener("click", () => play(false));
playBtn.focus();
})();
