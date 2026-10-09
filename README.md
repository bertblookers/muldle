# Muldle 𒀯

**Play: <https://bertblookers.github.io/muldle/>**

A daily Wordle-style game for astronomical catalogue identifiers. Each day
there is one target object from the Messier, NGC, IC, Melotte, Collinder,
Caldwell or Barnard catalogues; you get six guesses to find its identifier,
e.g. `M31`, `NGC42`, `Mel25` or `NGC1023A`.

## How to play

- Type the full identifier: catalogue prefix (`M`, `NGC`, `IC`, `Mel`, `Cr`,
  `C` or `B`), the number without leading zeros, plus a component letter if
  the object has one. Tiles left empty count as blanks.
- Each object is in the game once, under the identifier most people know it
  by: the Andromeda Galaxy is `M31`, and guessing `NGC224` tells you so.
- Puzzles before 5 October 2026 (#0–#26) use only NGC and IC; a puzzle you
  played before then keeps the zero-padded spelling it was played in
  (`NGC0042`).
- Standard Wordle colours after each guess: green = right character in the
  right place, yellow = elsewhere in the identifier, grey = absent.
- A hint panel describes each guessed object: constellation, object type,
  magnitude, and the angular distance and direction to the target.
- Click a submitted guess to see that object in a sky view (Aladin Lite);
  after the game the view shows the target.
- **Hard mode** is on by default: every guess must be one that could still
  be the answer. Greens stay in place, a character can't return to a tile
  where it was yellow or grey, and character counts must fit the feedback
  (stricter than NYT Wordle's hard mode).

## Modes

Toggle by the title between two modes, each with its own daily puzzle:

- **ID** — guess the catalogue identifier (the default, described above).
- **ABC** — guess the object's well-known common name (e.g. `ORION NEBULA`) as
  a Wordle over its letters.
- **OMNI** — any identifier or name in the game can be the answer, from `M31`
  to `ORION NEBULA` and `SIRIUS`; it opens once you've solved today's ID or
  ABC puzzle and plays one random puzzle after another. Spaces count;
  apostrophes and hyphens are shown, never typed. **Mini**, beside it, plays
  only the short answers (up to 6 characters).

## More

- **Puzzle navigator** — the `«` · `Puzzle #N` · `»` control by the title
  browses and plays past puzzles; deep-links are shareable (`?p=N`).
- **Stats & history** (in the settings menu ⚙) — games played, win %, current
  and max streak, and your guess distribution, plus a list of the puzzles
  you've played. Everything is kept only in your own browser; nothing is ever
  sent anywhere.
- **Share** your result as an emoji grid, and watch a countdown to the next
  puzzle.
- **Unlimited** — once you've solved today's puzzle, switch from Daily to
  Unlimited (beside the puzzle number) and solve random puzzles one after
  another, as many as you like, in either mode. A stopwatch runs from your
  first key; Unlimited keeps stats of its own (longest session, best solves
  per hour), and your daily streak is left alone.

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
(VizieR catalogues VII/239A, VII/220A and VI/42, SIMBAD, Aladin Lite — all
CDS, Strasbourg — OpenNGC, the Caldwell, Melotte and Collinder lists, common
names from SIMBAD, OpenNGC, Wikipedia and a few NASA and magazine pages, and
the Noto Sans Cuneiform font). `data.js` (puzzles before 5 October 2026) and
`data_v2.js` (from then on) are generated from those sources at build time.

## License

The code is licensed under the GNU Affero General Public License v3.0 —
see [LICENSE](LICENSE). SPDX: `AGPL-3.0-only`.
