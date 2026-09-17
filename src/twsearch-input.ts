import {
  type Alg,
  LineComment,
  Move,
  Newline,
  Pause,
} from "cubing/alg";

// For now, the position sent to twsearch is just the alg's move sequence, as
// a ScrambleAlg against the ksolve definition PuzzleGeometry writes by
// default.  twsearch parses the move names itself, and fails on any move not
// in that definition (rotations, slices the Explorer adds, and so on).

export class TwsearchInputError extends Error {}

/** Expands groupings, commutators, and conjugates into a ScrambleAlg. */
export function algToScrambleAlg(alg: Alg): string {
  const moves: string[] = [];
  for (const leaf of alg.experimentalExpand()) {
    if (leaf.is(Move)) {
      moves.push(leaf.toString());
    } else if (!(leaf.is(Pause) || leaf.is(LineComment) || leaf.is(Newline))) {
      throw new TwsearchInputError(`Can't send to twsearch: ${leaf}`);
    }
  }
  return `ScrambleAlg explorer\n${moves.join(" ")}\nEnd\n`;
}
