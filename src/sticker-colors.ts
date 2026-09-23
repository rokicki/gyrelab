import {
  KPattern,
  type KPatternData,
  type KPuzzle,
  type KTransformation,
} from "cubing/kpuzzle";
import type { PuzzleGeometry } from "cubing/puzzle-geometry";

// Sticker colors of the displayed puzzle, and conversion between colors and
// patterns.  Works for any PuzzleGeometry puzzle (named or described).
//
// A sticker is identified by the key "ORBIT-l<location>-o<facelet>", the ids
// PuzzleGeometry gives its SVG polygons.  The colors a pattern shows follow
// twisty's 2D renderer: sticker ORBIT-l<loc>-o<f> shows the solved color of
// ORBIT-l<pieces[loc]>-o<(f - orientation[loc]) mod m>.

export function stickerKey(orbit: string, location: number, facelet: number): string {
  return `${orbit}-l${location}-o${facelet}`;
}

export interface OrbitInfo {
  name: string;
  numPieces: number;
  numOrientations: number;
  /** No two pieces have the same color cycle (up to twist). */
  positionsDistinguishable: boolean;
  /** Every piece's twist can be seen (its colors don't repeat under twist). */
  twistsVisible: boolean;
  /** For each piece, its color cycle's canonical form (the piece "kind"). */
  kind: string[];
}

export interface StickerModel {
  kpuzzle: KPuzzle;
  /** Orbits that have stickers (others are invisible and never checked). */
  orbits: OrbitInfo[];
  solved: Map<string, string>;
  /**
   * Keys that are extra orientations of another sticker (an oriented center
   * is one sticker with several keys); these are not counted as stickers.
   */
  duplicates: Set<string>;
  /** The puzzle's colors, in face order, with a face name for each. */
  palette: { color: string; name: string }[];
}

export type Colors = Map<string, string | null>; // null: not painted

function cycle(colors: (string | null | undefined)[], twist: number): string {
  const m = colors.length;
  return colors.map((_, f) => colors[(f - twist + m) % m]).join("|");
}

export function buildStickerModel(pg: PuzzleGeometry, kpuzzle: KPuzzle): StickerModel {
  const dat = pg.get3d();
  const solved = new Map<string, string>();
  const duplicates = new Set<string>();
  const palette: { color: string; name: string }[] = [];
  for (const sticker of dat.stickers) {
    const key = stickerKey(sticker.orbit, sticker.ord, sticker.ori);
    solved.set(key, sticker.color);
    if (sticker.isDup) duplicates.add(key);
    if (!palette.some((p) => p.color === sticker.color)) {
      palette.push({ color: sticker.color, name: dat.faces[sticker.face]?.name ?? "" });
    }
  }
  const orbits: OrbitInfo[] = [];
  for (const def of kpuzzle.definition.orbits) {
    const m = def.numOrientations;
    const cycles: string[][] = [];
    let hasStickers = true;
    for (let p = 0; p < def.numPieces && hasStickers; p++) {
      const c: string[] = [];
      for (let f = 0; f < m; f++) {
        const color = solved.get(stickerKey(def.orbitName, p, f));
        if (color === undefined) {
          hasStickers = false;
          break;
        }
        c.push(color);
      }
      cycles.push(c);
    }
    if (!hasStickers) {
      continue;
    }
    const kind = cycles.map((c) =>
      [...Array(m).keys()].map((t) => cycle(c, t)).sort()[0],
    );
    orbits.push({
      name: def.orbitName,
      numPieces: def.numPieces,
      numOrientations: m,
      positionsDistinguishable: new Set(kind).size === kind.length,
      twistsVisible: cycles.every((c) =>
        [...Array(m).keys()].every((t) => t === 0 || cycle(c, t) !== cycle(c, 0)),
      ),
      kind,
    });
  }
  return { kpuzzle, orbits, solved, duplicates, palette };
}

export function solvedColors(model: StickerModel): Colors {
  return new Map(model.solved);
}

export function blankColors(model: StickerModel): Colors {
  return new Map([...model.solved.keys()].map((k) => [k, null]));
}

export function patternToColors(model: StickerModel, pattern: KPattern): Colors {
  const colors: Colors = new Map();
  for (const orbit of model.orbits) {
    const data = pattern.patternData[orbit.name];
    const m = orbit.numOrientations;
    for (let loc = 0; loc < orbit.numPieces; loc++) {
      for (let f = 0; f < m; f++) {
        const from = stickerKey(orbit.name, data.pieces[loc], (f - data.orientation[loc] + m * m) % m);
        colors.set(stickerKey(orbit.name, loc, f), model.solved.get(from)!);
      }
    }
  }
  return colors;
}

/**
 * For each orbit and piece, the (location, twist) pairs the piece can reach
 * with the given transformations, as location * numOrientations + twist.
 */
type PieceReach = Map<string, Set<number>[]>;
const reachCache = new WeakMap<KTransformation[], PieceReach>();

function pieceReach(model: StickerModel, generators: KTransformation[]): PieceReach {
  const cached = reachCache.get(generators);
  if (cached) return cached;
  const reach: PieceReach = new Map();
  for (const orbit of model.orbits) {
    const m = orbit.numOrientations;
    const n = orbit.numPieces;
    // Per generator: where a piece at location j goes, and the twist it gains.
    const steps = generators.map((g) => {
      const { permutation, orientationDelta } = g.transformationData[orbit.name];
      const to = new Array<number>(n);
      const add = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        to[permutation[i]] = i;
        add[permutation[i]] = orientationDelta[i];
      }
      return { to, add };
    });
    const sets: Set<number>[] = [];
    for (let p = 0; p < n; p++) {
      const seen = new Set<number>([p * m]);
      const queue = [p * m];
      while (queue.length > 0) {
        const state = queue.pop()!;
        const loc = Math.floor(state / m);
        const twist = state % m;
        for (const { to, add } of steps) {
          const next = to[loc] * m + (((twist + add[loc]) % m) + m) % m;
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      sets.push(seen);
    }
    reach.set(orbit.name, sets);
  }
  reachCache.set(generators, reach);
  return reach;
}

export interface Problem {
  message: string;
  stickers: string[];
}

export interface ColorsReading {
  /** The pattern, if every location shows a real piece and counts are right. */
  pattern: KPattern | null;
  problems: Problem[];
  /**
   *   Places whose stickers were all left unpainted, by orbit name.  The
   *   pattern puts something in them, since a pattern has to, but nobody
   *   asked what; see twsearch-state's ksolveWithUnknowns.
   */
  unknown: Map<string, Set<number>>;
}

/**
 * Reads a pattern from sticker colors: checks that every sticker is painted,
 * that each color appears as often as when solved, that each location shows
 * a real piece, and that each kind of piece appears as often as when solved.
 * (Reachability is checked separately; see color-check.ts.)
 *
 * Pieces that look identical are not interchangeable in general: the two
 * wings of a 4x4x4 edge look the same, but a wing can reach its partner's
 * slot twisted and never its own.  So with `generators` (the moves and
 * rotations), a location only takes a (piece, twist) that the piece can
 * reach, and pieces are assigned to locations by a matching.
 */
export function colorsToPattern(
  model: StickerModel,
  colors: Colors,
  generators?: KTransformation[],
): ColorsReading {
  const reach = generators ? pieceReach(model, generators) : null;
  const problems: Problem[] = [];
  const unknown = new Map<string, Set<number>>();
  for (const orbit of model.orbits) {
    const places = new Set<number>();
    for (let loc = 0; loc < orbit.numPieces; loc++) {
      const real = [...Array(orbit.numOrientations).keys()]
        .map((f) => stickerKey(orbit.name, loc, f))
        .filter((k) => model.solved.has(k) && !model.duplicates.has(k));
      const painted = real.filter((k) => colors.get(k));
      if (painted.length === 0) {
        places.add(loc);
      } else if (painted.length < real.length) {
        problems.push({
          message: `${orbit.name}: a piece is painted in part; paint all of it or none of it`,
          stickers: real,
        });
      }
    }
    unknown.set(orbit.name, places);
  }
  if (problems.length > 0) {
    return { pattern: null, problems, unknown };
  }

  // Color counts, over real stickers (not duplicated orientations).
  const counts = new Map<string, number>();
  for (const [k, c] of colors) {
    if (model.solved.has(k) && !model.duplicates.has(k)) counts.set(c!, (counts.get(c!) ?? 0) + 1);
  }
  const solvedCounts = new Map<string, number>();
  for (const [k, c] of model.solved) {
    if (!model.duplicates.has(k)) solvedCounts.set(c, (solvedCounts.get(c) ?? 0) + 1);
  }
  for (const { color, name } of model.palette) {
    const have = counts.get(color) ?? 0;
    const want = solvedCounts.get(color) ?? 0;
    if (have > want) {
      problems.push({
        message: `${name || color}: ${have} stickers, should be at most ${want}`,
        stickers: [...colors].filter(([k, c]) => c === color && model.solved.has(k)).map(([k]) => k),
      });
    }
  }
  if (problems.length > 0) {
    return { pattern: null, problems, unknown };
  }

  const data: KPatternData = {};
  for (const def of model.kpuzzle.definition.orbits) {
    // Orbits without stickers stay solved.
    const pieces = [...Array(def.numPieces).keys()];
    data[def.orbitName] = { pieces, orientation: pieces.map(() => 0) };
  }
  for (const orbit of model.orbits) {
    const m = orbit.numOrientations;
    const shown = (loc: number) =>
      [...Array(m).keys()].map((f) => colors.get(stickerKey(orbit.name, loc, f))!);
    const solvedCycle = (p: number) =>
      [...Array(m).keys()].map((f) => model.solved.get(stickerKey(orbit.name, p, f))!);
    // For each location, the (piece, twist) pairs that fit its colors.
    const fits: { piece: number; twist: number }[][] = [];
    const places = unknown.get(orbit.name) ?? new Set<number>();
    for (let loc = 0; loc < orbit.numPieces; loc++) {
      const here = shown(loc).join("|");
      const found: { piece: number; twist: number }[] = [];
      for (let p = 0; p < orbit.numPieces; p++) {
        const c = solvedCycle(p);
        for (let t = 0; t < m; t++) {
          if (places.has(loc) || cycle(c, t) === here) {
            found.push({ piece: p, twist: t });
          }
        }
      }
      if (found.length === 0) {
        problems.push({
          message: `${orbit.name}: no piece has these colors`,
          stickers: [...Array(m).keys()].map((f) => stickerKey(orbit.name, loc, f)),
        });
      }
      fits.push(found);
    }
    if (problems.length > 0) continue;

    // Each kind of piece must appear as often as when solved.
    const wanted = new Map<string, number>();
    for (const k of orbit.kind) wanted.set(k, (wanted.get(k) ?? 0) + 1);
    const seen = new Map<string, number[]>();
    for (let loc = 0; loc < orbit.numPieces; loc++) {
      if (places.has(loc)) {
        continue;
      }
      const k = orbit.kind[fits[loc][0].piece];
      seen.set(k, [...(seen.get(k) ?? []), loc]);
    }
    for (const [k, want] of wanted) {
      const locs = seen.get(k) ?? [];
      if (locs.length > want) {
        const colorsOfKind = k.split("|").filter((c, i, a) => a.indexOf(c) === i);
        const names = colorsOfKind.map((c) => model.palette.find((p) => p.color === c)?.name || c);
        problems.push({
          message: `${orbit.name}: ${locs.length} ${names.join("-")} pieces, should be at most ${want}`,
          stickers: locs.flatMap((loc) => [...Array(m).keys()].map((f) => stickerKey(orbit.name, loc, f))),
        });
      }
    }
    if (problems.length > 0) continue;

    // Keep only (piece, twist) pairs the piece can reach at that location,
    // and try a piece's own home first, so that pieces that look alike are
    // left where they belong instead of being shuffled among themselves.
    // (--distinguishall then solves the least disturbed position that shows
    // these colors.)
    const orbitReach = reach?.get(orbit.name);
    const allowed = fits.map((f, loc) =>
      (orbitReach ? f.filter(({ piece, twist }) => orbitReach[piece].has(loc * m + twist)) : f)
        .slice()
        .sort(
          (a, b) =>
            Number(b.piece === loc && b.twist === 0) - Number(a.piece === loc && a.twist === 0) ||
            a.piece - b.piece ||
            a.twist - b.twist,
        ),
    );
    for (let loc = 0; loc < orbit.numPieces; loc++) {
      if (allowed[loc].length === 0) {
        problems.push({
          message: `${orbit.name}: no piece with these colors can be here in this orientation`,
          stickers: [...Array(m).keys()].map((f) => stickerKey(orbit.name, loc, f)),
        });
      }
    }
    if (problems.length > 0) continue;

    // Assign pieces to locations: a bipartite matching (augmenting paths).
    const locationOf = new Array<number>(orbit.numPieces).fill(-1);
    const choice = new Array<{ piece: number; twist: number } | null>(orbit.numPieces).fill(null);
    const tryAssign = (loc: number, visited: Set<number>): boolean => {
      for (const fit of allowed[loc]) {
        if (visited.has(fit.piece)) continue;
        visited.add(fit.piece);
        if (locationOf[fit.piece] < 0 || tryAssign(locationOf[fit.piece], visited)) {
          locationOf[fit.piece] = loc;
          choice[loc] = fit;
          return true;
        }
      }
      return false;
    };
    for (let loc = 0; loc < orbit.numPieces; loc++) {
      if (!tryAssign(loc, new Set())) {
        problems.push({
          message: `${orbit.name}: these pieces can't all be where they are shown`,
          stickers: [...Array(m).keys()].map((f) => stickerKey(orbit.name, loc, f)),
        });
        break;
      }
    }
    if (problems.length > 0) continue;
    for (let loc = 0; loc < orbit.numPieces; loc++) {
      // A piece matched to a location has a fit there; its twist is the one
      // recorded for that location.
      const piece = choice[loc]!.piece;
      const twist = allowed[loc].find((f) => f.piece === piece)!.twist;
      data[orbit.name].pieces[loc] = piece;
      data[orbit.name].orientation[loc] = twist;
    }
  }
  if (problems.length > 0) {
    return { pattern: null, problems, unknown };
  }
  return { pattern: new KPattern(model.kpuzzle, data), problems, unknown };
}
