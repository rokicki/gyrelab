// Sticker colors and reachability, for all PG named puzzles and some custom
// descriptions:
// - a random reachable state round-trips through colors and is reachable;
// - swapped, twisted, and rotated variants get the same verdict from our
//   Schreier-Sims as from twsearch's --checkbeforesolve (where twsearch can
//   check: all pieces distinct in its puzzle).
// Run from the gyrelab directory: bun test/colors-test.ts [descriptions...]
import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { KPattern, KPuzzle } from "cubing/kpuzzle";
import { ExperimentalPGNotation, getPG3DNamedPuzzles, getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";
import { ReachabilityChecker, rotationTransformations } from "../src/color-check";
import { buildStickerModel, colorsToPattern, patternToColors } from "../src/sticker-colors";
import { ksolveMoveNames, patternToScrambleState, twsearchKsolve } from "../src/twsearch-state";

const twsearch = new URL("../twsearch/build/bin/twsearch", import.meta.url).pathname;
const custom = ["c f 0.2 v 0.8", "d f 0.5 e 0.9", "o f 0.3 v 0.6", "t v 0.2 e 0.5", "i v 0.8"];
const args = process.argv.slice(2);
const descs: [string, string][] = args.length
  ? args.map((d) => [d, d])
  : [...Object.entries(getPG3DNamedPuzzles()), ...custom.map((d): [string, string] => [`custom ${d}`, d])];
const skip = new Set(["30x30x30", "40x40x40", "zetaminx", "yottaminx"]); // twsearch refuses these
const timings: [string, number][] = [];
let ok = 0, oracleChecks = 0, disagreements = 0;
const failures: string[] = [];

function oracle(pattern: KPattern, displayKsolve: string, tws: string): string | null {
  let state: string;
  try {
    state = patternToScrambleState(pattern, tws);
  } catch {
    return "unreachable"; // e.g. rotated centers
  }
  const f = `/tmp/claude-colors-${process.pid}`;
  writeFileSync(`${f}.tws`, tws); writeFileSync(`${f}.scr`, state);
  const r = spawnSync(twsearch, ["--nowrite", "-M", "64", "--quiet", "--checkbeforesolve", "--maxdepth", "0", `${f}.tws`, `${f}.scr`], { encoding: "utf8" });
  unlinkSync(`${f}.tws`); unlinkSync(`${f}.scr`);
  if (/Ignoring --checkbeforesolve/.test(r.stderr)) return null; // twsearch can't check
  return r.stdout.includes("Ignoring unsolvable position") ? "unreachable" : "reachable";
}

for (const [label, desc] of descs) {
  if (skip.has(label)) continue;
  try {
    const pg = getPuzzleGeometryByDesc(desc, { allMoves: true, orientCenters: true, addRotations: true });
    const notation = new ExperimentalPGNotation(pg, pg.getOrbitsDef(true));
    const kpuzzle = new KPuzzle(notation.remapKPuzzleDefinition(pg.getKPuzzleDefinition(true)), { experimentalPGNotation: notation });
    const model = buildStickerModel(pg, kpuzzle);
    const tws = twsearchKsolve(desc);
    const displayKsolve = pg.writeksolve("TwizzlePuzzle");
    const { moves, rotations } = ksolveMoveNames(tws);
    const t0 = performance.now();
    const checker = new ReachabilityChecker(model, moves.map((m) => kpuzzle.algToTransformation(m)), rotationTransformations(pg, kpuzzle));
    timings.push([label, performance.now() - t0]);

    const random = Array.from({ length: 40 }, () => moves[Math.floor(Math.random() * moves.length)]).join(" ");
    const pattern = kpuzzle.defaultPattern().applyAlg(random);
    const colors = patternToColors(model, pattern);
    const read = colorsToPattern(model, colors);
    if (!read.pattern) throw new Error(`reading colors: ${read.problems.map((p) => p.message).join("; ")}`);
    const back = patternToColors(model, read.pattern);
    for (const [k, c] of colors) if (back.get(k) !== c) throw new Error(`colors differ after round trip at ${k}`);
    const v = checker.check(read.pattern);
    if (v !== "reachable") throw new Error(`random reachable state judged ${v}`);

    // Variants.
    const variants: [string, KPattern][] = [];
    const dist = model.orbits.find((o) => o.positionsDistinguishable && o.numPieces >= 2);
    if (dist) {
      const data = structuredClone(pattern.patternData);
      const o = data[dist.name];
      [o.pieces[0], o.pieces[1]] = [o.pieces[1], o.pieces[0]];
      [o.orientation[0], o.orientation[1]] = [o.orientation[1], o.orientation[0]];
      variants.push([`swap ${dist.name}`, new KPattern(kpuzzle, data)]);
    }
    const twisty = model.orbits.find((o) => o.positionsDistinguishable && o.twistsVisible && o.numOrientations > 1);
    if (twisty) {
      const data = structuredClone(pattern.patternData);
      const o = data[twisty.name];
      o.orientation[0] = (o.orientation[0] + 1) % twisty.numOrientations;
      variants.push([`twist ${twisty.name}`, new KPattern(kpuzzle, data)]);
    }
    for (const [i, r] of rotationTransformations(pg, kpuzzle).slice(0, 3).entries()) variants.push([`rotation ${i}`, pattern.applyTransformation(r)]);
    for (const [what, variant] of variants) {
      if (process.env.NO_ORACLE) { checker.check(variant); continue; }
      const ours = checker.check(variant);
      const theirs = oracle(variant, displayKsolve, tws);
      if (theirs === null) continue;
      oracleChecks++;
      // twsearch doesn't distinguish rotated from unreachable.
      const oursPlain = ours === "rotated" ? "unreachable" : ours;
      if (oursPlain !== theirs) {
        disagreements++;
        failures.push(`${label}: ${what}: ours ${ours}, twsearch ${theirs}`);
      }
    }
    ok++;
  } catch (e) {
    failures.push(`${label}: ${(e as Error).message}`);
  }
}
console.log(`${ok} of ${descs.length - [...skip].filter((s) => descs.some(([l]) => l === s)).length} puzzles round-trip and judge a random state reachable; ${oracleChecks} variant verdicts compared with twsearch, ${disagreements} disagreements`);
for (const f of failures) console.log("  FAIL", f);
timings.sort((a, b) => b[1] - a[1]);
console.log("slowest checker builds:", timings.slice(0, 6).map(([l, t]) => `${l} ${t.toFixed(0)}ms`).join(", "));
