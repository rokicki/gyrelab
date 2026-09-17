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

async function solve(label, { puzzle = "3x3x3", alg, channel, cancelAfter }) {
  await open(puzzle, alg);
  await page.click('button[data-tab-id="twsearch-solve"]');
  await page.selectOption("#twsearch-channel", channel);
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
  await solve("wasm rotation", { alg: "R U x", channel: "wasm" });
  await solve("wasm grouping", { alg: "[R, U] (F2 D)2", channel: "wasm" });
  await solve("wasm cancel", { alg: "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2", channel: "wasm", cancelAfter: 5000 });
} else if (mode === "bridge") {
  await solve("auto (bridge)", { alg: "R U R' F2 D L2 B R2 D' F", channel: "auto" });
  await solve("bridge cancel", { alg: "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2", channel: "bridge", cancelAfter: 4000 });
}
await browser.close();
