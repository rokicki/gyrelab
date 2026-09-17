# Explorer with twsearch

The Twizzle Explorer (from cubing.js's `src/sites/alpha.twizzle.net/explore/`)
with a Solve tab that solves the position at the end of the alg with
twsearch: natively through the twsearch bridge when it is running on this
computer, otherwise with the WebAssembly build in the browser.

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

## Files

- `src/`: the Explorer (`index.html`, `app.ts`, ...), plus
  - `solve-panel.ts`: the Solve tab
  - `twsearch-channel.ts`: one interface over the bridge and the Worker
  - `twsearch-input.ts`: the alg as a twsearch ScrambleAlg
  - `twsearch-worker.ts`: the Worker running the wasm build
- `vendor/twsearch/`: the wasm build and session code from ../twsearch
  (`VERSION.txt` records the commit)
- `script/`: build and vendoring scripts
- `test/browser-test.mjs`: drives the page in headless Chrome
  (`wasm`, `bridge`, or `screenshot`)
