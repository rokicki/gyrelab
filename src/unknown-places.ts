import type { KPattern } from "cubing/kpuzzle";

/**
 *   The pieces nobody asked about, by orbit name.
 *
 *   A sticker left unpainted is a sticker on a *piece*, so that is what is
 *   remembered: turn the puzzle and the unknown pieces go with it, showing
 *   up wherever they now are.  A piece's home is the place with its own
 *   number, so the same set says which places the solved state may leave
 *   open (see twsearch-state's ksolveWithUnknowns).
 */
let remembered: Map<string, Set<number>> | null = null;

export function rememberUnknownPieces(
  pieces: Map<string, Set<number>>,
): void {
  const any = [...pieces.values()].some((set) => set.size > 0);
  remembered = any ? new Map([...pieces].map(([o, s]) => [o, new Set(s)])) : null;
}

/** Forgotten when the puzzle changes: these numbers are that puzzle's. */
export function forgetUnknownPieces(): void {
  remembered = null;
}

export function unknownPieces(): Map<string, Set<number>> | null {
  return remembered;
}

/** Where those pieces are in this position, by orbit name. */
export function unknownPlacesIn(
  pattern: KPattern,
): Map<string, Set<number>> | null {
  if (!remembered) {
    return null;
  }
  const places = new Map<string, Set<number>>();
  for (const [orbit, pieces] of remembered) {
    const here = new Set<number>();
    const o = pattern.patternData[orbit];
    if (o) {
      o.pieces.forEach((piece, place) => {
        if (pieces.has(piece)) here.add(place);
      });
    }
    places.set(orbit, here);
  }
  return places;
}
