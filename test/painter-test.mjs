// Drives the Colors tab in headless Chrome.  Start `npm run dev` first.
//    node test/painter-test.mjs [screenshot-dir]
import { chromium } from "playwright";

const base = process.env.EXPLORER_URL ?? "http://localhost:3334/";
const shots = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("  [console error]", m.text()); });
page.on("dialog", (d) => void d.dismiss());
const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

// The Explorer's position: its alg, and whether its displayed state matches
// the painted colors.
const explorerState = () =>
  page.evaluate(async () => {
    const painter = globalThis.app.colorPainter;
    const m = globalThis.app.twistyPlayer.experimentalModel;
    const [start, alg] = await Promise.all([m.anchorTransformation.get(), m.puzzleAlg.get()]);
    const end = start.applyAlg(alg.alg).toKPattern();
    let matches = true;
    for (const orbit of painter.puzzle.model.orbits) {
      const d = end.patternData[orbit.name];
      const mm = orbit.numOrientations;
      for (let loc = 0; loc < orbit.numPieces; loc++) for (let f = 0; f < mm; f++) {
        const shown = painter.puzzle.model.solved.get(`${orbit.name}-l${d.pieces[loc]}-o${(f - d.orientation[loc] + mm * mm) % mm}`);
        if (shown !== painter.colors.get(`${orbit.name}-l${loc}-o${f}`)) matches = false;
      }
    }
    return { alg: alg.alg.toString(), explorerShowsPaintedColors: matches };
  });

async function report(label) {
  await page.waitForTimeout(500);
  const status = await page.textContent("#color-status");
  const problems = await page.$$eval("#color-problems li", (lis) => lis.map((l) => l.textContent));
  console.log(ts(), label, "->", JSON.stringify({ status, problems, ...(await explorerState()) }));
}

async function clickSticker(id) {
  const box = await page.locator(`#color-net [id="${id}"]`).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function paint(id, color) {
  const index = await page.evaluate((c) => globalThis.app.colorPainter.puzzle.model.palette.findIndex((p) => p.color === c), color);
  await (await page.$$("#color-palette .swatch"))[index].click();
  await clickSticker(id);
}

const colorOf = (id) => page.evaluate((id) => globalThis.app.colorPainter.colors.get(id), id);

await page.goto(`${base}?puzzle=3x3x3&alg=${encodeURIComponent("R U")}`);
await page.waitForSelector("twisty-player");
await page.click('button[data-tab-id="color-picker"]');
await page.waitForSelector("#color-net svg");
console.log(ts(), "net shown:", await page.isVisible("#color-net"), "3D hidden:", !(await page.isVisible("twisty-player")));
await report("opened on R U (nothing applied)");

await page.click("#color-clear");
await report("cleared (invalid, not applied)");

await page.click("#color-solved");
await report("Solved (valid, applied)");

await paint("CORNERS-l0-o0", await colorOf("CORNERS-l0-o1"));
await report("one sticker repainted (invalid; position stays solved)");
if (shots) await page.screenshot({ path: `${shots}/painter-problem.png` });

// Twist a corner in place.
await page.click("#color-solved");
await page.waitForTimeout(300);
const corner = [0, 1, 2].map((f) => `CORNERS-l0-o${f}`);
const original = [];
for (const id of corner) original.push(await colorOf(id));
for (let f = 0; f < 3; f++) await paint(corner[f], original[(f + 1) % 3]);
await report("one corner twisted (unreachable, not applied)");

// Paint the position after R, sticker by sticker, starting from solved.
await page.click("#color-solved");
await page.waitForTimeout(300);
const target = await page.evaluate(async () => {
  const painter = globalThis.app.colorPainter;
  const kpuzzle = await globalThis.app.twistyPlayer.experimentalModel.kpuzzle.get();
  const p = kpuzzle.defaultPattern().applyAlg("R");
  const out = [];
  for (const orbit of painter.puzzle.model.orbits) {
    const d = p.patternData[orbit.name];
    const m = orbit.numOrientations;
    for (let loc = 0; loc < orbit.numPieces; loc++) for (let f = 0; f < m; f++) {
      const key = `${orbit.name}-l${loc}-o${f}`;
      const want = painter.puzzle.model.solved.get(`${orbit.name}-l${d.pieces[loc]}-o${(f - d.orientation[loc] + m * m) % m}`);
      if (painter.colors.get(key) !== want && !painter.puzzle.model.duplicates.has(key)) out.push([key, want]);
    }
  }
  return out;
});
for (const [key, color] of target) await paint(key, color);
await report(`painted the position after R (${target.length} stickers)`);

await page.click('button[data-tab-id="twsearch-solve"]');
await page.selectOption("#twsearch-channel", "wasm");
await page.click("#twsearch-solve-button");
await page.waitForFunction(() => !document.querySelector("#twsearch-solve-button").disabled && document.querySelector("#twsearch-status").textContent, null, { timeout: 120000 });
console.log(ts(), "solve:", await page.textContent("#twsearch-status"), JSON.stringify(await page.$$eval("#twsearch-solutions button", (b) => b.map((x) => x.textContent))));

// Leaving the tab and coming back must show the Explorer's position, not
// whatever was last painted: otherwise the next pick applies a stale
// position and silently discards the alg.
await page.click('button[data-tab-id="twsearch-solve"]');
await page.evaluate(() => { globalThis.app.twistyPlayer.alg = "R U F"; });
await page.waitForTimeout(700);
await page.click('button[data-tab-id="color-picker"]');
await report("back on Colors after the alg changed to R U F");

// With the position unchanged, a painting in progress survives the trip.
await page.click("#color-clear");
await page.waitForTimeout(300);
await page.click('button[data-tab-id="twsearch-solve"]');
await page.waitForTimeout(300);
await page.click('button[data-tab-id="color-picker"]');
await page.waitForTimeout(500);
console.log(ts(), "cleared painting kept across a tab trip:",
  (await page.evaluate(() => [...globalThis.app.colorPainter.colors.values()].every((c) => c === null))));

// A described (custom) puzzle.
await page.goto(`${base}?puzzle-description=${encodeURIComponent("c f 0.2 v 0.8")}`);
await page.waitForSelector("twisty-player");
await page.click('button[data-tab-id="color-picker"]');
await page.waitForSelector("#color-net svg");
await report("custom puzzle c f 0.2 v 0.8");
await page.click("#color-solved");
await report("custom puzzle, Solved");
if (shots) await page.screenshot({ path: `${shots}/painter-custom.png` });
await browser.close();
