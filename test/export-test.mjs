// Checks the Solve tab's "Export..." popup: the file it shows must be a
// complete twsearch input (puzzle plus the position to solve), and native
// twsearch must solve it with the command line the popup gives.
//
//    node test/export-test.mjs        (start `npm run dev` first)
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.env.EXPLORER_URL ?? "http://localhost:3334/";
const twsearch = process.env.TWSEARCH ?? "../twsearch/build/bin/twsearch";
const dir = mkdtempSync(join(tmpdir(), "export-test-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
let failures = 0;
const seen = new Set();

async function exportFor(puzzle, alg, { moves = "", options = null } = {}) {
  await page.goto(`${base}?puzzle=${encodeURIComponent(puzzle)}&alg=${encodeURIComponent(alg)}`);
  await page.waitForSelector("twisty-player");
  await page.click('button[data-tab-id="twsearch-solve"]');
  await page.fill("#twsearch-moves", moves);
  if (options !== null) {
    await page.fill("#twsearch-args", options);
  }
  await page.click("#twsearch-export-button");
  await page.waitForSelector("#twsearch-export-dialog[open]", { timeout: 30000 });
  const file = await page.inputValue("#twsearch-export-text");
  const command = await page.textContent("#twsearch-export-command");
  await page.click("#twsearch-export-close");
  return { file, command };
}

function check(label, cond, detail = "") {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? " -- " + detail : ""}`);
  if (!cond) failures++;
}

for (const [puzzle, alg, opts] of [
  ["3x3x3", "R U R' F2 D L2 B", {}],
  ["4x4x4", "R U 2F", {}],
  ["megaminx", "R U F", {}],
  ["3x3x3", "u r f", { moves: "u,r,f" }],
  ["4x4x4", "R U 2F", { options: "-v2 --nocenters" }],
]) {
  const label = `${puzzle} "${alg}"${opts.moves ? ` moves=${opts.moves}` : ""}${opts.options ? ` args="${opts.options}"` : ""}`;
  const { file, command } = await exportFor(puzzle, alg, opts);
  const name0 = command.trim().split(/\s+/).pop();
  void name0;
  check(`${label}: first line is the command`,
    file.split("\n")[0] === `# ${command.trim()}`, file.split("\n")[0]);
  check(`${label}: file has the puzzle and the position`,
    /^Name /m.test(file) && /^Move /m.test(file) && /^ScrambleState /m.test(file));
  const name = command.trim().split(/\s+/).pop();
  check(`${label}: command names a numbered file`, /^[A-Za-z0-9_]+\.\d+\.tws$/.test(name), command);
  check(`${label}: file name is new`, !seen.has(name), name);
  seen.add(name);
  const path = join(dir, name);
  writeFileSync(path, file);
  const args = command.trim().split(/\s+/).slice(1, -1);
  let out;
  try {
    out = execFileSync(twsearch, [...args, "-M", "256", "--nowrite", path], { encoding: "utf8", timeout: 300000 });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const solved = /^Found \d+ solution/m.test(out);
  check(`${label}: native twsearch solves it`, solved,
    solved ? (out.match(/^ .*$/m) ?? [""])[0].trim() : out.split("\n").filter((l) => l.startsWith("!")).join(" "));
}

await browser.close();
console.log(failures === 0 ? "All export checks passed." : `${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
