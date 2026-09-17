import type { KTransformation } from "cubing/kpuzzle";
import type { TwizzleExplorerApp } from "./app";
import { ReachabilityChecker, rotationTransformations } from "./color-check";
import { currentMoveSet } from "./move-set";
import { buildStickerModel, type StickerModel } from "./sticker-colors";
import {
  ksolveMoveNames,
  setOmissionFromArgs,
  setOmissionKey,
  TwsearchStateError,
  twsearchKsolve,
} from "./twsearch-state";

// The sticker model and reachability checker for the Explorer's current
// puzzle and move set, built once and shared by the Colors and Solver tabs.

export interface PuzzleChecks {
  description: string;
  moveSet: string[];
  /** The ksolve file twsearch gets for this puzzle and move set. */
  tws: string;
  model: StickerModel;
  checker: ReachabilityChecker;
  /** The moves and rotations, for reading colors (see colorsToPattern). */
  generators: KTransformation[];
}

let cachedKey = "";
let cached: Promise<PuzzleChecks> | null = null;
let cachedModelDescription = "";
let cachedModel: Promise<StickerModel> | null = null;

export function stickerModel(app: TwizzleExplorerApp): Promise<StickerModel> {
  const description = app.configUI.descInput.value;
  if (!cachedModel || cachedModelDescription !== description) {
    cachedModelDescription = description;
    cachedModel = (async () =>
      buildStickerModel(
        await app.puzzleGeometry(),
        await app.twistyPlayer.experimentalModel.kpuzzle.get(),
      ))();
  }
  return cachedModel;
}

/**
 * Throws TwsearchStateError (asynchronously) for a bad move set.
 *
 * @param twsearchArgs twsearch's options, for what they tell it to ignore
 *   (--nocorners, --omit, ...); the Colors tab passes none.
 */
export function puzzleChecks(
  app: TwizzleExplorerApp,
  twsearchArgs: string[] = [],
): Promise<PuzzleChecks> {
  const description = app.configUI.descInput.value;
  let moveSet: string[];
  try {
    moveSet = currentMoveSet(description);
  } catch (e) {
    return Promise.reject(e);
  }
  const key = JSON.stringify([description, moveSet, setOmissionKey(twsearchArgs)]);
  if (!cached || cachedKey !== key) {
    cachedKey = key;
    cached = (async () => {
      const [pg, kpuzzle, model] = await Promise.all([
        app.puzzleGeometry(),
        app.twistyPlayer.experimentalModel.kpuzzle.get(),
        stickerModel(app),
      ]);
      // Every name must be a move of the Explorer's puzzle (PuzzleGeometry
      // would quietly ignore unknown names).
      const unknown = moveSet.filter((name) => {
        try {
          kpuzzle.algToTransformation(name);
          return false;
        } catch {
          return true;
        }
      });
      if (unknown.length > 0) {
        throw new TwsearchStateError(`Move set: the puzzle has no move ${unknown.join(", ")}`);
      }
      const tws = twsearchKsolve(description, moveSet);
      const moves = ksolveMoveNames(tws).moves.map((name) => {
        try {
          return kpuzzle.algToTransformation(name);
        } catch {
          throw new TwsearchStateError(`Move set: the puzzle has no move ${name}`);
        }
      });
      const rotations = rotationTransformations(pg, kpuzzle);
      const checker = new ReachabilityChecker(
        model,
        moves,
        rotations,
        setOmissionFromArgs(twsearchArgs),
      );
      return { description, moveSet, tws, model, checker, generators: [...moves, ...rotations] };
    })();
    // Don't keep a failure cached.
    cached.catch(() => {
      if (cachedKey === key) cached = null;
    });
  }
  return cached;
}
