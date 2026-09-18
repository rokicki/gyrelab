// The Scramble button: what it produces must be solvable with the moves the
// Solver is set to use -- the move set typed on the Solver tab if there is
// one, otherwise the puzzle's own moves.  Start `npm run dev` first (or
// `make dev` one directory up).
//
//    node test/scramble-test.mjs
import { chromium } from "playwright";

const base = process.env.EXPLORER_URL ?? "http://localhost:3334/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => { console.log("  [pageerror]", e.message); failures++; });
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
};

// Whether the Solver accepts the displayed position: its pre-check refuses
// a position its moves cannot reach.
const solverAccepts = () => page.evaluate(async () => {
  try {
    await globalThis.app.solvePanel.input([]);
    return "reachable";
  } catch (e) {
    return e.message;
  }
});

async function scrambleAndSolve(puzzle, moveSet) {
  await page.goto(`${base}?puzzle=${encodeURIComponent(puzzle)}`);
  await page.waitForSelector("twisty-player");
  await page.click('button[data-tab-id="twsearch-solve"]');
  await page.selectOption("#twsearch-channel", "wasm");
  await page.fill("#twsearch-moves", moveSet);
  await page.waitForTimeout(300);
  await page.click("#scramble");
  await page.waitForTimeout(900);
  await page.evaluate(() => { document.querySelector("#twsearch-status").textContent = ""; });
  await page.click("#twsearch-solve-button");
  await page.waitForFunction(
    () => !document.querySelector("#twsearch-solve-button").disabled &&
      document.querySelector("#twsearch-status").textContent !== "",
    null, { timeout: 300000 });
  const status = await page.textContent("#twsearch-status");
  const solutions = await page.$$eval("#twsearch-solutions button", (b) => b.map((x) => x.textContent));
  return { status, solutions };
}

// Every scramble must be a position the Solver's moves can reach.
for (const [puzzle, moveSet] of [
  ["3x3x3", ""],
  ["4x4x4", ""],
  ["5x5x5", ""],
  ["megaminx", ""],
  ["skewb", ""],
  ["pyraminx", ""],
  ["2x2x2", ""],
  ["3x3x3", "R,U"],
  ["3x3x3", "U,D,R2,L2,F2,B2"],
  ["4x4x4", "U,R,F"],
]) {
  const label = `${puzzle}${moveSet ? ` move set ${moveSet}` : " (default moves)"}`;
  await page.goto(`${base}?puzzle=${encodeURIComponent(puzzle)}`);
  await page.waitForSelector("twisty-player");
  await page.click('button[data-tab-id="twsearch-solve"]');
  await page.fill("#twsearch-moves", moveSet);
  await page.waitForTimeout(300);
  const verdicts = [];
  for (let i = 0; i < 3; i++) {
    await page.click("#scramble");
    await page.waitForTimeout(700);
    verdicts.push(await solverAccepts());
  }
  const ok = verdicts.every((v) => v === "reachable");
  check(ok, `${label}: scrambles are reachable`, ok ? "" : verdicts.find((v) => v !== "reachable")?.slice(0, 90));
}

// And a few small enough to solve outright, which also shows the solution
// stays inside a move set that was given.
for (const [puzzle, moveSet] of [
  ["2x2x2", ""],
  ["skewb", ""],
  ["pyraminx", ""],
  ["3x3x3", "R,U"],
]) {
  const label = `${puzzle}${moveSet ? ` move set ${moveSet}` : " (default moves)"}`;
  const { status, solutions } = await scrambleAndSolve(puzzle, moveSet);
  const solved = /^Found \d+ solution/.test(status);
  check(solved, `${label}: a scramble solves`, solved ? `solution ${JSON.stringify(solutions[0] ?? "")}` : status.slice(0, 90));
  if (solved && moveSet) {
    const allowed = moveSet.split(",").map((m) => m.replace(/['2]+$/, ""));
    const used = (solutions[0] ?? "").split(/\s+/).filter(Boolean).map((m) => m.replace(/['2]+$/, ""));
    const outside = used.filter((m) => !allowed.includes(m));
    check(outside.length === 0, `${label}: solution uses only those moves`, outside.length ? `saw ${outside.join(" ")}` : "");
  }
}

await browser.close();
console.log(failures === 0 ? "All scramble checks passed." : `${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
