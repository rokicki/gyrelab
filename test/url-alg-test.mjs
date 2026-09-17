// The URL's alg parameter versus positions set up outside the alg.  The
// parameter cannot express such a position, so it is dropped while one is in
// effect (Scramble, or a position applied in the Colors tab) and comes back
// once the position is cleared.  Start `npm run dev` first.
//
//    node test/url-alg-test.mjs
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
let failures = 0;
const show = async (label, expected) => {
  const alg = new URL(page.url()).searchParams.get("alg");
  const playerAlg = await page.evaluate(async () =>
    (await globalThis.app.twistyPlayer.experimentalModel.puzzleAlg.get()).alg.toString());
  const ok = alg === expected;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label} alg param ${JSON.stringify(alg)} (alg ${JSON.stringify(playerAlg)}), expected ${JSON.stringify(expected)}`);
};
await page.goto("http://localhost:3334/?puzzle=3x3x3&alg=" + encodeURIComponent("R U"));
await page.waitForSelector("twisty-player");
await show("1. start                 ", "R U");
await page.click("#scramble"); await page.waitForTimeout(800);
await show("2. after Scramble        ", null);
await page.evaluate(() => { globalThis.app.twistyPlayer.alg = "F"; }); await page.waitForTimeout(600);
await show("3. alg F while scrambled ", null);
await page.click("#reset"); await page.waitForTimeout(800);
await show("4. after Reset           ", null);
await page.evaluate(() => { globalThis.app.twistyPlayer.alg = "R U F"; }); await page.waitForTimeout(600);
await show("5. alg R U F after Reset ", "R U F");
// color picker: apply a non-solved position, then the solved one
await page.click('button[data-tab-id="color-picker"]');
await page.waitForSelector("#color-net svg"); await page.waitForTimeout(600);
await page.click("#color-solved"); await page.waitForTimeout(900);
await show("6. picker applied Solved ", null);
await page.evaluate(() => { globalThis.app.twistyPlayer.alg = "L"; }); await page.waitForTimeout(600);
await show("7. alg L after that      ", "L");
await browser.close();
console.log(failures === 0 ? "All URL alg checks passed." : `${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
