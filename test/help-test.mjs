// The Solver tab's Help popup.  Checks that it opens and closes, and that
// every option it documents is one the bridge accepts, so the help cannot
// promise something the native channel refuses.  Start `npm run dev` first.
//
//    node test/help-test.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const base = process.env.EXPLORER_URL ?? "http://localhost:3334/";
const bridgeSource = readFileSync(new URL("../twsearch/src/js/twsearch-bridge.mjs", import.meta.url), "utf8");
const allowed = new Set(
  [...bridgeSource.matchAll(/^\s*\["(-[^"]+)", \d\],$/gm)].map((m) => m[1]),
);
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => { console.log("  [pageerror]", e.message); failures++; });
await page.goto(`${base}?puzzle=3x3x3`);
await page.waitForSelector("twisty-player");
await page.click('button[data-tab-id="twsearch-solve"]');

check(!(await page.isVisible("#twsearch-help-dialog")), "help starts closed");
await page.click("#twsearch-help-button");
await page.waitForSelector("#twsearch-help-dialog[open]", { timeout: 10000 });
check(true, "help opens");

const body = await page.textContent("#twsearch-help-body");
check(/comma separated/i.test(body), "says the move set is comma separated");
check(/blank/i.test(body), "says blank means the puzzle's own moves");
check(/checkbeforesolve/.test(body), "mentions the check it adds itself");

// The bridge instructions must be complete and name this page's origin.
// How to get twsearch natively: a download for each platform, and this
// page's origin for --allow-origin.
const mac = await page.textContent("#twsearch-help-mac");
check(/releases\/latest\/download\/twsearch-macos\b/.test(mac), "Mac: downloads the latest release", mac.split("\n")[0]);
check(/chmod \+x twsearch/.test(mac), "Mac: makes it executable");
check(/--serve/.test(mac), "Mac: starts it serving");
const windows = await page.textContent("#twsearch-help-windows");
check(/curl\.exe .*releases\/latest\/download\/twsearch-windows-x64\.exe/.test(windows), "Windows: downloads the latest release", windows.split("\n")[0]);
check(/twsearch\.exe --serve/.test(windows), "Windows: starts it serving");
const originLine = await page.textContent("#twsearch-help-bridge-origin");
const origin = new URL(base).origin;
check(originLine.trim() === `--allow-origin ${origin}`, "names this page's origin for --allow-origin", originLine);
check(/make build/.test(body), "says how to build it yourself");
check(/native \(twsearch bridge\)/.test(body), "says what the status looks like when it is in use");

const options = await page.$$eval("#twsearch-help-options dt", (ds) => ds.map((d) => d.textContent));
check(options.length > 15, `documents ${options.length} options`);
for (const option of options) {
  const flag = option.split(" ")[0];
  // -v is handled by its own rule in the bridge (-v, -v0 ... -v9).
  const ok = /^-v\d?$/.test(flag) || allowed.has(flag);
  if (!ok) check(false, `bridge allows ${flag}`, option);
}
check(true, "every documented option is allowed through the bridge");

await page.click("#twsearch-help-close");
await page.waitForTimeout(300);
check(!(await page.isVisible("#twsearch-help-dialog")), "help closes");

await browser.close();
console.log(failures === 0 ? "All help checks passed." : `${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
