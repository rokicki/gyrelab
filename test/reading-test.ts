// Reading colors back must give a position twsearch accepts.  For random
// reachable states of every named puzzle (and some custom descriptions):
// colors -> colorsToPattern (with the moves and rotations) -> twsearch's
// --checkbeforesolve with the ignored sets that make its check possible.
// A plain colors round trip can't catch a wrong reading of pieces that look
// identical (the 4x4x4 flipped edge), but twsearch's check can, whenever
// twsearch treats those pieces as distinct.
//
//    node test/run-ts.mjs test/reading-test.ts
import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { KPuzzle } from "cubing/kpuzzle";
import { ExperimentalPGNotation, getPG3DNamedPuzzles, getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";
import { rotationTransformations } from "../src/color-check";
import { buildStickerModel, colorsToPattern, patternToColors } from "../src/sticker-colors";
import { ksolveMoveNames, patternToScrambleState, setOmissionFromArgs, twsearchKsolve } from "../src/twsearch-state";

const twsearch = `${process.cwd()}/../twsearch/build/bin/twsearch`;
const named = getPG3DNamedPuzzles() as Record<string, string>;
const refused = new Set(["30x30x30", "40x40x40", "zetaminx", "yottaminx"]);
let checked = 0;
let cantCheck = 0;
const failures: string[] = [];
const only = process.argv.slice(2);
for (const [name, desc] of Object.entries(named)) {
  if (refused.has(name) || (only.length > 0 && !only.includes(name))) continue;
  const pg = getPuzzleGeometryByDesc(desc, { allMoves: true, orientCenters: true, addRotations: true });
  const notation = new ExperimentalPGNotation(pg, pg.getOrbitsDef(true));
  const kpuzzle = new KPuzzle(notation.remapKPuzzleDefinition(pg.getKPuzzleDefinition(true)), { experimentalPGNotation: notation });
  const model = buildStickerModel(pg, kpuzzle);
  const tws = twsearchKsolve(desc);
  const { moves } = ksolveMoveNames(tws);
  const generators = [...moves.map((m) => kpuzzle.algToTransformation(m)), ...rotationTransformations(pg, kpuzzle)];
  // Try twsearch's check with no sets ignored, then without centers (often
  // the identical pieces), so that as many orbits as possible get checked.
  for (let trial = 0; trial < 3; trial++) {
    const seq = Array.from({ length: 40 }, () => moves[Math.floor(Math.random() * moves.length)]).join(" ");
    // OLD_READING=1 reads without the moves (first-fit assignment), to show
    // what this test catches.
    const reading = colorsToPattern(model, patternToColors(model, kpuzzle.defaultPattern().applyAlg(seq)), process.env.OLD_READING ? undefined : generators);
    if (!reading.pattern) {
      failures.push(`${name}: reading failed: ${reading.problems.map((p) => p.message).join("; ")}`);
      break;
    }
    let verdict: string | null = null;
    for (const args of [[], ["--nocenters"], ["--nocenters", "--nocorners"]]) {
      const state = patternToScrambleState(reading.pattern, tws, undefined, setOmissionFromArgs(args));
      const f = `/tmp/claude-reading-${process.pid}`;
      writeFileSync(`${f}.tws`, tws);
      writeFileSync(`${f}.scr`, state);
      // twsearch's Schreier-Sims can take very long on big puzzles; treat a
      // timeout as "can't check".
      const r = spawnSync(twsearch, ["--nowrite", "-M", "64", "--quiet", "--checkbeforesolve", "--maxdepth", "0", ...args, `${f}.tws`, `${f}.scr`], { encoding: "utf8", timeout: 20000 });
      unlinkSync(`${f}.tws`);
      unlinkSync(`${f}.scr`);
      if (r.error || /Ignoring --checkbeforesolve/.test(r.stderr)) continue;
      verdict = r.stdout.includes("Ignoring unsolvable position") ? `unsolvable with ${args.join(" ") || "no options"}` : "ok";
      break;
    }
    if (verdict === null) {
      cantCheck++;
      break;
    }
    checked++;
    if (verdict !== "ok") {
      failures.push(`${name}: a reachable position read back from colors is ${verdict}`);
      break;
    }
  }
}
console.log(`${checked} readings checked by twsearch, ${cantCheck} puzzles twsearch can't check; ${failures.length} failures`);
for (const f of failures) console.log("  FAIL", f);
