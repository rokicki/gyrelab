import type { KPattern } from "cubing/kpuzzle";

/**
 *   Which places the Colors tab was left blank about, and the position it
 *   read them from.  Kept by the position itself, so that any other change
 *   (a move, another alg, a scramble) leaves it behind: blank places only
 *   mean anything for the position they were painted on.
 */
let remembered: { key: string; places: Map<string, Set<number>> } | null = null;

function positionKey(pattern: KPattern): string {
  return JSON.stringify(
    Object.entries(pattern.patternData).map(([orbit, o]) => [
      orbit,
      o.pieces,
      o.orientation,
    ]),
  );
}

export function rememberUnknownPlaces(
  pattern: KPattern,
  places: Map<string, Set<number>>,
): void {
  const any = [...places.values()].some((set) => set.size > 0);
  remembered = any ? { key: positionKey(pattern), places } : null;
}

/** The blank places for this position, or null if it is a different one. */
export function unknownPlacesFor(
  pattern: KPattern,
): Map<string, Set<number>> | null {
  return remembered?.key === positionKey(pattern) ? remembered.places : null;
}
