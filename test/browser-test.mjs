// Drives the Explorer in headless Chrome (the installed Chrome; nothing is
// downloaded).  Start `npm run dev` first; for the bridge tests also run
// `node src/js/twsearch-bridge.mjs` in ../twsearch.
//
//    node test/browser-test.mjs [wasm|bridge|screenshot]
import { chromium } from "playwright";

const base = process.env.EXPLORER_URL ?? "http://localhost:3334/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("  [console error]", m.text()); });
const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

async function open(puzzle, alg) {
  await page.goto(`${base}?puzzle=${encodeURIComponent(puzzle)}&alg=${encodeURIComponent(alg)}`);
  await page.waitForSelector("twisty-player");
}

async function solve(label, { puzzle = "3x3x3", alg, channel, cancelAfter, scramble }) {
  await open(puzzle, alg);
  if (scramble) {
    await page.waitForTimeout(500);
    await page.click("#scramble");
    await page.waitForTimeout(500);
  }
  await page.click('button[data-tab-id="twsearch-solve"]');
  await page.selectOption("#twsearch-channel", channel);
  await page.evaluate(() => { document.querySelector("#twsearch-status").textContent = ""; });
  await page.click("#twsearch-solve-button");
  if (cancelAfter) {
    await page.waitForTimeout(cancelAfter);
    page.once("dialog", (d) => void d.dismiss());
    await page.click("#twsearch-cancel-button");
  }
  await page.waitForFunction(
    () => !document.querySelector("#twsearch-solve-button").disabled &&
      document.querySelector("#twsearch-status").textContent !== "",
    null,
    { timeout: 300000 },
  );
  const status = await page.textContent("#twsearch-status");
  const solutions = await page.$$eval("#twsearch-solutions button", (bs) => bs.map((b) => b.textContent));
  console.log(ts(), label, "->", status, "|", JSON.stringify(solutions));
  return solutions;
}

const mode = process.argv[2] ?? "wasm";
if (mode === "screenshot") {
  const url = process.argv[3] ?? base;
  await page.goto(`${url}?puzzle=megaminx&alg=${encodeURIComponent("R U F")}`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: process.argv[4] ?? "explorer.png" });
  console.log("move count:", await page.textContent("#move-count"));
} else if (mode === "wasm") {
  await open("3x3x3", "R U R' F2");
  await page.waitForTimeout(1500);
  console.log(ts(), "move count:", JSON.stringify(await page.textContent("#move-count")));
  const sols = await solve("wasm 3x3x3", { alg: "R U R' F2 D L2 B", channel: "wasm" });
  if (sols.length) {
    await page.click("#twsearch-solutions button");
    await page.waitForTimeout(500);
    console.log(ts(), "URL alg after applying:", new URL(page.url()).searchParams.get("alg"));
  }
  await solve("wasm megaminx", { puzzle: "megaminx", alg: "R U2 F' BL", channel: "wasm" });
  await solve("wasm rotation", { alg: "R U Lv", channel: "wasm" });
  await solve("wasm slice", { alg: "R 2L", channel: "wasm" });
  // Clicking the puzzle while the Solver tab is shown must not make a move.
  await open("3x3x3", "R U");
  await page.click('button[data-tab-id="twsearch-solve"]');
  const box = await page.locator("twisty-player").boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.4);
  await page.waitForTimeout(700);
  const afterSolveTabClick = new URL(page.url()).searchParams.get("alg");
  await page.click('button[data-tab-id="editor"]');
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.4);
  await page.waitForTimeout(700);
  console.log(ts(), "alg after clicking the puzzle: Solver tab ->", JSON.stringify(afterSolveTabClick), "; Edit Alg tab ->", JSON.stringify(new URL(page.url()).searchParams.get("alg")));
  // Scramble-button positions.  Only puzzles small enough to solve optimally
  // in the browser are solved here; a real megaminx or 3x3x3 scramble is a
  // job for the native bridge (see test/scramble-test.mjs, which checks that
  // every scramble is at least a position the Solver's moves can reach).
  for (let trial = 0; trial < 3; trial++) for (const puzzle of ["2x2x2", "skewb", "pyraminx", "dino"]) {
    const found = await solve(`wasm ${puzzle} Scramble button`, { puzzle, alg: "", channel: "wasm", scramble: true });
    if (found.length) {
      await page.click("#twsearch-solutions button");
      await page.waitForTimeout(500);
      const solved = await page.evaluate(async () => {
        const model = globalThis.app.twistyPlayer.experimentalModel;
        const [start, alg, kpuzzle] = await Promise.all([model.anchorTransformation.get(), model.puzzleAlg.get(), model.kpuzzle.get()]);
        const end = start.applyAlg(alg.alg).toKPattern();
        if (end.isIdentical(kpuzzle.defaultPattern())) return true;
        // Report what differs from solved.
        const diffs = [];
        for (const [orbit, data] of Object.entries(end.patternData)) {
          const solved = kpuzzle.defaultPattern().patternData[orbit];
          if (JSON.stringify(data.pieces) !== JSON.stringify(solved.pieces)) diffs.push(`${orbit} positions`);
          else if (JSON.stringify(data.orientation) !== JSON.stringify(solved.orientation)) diffs.push(`${orbit} orientation only`);
        }
        // Center orientation is display-only (twsearch ignores it).
        if (diffs.every((d) => d === "CENTERS orientation only")) return "true (except display-only center orientation)";
        return `not identical: ${diffs.join(", ")}`;
      });
      console.log(ts(), `${puzzle}: solved after applying the solution:`, solved);
    }
  }
  await solve("wasm grouping", { alg: "[R, U] (F2 D)2", channel: "wasm" });
  await solve("wasm cancel", { alg: "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2", channel: "wasm", cancelAfter: 5000 });
} else if (mode === "bridge") {
  await solve("auto (bridge)", { alg: "R U R' F2 D L2 B R2 D' F", channel: "auto" });
  await solve("bridge cancel", { alg: "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2", channel: "bridge", cancelAfter: 4000 });
}
await browser.close();
