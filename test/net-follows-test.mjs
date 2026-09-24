// The net shows what the puzzle shows.  A position set from elsewhere
// (Scramble, Reset, an alg) reaches the Colors tab while it is the one
// showing, and a painting of its own is not mistaken for one of those.
// Start `npm run dev` first.
//
//    node test/net-follows-test.mjs
import { chromium } from "playwright";

const base = process.env.EXPLORER_URL ?? "http://localhost:3334/";
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on("pageerror", (e) => { console.log("  [pageerror]", e.message); failures++; });
await page.goto(`${base}?puzzle=2x2x2`);
await page.waitForSelector("twisty-player");
await page.click('button[data-tab-id="color-picker"]');
await page.waitForTimeout(900);

const net = () =>
  page.$$eval("polygon.sticker", (ps) => ps.map((p) => p.getAttribute("fill") ?? p.style.fill).join(","));
const blanks = () =>
  page.evaluate(() => [...globalThis.app.colorPainter.colors.values()].filter((c) => !c).length);

// Scramble is a position to work from, so it clears the alg as Reset does.
await page.click('button[data-tab-id="editor"]');
await page.evaluate(() => { document.querySelector("twisty-player").alg = "R U R' U'"; });
await page.waitForTimeout(1000);
await page.click("#scramble");
await page.waitForTimeout(1500);
const algAfter = await page.evaluate(async () =>
  (await document.querySelector("twisty-player").experimentalModel.puzzleAlg.get()).alg.toString(),
);
check(algAfter === "", "Scramble clears the alg, as Reset does", JSON.stringify(algAfter));
await page.click('button[data-tab-id="color-picker"]');
await page.waitForTimeout(900);

const solved = await net();
await page.click("#scramble");
await page.waitForTimeout(1500);
check((await net()) !== solved, "Scramble reaches the net while the Colors tab is showing");
check(/current position/i.test((await page.textContent("#color-status")) ?? ""),
  "and the net says it is the current position", (await page.textContent("#color-status"))?.trim());

// A painting with blanks in it must survive being applied: the puzzle puts
// something in the blank places, which is not what was painted.
await page.click('#color-palette button[data-color=""]');
for (const f of [0, 1, 2]) await page.click(`polygon#CORNERS-l0-o${f}`);
await page.waitForTimeout(1400);
check((await blanks()) === 3, "a blanked piece stays blank once the position is taken", `${await blanks()} blank stickers`);
check(/this is now the position/i.test((await page.textContent("#color-status")) ?? ""),
  "and it is taken as the position", (await page.textContent("#color-status"))?.trim());
check(((await page.textContent("#color-problems")) ?? "").trim() === "", "with no problems reported");

// A blank is a sticker on a piece, so scrambling takes it along: the same
// pieces stay blank, and show up wherever the scramble put them.
const where = () =>
  page.evaluate(() =>
    [...new Set(
      [...globalThis.app.colorPainter.colors]
        .filter(([, c]) => !c)
        .map(([k]) => k.match(/-l(\d+)-/)[1]),
    )].sort().join(","),
  );
const placeBefore = await where();
await page.click("#scramble");
await page.waitForTimeout(1800);
check((await blanks()) === 3, "a later Scramble keeps the blanks", `${await blanks()} blank stickers`);
check((await where()) !== placeBefore, "and they move with their piece",
  `place ${placeBefore} -> ${await where()}`);
check(((await page.textContent("#color-problems")) ?? "").trim() === "",
  "with the scrambled position still read cleanly");

await browser.close();
console.log(failures === 0 ? "All net-follows checks passed." : `${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
