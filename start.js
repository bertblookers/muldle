// SPDX-License-Identifier: AGPL-3.0-only
// Start screen: a landing state with a Play button and a short "What's new"
// list for the latest major update. One gate for both modes, outside the flip.
// Shown on load only for a fresh puzzle (no guess yet in the active mode): a
// puzzle in progress or finished goes straight to the board, and so does a
// ?p=N link (it already names the puzzle). Whether this browser has seen an
// update's list is remembered per update (muldle-seen-v1, local only, nothing
// is sent anywhere): unseen, the list starts open; seen, it starts folded. A
// returning player (one with play history) who missed earlier updates gets
// their lists too, under "Earlier"; a new player only the latest.
// Loaded after game.js and abc.js, which register window.__muldle.started.
(function () {
"use strict";

// The latest major updates, newest first, each shown from its date on (local
// midnight; an era's update uses its switch date from game.js, so moving the
// switch moves the list too). Keep each to at most 4-5 one-line items.
const WHATS_NEW = [
  {
    id: "abc-v3",
    date: ERA_ABC_V3_START,
    items: [
      "ABC mode reaches beyond deep-sky objects: constellations, bright stars, asterisms and famous objects outside the catalogues.",
      "Two days a week the ABC answer is one of them; the other five stay deep-sky.",
      "The sky view draws a constellation's borders and an asterism's figure.",
      "ID mode: no change in this update.",
    ],
  },
  {
    id: "v2",
    date: ERA_V2_START,
    items: [
      "More catalogues: Messier, Caldwell, Melotte, Collinder and Barnard join NGC and IC.",
      "Each object counts once, under the id most people know (M31, Mel25, B33); its other ids point you there.",
      "No more leading zeros: NGC31, not NGC0031.",
      "Some days now feature famous objects (Messier, Caldwell, named ones).",
      "45 new names in ABC mode, from the Pleiades to the Coathanger.",
    ],
  },
];
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

// the updates that have started (local date), newest first; the latest one
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const startedUpdates = WHATS_NEW.filter(u => new Date(u.date.y, u.date.m - 1, u.date.d) <= today);
const update = startedUpdates[0];
let seenId = null;
try { seenId = localStorage.getItem(SEEN_KEY); } catch (e) { /* ignore */ }
// a returning player: any play history in either mode
function returning() {
  try {
    return ["muldle-results-v1", "muldle-abc-results-v1", "muldle-v1", "muldle-abc-v1"]
      .some(k => localStorage.getItem(k) !== null);
  } catch (e) { return false; }
}
// the updates to list: the latest, plus for a returning player every earlier
// one newer than the last seen (all of them if none was seen)
function updatesToShow() {
  if (!update || seenId === update.id || !returning()) return update ? [update] : [];
  const i = startedUpdates.findIndex(u => u.id === seenId);
  return startedUpdates.slice(0, i < 0 ? startedUpdates.length : i);
}
const fmtDate = u => new Date(u.date.y, u.date.m - 1, u.date.d)
  .toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

document.getElementById("start-puzzle").textContent =
  `${mode === "abc" ? "ABC" : "ID"} · Puzzle #${muldle.today ? muldle.today[mode] : ""}`;

if (update) {
  const box = document.getElementById("whats-new");
  document.getElementById("whats-new-date").textContent = fmtDate(update);
  const list = document.getElementById("whats-new-list");
  updatesToShow().forEach((u, k) => {
    if (k) {
      const head = document.createElement("li");
      head.className = "whats-new-earlier";
      head.textContent = "Earlier, " + fmtDate(u) + ":";
      list.appendChild(head);
    }
    for (const text of u.items) {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    }
  });
  box.open = seenId !== update.id;
  box.hidden = false;
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
