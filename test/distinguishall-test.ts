// --distinguishall: twsearch solves the superpuzzle, where pieces that look
// alike are still told apart.  The Explorer must export the position against
// the identity labeling, since that option throws away the solved state that
// names pieces by color.
//
//    node test/run-ts.mjs test/distinguishall-test.ts
import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { KPattern, KPuzzle } from "cubing/kpuzzle";
import { buildStickerModel, type StickerModel } from "../src/sticker-colors";
import { ExperimentalPGNotation, getPuzzleDescriptionString, getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";
import { patternToScrambleState, twsearchKsolve } from "../src/twsearch-state";

const twsearch = `${process.cwd()}/../twsearch/build/bin/twsearch`;
// puzzle, and either an alg or a 3-cycle of pieces that look alike, which is
// invisible on the puzzle itself and only exists in the superpuzzle.
type Case = { name: string; alg?: string; cycleLookalikes?: string; what: string };
const cases: Case[] = [
  { name: "3x3x3", alg: "R U R' F2", what: "an ordinary scramble" },
  { name: "megaminx", alg: "R U F", what: "an ordinary scramble" },
  { name: "4x4x4", alg: "R U 2F", what: "an ordinary scramble" },
  { name: "skewb", alg: "U L R", what: "an ordinary scramble" },
  { name: "4x4x4", cycleLookalikes: "CENTERS", what: "three same-color centers cycled" },
  { name: "5x5x5", cycleLookalikes: "CENTERS2", what: "three same-color centers cycled" },
];

/**
 * A position that looks solved but is not: three pieces of one orbit that
 * show the same colors, cycled among their places.
 */
function cycleLookalikes(kpuzzle: KPuzzle, model: StickerModel, orbitName: string) {
  const orbit = model.orbits.find((o) => o.name === orbitName);
  if (!orbit) throw new Error(`no orbit ${orbitName}`);
  const byColors = new Map<string, number[]>();
  for (let loc = 0; loc < orbit.numPieces; loc++) {
    const colors = [...Array(orbit.numOrientations).keys()]
      .map((f) => model.solved.get(`${orbitName}-l${loc}-o${f}`))
      .join(",");
    byColors.set(colors, [...(byColors.get(colors) ?? []), loc]);
  }
  const alike = [...byColors.values()].find((locs) => locs.length >= 3);
  if (!alike) throw new Error(`no three pieces of ${orbitName} look alike`);
  const pattern = kpuzzle.defaultPattern();
  const data = JSON.parse(JSON.stringify(pattern.patternData));
  const [a, b, c] = alike;
  data[orbitName].pieces[a] = b;
  data[orbitName].pieces[b] = c;
  data[orbitName].pieces[c] = a;
  return new KPattern(kpuzzle, data);
}

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
};

function solve(tws: string, state: string, args: string[]): { solution: string; refused: boolean; error: string } {
  const f = `/tmp/claude-distinguishall-${process.pid}`;
  writeFileSync(`${f}.tws`, tws);
  writeFileSync(`${f}.scr`, state);
  const r = spawnSync(twsearch, ["--nowrite", "-M", "256", "--quiet", "--checkbeforesolve", ...args, `${f}.tws`, `${f}.scr`], { encoding: "utf8", timeout: 600000 });
  unlinkSync(`${f}.tws`);
  unlinkSync(`${f}.scr`);
  return {
    solution: (r.stdout.match(/^ .*$/m) ?? [""])[0].trim(),
    refused: /Ignoring unsolvable position/.test(r.stdout),
    error: r.status === 0 ? "" : r.stderr.trim().slice(0, 80),
  };
}

for (const { name, alg, cycleLookalikes: lookalikeOrbit, what } of cases) {
  const desc = getPuzzleDescriptionString(name);
  const tws = twsearchKsolve(desc);
  const pg = getPuzzleGeometryByDesc(desc, { allMoves: false, orientCenters: false, addRotations: true });
  const notation = new ExperimentalPGNotation(pg, pg.getOrbitsDef(true));
  const kpuzzle = new KPuzzle(notation.remapKPuzzleDefinition(pg.getKPuzzleDefinition(true)) as any, { experimentalPGNotation: notation } as any);
  const label = `${name} ${alg ? `"${alg}"` : `(${what})`}`;
  let pattern: KPattern;
  try {
    pattern = alg
      ? kpuzzle.defaultPattern().applyAlg(alg)
      : cycleLookalikes(kpuzzle, await buildStickerModel(pg, kpuzzle), lookalikeOrbit!);
  } catch (e) {
    check(false, label, `could not build the position: ${(e as Error).message}`);
    continue;
  }
  if (lookalikeOrbit) {
    // The puzzle itself cannot show this position, so twsearch without the
    // option must consider it already solved.
    const plain = solve(tws, patternToScrambleState(pattern, tws), []);
    check(plain.solution === "", `${label} is invisible without --distinguishall`,
      plain.solution === "" ? "already solved as it stands" : `found "${plain.solution}"`);
  }
  const state = patternToScrambleState(pattern, tws, undefined, () => 0, true);
  const { solution, refused, error } = solve(tws, state, ["--distinguishall"]);
  if (refused || error) {
    check(false, `${label} (${what})`, refused ? "twsearch called it unsolvable" : error);
    continue;
  }
  // The solution must put the displayed puzzle back to solved.
  const after = pattern.applyAlg(solution);
  const solvedPattern = kpuzzle.defaultPattern();
  let same = true;
  for (const orbit of Object.keys(after.patternData)) {
    const a = after.patternData[orbit], b = solvedPattern.patternData[orbit];
    for (let i = 0; i < a.pieces.length; i++) {
      if (a.pieces[i] !== b.pieces[i] || (a.orientation[i] ?? 0) !== (b.orientation[i] ?? 0)) same = false;
    }
  }
  check(same, `${label} (${what})`, `solution "${solution}" ${same ? "solves it" : "does NOT solve it"}`);
}

console.log(failures === 0 ? "All --distinguishall checks passed." : `${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
