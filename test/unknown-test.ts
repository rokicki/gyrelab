// Places nobody asked about: the puzzle twsearch is given makes them
// interchangeable, the position says the same, and the solution leaves the
// places that were asked about solved while putting anything it likes in
// the rest.  Run from the gyrelab directory: bun test/unknown-test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KPattern, KPuzzle } from "cubing/kpuzzle";
import { getPG3DNamedPuzzles, getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";
import { ksolveWithUnknowns, patternToScrambleState, twsearchKsolve, unknownsForTwsearch, type Unknowns } from "../src/twsearch-state";
import { buildStickerModel, colorsToPattern, patternToColors, solvedColors, stickerKey } from "../src/sticker-colors";
import { ReachabilityChecker } from "../src/color-check";
import { isRotationName } from "../src/twsearch-state";

const twsearch = new URL("../twsearch/build/bin/twsearch", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "unknown-"));
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
};

function solve(tws: string, scramble: string, args: string[] = []): string {
  const f = join(dir, "p.tws");
  const g = join(dir, "p.scr");
  writeFileSync(f, tws);
  writeFileSync(g, scramble);
  return execFileSync(twsearch, ["--quiet", "-M", "64", "--nowrite", ...args, f, g], { encoding: "utf8" });
}

const named = getPG3DNamedPuzzles();
for (const [name, alg, orbit, keep] of [
  ["2x2x2", "R U R' F R", "CORNERS", 4],
  ["3x3x3", "R U R' F' U2 R", "EDGES", 6],
] as [string, string, string, number][]) {
  const desc = named[name];
  const tws = twsearchKsolve(desc);
  const pg = getPuzzleGeometryByDesc(desc, { allMoves: false, orientCenters: false, addRotations: true });
  const kpuzzle = new KPuzzle(pg.getKPuzzleDefinition(true));
  const pattern = kpuzzle.defaultPattern().applyAlg(alg as any);

  // Give away every place in the set past the first `keep`.
  const size = Number(tws.match(new RegExp(`^Set ${orbit} (\\d+)`, "m"))![1]);
  const unknown: Unknowns = new Map([[orbit, new Set([...Array(size - keep).keys()].map((i) => i + keep))]]);

  const puzzle = ksolveWithUnknowns(tws, unknown);
  const solvedRow = puzzle.slice(puzzle.indexOf("Solved")).split("\n").slice(0, 8).join(" | ");
  check(/\?/.test(puzzle), `${name}: the puzzle says some places are unasked-about`, solvedRow.slice(0, 90));

  const scramble = patternToScrambleState(pattern, puzzle, undefined, undefined, false, unknown);
  check(/\?/.test(scramble), `${name}: so does the position`);

  const out = solve(puzzle, scramble);
  const line = (out.match(/^ .*$/m) ?? [""])[0].trim();
  check(/Found \d+ solution/.test(out), `${name}: twsearch solves it`, line);

  // The whole puzzle, solved the ordinary way, for comparison.
  const full = solve(tws, patternToScrambleState(pattern, tws));
  const fullLine = (full.match(/^ .*$/m) ?? [""])[0].trim();
  check(line.split(/\s+/).filter(Boolean).length <= fullLine.split(/\s+/).filter(Boolean).length,
    `${name}: and does not need more moves than solving everything`,
    `${line.split(/\s+/).filter(Boolean).length} vs ${fullLine.split(/\s+/).filter(Boolean).length}`);

  // What it found really is solved as far as it was asked.
  const after = pattern.applyAlg(line as any);
  const home = kpuzzle.defaultPattern();
  const asked = [...Array(keep).keys()];
  const kept = asked.every((i) => {
    const o = after.patternData[orbit] ?? after.patternData[Object.keys(after.patternData)[0]];
    return o.pieces[i] === home.patternData[orbit].pieces[i] && (o.orientation[i] ?? 0) === 0;
  });
  check(kept, `${name}: the places that were asked about end up solved`);
}

// The whole way through, as the Colors tab will do it: paint some pieces of
// a scrambled 4x4x4, leave the rest blank, and check that what twsearch
// gives back leaves the painted pieces where they were asked to be.
{
  const desc = named["4x4x4"];
  const tws = twsearchKsolve(desc);
  const pg = getPuzzleGeometryByDesc(desc, { allMoves: true, orientCenters: true, addRotations: true });
  const kpuzzle = new KPuzzle(pg.getKPuzzleDefinition(true));
  const model = buildStickerModel(pg, kpuzzle);
  const pattern = kpuzzle.defaultPattern().applyAlg("R U R' F2 U" as any);
  const painted = new Map(
    [...patternToColors(model, pattern)].map(([k, c]) => [k, k.startsWith("CORNERS-") ? c : null]),
  );
  const reading = colorsToPattern(model, painted);
  check(reading.pattern !== null, "4x4x4: corners painted, the rest blank, reads", reading.problems.map((p) => p.message).join("; "));
  const displayedUnknown = reading.unknown;
  check([...displayedUnknown].some(([, places]) => places.size > 0), "4x4x4: and says which places nobody asked about",
    [...displayedUnknown].map(([o, p]) => `${o}:${p.size}`).join(" "));

  const unknown = unknownsForTwsearch(reading.pattern!, tws, displayedUnknown);
  const puzzle = ksolveWithUnknowns(tws, unknown);
  const scramble = patternToScrambleState(reading.pattern!, puzzle, undefined, undefined, false, unknown);
  const out = solve(puzzle, scramble, ["-M", "256"]);
  const line = (out.match(/^ .*$/m) ?? [""])[0].trim();
  check(/Found \d+ solution/.test(out), "4x4x4: twsearch solves the corners and ignores the rest", line);

  const after = reading.pattern!.applyAlg(line as any);
  const home = kpuzzle.defaultPattern();
  const corners = after.patternData.CORNERS;
  const cornersOk = corners.pieces.every((p, i) => p === home.patternData.CORNERS.pieces[i])
    && corners.orientation.every((o) => o === 0);
  check(cornersOk, "4x4x4: and the corners really are solved");
}


// Blanks do not blind the check.  A 3x3x3 with every edge left blank and
// one corner twisted is still impossible, and the corners say so on their
// own; with the corners blank instead, nothing can be said about them.
{
  const desc = named["3x3x3"];
  const pg = getPuzzleGeometryByDesc(desc, { allMoves: true, orientCenters: true, addRotations: true });
  const kpuzzle = new KPuzzle(pg.getKPuzzleDefinition(true));
  const model = buildStickerModel(pg, kpuzzle);
  const names = Object.keys(kpuzzle.definition.moves);
  const transformations = names.map((n) => kpuzzle.algToTransformation(n));
  const rotations = names.filter((n) => /v$|^[xyz]/.test(n)).map((n) => kpuzzle.algToTransformation(n));

  const twisted = kpuzzle.defaultPattern();
  const data = structuredClone(twisted.patternData);
  data.CORNERS.orientation[0] = (data.CORNERS.orientation[0] + 1) % 3;
  const bad = new KPattern(kpuzzle, data);

  const ignoring = (orbits: string[]) =>
    new ReachabilityChecker(model, transformations, rotations, (name) => (orbits.includes(name) ? 3 : 0));
  check(ignoring(["EDGES", "CENTERS"]).check(bad) === "unreachable",
    "a twisted corner is still caught when every edge is blank");
  check(ignoring(["CORNERS", "EDGES", "CENTERS"]).check(bad) === "reachable",
    "and is not claimed to be caught when the corners are blank too");
}


// An orbit check the group check cannot make: the FTO's centers are two
// parts of twelve places, four colors in each, and no turn takes a color
// from one part to the other.  Schreier-Sims says nothing about them (the
// pieces are not all distinguishable), so without this they were accepted.
{
  const desc = named["FTO"];
  const pg = getPuzzleGeometryByDesc(desc, { allMoves: true, orientCenters: true, addRotations: true });
  const kpuzzle = new KPuzzle(pg.getKPuzzleDefinition(true));
  const model = buildStickerModel(pg, kpuzzle);
  const names2 = Object.keys(kpuzzle.definition.moves);
  const moves = names2.filter((n) => !isRotationName(n)).map((n) => kpuzzle.algToTransformation(n));
  const rotations = names2.filter(isRotationName).map((n) => kpuzzle.algToTransformation(n));
  const checker = new ReachabilityChecker(model, moves, rotations);
  const solved = solvedColors(model);
  const colorAt = (loc: number) => solved.get(stickerKey("CENTERS", loc, 0))!;
  const swapped = new Map(solved);
  swapped.set(stickerKey("CENTERS", 0, 0), colorAt(12));   // places 0 and 12
  swapped.set(stickerKey("CENTERS", 12, 0), colorAt(0));   // are in different parts
  const read = (colors: Map<string, string | null>) =>
    colorsToPattern(model, colors, [...moves, ...rotations]).pattern!;
  check(checker.check(read(swapped)) === "unreachable",
    "FTO: a center color in a part it can never reach is refused");
  const blanks = [3, 5, 7, 15, 17, 19];
  const withBlanks = new Map(swapped);
  for (const b of blanks) withBlanks.set(stickerKey("CENTERS", b, 0), null);
  check(checker.check(read(withBlanks), new Map([["CENTERS", new Set(blanks)]])) === "unreachable",
    "FTO: and still refused with six other centers left blank");
  check(checker.check(read(solved)) === "reachable", "FTO: while the solved position is fine");
}

console.log(failures === 0 ? "All unknown-place checks passed." : `${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
