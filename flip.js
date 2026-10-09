// SPDX-License-Identifier: AGPL-3.0-only
// The flip between the three modes, ID | ABC | OMNI (#17 Q9; moved here from
// abc.js when OMNI came). The whole game is a card, #flipper, with three
// faces: ID at its front, ABC behind it about the vertical axis, OMNI behind
// ABC about the horizontal axis. The flipper's pose is always
// rotateY(a) rotateX(b) (style.css): ID (0, 0), ABC (180, 0), OMNI (180, 180),
// so ID-ABC turns about the vertical axis (ID->ABC swings the left edge
// towards the viewer; ABC->ID replays it), ABC-OMNI about the horizontal one,
// and ID-OMNI runs both legs, ID, ABC, OMNI, each at double speed.
//
// We do not rely on backface-visibility to hide the faces turned away:
// Firefox/LibreWolf don't cull the backface here. Every face but the one
// shown is hidden outright (.face-back), and during a leg the swap waits for
// the leg's midpoint (.flip-anim, --flip-ms), when the card is edge-on.
// The face shown flows (.face-active, its height drives the card's); the
// others are inert. window.__muldleMode names it; muldle-mode-v1 keeps it.
(function () {
"use strict";

const flipper = document.getElementById("flipper");
const FACES = {
  id: document.getElementById("face-id"),
  abc: document.getElementById("face-abc"),
  omni: document.getElementById("face-omni"),
};
const ORDER = ["id", "abc", "omni"]; // each next one is one leg away
const MODE_KEY = "muldle-mode-v1";
const LEG_MS = 850;

let mode = "id";   // the face shown, or being flipped to
let at = "id";     // the face the flipper's pose shows (between legs)
let legTo = null;  // the leg running, if one is
let legTimer = null;
let legMs = LEG_MS; // this flip's leg length: set once per flip, as it starts

function setInert(el, on) {
  el.inert = on;
  if (on) el.setAttribute("aria-hidden", "true");
  else el.removeAttribute("aria-hidden");
}

function pose(m) {
  flipper.classList.toggle("flipped", m !== "id");
  flipper.classList.toggle("flipped-x", m === "omni");
}

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// the next leg towards `mode`, at the flip's speed (legMs)
function runLeg() {
  const i = ORDER.indexOf(at), j = ORDER.indexOf(mode);
  const next = ORDER[i + Math.sign(j - i)];
  const ms = legMs;
  flipper.style.setProperty("--flip-ms", ms + "ms");
  flipper.classList.add("flip-anim");
  // the incoming face shows and the outgoing one hides at the leg's midpoint
  // (.flip-anim's delay); the third stays hidden
  for (const [k, f] of Object.entries(FACES)) f.classList.toggle("face-back", k !== next);
  legTo = next;
  pose(next);
  clearTimeout(legTimer);
  legTimer = setTimeout(legDone, ms + 150); // in case transitionend never comes (a hidden tab)
}

function legDone() {
  if (legTo === null) return;
  clearTimeout(legTimer);
  at = legTo;
  legTo = null;
  if (at !== mode) runLeg();
  else { flipper.classList.remove("flip-anim"); settled(); }
}

// the face shown is still and upright (the last leg done, or no animation):
// its layout can be measured now (omni.js keeps the row being typed in view)
function settled() {
  window.dispatchEvent(new CustomEvent("muldle:settled", { detail: mode }));
}

flipper.addEventListener("transitionend", (e) => {
  if (e.target === flipper && e.propertyName === "transform") legDone();
});

// a phone turned (or a window made wider or narrower) gives the pinned dock
// another share of the screen: the face shown measures again, as when it
// settles (release 2.1's review, B3). Width changes only: Chrome on Android
// changes the height as its toolbar hides on a scroll, and a re-run then
// would pull a player reading the hints back to the row.
let lastWidth = window.innerWidth, resizeTimer = 0;
window.addEventListener("resize", () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!flipper.classList.contains("flip-anim")) settled(); }, 150);
});

// straight to a face: no animation
function settle(m) {
  clearTimeout(legTimer);
  legTo = null;
  flipper.classList.remove("flip-anim");
  flipper.classList.add("no-anim");
  for (const [k, f] of Object.entries(FACES)) f.classList.toggle("face-back", k !== m);
  pose(m);
  at = m;
  void flipper.offsetWidth;
  flipper.classList.remove("no-anim");
  settled();
}

function applyMode(m, animate) {
  mode = m;
  window.__muldleMode = m;
  // an Unlimited stopwatch runs only while its face shows
  MuldleUnlimited.sync();
  for (const [k, f] of Object.entries(FACES)) {
    f.classList.toggle("face-active", k === m);
    setInert(f, k !== m);
  }
  document.querySelectorAll(".mode-seg").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  if (animate && !reducedMotion()) {
    // a flip from rest of two legs (ID <-> OMNI) runs both at double speed,
    // so it takes one leg's time; the speed holds for the whole flip (it was
    // set per leg, and the second leg ran at full length: R2-7)
    if (legTo === null && at !== m) {
      legMs = Math.abs(ORDER.indexOf(m) - ORDER.indexOf(at)) > 1 ? LEG_MS / 2 : LEG_MS;
      runLeg();
    } // mid-leg, the next leg turns towards m at this flip's speed
  } else settle(m);
  // keep the shareable ?p= in sync with the face shown
  if (window.__muldle && window.__muldle.syncUrl) window.__muldle.syncUrl();
  // OMNI begins (or resumes) its session when it shows (omni.js)
  window.dispatchEvent(new CustomEvent("muldle:mode", { detail: m }));
}

function setMode(m) {
  if (m === mode || !FACES[m]) return;
  try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* ignore */ }
  applyMode(m, true);
}

document.querySelectorAll(".mode-seg").forEach(b =>
  b.addEventListener("click", () => { setMode(b.dataset.mode); b.blur(); }));

// the face saved last time; a ?p=N link opens on ID's face if OMNI was
// saved, since OMNI has no numbered puzzles (unlimited.js, faceOnLoad: the
// rule game.js and abc.js follow too; release 2's review, R2-2)
mode = MuldleUnlimited.faceOnLoad();
applyMode(mode, false);
})();
