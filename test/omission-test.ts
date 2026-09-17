// twsearch options that ignore sets (--nocorners, --nocenters, --noedges,
// --omit, --omitoris, --omitperms, --noorientation): our reachability
// verdict (state mapping plus pre-check, with the options) must match
// twsearch's --checkbeforesolve with the same options, for variants that
// break each orbit in turn (a swapped pair, a twisted piece, a rotation).
// Cases where twsearch can't check (identical pieces left) are skipped.
//
//    node test/run-ts.mjs test/omission-test.ts
import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { KPattern, KPuzzle } from "cubing/kpuzzle";
import { ExperimentalPGNotation, getPG3DNamedPuzzles, getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";
import { ReachabilityChecker, rotationTransformations } from "../src/color-check";
import { buildStickerModel } from "../src/sticker-colors";
import { ksolveMoveNames, patternToScrambleState, setOmissionFromArgs, twsearchKsolve } from "../src/twsearch-state";

const twsearch = `${process.cwd()}/../twsearch/build/bin/twsearch`;
const named = getPG3DNamedPuzzles() as Record<string, string>;
const cases: [string, string[]][] = [
  ["3x3x3", []],
  ["3x3x3", ["--nocorners"]],
  ["3x3x3", ["--noedges"]],
  ["3x3x3", ["--nocenters"]],
  ["3x3x3", ["--omit", "CORNERS"]],
  ["3x3x3", ["--omit", "EDGES"]],
  ["3x3x3", ["--omitoris", "CORNERS"]],
  ["3x3x3", ["--omitoris", "EDGES"]],
  ["3x3x3", ["--omitperms", "EDGES"]],
  ["3x3x3", ["--noorientation"]],
  ["3x3x3", ["--nocorners", "--noedges"]],
  ["2x2x2", ["--noorientation"]],
  ["megaminx", ["--nocorners"]],
  ["megaminx", ["--noedges"]],
  ["skewb", ["--nocenters"]],
  ["pyraminx", ["--noedges"]],
  ["pyraminx", ["--omit", "CORNERS2"]],
  ["FTO", ["--nocorners"]],
  ["FTO", ["--noedges"]],
  ["master skewb", ["--nocenters"]],
];

let compared = 0;
const failures: string[] = [];
// Cases where our pre-check passes a position that twsearch then refuses.
const lenient: string[] = [];
for (const [name, args] of cases) {
  const label = `${name} ${args.join(" ")}`;
  try {
    const desc = named[name];
    const pg = getPuzzleGeometryByDesc(desc, { allMoves: true, orientCenters: true, addRotations: true });
    const notation = new ExperimentalPGNotation(pg, pg.getOrbitsDef(true));
    const kpuzzle = new KPuzzle(notation.remapKPuzzleDefinition(pg.getKPuzzleDefinition(true)), { experimentalPGNotation: notation });
    const tws = twsearchKsolve(desc);
    const { moves } = ksolveMoveNames(tws);
    const model = buildStickerModel(pg, kpuzzle);
    const omission = setOmissionFromArgs(args);
    const checker = new ReachabilityChecker(model, moves.map((m) => kpuzzle.algToTransformation(m)), rotationTransformations(pg, kpuzzle), omission);
    const seq = Array.from({ length: 25 }, () => moves[Math.floor(Math.random() * moves.length)]).join(" ");
    const pattern = kpuzzle.defaultPattern().applyAlg(seq);

    const variants: [string, KPattern][] = [["reachable", pattern]];
    for (const orbit of model.orbits) {
      if (orbit.numPieces >= 2) {
        const data = structuredClone(pattern.patternData);
        const o = data[orbit.name];
        [o.pieces[0], o.pieces[1]] = [o.pieces[1], o.pieces[0]];
        [o.orientation[0], o.orientation[1]] = [o.orientation[1], o.orientation[0]];
        variants.push([`swap ${orbit.name}`, new KPattern(kpuzzle, data)]);
      }
      if (orbit.numOrientations > 1) {
        const data = structuredClone(pattern.patternData);
        data[orbit.name].orientation[0] = (data[orbit.name].orientation[0] + 1) % orbit.numOrientations;
        variants.push([`twist ${orbit.name}`, new KPattern(kpuzzle, data)]);
      }
    }
    for (const r of rotationTransformations(pg, kpuzzle).slice(0, 2)) variants.push(["rotated", pattern.applyTransformation(r)]);

    for (const [what, variant] of variants) {
      let ours: string;
      let state: string | null = null;
      try {
        state = patternToScrambleState(variant, tws, undefined, omission);
        ours = checker.check(variant) === "reachable" ? "reachable" : "unreachable";
      } catch {
        ours = "unreachable";
      }
      // twsearch's verdict needs a state; for positions our mapping refuses,
      // map without the unmoved-pieces check... there is no such option, so
      // skip those (they are refused before twsearch runs).
      if (state === null) continue;
      const f = `/tmp/claude-omission-${process.pid}`;
      writeFileSync(`${f}.tws`, tws);
      writeFileSync(`${f}.scr`, state);
      const r = spawnSync(twsearch, ["--nowrite", "-M", "64", "--quiet", "--checkbeforesolve", "--maxdepth", "0", ...args, `${f}.tws`, `${f}.scr`], { encoding: "utf8" });
      unlinkSync(`${f}.tws`);
      unlinkSync(`${f}.scr`);
      if (/Ignoring --checkbeforesolve/.test(r.stderr)) continue;
      if (r.status !== 0) throw new Error(`twsearch: ${r.stderr.trim()}`);
      const theirs = r.stdout.includes("Ignoring unsolvable position") ? "unreachable" : "reachable";
      compared++;
      if (ours === theirs) continue;
      // Being more permissive is safe as long as twsearch itself catches the
      // position: the search stops at once with its own message.  (It does
      // this for sets it can only check roughly, such as the orientation sum
      // of a set whose permutation --omitperms ignores.)
      if (ours === "reachable" && theirs === "unreachable") {
        lenient.push(`${label}: ${what}`);
        continue;
      }
      failures.push(`${label}: ${what}: ours ${ours}, twsearch ${theirs}`);
    }
  } catch (e) {
    failures.push(`${label}: ${(e as Error).message}`);
  }
}
console.log(`${cases.length} option cases; ${compared} verdicts compared with twsearch; ${failures.length} failures, ${lenient.length} left to twsearch`);
for (const l of lenient) console.log("  lenient (twsearch refuses it):", l);
for (const f of failures) console.log("  FAIL", f);
