// Which twsearch options work from the Solver tab, on both channels.
// Runs the same short solve with each option and reports what came back, so
// the help text only promises what actually works.  Start `npm run dev`
// first, and `twsearch/build/bin/twsearch --serve` for
// the bridge column.
//
//    node test/options-test.mjs [wasm|bridge|both]
import { chromium } from "playwright";

const base = process.env.EXPLORER_URL ?? "http://localhost:3334/";
const which = process.argv[2] ?? "both";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
let current = "";
page.on("pageerror", (e) => errors.push(`${current}: ${e.message}`));

// Options to try, with the value the Solver's Options field would hold.
const OPTIONS = [
  "", "-v2", "-v3", "-c 3", "--alloptimal", "--mindepth 2", "--maxdepth 12",
  "-M 256", "-t 4", "-R 42", "--randomstart", "--noearlysolutions",
  "--nosymmetry", "--newcanon 4", "--startprunedepth 4", "--microthreads 4",
  "-q", "--quiet", "--moves R,U,F", "--nocorners", "--nocenters", "--noedges",
  "--omit CENTERS", "--omitoris CORNERS", "--omitperms EDGES",
  "--noorientation", "--distinguishall", "--nowrite", "--cachedir /tmp",
  "--writeprunetables never", "--orientationgroup 2", "-g", "--schreiersims",
];

await page.goto(`${base}?puzzle=3x3x3&alg=${encodeURIComponent("R U R' F2")}`);
await page.waitForSelector("twisty-player");
await page.click('button[data-tab-id="twsearch-solve"]');

async function run(channel, options) {
  current = `${channel} ${options}`;
  await page.selectOption("#twsearch-channel", channel);
  await page.fill("#twsearch-args", options);
  await page.evaluate(() => {
    document.querySelector("#twsearch-status").textContent = "";
    document.querySelector("#twsearch-log").textContent = "";
  });
  await page.click("#twsearch-solve-button");
  let timedOut = false;
  try {
    await page.waitForFunction(
      () => !document.querySelector("#twsearch-solve-button").disabled &&
        document.querySelector("#twsearch-status").textContent !== "",
      null, { timeout: 45000 });
  } catch {
    timedOut = true;
    await page.click("#twsearch-cancel-button").catch(() => {});
    await page.waitForTimeout(1500);
  }
  const status = (await page.textContent("#twsearch-status")) ?? "";
  const solutions = await page.$$eval("#twsearch-solutions button", (b) => b.map((x) => x.textContent));
  const log = (await page.textContent("#twsearch-log")) ?? "";
  const verdict = timedOut ? "STUCK"
    : /^Error|not allowed|refused/i.test(status) ? "REFUSED"
    : /^Found \d+ solution/.test(status) ? (solutions.length ? "ok" : "ok (no list)")
    : "OTHER";
  return { verdict, status: status.replace(/\s+\(\d+\.\d+s.*$/, "").slice(0, 80), solutions: solutions.length,
           err: (log.match(/^!.*$/m) ?? [])[0] };
}

const channels = which === "both" ? ["wasm", "bridge"] : [which];
for (const options of OPTIONS) {
  const parts = [];
  for (const channel of channels) {
    const r = await run(channel, options);
    parts.push(`${channel}: ${r.verdict}${r.err ? ` [${r.err.slice(0, 50)}]` : ""}${r.verdict === "OTHER" ? ` (${r.status})` : ""}`);
  }
  console.log(`${(options || "(none)").padEnd(26)} ${parts.join("   ")}`);
}
if (errors.length) console.log("page errors:", errors.slice(0, 5));
await browser.close();
