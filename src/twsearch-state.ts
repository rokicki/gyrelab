import type { KPattern, KPuzzle, KTransformation } from "cubing/kpuzzle";
import { getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";

// Exporting the Explorer's displayed state to twsearch.
//
// The Explorer shows a puzzle built by PuzzleGeometry with display options
// (all moves, oriented centers, rotations), while twsearch gets a ksolve file
// for a move set (by default the base puzzle's moves), plus rotations.  Both
// come from PuzzleGeometry for the same puzzle, so they describe the same
// physical pieces, but orbits can be split or numbered differently.
//
// We pair up the pieces using the moves themselves.  Each move in twsearch's
// file is looked up by name in the Explorer's KPuzzle (PuzzleGeometry names
// moves consistently for both), giving its action on the Explorer's pieces.
// A piece is identified by the set of moves that move it; the pairing is then
// checked against every move (each must permute and twist corresponding
// pieces identically), so a wrong pairing is an error rather than a wrong
// state.  Rotations are not used: PuzzleGeometry adds those itself, and their
// names can mean different rotations in the two puzzles.

export class TwsearchStateError extends Error {}

interface KsolveSet {
  name: string;
  size: number;
  mod: number;
}

interface KsolveOrbit {
  perm: number[]; // zero-based
  ori: number[];
}

interface Ksolve {
  sets: KsolveSet[];
  solved: Map<string, KsolveOrbit>;
  moves: Map<string, Map<string, KsolveOrbit>>; // move -> set -> orbit
}

/** A piece location: an orbit (set) name and an index within it. */
interface Slot {
  set: string;
  index: number;
}

function parseKsolve(text: string): Ksolve {
  const lines = text
    .split("\n")
    .map((line) => line.trim().split(/\s+/).filter(Boolean))
    .filter((toks) => toks.length > 0 && !toks[0].startsWith("#"));
  const sets: KsolveSet[] = [];
  const solved = new Map<string, KsolveOrbit>();
  const moves = new Map<string, Map<string, KsolveOrbit>>();
  const setByName = new Map<string, KsolveSet>();
  let i = 0;
  // Reads "SET / perm / [ori]" groups up to "End".
  const readBlock = (): Map<string, KsolveOrbit> => {
    const orbits = new Map<string, KsolveOrbit>();
    for (i++; i < lines.length && lines[i][0] !== "End"; i++) {
      const set = setByName.get(lines[i][0]);
      if (!set) {
        throw new TwsearchStateError(`ksolve: unknown set ${lines[i][0]}`);
      }
      const perm = lines[++i].map((t) => Number(t) - 1);
      let ori = perm.map(() => 0);
      if (i + 1 < lines.length && /^\d/.test(lines[i + 1][0])) {
        ori = lines[++i].map(Number);
      }
      orbits.set(set.name, { perm, ori });
    }
    return orbits;
  };
  for (; i < lines.length; i++) {
    const toks = lines[i];
    if (toks[0] === "Set") {
      const set = { name: toks[1], size: Number(toks[2]), mod: Number(toks[3]) };
      sets.push(set);
      setByName.set(set.name, set);
    } else if (toks[0] === "Solved") {
      for (const [name, orbit] of readBlock()) {
        solved.set(name, orbit);
      }
    } else if (toks[0] === "Move") {
      moves.set(toks[1], readBlock());
    }
  }
  for (const set of sets) {
    if (!solved.has(set.name)) {
      const perm = [...Array(set.size).keys()];
      solved.set(set.name, { perm, ori: perm.map(() => 0) });
    }
  }
  return { sets, solved, moves };
}

/**
 * The ksolve file twsearch is given for a puzzle description: the move set
 * (PuzzleGeometry's moveList, i.e. PG's --moves; by default the base
 * puzzle's moves) plus the rotations that preserve it (PG's --rotations),
 * which twsearch uses for symmetry.  Move names are as the user gave them.
 */
export function twsearchKsolve(
  puzzleDescription: string,
  moveSet: string[] = [],
): string {
  try {
    return getPuzzleGeometryByDesc(puzzleDescription, {
      allMoves: false,
      orientCenters: false,
      addRotations: true,
      ...(moveSet.length > 0 ? { moveList: moveSet } : {}),
    }).writeksolve("TwizzlePuzzle");
  } catch (e) {
    throw new TwsearchStateError(`Move set: ${(e as Error).message}`);
  }
}

/** The move names in a ksolve file, split into moves and rotations. */
export function ksolveMoveNames(ksolve: string): { moves: string[]; rotations: string[] } {
  const names = [...ksolve.matchAll(/^Move (\S+)\s*$/gm)].map((m) => m[1]);
  return {
    moves: names.filter((n) => !isRotationName(n)),
    rotations: names.filter(isRotationName),
  };
}

/**
 * What twsearch ignores of a set, given its options (readksolve.cpp's
 * omitset): 0 nothing, 1 the permutation (--omitperms), 2 the orientations
 * (--omitoris, --noorientation), 3 the whole set (--omit, --nocorners,
 * --nocenters, --noedges).
 */
export type SetOmission = (setName: string) => number;

export function setOmissionFromArgs(args: string[]): SetOmission {
  const valueOf = (flag: string) =>
    new Set(args.flatMap((a, i) => (a === flag && i + 1 < args.length ? [args[i + 1]] : [])));
  const omit = valueOf("--omit");
  const omitOris = valueOf("--omitoris");
  const omitPerms = valueOf("--omitperms");
  const noCorners = args.includes("--nocorners");
  const noCenters = args.includes("--nocenters");
  const noEdges = args.includes("--noedges");
  const noOrientation = args.includes("--noorientation");
  return (name) => {
    const s = name.toLowerCase();
    let ignore = 0;
    if (
      omit.has(name) ||
      (s.length >= 2 &&
        ((noCorners && s[0] === "c" && s[2] === "r") ||
          (noCenters && s[0] === "c" && s[1] === "e") ||
          (noEdges && s[0] === "e" && s[1] === "d")))
    ) {
      ignore = 3;
    } else if (omitOris.has(name)) {
      ignore = 2;
    } else if (omitPerms.has(name)) {
      ignore = 1;
    }
    return noOrientation ? ignore | 2 : ignore;
  };
}

/** A key that changes exactly when the set-omission options change. */
export function setOmissionKey(args: string[]): string {
  const relevant: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (["--omit", "--omitoris", "--omitperms"].includes(args[i])) relevant.push(`${args[i]} ${args[++i]}`);
    else if (["--nocorners", "--nocenters", "--noedges", "--noorientation"].includes(args[i])) relevant.push(args[i]);
  }
  return relevant.sort().join(";");
}

/** twsearch's rule for which move names are rotations (parsemoves.cpp). */
export function isRotationName(name: string): boolean {
  return /^[xyz]['2]?$/.test(name) || /^[A-Z_]+v$/.test(name);
}

/**
 * The Explorer's puzzle in ksolve terms, for the given moves.  A ksolve move
 * (as PuzzleGeometry writes it) and the KPuzzle transformation of the same
 * move have the same permutation, and orientationDelta[i] = ori[perm[i]]
 * (checked for every move of every named puzzle).
 */
function ksolveFromKPuzzle(
  kpuzzle: KPuzzle,
  moveNames: string[],
  transformationFor: (name: string) => KTransformation,
): Ksolve {
  const sets = kpuzzle.definition.orbits.map((o) => ({
    name: o.orbitName,
    size: o.numPieces,
    mod: o.numOrientations,
  }));
  const solved = new Map(sets.map((set) => [set.name, identity(set.size)]));
  const moves = new Map<string, Map<string, KsolveOrbit>>();
  for (const name of moveNames) {
    let t: KTransformation;
    try {
      t = transformationFor(name);
    } catch {
      throw new TwsearchStateError(`The Explorer's puzzle has no move ${name}`);
    }
    const orbits = new Map<string, KsolveOrbit>();
    for (const set of sets) {
      const { permutation, orientationDelta } = t.transformationData[set.name];
      const ori = new Array<number>(set.size);
      for (let i = 0; i < set.size; i++) ori[permutation[i]] = orientationDelta[i];
      orbits.set(set.name, { perm: [...permutation], ori });
    }
    moves.set(name, orbits);
  }
  return { sets, solved, moves };
}

/** Orbits of the same kind: names equal but for a numeric suffix. */
function sameKind(a: string, b: string): boolean {
  return a.replace(/\d+$/, "") === b.replace(/\d+$/, "");
}

function identity(size: number): KsolveOrbit {
  const perm = [...Array(size).keys()];
  return { perm, ori: perm.map(() => 0) };
}

function orbitOf(ks: Ksolve, move: string, set: KsolveSet): KsolveOrbit {
  return ks.moves.get(move)?.get(set.name) ?? identity(set.size);
}

const key = (slot: Slot) => `${slot.set}#${slot.index}`;

/**
 * Pairs each piece of the twsearch puzzle with a piece of the displayed
 * puzzle, checking that all the given moves agree.  Returns a map from
 * twsearch slot keys to displayed slots.
 */
function pairPieces(ui: Ksolve, tw: Ksolve, shared: string[]): Map<string, Slot> {
  // Only permutation counts here: orientations can differ between the two
  // (the displayed puzzle orients centers; twsearch's does not).  Twists are
  // checked below, modulo twsearch's orientation count.
  const signature = (ks: Ksolve, set: KsolveSet, index: number) =>
    shared.filter((m) => orbitOf(ks, m, set).perm[index] !== index).join(" ");

  const uiSets = new Map(ui.sets.map((s) => [s.name, s]));
  const candidates = new Map<string, Slot[]>();
  {
    const uiBySignature = new Map<string, Slot[]>();
    for (const set of ui.sets) {
      for (let index = 0; index < set.size; index++) {
        const sig = signature(ui, set, index);
        uiBySignature.set(sig, [
          ...(uiBySignature.get(sig) ?? []),
          { set: set.name, index },
        ]);
      }
    }
    for (const set of tw.sets) {
      for (let index = 0; index < set.size; index++) {
        const sig = signature(tw, set, index);
        // Pieces no move touches all share the empty signature, so also
        // require an orbit of the same kind (a corner is not a center).
        const found = (uiBySignature.get(sig) ?? []).filter(
          (slot) =>
            sameKind(slot.set, set.name) &&
            (set.mod === 1 || uiSets.get(slot.set)!.mod === set.mod),
        );
        if (found.length === 0) {
          throw new TwsearchStateError(
            `No displayed piece matches ${set.name} piece ${index + 1} (moved by: ${sig || "nothing"})`,
          );
        }
        candidates.set(key({ set: set.name, index }), found);
      }
    }
  }

  // Pieces with the same signature can be genuinely interchangeable as far
  // as the moves can tell (on the 3x3x3, swapping opposite centers commutes
  // with every move).  Any pairing that agrees with all moves gives the same
  // positions for move sequences, so choose among candidates, propagate each
  // choice through the moves, and backtrack on a contradiction.
  const twSets = new Map(tw.sets.map((s) => [s.name, s]));
  const pairing = new Map<string, Slot>();
  const pairedUI = new Map<string, string>(); // UI slot key -> TW slot key

  // Assigns tw -> ui and everything it implies; returns the keys it added,
  // or null (having undone them) on a contradiction.
  const assign = (twSlot: Slot, uiSlot: Slot): string[] | null => {
    const added: string[] = [];
    const queue: [Slot, Slot][] = [[twSlot, uiSlot]];
    const undo = () => {
      for (const k of added) {
        pairedUI.delete(key(pairing.get(k)!));
        pairing.delete(k);
      }
      return null;
    };
    while (queue.length > 0) {
      const [t, u] = queue.pop()!;
      const tk = key(t);
      const uk = key(u);
      const existing = pairing.get(tk);
      if (existing) {
        if (key(existing) !== uk) return undo();
        continue;
      }
      if (pairedUI.has(uk)) return undo();
      if (!candidates.get(tk)!.some((c) => key(c) === uk)) return undo();
      pairing.set(tk, u);
      pairedUI.set(uk, tk);
      added.push(tk);
      const twSet = twSets.get(t.set)!;
      const uiSet = uiSets.get(u.set)!;
      for (const move of shared) {
        const tp = orbitOf(tw, move, twSet).perm;
        const up = orbitOf(ui, move, uiSet).perm;
        // Where each goes, and where each comes from, must correspond.
        queue.push([
          { set: t.set, index: tp.indexOf(t.index) },
          { set: u.set, index: up.indexOf(u.index) },
        ]);
        queue.push([
          { set: t.set, index: tp[t.index] },
          { set: u.set, index: up[u.index] },
        ]);
      }
    }
    return added;
  };

  const twSlots = tw.sets.flatMap((set) =>
    [...Array(set.size).keys()].map((index) => ({ set: set.name, index })),
  );
  const solve = (): boolean => {
    const next = twSlots.find((slot) => !pairing.has(key(slot)));
    if (!next) return true;
    for (const choice of candidates.get(key(next))!) {
      const added = assign(next, choice);
      if (added) {
        if (solve()) return true;
        for (const k of added) {
          pairedUI.delete(key(pairing.get(k)!));
          pairing.delete(k);
        }
      }
    }
    return false;
  };
  if (!solve()) {
    throw new TwsearchStateError(
      "Could not pair the displayed puzzle's pieces with twsearch's",
    );
  }

  // Check: every shared move sends paired pieces to paired places with the
  // same twist.
  for (const move of shared) {
    for (const set of tw.sets) {
      const twOrbit = orbitOf(tw, move, set);
      for (let index = 0; index < set.size; index++) {
        const at = pairing.get(key({ set: set.name, index }))!;
        const from = pairing.get(key({ set: set.name, index: twOrbit.perm[index] }))!;
        const uiSet = uiSets.get(at.set)!;
        const uiOrbit = orbitOf(ui, move, uiSet);
        const twTwist = twOrbit.ori[index] % set.mod;
        const uiTwist = uiOrbit.ori[at.index] % set.mod;
        if (from.set !== at.set || uiOrbit.perm[at.index] !== from.index || twTwist !== uiTwist) {
          throw new TwsearchStateError(
            `Move ${move} does not agree between the displayed and twsearch puzzles (${set.name} piece ${index + 1})`,
          );
        }
      }
    }
  }
  return pairing;
}

/**
 * Converts the displayed pattern to a twsearch ScrambleState for the twsearch
 * ksolve file.
 *
 * @param pattern the displayed pattern (of the Explorer's KPuzzle, every
 *   piece distinct)
 * @param twsearchKsolve the ksolve file twsearch is given
 * @param transformationFor a move's transformation on the Explorer's KPuzzle,
 *   by name (normally kpuzzle.algToTransformation)
 */
export function patternToScrambleState(
  pattern: KPattern,
  twsearchKsolve: string,
  transformationFor: (name: string) => KTransformation = (name) =>
    pattern.kpuzzle.algToTransformation(name),
  omission: SetOmission = () => 0,
): string {
  const tw = parseKsolve(twsearchKsolve);
  const moves = [...tw.moves.keys()].filter((m) => !isRotationName(m));
  const ui = ksolveFromKPuzzle(pattern.kpuzzle, moves, transformationFor);
  const pairing = pairPieces(ui, tw, moves);
  // Where each displayed piece lives in the twsearch puzzle.
  const inverse = new Map<string, Slot>();
  for (const [twKey, uiSlot] of pairing) {
    const [set, index] = twKey.split("#");
    inverse.set(key(uiSlot), { set, index: Number(index) });
  }

  const out = ["ScrambleState explorer"];
  for (const set of tw.sets) {
    // With --omitperms (and --omit, which drops the set entirely), twsearch
    // makes every piece of the set identical when it reads the solved state,
    // so the scramble has to name the same pieces or its piece counts will
    // not match.
    const omitPerm = (omission(set.name) & 1) !== 0;
    const pieces: number[] = [];
    const oris: number[] = [];
    for (let index = 0; index < set.size; index++) {
      const at = pairing.get(key({ set: set.name, index }))!;
      const orbit = pattern.patternData[at.set];
      if (!orbit) {
        throw new TwsearchStateError(`The displayed pattern has no orbit ${at.set}`);
      }
      const piece = orbit.pieces[at.index];
      const home = inverse.get(key({ set: at.set, index: piece }));
      if (!home || home.set !== set.name) {
        throw new TwsearchStateError(
          `A ${at.set} piece is somewhere twsearch's puzzle can't move it`,
        );
      }
      pieces.push(omitPerm ? 0 : tw.solved.get(set.name)!.perm[home.index]);
      oris.push(orbit.orientation[at.index] % set.mod);
    }
    // Pieces no move moves must be at home, or the position can never be
    // solved with these moves (except for what twsearch is told to ignore).
    const ignore = omission(set.name);
    for (let index = 0; ignore !== 3 && index < set.size; index++) {
      const unmoved = moves.every(
        (m) =>
          orbitOf(tw, m, set).perm[index] === index &&
          orbitOf(tw, m, set).ori[index] === 0,
      );
      const solvedValue = tw.solved.get(set.name)!.perm[index];
      const pieceWrong = !(ignore & 1) && pieces[index] !== solvedValue;
      const twistWrong = !(ignore & 2) && oris[index] !== 0;
      if (unmoved && (pieceWrong || twistWrong)) {
        throw new TwsearchStateError(
          `Some ${set.name} are out of place, but no move in the move set moves them (a rotation, or a move outside the move set?)`,
        );
      }
    }
    out.push(set.name, pieces.join(" "), oris.join(" "));
  }
  out.push("End", "");
  return out.join("\n");
}

