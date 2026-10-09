// SPDX-License-Identifier: AGPL-3.0-only
// Unlimited, shared by ID mode (game.js) and ABC mode (abc.js). Once a mode's
// daily is finished today, won or lost (or an older daily, finished today
// through the navigator; user, 09-10-2026), its Daily | Unlimited toggle
// shows. Unlimited plays random
// puzzles of today's pool one after another: a finished one loads the next at
// once. Each mode has its own Unlimited; its board and puzzle live in the
// mode's file, and this module holds what both share:
//   - the gate: today's daily finished (the mode's finishedToday), or a
//     numbered puzzle finished live today (unlock);
//   - the session: a fresh random seed on every entry and its draw sequence
//     (makeDrawer, following the practice weighting, never a daily object of
//     today in either mode: setDaily, isDaily), and a stopwatch that
//     starts at the first key and runs only while the page is visible and the
//     mode's face is showing. A session ends only on leaving Unlimited, or when
//     a later load finds the gate closed (another day);
//   - the totals per mode and practice weighting, no row per puzzle: played,
//     won, guess distribution, longest session, best solves per hour over a
//     run of at least minRunMs; and their part of Stats & history;
//   - the growing star that carries the view in and out (starTransition).
// Daily results, streaks and history are never touched. Everything stays in
// this browser. A classic-script global loaded before game.js and abc.js;
// nothing here touches the DOM until a controller is shown on the page (test
// sandboxes load it without one).
const MuldleUnlimited = (function () {
"use strict";

// muldle-unlimited-v1: { [mode]: session, unlocked: { [mode]: day } }
//   session: { seed, weighted, n (puzzles drawn), prev (the puzzle number to
//   go back to), puzzle (the mode's own save of the puzzle in play), ms (time
//   on the stopwatch), started, solves, lastT (ms at the last rate check),
//   owner (the page playing it: with two tabs, the last to resume or begin) }
// muldle-unlimited-stats-v1: { "<mode>:any" | "<mode>:weighted": totals }
//   totals: { played, won, dist, longestMs, bestRate (solves per hour) }
const STATE_KEY = "muldle-unlimited-v1";
const STATS_KEY = "muldle-unlimited-stats-v1";
const MODE_KEY = "muldle-mode-v1";
const HOUR = 3600000;

function readJSON(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* full: the session goes on unsaved */ }
}

/* ---- the draw sequence ---- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, seed) {
  const arr = list.slice();
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// A session's puzzles: each draw picks a group (each equally likely; a flat
// draw is one group of every item), then that group's next item in its own
// seeded shuffle, wrapping, so a group repeats nothing until it has shown
// everything. Items skip() refuses never come (today's daily answer). The same
// seed gives the same sequence, so a reloaded session goes on where it was.
function makeDrawer(seed, groups, skip = () => false) {
  const rand = mulberry32(seed);
  const gs = groups
    .map((g, i) => shuffled(g.filter(x => !skip(x)), (seed + Math.imul(i + 1, 0x9E3779B1)) >>> 0))
    .filter(g => g.length);
  const cursors = gs.map(() => 0);
  const drawn = [];
  function draw() {
    const g = gs.length > 1 ? Math.floor(rand() * gs.length) : 0;
    return gs[g][cursors[g]++ % gs[g].length];
  }
  return {
    // the n-th puzzle of the session (0 = the first)
    at(n) {
      if (!gs.length) return undefined;
      while (drawn.length <= n) drawn.push(draw());
      return drawn[n];
    },
  };
}

function freshSeed() {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
  } catch (e) {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
}

/* ---- the stopwatch's numbers ---- */

// The best rate (solves per hour) a session reached between two checks, at
// times t0 < t (ms on its stopwatch), counting only moments when it had run at
// least minMs: solves / time is highest either when the run reaches minMs or
// right after a solve, so those are the moments checked. `before` and `after`
// are the solves just before and at t (equal unless t is a solve). 0: none.
function bestRate(t0, t, before, after, minMs) {
  let best = 0;
  if (t0 < minMs && t >= minMs && minMs > 0) best = (before / minMs) * HOUR;
  if (t >= minMs && t > 0) best = Math.max(best, (after / t) * HOUR);
  return best;
}

// 0:07, 12:34, 1:02:03
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = n => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

const nonNeg = v => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const count = v => (Number.isInteger(v) && v > 0 ? v : 0);

// a stored totals entry, sanitised (absent or corrupt: zeros)
function normTotals(t, maxGuesses) {
  t = t && typeof t === "object" ? t : {};
  const dist = Array.from({ length: maxGuesses }, (_, i) => count(Array.isArray(t.dist) ? t.dist[i] : 0));
  return { played: count(t.played), won: count(t.won), dist, longestMs: nonNeg(t.longestMs), bestRate: nonNeg(t.bestRate),
    timedMs: nonNeg(t.timedMs), timedSolves: count(t.timedSolves) };
}

// a stored session, sanitised, or null if it isn't one
function normSession(s) {
  if (!s || typeof s !== "object" || !Number.isInteger(s.seed)) return null;
  return {
    seed: s.seed >>> 0, weighted: s.weighted === true, n: count(s.n),
    prev: Number.isInteger(s.prev) ? s.prev : null,
    puzzle: s.puzzle && typeof s.puzzle === "object" ? s.puzzle : null,
    ms: nonNeg(s.ms), started: s.started === true, solves: count(s.solves), lastT: nonNeg(s.lastT),
    // time already counted in the time-spent total; a session saved before
    // that total existed counts from where it was (its earlier time no)
    timedAt: Number.isFinite(s.timedAt) && s.timedAt >= 0 ? s.timedAt : nonNeg(s.ms),
  };
}

/* ---- where the page is ---- */

function visible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}
// the face a load shows: the one saved last time (muldle-mode-v1), except
// that a ?p=N link opens on ID's face when OMNI was saved, OMNI having no
// numbered puzzles (release 2's review, R2-2). flip.js shows it; game.js and
// abc.js ask it before flip.js has run (which face takes the link).
function faceOnLoad() {
  let m = null;
  try { m = localStorage.getItem(MODE_KEY); } catch (e) { /* ignore */ }
  if (m === "abc" || m === "id") return m;
  if (m !== "omni") return "id";
  try { if (new URLSearchParams(location.search).has("p")) return "id"; } catch (e) { /* ignore */ }
  return "omni";
}
// the face showing (flip.js sets window.__muldleMode; before it has run, the
// face the load will show)
function activeMode() {
  if (typeof window !== "undefined" && window.__muldleMode) return window.__muldleMode;
  return faceOnLoad();
}

const controllers = [];
// the page's visibility or the face changed: every stopwatch runs or pauses
function syncAll() { for (const c of controllers) c.sync(); }

// Every mode's daily object today (the objects its answer names), so that no
// mode's Unlimited serves a daily the player may not have played yet: ID
// Unlimited never draws today's ABC object, ABC Unlimited never today's ID
// object, and each never its own. game.js and abc.js register theirs as they
// load; a new registration rebuilds the draws and lets each mode check the
// puzzle it shows (recheck).
const dailyObjects = {};
function setDaily(mode, objects) {
  dailyObjects[mode] = new Set(objects);
  for (const c of controllers) c.dailyChanged();
}
function isDaily(object) {
  return Object.values(dailyObjects).some(set => set.has(object));
}

// this page's mark on the sessions it plays: with two tabs on one mode, the
// one that resumed or began a session last plays on, the other lets go
const PAGE = freshSeed().toString(36);

/* ---- one mode's Unlimited ---- */

// mode         "id" | "abc" | "omni" | "mini": the session's key and stats
// face         the face it plays on (default: mode; Mini's is OMNI's)
// title        what Stats & history calls it (default "Unlimited")
// today        the mode's puzzle number of today
// minRunMs     a run counts for the best rate from this long on
// maxGuesses   rows per puzzle (the distribution's length)
// finishedToday  () => true once today's daily is finished, won or lost
//              (the results store)
// groups       (weighted) => arrays of items to draw from (practice weighting)
// skip         (item) => true for an item never to draw (a daily object,
//              isDaily)
// labels       { any, weighted }: the weightings as Stats & history names them
// liveDay      () => the mode's puzzle number of the clock's day now; once it
//              passes `today`, the page's day is over (stale)
// recheck      optional () => void: the daily objects changed (another mode
//              registered), so the mode checks the puzzle it shows
// onLost       optional (ended) => void: another tab took this session over
//              (ended false) or ended it (ended true); it is gone here, and
//              the mode shows its daily
function create({ mode, face = mode, title = "Unlimited", today, minRunMs, maxGuesses, finishedToday, groups, skip, labels,
  liveDay, recheck, onLost }) {
  let live = null;    // the session while this mode is in Unlimited (also stored)
  let drawer = null;  // its draw sequence
  let since = null;   // Date.now() when the stopwatch last started running, else null
  let timer = null;   // the clock's once-a-second refresh while it runs
  let clockEl = null; // where the clock shows (setClock)

  const stored = () => readJSON(STATE_KEY);
  function persist() {
    const s = stored();
    if (live) s[mode] = { ...live, owner: PAGE }; else delete s[mode];
    writeJSON(STATE_KEY, s);
  }
  // the draws, built for the first puzzle needed (by then every mode has
  // registered its daily object)
  function draws() {
    if (!drawer) drawer = makeDrawer(live.seed, groups(live.weighted), skip);
    return drawer;
  }
  // the session leaves this page without a write: another tab has it, or
  // ended it (ended: true)
  function letGo(ended) {
    since = null;
    if (timer) { clearInterval(timer); timer = null; }
    live = null;
    drawer = null;
    show();
    if (onLost) onLost(ended);
  }
  // fold the running stretch into live.ms
  function bank() {
    if (since === null) return;
    const now = Date.now();
    live.ms += Math.max(0, now - since);
    since = now;
  }
  const elapsed = () => (live ? live.ms + (since === null ? 0 : Math.max(0, Date.now() - since)) : 0);

  const bucket = weighted => mode + ":" + (weighted ? "weighted" : "any");
  // add to the session's totals (its weighting's)
  function addTotals(fn) {
    const all = readJSON(STATS_KEY), k = bucket(live.weighted);
    const t = normTotals(all[k], maxGuesses);
    fn(t);
    all[k] = t;
    writeJSON(STATS_KEY, all);
  }
  // a check of the session's time so far: its best rate since the last check
  // and its length go into the totals
  // (and the time since the last check goes into the time-spent total)
  function check(before, after) {
    const t = live.ms, rate = bestRate(live.lastT, t, before, after, minRunMs), dt = Math.max(0, t - live.timedAt);
    live.lastT = t;
    live.timedAt = t;
    return tot => {
      if (rate > tot.bestRate) tot.bestRate = rate;
      if (t > tot.longestMs) tot.longestMs = t;
      tot.timedMs += dt;
    };
  }

  function show() {
    if (!clockEl) return;
    clockEl.hidden = !live;
    if (!live) return;
    clockEl.textContent = `${fmtClock(elapsed())} · ${live.solves} solved`;
    clockEl.title = live.started ? "This Unlimited session's time, paused while the page is hidden"
      : "The stopwatch starts at your first key";
    clockEl.classList.toggle("waiting", !live.started);
  }

  // run the stopwatch exactly while the session has started, the page is
  // visible and this mode's face shows; a pause checks the rate and saves
  function sync() {
    const run = !!live && live.started && visible() && activeMode() === face;
    if (run && since === null) {
      since = Date.now();
      if (clockEl && !timer) timer = setInterval(show, 1000);
    } else if (!run && since !== null) {
      bank();
      since = null;
      if (live.ms > live.lastT) addTotals(check(live.solves, live.solves));
      persist();
    }
    if (!run && timer) { clearInterval(timer); timer = null; }
    show();
  }

  const ctl = {
    mode,
    face,
    get on() { return !!live; },
    // the puzzle number to go back to on leaving
    get prev() { return live ? live.prev : null; },
    get weighted() { return !!live && live.weighted; },
    get session() { return live ? { ms: elapsed(), solves: live.solves, started: live.started, n: live.n, seed: live.seed } : null; },
    gateOpen() {
      if (ctl.stale()) return false; // a new day: this page's daily is over
      const u = stored().unlocked;
      return !!(u && u[mode] === today) || !!finishedToday();
    },
    // midnight has passed since the page loaded: its day, answers and pool
    // are yesterday's
    stale() { return !!liveDay && liveDay() !== today; },
    // whether an item is one the draws never serve (a daily object)
    skips(item) { return !!skip(item); },
    // a numbered puzzle was just finished live, won or lost: Unlimited is
    // open today. A page past midnight writes nothing: its day is yesterday,
    // and a fresh tab's unlock of today stays (release 2.1's review, A2)
    unlock() {
      if (ctl.stale()) return;
      const s = stored();
      s.unlocked = Object.assign({}, s.unlocked, { [mode]: today });
      writeJSON(STATE_KEY, s);
    },
    // the saved session, if this mode was in Unlimited: it goes on (returns
    // the mode's save of its puzzle, or null for a fresh draw). One the gate
    // no longer allows (another day) ends here, its time counted. undefined:
    // no session.
    restore() {
      // a page past midnight leaves the store alone: the session there may be
      // one a fresh tab plays today (the re-check's R2); the page shows the
      // new day instead
      if (ctl.stale()) return undefined;
      const raw = stored()[mode];
      if (raw === undefined) return undefined;
      live = normSession(raw);
      if (!live) { persist(); return undefined; } // corrupt: dropped
      if (!ctl.gateOpen()) { ctl.end(); return undefined; }
      drawer = null;
      persist(); // this page plays it now (a tab that had it lets go)
      sync();
      return live.puzzle;
    },
    // enter Unlimited: a new session with a fresh seed
    begin(weighted, prev) {
      if (live) ctl.end();
      live = { seed: freshSeed(), weighted: !!weighted, n: 0, prev: Number.isInteger(prev) ? prev : null,
        puzzle: null, ms: 0, started: false, solves: 0, lastT: 0, timedAt: 0 };
      drawer = null;
      persist();
      sync();
    },
    // the session's next puzzle
    next() {
      const item = draws().at(live.n);
      live.n++;
      live.puzzle = null;
      persist();
      return item;
    },
    // the mode's save of the puzzle in play (its guesses so far)
    savePuzzle(p) {
      if (!live) return;
      live.puzzle = p;
      bank();
      persist();
    },
    // a key was pressed on the board: the stopwatch starts at the first
    key() {
      if (!live || live.started) return;
      live.started = true;
      persist();
      sync();
    },
    // a puzzle of the session is over: into the totals
    finish(won, tries) {
      if (!live) return;
      bank();
      const before = live.solves;
      if (won) live.solves++;
      const rec = check(before, live.solves);
      addTotals(tot => {
        tot.played++;
        if (won) {
          tot.won++;
          tot.timedSolves++;
          if (tries >= 1 && tries <= maxGuesses) tot.dist[tries - 1]++;
        }
        rec(tot);
      });
      persist();
      show();
    },
    // leave Unlimited: the session ends, its time counted
    end() {
      if (!live) return;
      bank();
      since = null;
      if (timer) { clearInterval(timer); timer = null; }
      if (live.ms > 0) addTotals(check(live.solves, live.solves));
      live = null;
      drawer = null;
      persist();
      show();
    },
    // the page is closing: keep the time so far
    save() {
      if (live && since !== null) { bank(); persist(); }
    },
    // another tab wrote the sessions: if this one is no longer this page's,
    // let go of it (writing nothing, so the other tab's stays as it is)
    claimed() {
      if (!live) return;
      const s = stored()[mode];
      if (!s) letGo(true);                  // another tab ended it
      else if (s.owner !== PAGE) letGo(false); // another tab plays it now
    },
    // a mode registered its daily object: later draws skip it too
    dailyChanged() {
      drawer = null;
      if (live && recheck) recheck();
    },
    setClock(el) { clockEl = el; sync(); },
    sync,
    // one weighting's totals, the session in play counted in its length
    totals(weighted) {
      const t = normTotals(readJSON(STATS_KEY)[bucket(weighted)], maxGuesses);
      if (live && live.weighted === !!weighted) t.longestMs = Math.max(t.longestMs, elapsed());
      return t;
    },
    // Clear history & stats: the mode's totals go, and so does today's
    // unlock (the cleared daily is fresh again, so the gate follows it)
    clearStats() {
      const all = readJSON(STATS_KEY);
      delete all[bucket(false)];
      delete all[bucket(true)];
      writeJSON(STATS_KEY, all);
      const s = stored();
      if (s.unlocked && mode in s.unlocked) {
        delete s.unlocked[mode];
        writeJSON(STATE_KEY, s);
      }
    },
    // Unlimited's part of Stats & history: the current weighting's totals,
    // then the other's if it has any. Nothing before the first session.
    renderStats(container, weightedNow) {
      const blocks = [!!weightedNow, !weightedNow]
        .map(w => ({ w, t: ctl.totals(w) }))
        .filter(({ w, t }) => t.played > 0 || t.longestMs > 0 || (live && live.weighted === w));
      if (!blocks.length) return;
      for (const { w, t } of blocks) {
        const h = document.createElement("h3");
        h.className = "unlimited-stats-head";
        h.textContent = `${title} · ${labels[w ? "weighted" : "any"]}`;
        const tiles = document.createElement("div");
        tiles.className = "stats-tiles unlimited-tiles";
        tiles.append(
          MuldleStats.statTile("Played", t.played),
          MuldleStats.statTile("Win %", t.played ? Math.round((100 * t.won) / t.played) : 0),
          MuldleStats.statTile("Longest", t.longestMs ? fmtClock(t.longestMs) : "–"),
          MuldleStats.statTile("Best / hour", t.bestRate ? t.bestRate.toFixed(1) : "–"),
          MuldleStats.statTile("Avg / solve", t.timedSolves ? fmtClock(t.timedMs / t.timedSolves) : "–"),
        );
        container.append(h, tiles, MuldleStats.distBlock(t.dist));
      }
      const note = document.createElement("p");
      note.className = "stats-note unlimited-note";
      note.textContent = `Best / hour: your most solves per hour over a run of at least ${Math.round(minRunMs / 60000)} minutes. ` +
        "Avg / solve: your stopwatch time divided by your solves, the time of puzzles you lost included.";
      container.appendChild(note);
    },
  };
  controllers.push(ctl);
  return ctl;
}

// a mode's controller (OMNI's gate asks ID's and ABC's)
function controller(mode) {
  return controllers.find(c => c.mode === mode) || null;
}

// The time-spent totals (counted from release 2 on): per mode and weighting,
// the stopwatch's time and the solves in it, so the average solve time is
// timedMs / timedSolves: players see it in Stats & history ("Avg / solve",
// user 09-10-2026), the Developer section lists every bucket; Q6's minimum
// runs recalibrate from it.
// A solve in Unlimited shows (user, 08-10-2026): the reveal line glows gold
// for a moment and the clock's "n solved" pops (style.css, .celebrate). Only
// a solve played now calls it, never a load or a resume; with reduced motion
// the reveal shows without the animation, and no class waits for an end that
// never comes (the re-check's R4). celebrations counts them (tests).
let celebrations = 0;
const celebrateEnds = new WeakMap(); // each element's one listener for its animation's end
function celebrate(...els) {
  celebrations++;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of els) {
    if (!el) continue;
    el.classList.remove("celebrate");
    void el.offsetWidth; // a solve right after another plays it again
    el.classList.add("celebrate");
    if (celebrateEnds.has(el)) continue;
    // its own animation's end, not one bubbling up from inside it (nor the
    // cancel a restart fires, which would take the new one's class away)
    const done = ev => { if (ev.target === el) el.classList.remove("celebrate"); };
    celebrateEnds.set(el, done);
    el.addEventListener("animationend", done);
  }
}

function averages() {
  return Object.entries(readJSON(STATS_KEY))
    .map(([bucket, t]) => ({ bucket, ms: nonNeg(t && t.timedMs), solves: count(t && t.timedSolves) }))
    .filter(a => a.ms > 0 || a.solves > 0);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", syncAll);
  window.addEventListener("pagehide", () => { for (const c of controllers) c.save(); });
  // another tab wrote the sessions (or cleared the storage)
  window.addEventListener("storage", e => {
    if (e.key === STATE_KEY || e.key === null) for (const c of controllers) c.claimed();
  });
}

/* ---- the growing star ---- */

const STAR_POINTS = 8;     // like MUL 𒀯
const STAR_INNER = 0.5;    // inner corners at half the tips' radius
const STAR_MS = 900;
const STAR_STEPS = 30;

// the corners of an eight-pointed star of tip radius r round (cx, cy), a tip up
function starCorners(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 2 * STAR_POINTS; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / STAR_POINTS, d = i % 2 ? r * STAR_INNER : r;
    pts.push([cx + d * Math.cos(a), cy + d * Math.sin(a)]);
  }
  return pts;
}
const px = ([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`;
// the star as a clip-path
function starClip(cx, cy, r) {
  return `polygon(${starCorners(cx, cy, r).map(px).join(", ")})`;
}
// everything of a w x h screen outside the star
function outsideClip(w, h, cx, cy, r) {
  const s = starCorners(cx, cy, r);
  return `polygon(evenodd, 0px 0px, ${w}px 0px, ${w}px ${h}px, 0px ${h}px, 0px 0px, ${s.map(px).join(", ")}, ${px(s[0])})`;
}

// The star's frames: inside it the Unlimited view, outside it the other one,
// between them the star's thick border (the image pair's background, see
// style.css). Entering, it grows from the centre (slowly, then faster) until
// its inner corners pass the screen's corners; leaving is the same, played
// backwards. r = the tips' radius of the inside, `border` the extra radius of
// the outside's edge: the outside's star is the inside's scaled up, so the
// border is `border` wide at the tips and about a third of it across the
// edges (8-13 px on a phone or a laptop)
function starFrames(dir, w, h) {
  const cx = w / 2, cy = h / 2;
  const border = Math.max(24, Math.min(w, h) * 0.05);
  const rMax = (Math.hypot(w, h) / 2 + border) / STAR_INNER + 2;
  const inside = [], outside = [];
  for (let i = 0; i <= STAR_STEPS; i++) {
    const p = i / STAR_STEPS, g = dir === "in" ? p * p : (1 - p) * (1 - p);
    const r = rMax * g, b = Math.min(border, r * 0.5 + 1);
    inside.push({ offset: p, clipPath: starClip(cx, cy, r) });
    outside.push({ offset: p, clipPath: outsideClip(w, h, cx, cy, r + b) });
  }
  return { inside, outside };
}

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// The star runs only where it was checked: Chromium (navigator.userAgentData
// is Chromium's own). Firefox has view transitions since 144, but in tests it
// ignored the clip and painted the border colour over both views (a solid
// gold screen for the whole transition); Safari is unchecked. Elsewhere the
// views swap at once.
function starEngine() {
  const ua = typeof navigator !== "undefined" && navigator.userAgentData;
  return typeof document.startViewTransition === "function" &&
    !!(ua && Array.isArray(ua.brands) && ua.brands.some(b => /Chromium/.test(b.brand)));
}

// Swap the view (update) inside a star: "in" grows it from the screen's centre
// until it is off screen, the new view inside it and the previous one outside;
// "out" shrinks it back to the centre, the old view (Unlimited) inside it and
// the new one outside. Built on a view transition (the browser's snapshots of
// both views); with reduced motion, or a browser without view transitions,
// the views swap at once (starEngine). Resolves once update has run.
function starTransition(dir, update) {
  const root = document.documentElement;
  if (reducedMotion() || !starEngine()) {
    update();
    return Promise.resolve();
  }
  let vt;
  root.dataset.star = dir;
  try {
    vt = document.startViewTransition(update);
  } catch (e) {
    delete root.dataset.star;
    update();
    return Promise.resolve();
  }
  const done = () => { if (root.dataset.star === dir) delete root.dataset.star; };
  vt.finished.then(done, done);
  vt.ready.then(() => {
    const { inside, outside } = starFrames(dir, window.innerWidth, window.innerHeight);
    const opts = { duration: STAR_MS, easing: "linear", fill: "both" };
    const newer = "::view-transition-new(root)", older = "::view-transition-old(root)";
    root.animate(inside, { ...opts, pseudoElement: dir === "in" ? newer : older });
    root.animate(outside, { ...opts, pseudoElement: dir === "in" ? older : newer });
  }).catch(() => { /* skipped (another transition, a hidden page): the views just swap */ });
  return vt.updateCallbackDone.catch(() => {});
}

return { create, makeDrawer, bestRate, fmtClock, normTotals, normSession, starCorners, starFrames,
  starTransition, starEngine, sync: syncAll, setDaily, isDaily, controller, averages, faceOnLoad, celebrate,
  get celebrations() { return celebrations; }, STATE_KEY, STATS_KEY };
})();
