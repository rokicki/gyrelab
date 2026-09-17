import { isRotationName, TwsearchStateError } from "./twsearch-state";

// The move set for solving and for checking positions: a list of move names
// in the Explorer's notation (blank means the puzzle's default move set).
// Kept in memory, per puzzle description, while the page is open (moving
// between tabs and puzzles keeps it; it is not stored or put in the URL).

const moveSets = new Map<string, string>();

/** Fires "change" when a puzzle's move set is changed. */
export const moveSetEvents = new EventTarget();

export function getMoveSetText(puzzleDescription: string): string {
  return moveSets.get(puzzleDescription) ?? "";
}

export function setMoveSetText(puzzleDescription: string, text: string): void {
  if (text.trim() === "") moveSets.delete(puzzleDescription);
  else moveSets.set(puzzleDescription, text);
  moveSetEvents.dispatchEvent(new Event("change"));
}

/** The move names in a move set's text (commas and/or spaces between). */
export function parseMoveSet(text: string): string[] {
  const names = text.split(/[\s,]+/).filter(Boolean);
  const rotations = names.filter(isRotationName);
  if (rotations.length > 0) {
    throw new TwsearchStateError(
      `Move set: whole-puzzle rotations can't be moves (${rotations.join(" ")})`,
    );
  }
  return [...new Set(names)];
}

export function currentMoveSet(puzzleDescription: string): string[] {
  return parseMoveSet(getMoveSetText(puzzleDescription));
}
