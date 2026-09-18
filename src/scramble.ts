import type { KPuzzle, KTransformation } from "cubing/kpuzzle";
import { currentMoveSet } from "./move-set";
import type { TwizzleExplorerApp } from "./app";
import { ksolveMoveNames, TwsearchStateError, twsearchKsolve } from "./twsearch-state";

/**
 * Scrambling with the moves the Solver is set to use.
 *
 * The Explorer scrambles for itself rather than asking PuzzleGeometry,
 * because the puzzle the twisty player builds has more moves than the puzzle
 * itself does (every slice, so that moves like 2-3U2 can be understood and
 * rendered) as well as whole-puzzle rotations, and a scramble made with
 * those leaves a position the puzzle's own moves cannot solve.  Scrambling
 * here also means a move set typed on the Solver tab is scrambled within:
 * what you are given to solve is something the solver can actually solve.
 *
 * The method is PuzzleGeometry's (see getScrambleTransformation in
 * PermOriSet.ts): rather than a long random sequence of moves, which is slow
 * to apply on a big puzzle, keep a pool of transformations and repeatedly
 * combine two of them with a random move.
 */
export function scrambleTransformation(
  moves: KTransformation[],
  n = 0,
): KTransformation {
  if (moves.length === 0) {
    throw new TwsearchStateError("The move set has no moves to scramble with.");
  }
  if (n < 100) {
    n = 100;
  }
  const pool = moves.slice();
  for (let i = 0; i < pool.length; i++) {
    const j = Math.floor(Math.random() * pool.length);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (n < pool.length) {
    n = pool.length;
  }
  for (let i = 0; i < n; i++) {
    const ri = Math.floor(Math.random() * pool.length);
    const rj = Math.floor(Math.random() * pool.length);
    const rm = Math.floor(Math.random() * moves.length);
    pool[ri] = pool[ri].applyTransformation(pool[rj]).applyTransformation(moves[rm]);
    if (Math.random() < 0.1) {
      // break up parity
      pool[ri] = pool[ri].applyTransformation(moves[rm]);
    }
  }
  let scramble = pool[0];
  for (let i = 1; i < pool.length; i++) {
    scramble = scramble.applyTransformation(pool[i]);
  }
  return scramble;
}

/**
 * The moves to scramble the current puzzle with: the Solver tab's move set
 * if it has one and it is usable, otherwise the puzzle's own moves.  The
 * move set is kept per puzzle, so changing puzzles gives this the new
 * puzzle's moves.
 */
export async function scrambleMoves(
  app: TwizzleExplorerApp,
): Promise<{ moves: KTransformation[]; moveSet: string[] }> {
  const description = app.configUI.descInput.value;
  const kpuzzle: KPuzzle =
    await app.twistyPlayer.experimentalModel.kpuzzle.get();
  const namesFor = (moveSet: string[]) =>
    ksolveMoveNames(twsearchKsolve(description, moveSet)).moves.map((name) =>
      kpuzzle.algToTransformation(name),
    );
  let moveSet: string[] = [];
  try {
    moveSet = currentMoveSet(description);
    return { moves: namesFor(moveSet), moveSet };
  } catch {
    // A move set that will not parse, or names this puzzle does not have:
    // scramble with the puzzle's own moves.  The Solver tab reports why when
    // it is asked to solve.
    return { moves: namesFor([]), moveSet: [] };
  }
}
