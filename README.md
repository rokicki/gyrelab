# Gyrelab

A workbench for twisty puzzles built from
[Twizzle Explorer](https://alpha.twizzle.net/explore/) and twsearch,
with a color picker tab and a solver tab.  Uses an
embedded wasm server for twsearch, or for deeper, faster searches, a
local native twsearch executable.

## Building and developing

You need [bun](https://bun.sh).  twsearch comes along as a submodule, so
clone with it:

    git clone --recursive https://github.com/rokicki/gyrelab
    cd gyrelab
    bun install
    bun run dev             # http://localhost:3334/, rebuilt as you edit

`bun run site` builds a static site into `site/` that works from any web
server and also opened straight from the filesystem: one classic script,
with the twsearch worker embedded and started from a Blob URL (browsers
refuse module and worker scripts from file:// URLs).  `bun run build` writes
a development build to `dist/`, and `bun run check` type-checks.

The WebAssembly twsearch in `vendor/twsearch/` is committed, so none of that
needs anything but bun.  Two things do need more:

- **Solving natively**, and the tests that compare against twsearch, need
  twsearch built from the submodule, which takes a C++ compiler:

      bun run build-twsearch
      twsearch/build/bin/twsearch --serve

  The Solver tab then finds it by itself.

- **Updating the WebAssembly twsearch** after the submodule moves on needs
  [emsdk](https://emscripten.org/) (in `~/emsdk`, or set `EMSDK`):

      bun run update-twsearch

  which builds it and copies it into `vendor/twsearch/`, recording the
  twsearch commit in `VERSION.txt`.

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

Two things here are somebody else's work, under their own terms: the
WebAssembly twsearch in `vendor/twsearch/`, which is a build of twsearch
(the same dual license, and it carries CityHash under the MIT license), and
the Ubuntu font that `@fontsource/ubuntu` brings in, under the Ubuntu Font
License.
