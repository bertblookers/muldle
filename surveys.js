// SPDX-License-Identifier: AGPL-3.0-only
// Shared survey picker for the Aladin Lite object viewer. Both modes (game.js
// and abc.js) have their own duplicated viewer + aladin instance; this module
// keeps the single survey list and the picker/coverage logic in one place.
// Exposed as window.MuldleSurveys; loaded before game.js/abc.js.
(function () {
"use strict";

// Surveys offered as a stacked column of square buttons, DSS2 (the original
// default) first, then Mellinger, an all-sky optical mosaic that stays clean
// in views tens of degrees wide where DSS2 shows its plate seams (ABC suggests
// it for a wide constellation, see suggest below). `id` is an Aladin Lite HiPS id; `fullSky` surveys skip the
// coverage check (always enabled). Partial-sky surveys are greyed out where the
// shown object has no coverage (see updateCoverage). HiPS ids from the CDS
// registry: https://aladin.cds.unistra.fr/hips/list
const SURVEYS = [
  { key: "dss2",  label: "DSS2",  id: "P/DSS2/color",           fullSky: true  }, // optical (default)
  { key: "mell",  label: "MELL",  id: "P/Mellinger/color",      fullSky: true  }, // optical, wide views
  { key: "sdss",  label: "SDSS",  id: "P/SDSS9/color",          fullSky: false }, // optical, ~N. sky
  { key: "hst",   label: "HST",   id: "CDS/P/HST/color",        fullSky: false }, // Hubble, pointed fields
  { key: "galex", label: "GALEX", id: "P/GALEXGR6/AIS/color",   fullSky: false }, // UV
  { key: "2mass", label: "2MASS", id: "P/2MASS/color",          fullSky: true  }, // near-IR
  { key: "irac",  label: "IRAC",  id: "P/SPITZER/color",        fullSky: false }, // mid-IR (Spitzer, galactic)
  { key: "wise",  label: "WISE",  id: "P/allWISE/color",        fullSky: true  }, // mid-IR
  { key: "iris",  label: "IRIS",  id: "P/IRIS/color",           fullSky: true  }, // far-IR (IRAS)
  { key: "xmm",   label: "XMM",   id: "xcatdb/P/XMM/PN/color",  fullSky: false }, // X-ray, pointed
];

const DEFAULT_ID = SURVEYS[0].id;
const WIDE_ID = SURVEYS[1].id;
const COVERAGE_RADIUS_DEG = 0.1;
const coverageCache = new Map(); // "ra,dec" -> Set of covering HiPS ids (suffix-matched)

// One controller per picker element (per mode). Builds the buttons once, tracks
// the selected survey, and applies it to whatever aladin view is passed in.
function mount(pickerEl, getView) {
  if (!pickerEl) return null;
  if (pickerEl.__surveyController) return pickerEl.__surveyController;

  let currentId = DEFAULT_ID; // the survey shown
  // the survey wanted: the player's pick, else the latest suggestion. Kept
  // apart from the one shown, so a survey with no coverage at one object
  // (shown as DSS2 there) comes back where it has coverage
  let wantedId = DEFAULT_ID;
  let picked = false; // the player chose a survey this page-life: suggest() leaves it be
  const buttons = new Map(); // id -> <button>

  SURVEYS.forEach(function (s) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "survey-btn";
    btn.textContent = s.label;
    btn.title = s.label;
    btn.setAttribute("aria-pressed", s.id === currentId ? "true" : "false");
    if (s.id === currentId) btn.classList.add("active");
    btn.addEventListener("click", function () {
      if (btn.disabled || s.id === currentId) return;
      picked = true;
      wantedId = s.id;
      select(s.id);
      const view = getView && getView();
      if (view) view.setBaseImageLayer(s.id);
    });
    buttons.set(s.id, btn);
    pickerEl.appendChild(btn);
  });

  function select(id) {
    currentId = id;
    buttons.forEach(function (btn, bid) {
      const on = bid === id;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // the wanted survey, or DSS2 while it has no coverage here
  function usable() {
    const btn = buttons.get(wantedId);
    return btn && btn.disabled ? DEFAULT_ID : wantedId;
  }

  const controller = {
    current: usable,
    // the survey that suits the next view, unless the player picked one
    suggest: function (id) { if (!picked && buttons.has(id)) wantedId = id; },
    // show the wanted survey on a (re)used view; DSS2 if it is disabled (the
    // flags may still be the previous object's: setCoverage corrects it)
    apply: function (view) {
      if (!view) return;
      select(usable());
      view.setBaseImageLayer(currentId);
    },
    // enable/disable buttons from a Set of covering HiPS ids (null = all on),
    // then show the wanted survey if the new coverage changes what can be shown
    setCoverage: function (coveringIds) {
      SURVEYS.forEach(function (s) {
        const btn = buttons.get(s.id);
        const covered = s.fullSky || !coveringIds || idCovered(s.id, coveringIds);
        btn.disabled = !covered;
        btn.classList.toggle("disabled", !covered);
        btn.title = covered ? s.label : s.label + " — no coverage here";
      });
      const view = getView && getView();
      if (view && usable() !== currentId) {
        select(usable());
        view.setBaseImageLayer(currentId);
      }
    },
  };

  pickerEl.__surveyController = controller;
  return controller;
}

// registry ids carry an authority prefix (e.g. "CDS/P/DSS2/color"); match by
// suffix so our bare "P/DSS2/color" resolves
function idCovered(id, coveringIds) {
  if (coveringIds.has(id)) return true;
  const tail = id.indexOf("/") >= 0 ? id.slice(id.indexOf("/")) : id; // "/P/DSS2/color"
  let hit = false;
  coveringIds.forEach(function (cid) {
    if (cid === id || cid.endsWith(tail)) hit = true;
  });
  return hit;
}

// Query the CDS MOCServer for every HiPS covering this position, then grey out
// partial-sky surveys with no data here. Best-effort: on any failure, leave all
// enabled (fail open). Result cached per position.
function updateCoverage(controller, ra, dec) {
  if (!controller) return;
  const key = ra.toFixed(4) + "," + dec.toFixed(4);
  if (coverageCache.has(key)) { controller.setCoverage(coverageCache.get(key)); return; }
  const url = "https://alasky.cds.unistra.fr/MocServer/query?RA=" + ra +
    "&DEC=" + dec + "&SR=" + COVERAGE_RADIUS_DEG +
    "&intersect=overlaps&get=id&fmt=json";
  fetch(url)
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (ids) {
      const set = new Set(Array.isArray(ids) ? ids : []);
      coverageCache.set(key, set);
      controller.setCoverage(set);
    })
    .catch(function () { controller.setCoverage(null); }); // fail open
}

window.MuldleSurveys = {
  mount: mount, updateCoverage: updateCoverage,
  DEFAULT_ID: DEFAULT_ID, WIDE_ID: WIDE_ID, count: SURVEYS.length,
};
})();
