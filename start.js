// SPDX-License-Identifier: AGPL-3.0-only
// Start screen: a landing state with a Play button and a short "What's new"
// list for the latest major update. One gate for both modes, outside the flip.
// Shown on load only for a fresh puzzle (no guess yet in the active mode): a
// puzzle in progress or finished goes straight to the board, and so does a
// ?p=N link (it already names the puzzle). Whether this browser has seen an
// update's list is remembered per update (muldle-seen-v1, local only, nothing
// is sent anywhere): unseen, the list starts open; seen, it starts folded.
// Loaded after game.js and abc.js, which register window.__muldle.started.
(function () {
"use strict";

// The latest major updates, newest first, each shown from its date on (local
// midnight; an era's update uses its switch date from game.js, so moving the
// switch moves the list too). Keep each to at most 4-5 one-line items.
const WHATS_NEW = [
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

// the latest update that has started (local date)
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const update = WHATS_NEW.find(u => new Date(u.date.y, u.date.m - 1, u.date.d) <= today);

document.getElementById("start-puzzle").textContent =
  `${mode === "abc" ? "ABC" : "ID"} · Puzzle #${muldle.today ? muldle.today[mode] : ""}`;

if (update) {
  const box = document.getElementById("whats-new");
  const d = new Date(update.date.y, update.date.m - 1, update.date.d);
  document.getElementById("whats-new-date").textContent =
    d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const list = document.getElementById("whats-new-list");
  for (const text of update.items) {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  }
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === update.id; } catch (e) { /* ignore */ }
  box.open = !seen;
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
