# Muldle 𒀯

**Play: <https://bertblookers.github.io/muldle/>**

A daily Wordle-style game for astronomical catalogue identifiers. Each day
there is one target object from the NGC or IC catalogue; you get six guesses
to find its identifier, e.g. `NGC0042` or `IC1023A`.

## How to play

- Type the full identifier: catalogue prefix (`NGC` or `IC`), four zero-padded
  digits, plus a component letter if the object has one. Tiles left empty
  count as blanks.
- Standard Wordle colours after each guess: green = right character in the
  right place, yellow = elsewhere in the identifier, grey = absent.
- A hint panel describes each guessed object: constellation, object type,
  magnitude, and the angular distance and direction to the target.
- Click a submitted guess to see that object in a sky view (Aladin Lite);
  after the game the view shows the target.
- **Hard mode** is on by default: revealed hints must be used in subsequent
  guesses, and greyed-out characters may not be reused.

## Run locally

It's a static site — serve the repo root with any web server, e.g.:

```
python -m http.server 8080
```

then open <http://localhost:8080>. Object type/magnitude hints and the sky
view need a network connection (SIMBAD and Aladin Lite are queried at
runtime).

## The name

MUL 𒀯 — Sumerian for "star", after the oldest known star catalogues: the
Babylonian "Three Stars Each" lists (cuneiform: MUL.MEŠ 3.TA.ÀM, c. 12th
century BC) and their successor MUL.APIN. The 𒀯 glyph is served as a tiny
single-character subset of Noto Sans Cuneiform, since almost no system ships
a cuneiform font.

## Inspiration

Inspired by [Wordle](https://www.nytimes.com/games/wordle/) by Josh Wardle,
now published by The New York Times. Muldle is an independent hobby project
with no affiliation to or endorsement by Josh Wardle or The New York Times.

## Data & attribution

The astronomical data is not covered by the code license and is credited to
its sources — see [ATTRIBUTION.md](ATTRIBUTION.md) for the full list
(VizieR catalogues VII/239A and VI/42, SIMBAD, Aladin Lite — all CDS,
Strasbourg — and the Noto Sans Cuneiform font). `data.js` is generated from
the VizieR tables.

## License

The code is licensed under the GNU Affero General Public License v3.0 —
see [LICENSE](LICENSE). SPDX: `AGPL-3.0-only`.
