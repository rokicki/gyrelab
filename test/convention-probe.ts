// How do old-style ksolve Move blocks (as PuzzleGeometry writes them) relate
// to KTransformation data for the same move?  Try candidate formulas on every
// move shared by name, for several puzzles.
import { KPuzzle } from "cubing/kpuzzle";
import { ExperimentalPGNotation, getPG3DNamedPuzzles, getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";
const results = new Map<string, number>();
let checked = 0;
for (const [name, desc] of Object.entries(getPG3DNamedPuzzles() as Record<string, string>)) {
  if (/30x|40x|zeta|yotta|20x|13x|12x|11x|10x/.test(name)) continue;
  const pg = getPuzzleGeometryByDesc(desc, { allMoves: true, orientCenters: true, addRotations: true });
  const notation = new ExperimentalPGNotation(pg, pg.getOrbitsDef(true));
  const kpuzzle = new KPuzzle(notation.remapKPuzzleDefinition(pg.getKPuzzleDefinition(true)), { experimentalPGNotation: notation });
  const ks = pg.writeksolve("X");
  const lines = ks.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const mods = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].split(/\s+/);
    if (t[0] === "Set") mods.set(t[1], Number(t[3]));
    if (t[0] !== "Move") continue;
    const move = t[1];
    let kt;
    try { kt = kpuzzle.algToTransformation(move).transformationData; } catch { continue; }
    for (i++; lines[i] !== "End"; i++) {
      const set = lines[i];
      const perm = lines[++i].split(/\s+/).map((v) => Number(v) - 1);
      let ori = perm.map(() => 0);
      if (/^\d/.test(lines[i + 1] ?? "") && lines[i + 1].split(/\s+/).length === perm.length && !mods.has(lines[i + 1])) ori = lines[++i].split(/\s+/).map(Number);
      const k = kt[set]; if (!k) continue;
      const m = mods.get(set)!;
      const n = perm.length;
      const inv = perm.map((_, j) => perm.indexOf(j));
      const eq = (a: number[], b: number[]) => a.every((v, j) => ((v - b[j]) % m + m) % m === 0);
      const permCands: Record<string, number[]> = { "perm": perm, "inverse": inv };
      {
        const o = [...Array(n).keys()].map((j) => ori[perm[j]]);
        const permOK = perm.every((v, j) => v === k.permutation[j]);
        if (!permOK || !eq(o, k.orientationDelta)) {
          console.log(`MISMATCH ${name} move ${move} set ${set} (mod ${m}): permOK=${permOK}\n  ksolve perm ${perm}\n  ksolve ori  ${ori}\n  kpuzzle perm ${k.permutation}\n  kpuzzle ori  ${k.orientationDelta}`);
        }
      }
      for (const [pn, p] of Object.entries(permCands)) {
        if (!p.every((v, j) => v === k.permutation[j])) continue;
        const oriCands: Record<string, number[]> = {
          "ori": ori,
          "ori[perm]": [...Array(n).keys()].map((j) => ori[perm[j]]),
          "ori[inv]": [...Array(n).keys()].map((j) => ori[inv[j]]),
          "-ori": ori.map((v) => -v),
          "-ori[perm]": [...Array(n).keys()].map((j) => -ori[perm[j]]),
          "-ori[inv]": [...Array(n).keys()].map((j) => -ori[inv[j]]),
        };
        for (const [on, o] of Object.entries(oriCands)) {
          if (eq(o, k.orientationDelta)) results.set(`KPuzzle permutation = ksolve ${pn}; orientationDelta = ${on}`, (results.get(`KPuzzle permutation = ksolve ${pn}; orientationDelta = ${on}`) ?? 0) + 1);
        }
      }
      checked++;
    }
  }
}
console.log(`${checked} (move, orbit) blocks checked`);
for (const [k, v] of [...results].sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);
