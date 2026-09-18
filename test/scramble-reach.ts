// For a puzzle description or name: Scramble-button states, our reachability
// verdict, and whether native twsearch solves them within a depth limit.
//    bun test/scramble-reach.ts mastermorphix [trials]
import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { KPuzzle, KTransformation } from "cubing/kpuzzle";
import { ExperimentalPGNotation, getPG3DNamedPuzzles, getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";
import { ReachabilityChecker, rotationTransformations } from "../src/color-check";
import { buildStickerModel } from "../src/sticker-colors";
import { ksolveMoveNames, patternToScrambleState, twsearchKsolve } from "../src/twsearch-state";

const [nameOrDesc = "mastermorphix", trials = "8"] = process.argv.slice(2);
const desc = (getPG3DNamedPuzzles() as Record<string, string>)[nameOrDesc] ?? nameOrDesc;
const pg = getPuzzleGeometryByDesc(desc, { allMoves: true, orientCenters: true, addRotations: true });
const notation = new ExperimentalPGNotation(pg, pg.getOrbitsDef(true));
const kpuzzle = new KPuzzle(notation.remapKPuzzleDefinition(pg.getKPuzzleDefinition(true)), { experimentalPGNotation: notation });
const model = buildStickerModel(pg, kpuzzle);
const tws = twsearchKsolve(desc);
const { moves, rotations } = ksolveMoveNames(tws);
const checker = new ReachabilityChecker(model, moves.map((m) => kpuzzle.algToTransformation(m)), rotationTransformations(pg, kpuzzle));
console.log("orbits:", model.orbits.map((o) => `${o.name}:${o.numPieces}x${o.numOrientations}${o.positionsDistinguishable ? "" : "(count-only)"}`).join(" "), "| checked:", checker.orbits.join(" "));
for (let t = 0; t < Number(trials); t++) {
  const pattern = kpuzzle.defaultPattern().applyTransformation(new KTransformation(kpuzzle, pg.getScramble()));
  const verdict = checker.check(pattern);
  let solve = "";
  try {
    const state = patternToScrambleState(pattern, tws);
    const f = `/tmp/claude-sr-${process.pid}`;
    writeFileSync(`${f}.tws`, tws); writeFileSync(`${f}.scr`, state);
    const r = spawnSync(new URL("../twsearch/build/bin/twsearch", import.meta.url).pathname, ["--nowrite", "-M", "256", "--quiet", "--maxdepth", "16", `${f}.tws`, `${f}.scr`], { encoding: "utf8", timeout: 60000 });
    unlinkSync(`${f}.tws`); unlinkSync(`${f}.scr`);
    solve = (r.stdout.match(/Found \d+ solutions? max depth \d+|No solution found in \d+/) ?? [r.error ? "TIMEOUT" : r.stderr.trim()])[0];
  } catch (e) {
    solve = `mapping error: ${(e as Error).message}`;
  }
  console.log(`trial ${t}: ours ${verdict.padEnd(11)} twsearch (max depth 16): ${solve}`);
}
