# Gyrelab

A workbench for twisty puzzles built from
[Twizzle Explorer](https://alpha.twizzle.net/explore/) and twsearch,
with Colors and Solver tabs.  Solves with twsearch in the browser
(WebAssembly), or, for deeper, faster searches, a native twsearch on your
machine.

You need this repository only to build or develop Gyrelab, or to run it
offline.  Otherwise, use the [public page](https://cube20.org/gyrelab/).

## Building and developing

You need [bun](https://bun.sh).  twsearch comes along as a submodule, so
clone with it:

    git clone --recursive https://github.com/rokicki/gyrelab
    cd gyrelab
    bun install
    bun run dev             # http://localhost:3334/, rebuilt as you edit

To run it offline, `bun run site`, then open `site/index.html` in a
browser.  `site/` also works from any web server.  `bun run check`
type-checks.

The WebAssembly twsearch is prebuilt in `vendor/twsearch/`, so building
needs only bun.  Two things need more:

- **Solving natively**, and the tests that compare against twsearch, need
  twsearch built from the submodule, which takes a C++ compiler:

      bun run build-twsearch
      twsearch/build/bin/twsearch --serve

  The Solver tab then finds it by itself.  Just want to solve?  Download a
  prebuilt twsearch instead; the Solver tab's Help... has the commands.

- **Updating the WebAssembly twsearch** (if the submodule changes) needs
  [emsdk](https://emscripten.org/) (in `~/emsdk`, or set `EMSDK`):

      bun run update-twsearch

  This builds it into `vendor/twsearch/` and records the commit in
  `VERSION.txt`.

The tests run under bun as well: `bun test/moveset-test.ts`, and so on (see
below).  The browser tests drive Chrome through Playwright and expect
`bun run dev` to be running.

## Files

- `src/`: the Explorer (`index.html`, `app.ts`, ...), plus
  - `solve-panel.ts`: the Solver tab
  - `twsearch-channel.ts`: one interface over the bridge and the Worker
  - `twsearch-state.ts`: maps the displayed state onto twsearch's puzzle
  - `move-set.ts`, `reachability.ts`: the move set (Solver tab) and the
    reachability check for the puzzle and move set
  - `color-painter.ts`, `sticker-colors.ts`, `color-check.ts`,
    `schreier-sims.ts`: the Colors tab (paint a position on the 2D net and
    check it)
  - `twsearch-worker.ts`: the Worker running the wasm build
- `vendor/twsearch/`: the wasm build and session code, built from the
  `twsearch/` submodule (`VERSION.txt` records the commit)
- `twsearch/`: the twsearch source, as a submodule
- `script/`: build and vendoring scripts
- `test/browser-test.mjs`: drives the page in headless Chrome
  (`wasm`, `bridge`, or `screenshot`)
- `test/moveset-test.ts` (`bun test/moveset-test.ts`): the
  state mapping and reachability for every named puzzle's default move set
  and for custom move sets, compared with twsearch (--showpositions and
  --checkbeforesolve)
- `test/reading-test.ts`: colors read back from random reachable positions
  must be positions twsearch accepts (catches look-alike pieces read wrong)
- `test/omission-test.ts`: --nocorners, --omit, and friends: our
  reachability verdicts against twsearch's under the same options
- `test/moveset-ui-test.mjs`: the Solver tab's move set in headless Chrome
- `test/convention-probe.ts`: how ksolve moves correspond to KPuzzle
  transformations (permutation equal; orientationDelta[i] = ori[perm[i]])
- `test/scramble-reach.ts`: Scramble-button states, our verdict, and
  whether twsearch solves them
- `test/colors-test.ts` (`bun test/colors-test.ts`):
  colors round trip and reachability, compared with twsearch
- `test/painter-test.mjs`: drives the Colors tab in headless Chrome

## Which cubing.js

The build uses the published `cubing` package pinned in `package.json`,
which `bun install` fetches.  To try changes to cubing.js itself, set
`CUBING_LIB` to the `dist/lib/cubing` directory of a cubing.js checkout that
has been built, and the build uses that instead; every build says which one
it used.

## Licensing

Dual-licensed as [MPL](./LICENSE-MPL.md) and [GPL](./LICENSE-GPL.md), the
same as cubing.js and twsearch, so a project using any of them is under one
license throughout.

## Acknowledgements

This project was built using Claude, integrating the cubing.js Explorer code
and the C++ twsearch code; it serves entirely as glue between those two
projects.

The WebAssembly build in `vendor/twsearch/` is twsearch (same dual license;
includes CityHash, MIT).  The Ubuntu font from `@fontsource/ubuntu` is under the
Ubuntu Font License.
