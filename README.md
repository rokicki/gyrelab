# Gyrelab

A workbench for twisty puzzles: turn one, paint a position onto it, and have
twsearch solve it.  It grows out of the Twizzle Explorer (cubing.js's
`src/sites/alpha.twizzle.net/explore/`), and adds a Solver tab that solves
the position at the end of the alg (including Scramble-button setups)
natively when twsearch is serving on this computer, and with the WebAssembly
build in the browser otherwise.

The name is Carroll's, by way of the gyre: *twas brillig, and the slithy
toves did gyre and gimble in the wabe*.  A gyre is a turn.

It uses only the public API of the published `cubing` npm package (pinned
in `package.json`), so cubing.js itself is unmodified.  The few cubing.js
internals the original Explorer used are replaced locally:
`move-count.ts` (move count display), `getConfigFromURL` and the camera
position math in `twisty-player.ts`, and the legacy puzzle name map in
`url-params.ts`.

## Use

    npm install
    npm run roll-twsearch   # after `make build-wasm` in ../twsearch
    npm run dev             # http://localhost:3334/

For native solving, also run the bridge from ../twsearch:

    node src/js/twsearch-bridge.mjs

`npm run build` writes `dist/`; `npm run check` type-checks.

`node script/build.mjs --site DIR` builds a static site into DIR that works
from any web server and also opened straight from the filesystem: one
classic script, with the twsearch worker embedded and started from a Blob
URL (browsers refuse module and worker scripts from file:// URLs).
`make site` in the parent directory does the whole thing (wasm build,
vendoring, and this) into `../site/`.

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
- `vendor/twsearch/`: the wasm build and session code from ../twsearch
  (`VERSION.txt` records the commit)
- `script/`: build and vendoring scripts
- `test/browser-test.mjs`: drives the page in headless Chrome
  (`wasm`, `bridge`, or `screenshot`)
- `test/moveset-test.ts` (`node test/run-ts.mjs test/moveset-test.ts`): the
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
- `test/colors-test.ts` (`node test/run-ts.mjs test/colors-test.ts`):
  colors round trip and reachability, compared with twsearch
- `test/painter-test.mjs`: drives the Colors tab in headless Chrome

## Which cubing.js

By default the build uses the published `cubing` package pinned in
`package.json`.  Setting `CUBING_LIB` to the `dist/lib/cubing` directory of a
cubing.js checkout builds against that instead, which is how changes being
made there (a Scramble fix, say) can be tried here.  The Makefile one
directory up has a switch for it: `make site` uses the checkout,
`make site CUBING=npm` uses the package.  Every build prints which one it
used.  `test/run-ts.mjs` honors `CUBING_LIB` as well.
