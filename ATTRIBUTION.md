# Data & attribution

The AGPL-3.0 code license covers the game code only. The astronomical data
and services below are used under their own terms and credited here.

## NGC/IC identifiers and positions — VizieR VII/239A

Identifiers, J2000 positions and component letters come from
[VizieR catalogue VII/239A](https://cdsarc.cds.unistra.fr/viz-bin/cat/VII/239A):
H. G. Corwin Jr., *Accurate Positions for NGC and IC Objects* (2004).
Baked into `data.js` at build time.

## Catalogue cross-identifications (the v2 pool, `data_v2.js`)

Which Messier, NGC, IC, Melotte, Collinder, Caldwell and Barnard numbers
name the same object is decided at build time from several sources:

- **SIMBAD** cross-identifications (a committed snapshot; credited below).
- **Corwin's identity notes** in VizieR VII/239A (credited above).
- **OpenNGC** — the Name / Type / M / NGC / IC columns of
  [OpenNGC](https://github.com/mattiaverga/OpenNGC) by Mattia Verga, used
  under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Where those disagree, a per-pair verdict researched from Harold Corwin's
  NGC/IC notes, Wolfgang Steinicke's *Revised NGC and IC*, OpenNGC, SIMBAD
  and the NASA/IPAC Extragalactic Database (NED).
  > This research has made use of the NASA/IPAC Extragalactic Database (NED),
  > which is funded by the National Aeronautics and Space Administration and
  > operated by the California Institute of Technology.
- **Caldwell catalogue** — Patrick Moore, *Sky & Telescope* (December 1995);
  the list is checked against Wikipedia's "Caldwell catalogue" (text under
  CC BY-SA 4.0) and [SEDS](http://www.messier.seds.org/xtra/similar/caldwell.html).
- **Melotte (1915) and Collinder (1931) catalogues** — the numbers are checked
  against Wikipedia's "Melotte catalogue" and "Collinder catalogue" tables
  (CC BY-SA 4.0), [astrobasics.de](https://astrobasics.de/en/gallery/catalogs/melotte/)
  and the Collinder Catalogue list published by ukcloudmagnets.co.uk.
- **Barnard catalogue** — [VizieR VII/220A](https://cdsarc.cds.unistra.fr/viz-bin/cat/VII/220A):
  E. E. Barnard, *Catalogue of 349 Dark Objects in the Sky* (1927), for which
  entries exist and their positions.

## Constellation boundaries — VizieR VI/42

Per-object constellations are computed at build time from
[VizieR catalogue VI/42](https://cdsarc.cds.unistra.fr/viz-bin/cat/VI/42):
N. G. Roman, *Identification of a Constellation from a Position*,
PASP 99, 695 (1987).

## SIMBAD

Object types, magnitudes and angular sizes are queried at runtime from the
[SIMBAD database](https://simbad.cds.unistra.fr/). At build time SIMBAD also
supplies cross-identifications (above) and the positions of the objects with
no NGC/IC or Barnard entry (M40, M45, most Melotte and Collinder clusters,
C9).

> This research has made use of the SIMBAD database, operated at CDS,
> Strasbourg, France (Wenger et al. 2000, A&AS 143, 9).

## VizieR

> This research has made use of the VizieR catalogue access tool, CDS,
> Strasbourg, France (DOI: 10.26093/cds/vizier; Ochsenbein et al. 2000,
> A&AS 143, 23).

## Common names

The common names (`names.js` for puzzles before 5 October 2026,
`names_v2.js` from then on) were selected and curated at build time: one
best-known full name per object, abbreviated forms spelled out, and a name
kept only if a source page names the object together with one of its
catalogue numbers. The other names shown after a solve (`aka.js`) were
curated the same way, each attested in full next to one of the object's
numbers. The underlying data was not otherwise altered. Sources:

- **SIMBAD** `NAME` identifiers (CDS; credited above).
- **OpenNGC** — the *Common names* column of
  [OpenNGC](https://github.com/mattiaverga/OpenNGC) by Mattia Verga, used
  under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Wikipedia** — English Wikipedia articles by their contributors, text
  under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- For a few objects: NASA
  ([Astronomy Picture of the Day](https://apod.nasa.gov/) and the
  [Hubble Caldwell catalog](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-caldwell-catalog/)),
  [ESA](https://www.esa.int/) and [ESO](https://www.eso.org/) releases,
  and articles in *Sky & Telescope*, *Astronomy*, *Astronomy Now* and *BBC
  Sky at Night Magazine*. Only the names are used, as facts; no text is
  copied.

In the ShareAlike spirit of those sources, this curated list (as shipped in
`names.js`, `names_v2.js` and `aka.js`) is in turn offered under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/): anyone is
welcome to reuse it, with attribution, under the same terms.

## Aladin Lite

The sky view uses [Aladin Lite](https://aladin.cds.unistra.fr/AladinLite/),
developed at CDS, Strasbourg Observatory, France (Bonnarel et al. 2000,
A&AS 143, 33; Boch & Fernique 2014, ASPC 485, 277; Baumann et al. 2022).
Sky imagery is served by CDS and its partner surveys.

## Sky survey imagery (survey picker)

The object viewer's survey picker (`surveys.js`) switches between HiPS
progressive-survey layers. Except where noted, the HiPS are generated and
served by CDS from each survey's original data:

- **DSS2** — Digitized Sky Survey 2 (STScI).
- **SDSS** — Sloan Digital Sky Survey, DR9.
- **GALEX** — Galaxy Evolution Explorer, GR6/7 AIS (NASA / Caltech–JPL).
- **2MASS** — Two Micron All Sky Survey (UMass / IPAC–Caltech; NASA / NSF).
- **IRAC** — Spitzer Space Telescope / IRAC (NASA / JPL–Caltech).
- **WISE** — Wide-field Infrared Survey Explorer, AllWISE (NASA / JPL–Caltech).
- **IRIS** — IRAS / IRIS reprocessing (NASA; Miville-Deschênes & Lagache 2005).
- **XMM** — XMM-Newton EPIC-pn (ESA), via the XCatDB HiPS (Observatoire
  astronomique de Strasbourg).

Which surveys have data over a given object is determined at runtime by the
[CDS MocServer](https://alasky.cds.unistra.fr/MocServer/) (Fernique et al.
2014, ASPC 485, 279), used only to grey out surveys with no coverage there.

## Noto Sans Cuneiform (the 𒀯 glyph)

`mul.woff2` and `favicon.svg` are derived from
[Noto Sans Cuneiform](https://fonts.google.com/noto/specimen/Noto+Sans+Cuneiform)
(© Google), used under the
[SIL Open Font License 1.1](https://openfontlicense.org/). The subset is
renamed "MulGlyph" per the OFL's reserved-font-name rule.

## Wordle

Game mechanic inspired by [Wordle](https://www.nytimes.com/games/wordle/)
by Josh Wardle, published by The New York Times. No affiliation or
endorsement; "Wordle" is a trademark of The New York Times.
