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

await browser.close();
console.log(failures === 0 ? "All unpainted-sticker checks passed." : `${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
