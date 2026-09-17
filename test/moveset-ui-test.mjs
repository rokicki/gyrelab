// The Solver tab's move set, in headless Chrome.  Start `npm run dev` first.
import { chromium } from "playwright";
const base = process.env.EXPLORER_URL ?? "http://localhost:3334/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
page.on("dialog", (d) => void d.dismiss());
const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

async function solve(label) {
  await page.click('button[data-tab-id="twsearch-solve"]');
  await page.selectOption("#twsearch-channel", "wasm");
  // Clear the previous result, so we wait for this solve's.
  await page.evaluate(() => { document.querySelector("#twsearch-status").textContent = ""; });
  await page.click("#twsearch-solve-button");
  await page.waitForFunction(() => !document.querySelector("#twsearch-solve-button").disabled && document.querySelector("#twsearch-status").textContent, null, { timeout: 120000 });
  const solutions = await page.$$eval("#twsearch-solutions button", (b) => b.map((x) => x.textContent));
  console.log(ts(), label, "->", await page.textContent("#twsearch-status"), JSON.stringify(solutions));
  return solutions;
}
const setMoves = async (text) => { await page.click('button[data-tab-id="twsearch-solve"]'); await page.fill("#twsearch-moves", text); };
const solvedIgnoringCenterTwist = () => page.evaluate(async () => {
  const m = globalThis.app.twistyPlayer.experimentalModel;
  const [start, alg, kpuzzle] = await Promise.all([m.anchorTransformation.get(), m.puzzleAlg.get(), m.kpuzzle.get()]);
  const end = start.applyAlg(alg.alg).toKPattern();
  return Object.entries(end.patternData).every(([o, d]) => JSON.stringify(d.pieces) === JSON.stringify(kpuzzle.defaultPattern().patternData[o].pieces) && (o.startsWith("CENTERS") || d.orientation.every((x) => x === 0)));
});

await page.goto(`${base}?puzzle=3x3x3&alg=${encodeURIComponent("u r f u' r2")}`);
await page.waitForSelector("twisty-player");
await setMoves("u, r, f");
const sols = await solve("3x3x3 'u r f u' r2' with move set u,r,f");
if (sols.length) {
  await page.click("#twsearch-solutions button");
  await page.waitForTimeout(600);
  console.log(ts(), "  alg now:", await page.$eval("twisty-alg-editor", (e) => e.algString ?? ""), "solved:", await solvedIgnoringCenterTwist());
}
await page.goto(`${base}?puzzle=3x3x3&alg=${encodeURIComponent("u r f u' r2")}`);
await page.waitForSelector("twisty-player");
await solve("same position, default move set");
await setMoves("R, Q");
await solve("move set R,Q");
await setMoves("R, x");
await solve("move set R,x");

// Persistence per puzzle, across tabs and puzzle switches.
await setMoves("R,U");
await page.click('button[data-tab-id="color-picker"]');
await page.waitForSelector("#color-net svg");
await page.waitForTimeout(400);
console.log(ts(), "Colors tab says:", await page.textContent("#color-moveset"));
await page.selectOption("#puzzle-name", "megaminx");
await page.waitForTimeout(1500);
await page.click('button[data-tab-id="twsearch-solve"]');
console.log(ts(), "after switching to megaminx, move set field:", JSON.stringify(await page.inputValue("#twsearch-moves")));
await page.selectOption("#puzzle-name", "3x3x3");
await page.waitForTimeout(1500);
console.log(ts(), "back on 3x3x3, move set field:", JSON.stringify(await page.inputValue("#twsearch-moves")));

// Colors tab against the move set R,U: paint the position after F.
await page.click('button[data-tab-id="color-picker"]');
await page.waitForSelector("#color-net svg");
await page.click("#color-solved");
await page.waitForTimeout(400);
const target = await page.evaluate(async () => {
  const p = globalThis.app.colorPainter;
  const kpuzzle = await globalThis.app.twistyPlayer.experimentalModel.kpuzzle.get();
  const pat = kpuzzle.defaultPattern().applyAlg("F");
  const out = [];
  for (const orbit of p.puzzle.model.orbits) {
    const d = pat.patternData[orbit.name]; const m = orbit.numOrientations;
    for (let loc = 0; loc < orbit.numPieces; loc++) for (let f = 0; f < m; f++) {
      const key = `${orbit.name}-l${loc}-o${f}`;
      const want = p.puzzle.model.solved.get(`${orbit.name}-l${d.pieces[loc]}-o${(f - d.orientation[loc] + m * m) % m}`);
      if (p.colors.get(key) !== want && !p.puzzle.model.duplicates.has(key)) out.push([key, want]);
    }
  }
  return out;
});
for (const [key, color] of target) {
  const index = await page.evaluate((c) => globalThis.app.colorPainter.puzzle.model.palette.findIndex((p) => p.color === c), color);
  await (await page.$$("#color-palette .swatch"))[index].click();
  const box = await page.locator(`#color-net [id="${key}"]`).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
await page.waitForTimeout(600);
console.log(ts(), "painted position after F, move set R,U ->", JSON.stringify({ status: await page.textContent("#color-status"), problems: await page.$$eval("#color-problems li", (l) => l.map((x) => x.textContent)) }));
await setMoves("");
await page.click('button[data-tab-id="color-picker"]');
await page.waitForTimeout(600);
const alg = await page.evaluate(async () => (await globalThis.app.twistyPlayer.experimentalModel.alg.get()).alg.toString());
console.log(ts(), "after clearing the move set ->", JSON.stringify({ moveset: await page.textContent("#color-moveset"), status: await page.textContent("#color-status"), problems: await page.$$eval("#color-problems li", (l) => l.map((x) => x.textContent)) }));
await browser.close();
