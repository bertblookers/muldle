// SPDX-License-Identifier: AGPL-3.0-only
// Local play history + stats, shared by ID mode (game.js) and ABC mode
// (abc.js). Each mode keeps its own results store, keyed by puzzle number:
//   { [day]: { guesses, solved, tries, playedOnDay, fmt, ... } }
// (ID entries also carry `rejected`). This is the only store that outlives a
// day rollover; each mode records a finished puzzle into it at finish time and
// migrates a stale finished daily on load. Everything stays in this browser;
// nothing is ever transmitted.
//
// What stays per mode: the entry's fields, which stored entries are off limits
// (`keep`, e.g. a foreign fmt), and the stats view's heading, keys to clear and
// jump-to-puzzle callback. What lives here: the store itself, the streak and
// totals, the pruning of impossible puzzle numbers and the Stats & history view.
// A classic-script global loaded before game.js and abc.js (test sandboxes
// prepend this file); nothing here touches the DOM until render() is called.
const MuldleStats = (function () {
"use strict";

function readStore(key) {
  try {
    const r = JSON.parse(localStorage.getItem(key));
    return r && typeof r === "object" ? r : {};
  } catch (e) { return {}; }
}

// Drop entries of puzzle numbers that can't legitimately exist — day > today
// (you can't have finished a future puzzle) or a bad key. This self-heals stale
// data left after a day→answer re-indexing (e.g. an epoch change), which would
// otherwise show impossible future numbers in stats/history. Used on the
// results and the archive stores.
function pruneFuture(key, today) {
  try {
    const store = JSON.parse(localStorage.getItem(key));
    if (!store || typeof store !== "object") return;
    let changed = false;
    for (const k of Object.keys(store)) {
      const d = Number(k);
      if (!Number.isInteger(d) || d < 0 || d > today) { delete store[k]; changed = true; }
    }
    if (changed) localStorage.setItem(key, JSON.stringify(store));
  } catch (e) { /* corrupt: leave it */ }
}

// Streaks count consecutive on-day dailies only (playedOnDay); an archive replay
// never extends a daily streak. A loss today breaks the streak; not having
// played today yet does not.
function currentStreak(store, today) {
  const t = store[today];
  if (t && t.playedOnDay && !t.solved) return 0;
  const start = (t && t.playedOnDay && t.solved) ? today : today - 1;
  let n = 0;
  for (let d = start; d >= 0; d--) {
    const e = store[d];
    if (e && e.playedOnDay && e.solved) n++; else break;
  }
  return n;
}

// Played / win % / distribution cover EVERY saved puzzle (dailies + archive
// replays), so they match the history list; only streaks are daily-only.
function summarize(store, today, maxGuesses) {
  const all = Object.keys(store).map(Number).filter(d => d >= 0 && d <= today && store[d]);
  const solved = all.filter(d => store[d].solved);
  const dist = new Array(maxGuesses).fill(0);
  for (const d of solved) {
    const t = store[d].tries;
    if (t >= 1 && t <= maxGuesses) dist[t - 1]++;
  }
  // max streak = longest run of consecutive on-day dailies solved
  const dailySolved = all.filter(d => store[d].playedOnDay && store[d].solved).sort((a, b) => a - b);
  let max = 0, run = 0, prev = null;
  for (const d of dailySolved) {
    run = (prev !== null && d === prev + 1) ? run + 1 : 1;
    if (run > max) max = run;
    prev = d;
  }
  const played = all.length, wins = solved.length;
  return {
    played, wins,
    winPct: played ? Math.round((100 * wins) / played) : 0,
    dist, cur: currentStreak(store, today), max,
  };
}

// one stat tile: big value over a small label (unlimited.js uses it too)
function statTile(label, value) {
  const t = document.createElement("div"); t.className = "stat-tile";
  const v = document.createElement("div"); v.className = "stat-val"; v.textContent = String(value);
  const l = document.createElement("div"); l.className = "stat-label"; l.textContent = label;
  t.append(v, l);
  return t;
}

// the guess distribution's bars: dist[i] = games solved in i + 1 tries, the
// bar of `current` tries highlighted (unlimited.js uses it too)
function distBlock(dist, current = null) {
  const box = document.createElement("div"); box.className = "stats-dist";
  const maxCount = Math.max(1, ...dist);
  dist.forEach((count, i) => {
    const row = document.createElement("div"); row.className = "dist-row";
    const num = document.createElement("span"); num.className = "dist-num"; num.textContent = String(i + 1);
    const bar = document.createElement("span"); bar.className = "dist-bar";
    if (i + 1 === current) bar.classList.add("current");
    bar.style.width = (count / maxCount) * 100 + "%";
    bar.textContent = String(count);
    row.append(num, bar);
    box.appendChild(row);
  });
  return box;
}

// One mode's results store and its Stats & history view.
//   key         localStorage key of the store
//   today       the mode's puzzle number of today (DAY)
//   maxGuesses  rows per puzzle (the distribution's length)
//   keep        (entry, day) => true if a stored entry must never be
//               overwritten (a live daily is canonical; a foreign fmt is newer
//               code's)
//   heading     the view's title ("Stats & history — ID")
//   alsoClear   keys the clear control drops besides the store: the archive,
//               and today's save so a finished daily isn't re-recorded on load
//   openPuzzle  (day) => void, a history row's click
//   extra       optional (container) => void: more of the mode's stats,
//               rendered before History in the dialog only (Unlimited's)
//   onClear     optional () => void, run by the clear control after it drops
//               the keys (Unlimited drops its totals of the mode)
function create({ key, today, maxGuesses, keep, heading, alsoClear, openPuzzle, extra, onClear }) {
  const load = () => readStore(key);

  // Record one finished puzzle. A kept entry is never overwritten — a live-daily
  // record (playedOnDay) is written once, not replaced by a later archive replay
  // or a reset-and-replay, so daily history and streaks stay stable. Re-recording
  // an unchanged entry (every load of a finished puzzle does) writes nothing.
  function record(day, entry) {
    const store = load(), cur = store[day];
    if (keep(cur, day)) return;
    if (JSON.stringify(cur) === JSON.stringify(entry)) return;
    store[day] = entry;
    try { localStorage.setItem(key, JSON.stringify(store)); } catch (e) { /* quota/full */ }
  }

  const stats = () => summarize(load(), today, maxGuesses);

  // Render the stats + history view into <container>. In the settings dialog
  // the clear control + privacy note are included; the inline post-game view
  // (below a finished board) passes includeClear:false to omit them.
  function render(container, { includeClear = true } = {}) {
    const s = stats();
    const store = load();
    container.replaceChildren();

    const h = document.createElement("h2"); h.textContent = heading;
    container.appendChild(h);

    const tiles = document.createElement("div"); tiles.className = "stats-tiles";
    tiles.append(
      statTile("Played", s.played),
      statTile("Win %", s.winPct),
      statTile("Streak", s.cur),
      statTile("Max streak", s.max),
    );
    container.appendChild(tiles);

    const distHead = document.createElement("h3"); distHead.textContent = "Guess distribution";
    container.appendChild(distHead);
    const t = store[today];
    const todayTries = (t && t.playedOnDay && t.solved) ? t.tries : null;
    container.appendChild(distBlock(s.dist, todayTries));

    if (includeClear && extra) extra(container);

    const histHead = document.createElement("h3"); histHead.textContent = "History";
    container.appendChild(histHead);
    const days = Object.keys(store).map(Number).filter(d => d <= today).sort((a, b) => b - a);
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
        row.addEventListener("click", () => openPuzzle(d));
        const swatch = document.createElement("span");
        swatch.className = "history-swatch " + (e.solved ? "solved" : "lost");
        const label = document.createElement("span"); label.className = "history-label";
        label.textContent = "Puzzle #" + d;
        const outcome = document.createElement("span"); outcome.className = "history-outcome";
        outcome.textContent = (e.solved ? e.tries : "X") + "/" + maxGuesses;
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

    // two-step clear (privacy / shared devices): first click arms, second wipes
    const clearBtn = document.createElement("button");
    clearBtn.type = "button"; clearBtn.className = "stats-clear";
    clearBtn.textContent = "Clear history & stats";
    let armed = false;
    clearBtn.addEventListener("click", () => {
      if (!armed) { armed = true; clearBtn.textContent = "Click again to clear — can't be undone"; clearBtn.classList.add("armed"); return; }
      try {
        for (const k of [key, ...alsoClear]) localStorage.removeItem(k);
      } catch (e) { /* ignore */ }
      if (onClear) onClear();
      render(container, { includeClear });
    });
    container.appendChild(clearBtn);
  }

  return { key, load, record, stats, render };
}

return { create, pruneFuture, currentStreak, summarize, statTile, distBlock };
})();
