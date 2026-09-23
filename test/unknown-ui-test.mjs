// Stickers left unpainted, through the UI: the Colors tab takes a position
// with blank pieces, and the Solver solves it, saying first that it cannot
// tell whether the position is solvable.  Start `npm run dev` first.
//
//    node test/unknown-ui-test.mjs
import { chromium } from "playwright";

const base = process.env.EXPLORER_URL ?? "http://localhost:3334/";
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => { console.log("  [pageerror]", e.message); failures++; });
await page.goto(`${base}?puzzle=3x3x3&alg=${encodeURIComponent("R U R' F' U2 R")}`);
await page.waitForSelector("twisty-player");

await page.click('button[data-tab-id="color-picker"]');
await page.click("#color-from-position");
await page.waitForTimeout(800);

// Blank one whole edge: the "not painted" swatch, then both its stickers.
await page.click('#color-palette button[data-color=""]');
for (const f of [0, 1]) await page.click(`polygon#EDGES-l0-o${f}`);
await page.waitForTimeout(900);
check(/this is now the position/i.test((await page.textContent("#color-status")) ?? ""),
  "a piece left unpainted is a position, not an error", (await page.textContent("#color-status"))?.trim());
check(((await page.textContent("#color-problems")) ?? "").trim() === "", "and no problems are reported");

// Half of a piece is a question the format cannot put.
await page.click(`polygon#EDGES-l1-o0`);
await page.waitForTimeout(900);
check(/painted in part/.test((await page.textContent("#color-problems")) ?? ""),
  "half a piece is refused", ((await page.textContent("#color-problems")) ?? "").trim().slice(0, 60));
await page.click(`polygon#EDGES-l1-o1`);
await page.waitForTimeout(900);

await page.click('button[data-tab-id="twsearch-solve"]');
await page.click("#twsearch-solve-button");
try {
  await page.waitForFunction(() => document.querySelectorAll("#twsearch-solutions button").length > 0, { timeout: 90000 });
} catch {}
const solutions = await page.$$eval("#twsearch-solutions button", (b) => b.map((x) => x.textContent));
check(solutions.length > 0, "the Solver solves it", solutions.join(" | "));
const log = (await page.textContent("#twsearch-log")) ?? "";
check(/left unpainted/.test(log), "and warns that solvability cannot be told in advance",
  (log.split("\n").find((l) => /unpainted/.test(l)) ?? "").slice(0, 70));

// The pieces nobody asked about are drawn gray, by a mask that goes with
// the pieces rather than the places.
const mask = await page.evaluate(async () => {
  const p = document.querySelector("twisty-player");
  const m = await p.experimentalModel.twistySceneModel.stickeringMaskRequest.get();
  if (!m) return null;
  return Object.fromEntries(
    Object.entries(m.orbits).map(([orbit, o]) => [
      orbit,
      o.pieces.filter((piece) => piece?.facelets?.includes("ignored")).length,
    ]),
  );
});
check(mask !== null && Object.values(mask).some((n) => n > 0),
  "the pieces nobody asked about are marked gray", JSON.stringify(mask));

// A mask belongs to the puzzle it was painted on: carrying one to another
// puzzle names orbits it does not have, and the player throws.
const before = failures;
await page.evaluate(() => {
  const s = document.querySelector("select");
  const option = [...s.options].find((o) => o.textContent.trim() === "megaminx");
  s.value = option.value;
  s.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(3000);
await page.click('button[data-tab-id="editor"]');
await page.waitForTimeout(1200);
check(failures === before, "and switching puzzles does not carry the mask over");

await browser.close();
console.log(failures === 0 ? "All unpainted-sticker checks passed." : `${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
