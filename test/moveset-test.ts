// State mapping and reachability for move sets, checked against twsearch.
//
// For every PG named puzzle with its default move set, and for a list of
// custom move sets:
// - a random sequence of the move set's moves, applied to the Explorer's
//   puzzle and mapped to twsearch's, must equal twsearch's own
//   --showpositions for the same sequence;
// - that state must be judged reachable;
// - swapped, twisted, and rotated variants must get the same verdict as
//   twsearch's --checkbeforesolve (where twsearch can check: all pieces
//   distinct in its puzzle).
//
// Needs the native twsearch (bun run build-twsearch):
//    bun test/moveset-test.ts [--no-oracle] [puzzle name ...]
import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { KPattern, KPuzzle } from "cubing/kpuzzle";
import { ExperimentalPGNotation, getPG3DNamedPuzzles, getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";
import { ReachabilityChecker, rotationTransformations } from "../src/color-check";
import { buildStickerModel } from "../src/sticker-colors";
import { ksolveMoveNames, patternToScrambleState, twsearchKsolve } from "../src/twsearch-state";

const twsearch = new URL("../twsearch/build/bin/twsearch", import.meta.url).pathname;
const args = process.argv.slice(2);
const noOracle = args.includes("--no-oracle");
const only = args.filter((a) => !a.startsWith("--"));
const named = getPG3DNamedPuzzles() as Record<string, string>;
const refused = new Set(["30x30x30", "40x40x40", "zetaminx", "yottaminx"]); // twsearch refuses these

const cases: [string, string[]][] = [
  ...Object.keys(named).filter((n) => !refused.has(n)).map((n): [string, string[]] => [n, []]),
  ["3x3x3", ["U", "R", "F"]],
  ["3x3x3", ["u", "r", "f"]],
  ["3x3x3", ["R", "U", "M"]],
  ["3x3x3", ["Rw", "U"]],
  ["3x3x3", ["R", "U"]],
  ["3x3x3", ["U", "D", "F", "B", "L", "R", "M", "E", "S"]],
  ["2x2x2", ["U", "R", "F"]],
  ["4x4x4", ["U", "R", "F", "r", "u"]],
  ["4x4x4", ["Rw", "U", "F"]],
  ["5x5x5", ["U", "R", "F", "D", "L", "B", "u", "r"]],
  ["megaminx", ["U", "R"]],
  ["megaminx", ["U", "R", "F"]],
  ["skewb", ["R", "U"]],
  ["pyraminx", ["R", "U", "L", "B"]],
  ["FTO", ["U", "R", "F"]],
  ["dino", ["UFR", "UBL"]],
].filter(([n]) => only.length === 0 || only.includes(n));

let passed = 0;
let verdicts = 0;
const failures: string[] = [];

/** twsearch's verdict (--checkbeforesolve), or null if it can't check. */
function oracle(pattern: KPattern, tws: string): string | null {
  let state: string;
  try {
    state = patternToScrambleState(pattern, tws);
  } catch {
    return "unreachable"; // pieces no move moves are out of place
  }
  const f = `/tmp/claude-moveset-${process.pid}`;
  writeFileSync(`${f}.tws`, tws);
  writeFileSync(`${f}.scr`, state);
  const r = spawnSync(twsearch, ["--nowrite", "-M", "64", "--quiet", "--checkbeforesolve", "--maxdepth", "0", `${f}.tws`, `${f}.scr`], { encoding: "utf8" });
  unlinkSync(`${f}.tws`);
  unlinkSync(`${f}.scr`);
  if (/Ignoring --checkbeforesolve/.test(r.stderr)) return null;
  return r.stdout.includes("Ignoring unsolvable position") ? "unreachable" : "reachable";
}

for (const [name, moveSet] of cases) {
  const label = `${name}${moveSet.length ? ` [${moveSet.join(",")}]` : ""}`;
  try {
    const desc = named[name];
    const pg = getPuzzleGeometryByDesc(desc, { allMoves: true, orientCenters: true, addRotations: true });
    const notation = new ExperimentalPGNotation(pg, pg.getOrbitsDef(true));
    const kpuzzle = new KPuzzle(notation.remapKPuzzleDefinition(pg.getKPuzzleDefinition(true)), { experimentalPGNotation: notation });
    const tws = twsearchKsolve(desc, moveSet);
    const { moves } = ksolveMoveNames(tws);

    // Mapping vs twsearch --showpositions.
    const order = (m: string) => kpuzzle.algToTransformation(m).repetitionOrder();
    const seq = Array.from({ length: 30 }, () => {
      const m = moves[Math.floor(Math.random() * moves.length)];
      return Math.random() < 0.5 || order(m) <= 2 ? m : `${m}'`;
    }).join(" ");
    const pattern = kpuzzle.defaultPattern().applyAlg(seq);
    const state = patternToScrambleState(pattern, tws);
    const f = `/tmp/claude-moveset-${process.pid}`;
    writeFileSync(`${f}.tws`, tws);
    const shown = spawnSync(twsearch, ["--quiet", "--showpositions", `${f}.tws`], { input: `${seq}\n`, encoding: "utf8" });
    unlinkSync(`${f}.tws`);
    if (shown.status !== 0) throw new Error(`twsearch: ${shown.stderr.trim()}`);
    const expected = new Map<string, string[]>();
    let cur = "";
    for (const line of shown.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
      if (/^\d/.test(line)) expected.get(cur)!.push(line);
      else if (!/^(Scramble|End)/.test(line)) expected.set((cur = line), []);
    }
    const lines = state.split("\n").slice(1).filter((l) => l && l !== "End");
    for (let i = 0; i < lines.length; i += 3) {
      const [perm, ori] = expected.get(lines[i]) ?? [];
      const gotPerm = lines[i + 1].split(" ").map((v) => Number(v) + 1).join(" ");
      const oriOK = ori === undefined ? /^0( 0)*$/.test(lines[i + 2]) : ori === lines[i + 2];
      if (gotPerm !== perm || !oriOK) throw new Error(`${lines[i]} differs from twsearch after ${seq}`);
    }

    // Reachability.
    const model = buildStickerModel(pg, kpuzzle);
    const checker = new ReachabilityChecker(model, moves.map((m) => kpuzzle.algToTransformation(m)), rotationTransformations(pg, kpuzzle));
    const v = checker.check(pattern);
    if (v !== "reachable") throw new Error(`a state reached with the moves was judged ${v}`);

    if (!noOracle) {
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
        data[twisty.name].orientation[0] = (data[twisty.name].orientation[0] + 1) % twisty.numOrientations;
        variants.push([`twist ${twisty.name}`, new KPattern(kpuzzle, data)]);
      }
      for (const r of rotationTransformations(pg, kpuzzle).slice(0, 2)) variants.push(["rotated", pattern.applyTransformation(r)]);
      for (const [what, variant] of variants) {
        const theirs = oracle(variant, tws);
        if (theirs === null) continue;
        verdicts++;
        const ours = checker.check(variant) === "reachable" ? "reachable" : "unreachable";
        if (ours !== theirs) failures.push(`${label}: ${what}: ours ${checker.check(variant)}, twsearch ${theirs}`);
      }
    }
    passed++;
  } catch (e) {
    failures.push(`${label}: ${(e as Error).message}`);
  }
}
console.log(`${passed} of ${cases.length} (puzzle, move set) cases map exactly like twsearch and judge their states reachable; ${verdicts} variant verdicts compared with twsearch`);
for (const f of failures) console.log("  FAIL", f);
