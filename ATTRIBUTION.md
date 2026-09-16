# Data & attribution

The AGPL-3.0 code license covers the game code only. The astronomical data
and services below are used under their own terms and credited here.

## NGC/IC identifiers and positions — VizieR VII/239A

Identifiers, J2000 positions and component letters come from
[VizieR catalogue VII/239A](https://cdsarc.cds.unistra.fr/viz-bin/cat/VII/239A):
H. G. Corwin Jr., *Accurate Positions for NGC and IC Objects* (2004).
Baked into `data.js` at build time.

## Constellation boundaries — VizieR VI/42

Per-object constellations are computed at build time from
[VizieR catalogue VI/42](https://cdsarc.cds.unistra.fr/viz-bin/cat/VI/42):
N. G. Roman, *Identification of a Constellation from a Position*,
PASP 99, 695 (1987).

## SIMBAD

Object types, magnitudes and angular sizes are queried at runtime from the
[SIMBAD database](https://simbad.cds.unistra.fr/).

> This research has made use of the SIMBAD database, operated at CDS,
> Strasbourg, France (Wenger et al. 2000, A&AS 143, 9).

## VizieR

> This research has made use of the VizieR catalogue access tool, CDS,
> Strasbourg, France (DOI: 10.26093/cds/vizier; Ochsenbein et al. 2000,
> A&AS 143, 23).

## Common names

The common names in `data/common_names.tsv` are drawn from three sources, and
every name carries the exact source URL that attests both the name and its
NGC/IC number (the `source` column). Names were selected and curated (one
best-known full name per object; abbreviated forms spelled out); the
underlying data was not otherwise altered.

- **SIMBAD** `NAME` identifiers (CDS; credited above).
- **OpenNGC** — the *Common names* column of
  [OpenNGC](https://github.com/mattiaverga/OpenNGC) by Mattia Verga, used
  under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Wikipedia** — English Wikipedia articles by their contributors, text
  under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/);
  the per-object article links are in the `source` column.

In the ShareAlike spirit of those sources, this curated list
(`data/common_names.tsv`) is in turn offered under
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
