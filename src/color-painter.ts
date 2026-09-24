import { type KPattern, KTransformation, type KTransformationData } from "cubing/kpuzzle";
import type { TwizzleExplorerApp } from "./app";
import { getMoveSetText, moveSetEvents } from "./move-set";
import { type PuzzleChecks, puzzleChecks, stickerModel } from "./reachability";
import {
  blankColors,
  type Colors,
  colorsToPattern,
  patternToColors,
  type Problem,
  type StickerModel,
  solvedColors,
} from "./sticker-colors";
import { rememberUnknownPlaces } from "./unknown-places";

/** A comparable form of a painting, for noticing changes. */
function serializeColors(colors: Colors): string {
  return [...colors].map(([key, color]) => `${key}=${color ?? ""}`).sort().join(" ");
}

// The Colors tab: paint sticker colors on the puzzle's 2D net (shown in place
// of the 3D puzzle while the tab is open) and check the result.  Whenever a
// pick (painting, Solved, or Clear) leaves a valid position, it becomes the
// Explorer's position: the setup is set to it and the alg cleared.

/** Stickers smaller than this on screen (square pixels) can't be painted. */
const MIN_STICKER_AREA_PX = 16;
const UNKNOWN_FILL = "url(#color-painter-unknown)";

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function polygonArea(points: string): number {
  const nums = points.trim().split(/[\s,]+/).map(Number);
  let area = 0;
  for (let i = 0; i < nums.length; i += 2) {
    const j = (i + 2) % nums.length;
    area += nums[i] * nums[j + 1] - nums[j] * nums[i + 1];
  }
  return Math.abs(area) / 2;
}

interface Puzzle {
  description: string;
  model: StickerModel;
  /** Sticker key -> polygons drawn for it. */
  polygons: Map<string, SVGPolygonElement[]>;
  /** Polygon -> every sticker key painted when it is clicked. */
  groups: Map<SVGPolygonElement, string[]>;
}

export class ColorPainter {
  net = element<HTMLDivElement>("color-net");
  paletteElem = element<HTMLDivElement>("color-palette");
  statusElem = element<HTMLDivElement>("color-status");
  problemsElem = element<HTMLUListElement>("color-problems");
  moveSetElem = element<HTMLDivElement>("color-moveset");

  active = false;
  puzzle: Puzzle | null = null;
  colors: Colors = new Map();
  selected: string | null = null;
  /** Whether the colors were picked (not just loaded from the position). */
  #picked = false;
  /** The last position applied, to avoid applying it again. */
  #applied: string | null = null;
  // The colors of the Explorer's position when the net was last synced with
  // it, so that returning to the tab notices a position changed elsewhere
  // (by solving, by editing the alg, by Scramble) without discarding a
  // painting in progress when nothing changed.
  #fromPosition: string | null = null;
  #validateTimer: ReturnType<typeof setTimeout> | undefined;
  #validation = 0; // to ignore results of superseded validations
  #painting = false;

  constructor(private app: TwizzleExplorerApp) {
    element("color-from-position").addEventListener("click", () => void this.fromCurrentPosition());
    element("color-solved").addEventListener("click", () => {
      if (this.puzzle) this.setColors(solvedColors(this.puzzle.model), true);
    });
    element("color-clear").addEventListener("click", () => {
      if (this.puzzle) this.setColors(blankColors(this.puzzle.model), true);
    });

    // Left button paints (click or drag); right button picks up the color
    // under the mouse.
    this.net.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (e.button === 2) {
        this.pickAt(e.clientX, e.clientY);
      } else if (e.button === 0) {
        this.#painting = true;
        this.paintAt(e.clientX, e.clientY);
      }
    });
    this.net.addEventListener("contextmenu", (e) => e.preventDefault());
    this.net.addEventListener("pointermove", (e) => {
      if (this.#painting && e.buttons & 1) this.paintAt(e.clientX, e.clientY);
    });
    for (const type of ["pointerup", "pointerleave", "pointercancel"]) {
      this.net.addEventListener(type, () => {
        this.#painting = false;
      });
    }
    // Positions are checked against the move set (set on the Solver tab).
    moveSetEvents.addEventListener("change", () => {
      if (this.puzzle) this.scheduleValidate();
    });
    // The position can move while this tab is the one showing: Scramble and
    // Reset set it, and an alg can be applied from elsewhere.  The net
    // follows it, as it already did when the tab was opened again.
    const follow = () => {
      if (this.active && this.puzzle) void this.followPosition();
    };
    app.twistyPlayer.experimentalModel.setupTransformation.addFreshListener(follow);
    app.twistyPlayer.experimentalModel.puzzleAlg.addFreshListener(follow);
    // A new puzzle means a new net; the painting is discarded.
    app.twistyPlayer.experimentalModel.puzzleLoader.addFreshListener(() => {
      this.puzzle = null;
      if (this.active) void this.show();
    });
  }

  async setActive(active: boolean): Promise<void> {
    this.active = active;
    this.app.twistyPlayer.style.display = active ? "none" : "";
    this.net.hidden = !active;
    if (active) await this.show();
  }

  async show(): Promise<void> {
    const description = this.app.configUI.descInput.value;
    if (this.puzzle?.description === description) {
      // Same puzzle: keep the net, but follow the position if it moved on
      // another tab.
      await this.followPosition();
      return;
    }
    const pg = await this.app.puzzleGeometry();
    const model = await stickerModel(this.app);

    this.net.innerHTML = pg.generatesvg();
    const svg = this.net.querySelector("svg")!;
    svg.removeAttribute("id");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.insertAdjacentHTML(
      "afterbegin",
      `<defs><pattern id="color-painter-unknown" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="#ffffff"/><rect width="3" height="8" fill="#c8c8c8"/></pattern></defs>`,
    );
    const polygons = new Map<string, SVGPolygonElement[]>();
    for (const polygon of svg.querySelectorAll<SVGPolygonElement>("polygon.sticker")) {
      polygons.set(polygon.id, [...(polygons.get(polygon.id) ?? []), polygon]);
    }
    // Duplicated stickers (a center's orientations) are drawn as identical
    // polygons; painting one paints them all.
    const groups = new Map<SVGPolygonElement, string[]>();
    const byShape = new Map<string, string[]>();
    for (const [key, elems] of polygons) {
      const shape = `${key.replace(/-o\d+$/, "")} ${elems[0].getAttribute("points")}`;
      byShape.set(shape, [...(byShape.get(shape) ?? []), key]);
    }
    for (const keys of byShape.values()) {
      for (const key of keys) {
        for (const polygon of polygons.get(key)!) groups.set(polygon, keys);
      }
    }

    this.puzzle = {
      description,
      model,
      polygons,
      groups,
    };
    this.renderPalette();
    await this.fromCurrentPosition();
  }

  renderPalette(): void {
    const swatches = [...this.puzzle!.model.palette, { color: null, name: "not painted" }];
    this.paletteElem.textContent = "";
    // A grid about as wide as it is tall.
    this.paletteElem.style.gridTemplateColumns = `repeat(${Math.ceil(Math.sqrt(swatches.length))}, auto)`;
    for (const { color, name } of swatches) {
      const button = document.createElement("button");
      button.className = "swatch";
      button.title = name;
      button.dataset.color = color ?? "";
      button.style.background = color ?? "repeating-linear-gradient(45deg, #fff 0 6px, #c8c8c8 6px 9px)";
      button.addEventListener("click", () => this.selectColor(color));
      this.paletteElem.appendChild(button);
    }
    this.selectColor(swatches[0].color);
  }

  selectColor(color: string | null): void {
    this.selected = color;
    for (const b of this.paletteElem.children as HTMLCollectionOf<HTMLElement>) {
      b.classList.toggle("selected", b.dataset.color === (color ?? ""));
    }
  }

  /** Selects the color of the sticker at a point (any size of sticker). */
  pickAt(x: number, y: number): void {
    const target = document.elementFromPoint(x, y);
    if (!this.puzzle || !(target instanceof SVGPolygonElement)) return;
    const keys = this.puzzle.groups.get(target);
    if (keys) this.selectColor(this.colors.get(keys[0]) ?? null);
  }

  /** The colors of the Explorer's current position, for this puzzle. */
  /**
   *   Show what the puzzle shows, unless the net is already showing it.
   *   A painting of our own leaves `#fromPosition` equal to it, so applying
   *   one does not come back around as a change to follow.
   */
  async followPosition(): Promise<void> {
    const colors = await this.currentPositionColors();
    if (colors && serializeColors(colors) !== this.#fromPosition) {
      this.setColors(colors, false);
      this.#fromPosition = serializeColors(colors);
    }
  }

  async currentPositionColors(): Promise<Colors | null> {
    if (!this.puzzle) return null;
    const model = this.app.twistyPlayer.experimentalModel;
    const [start, alg] = await Promise.all([model.anchorTransformation.get(), model.puzzleAlg.get()]);
    return patternToColors(this.puzzle.model, start.applyAlg(alg.alg).toKPattern());
  }

  async fromCurrentPosition(): Promise<void> {
    const colors = await this.currentPositionColors();
    if (!colors) return;
    this.setColors(colors, false);
    this.#fromPosition = serializeColors(colors);
  }

  /** picked: whether this is a user's pick (which, if valid, is applied). */
  setColors(colors: Colors, picked: boolean): void {
    this.#picked = picked;
    if (!picked) this.#applied = null;
    this.colors = colors;
    this.render();
    this.scheduleValidate();
  }

  paintAt(x: number, y: number): void {
    const target = document.elementFromPoint(x, y);
    if (!this.puzzle || !(target instanceof SVGPolygonElement)) return;
    const keys = this.puzzle.groups.get(target);
    if (!keys) return;
    const ctm = target.ownerSVGElement?.getScreenCTM();
    const area = polygonArea(target.getAttribute("points") ?? "") * Math.abs((ctm?.a ?? 1) * (ctm?.d ?? 1));
    if (area < MIN_STICKER_AREA_PX) {
      this.statusElem.textContent = "That sticker is too small to paint at this size.";
      return;
    }
    if (keys.every((k) => this.colors.get(k) === this.selected)) return;
    for (const k of keys) this.colors.set(k, this.selected);
    this.#picked = true;
    this.render(keys);
    this.scheduleValidate();
  }

  render(keys: Iterable<string> = this.colors.keys()): void {
    for (const key of keys) {
      for (const polygon of this.puzzle?.polygons.get(key) ?? []) {
        polygon.style.fill = this.colors.get(key) ?? UNKNOWN_FILL;
      }
    }
  }

  scheduleValidate(): void {
    clearTimeout(this.#validateTimer);
    this.#validateTimer = setTimeout(() => void this.validate(), 150);
  }

  async validate(): Promise<void> {
    const puzzle = this.puzzle;
    if (!puzzle) return;
    const validation = ++this.#validation;
    const moveSetText = getMoveSetText(puzzle.description).trim();
    this.moveSetElem.textContent = moveSetText
      ? `Checking against the move set ${moveSetText} (set on the Solver tab).`
      : "Checking against the default move set (a move set can be set on the Solver tab).";
    const problems: Problem[] = [];
    let checks: PuzzleChecks | null = null;
    try {
      checks = await puzzleChecks(this.app);
    } catch (e) {
      problems.push({ message: (e as Error).message, stickers: [] });
    }
    // With the moves and rotations, pieces that look identical are placed
    // only where they can actually be (see colorsToPattern).
    const reading = colorsToPattern(puzzle.model, this.colors, checks?.generators);
    problems.push(...reading.problems);
    if (reading.pattern && checks) {
      const { moveSet } = checks;
      // Blank places change what can be checked at all, so the checker is
      // asked for with them (see puzzleChecks), and told about them.
      const blank = [...reading.unknown.values()].some((p) => p.size > 0)
        ? reading.unknown
        : undefined;
      const checker = blank
        ? (await puzzleChecks(this.app, [], blank)).checker
        : checks.checker;
      const reach = checker.check(reading.pattern, blank);
      const moves = moveSet.length > 0 ? `the move set ${moveSet.join(",")}` : "the puzzle's moves";
      if (reach === "rotated") {
        problems.push({
          message: `This position can't be reached with ${moves}, only with the whole puzzle rotated as well (not supported yet).`,
          stickers: [],
        });
      } else if (reach === "unreachable") {
        problems.push({
          message: `This position can't be reached with ${moves} (check twisted or swapped pieces in: ${checker.orbits.join(", ")}).`,
          stickers: [],
        });
      }
    }
    if (validation !== this.#validation || puzzle !== this.puzzle) return;
    for (const elems of puzzle.polygons.values()) {
      for (const p of elems) p.classList.remove("problem");
    }
    this.problemsElem.textContent = "";
    for (const problem of problems) {
      const li = document.createElement("li");
      li.textContent = problem.message;
      this.problemsElem.appendChild(li);
      for (const key of problem.stickers) {
        for (const p of puzzle.polygons.get(key) ?? []) p.classList.add("problem");
      }
    }
    if (problems.length === 0 && reading.pattern) {
      // What was left blank travels with the position, for the Solver, and
      // is shown in gray on the puzzle itself.
      rememberUnknownPlaces(reading.pattern, reading.unknown);
      this.showUnknownPieces(reading.pattern, reading.unknown);
      if (!this.#picked) {
        this.statusElem.textContent = "This is the current position.";
        return;
      }
      const data: KTransformationData = {};
      for (const [orbit, o] of Object.entries(reading.pattern.patternData)) {
        data[orbit] = { permutation: [...o.pieces], orientationDelta: [...o.orientation] };
      }
      const key = JSON.stringify(data);
      if (key !== this.#applied) {
        this.#applied = key;
        void this.applyPosition(data, patternToColors(puzzle.model, reading.pattern));
      }
      this.statusElem.textContent = "Valid; this is now the position.";
    } else {
      this.statusElem.textContent = "";
    }
  }

  /**
   *   Draws the pieces nobody asked about in gray.  The mask goes by piece
   *   rather than by place, so the gray follows them as the puzzle turns,
   *   which is what they are: the pieces this position says nothing about,
   *   wherever they end up.
   */
  showUnknownPieces(pattern: KPattern, unknown: Map<string, Set<number>>): void {
    const orbits: Record<string, { pieces: ({ facelets: string[] } | null)[] }> = {};
    for (const def of pattern.kpuzzle.definition.orbits) {
      const pieces = new Array<{ facelets: string[] } | null>(def.numPieces).fill(null);
      for (const place of unknown.get(def.orbitName) ?? []) {
        const piece = pattern.patternData[def.orbitName].pieces[place];
        pieces[piece] = {
          facelets: new Array(def.numOrientations).fill("ignored"),
        };
      }
      orbits[def.orbitName] = { pieces };
    }
    // biome-ignore lint/suspicious/noExplicitAny: the mask type is not exported.
    (this.app.twistyPlayer as any).experimentalStickeringMaskOrbits = { orbits };
  }

  /** Makes the position the Explorer's: set as the setup, alg cleared. */
  async applyPosition(data: KTransformationData, shown: Colors): Promise<void> {
    // What the puzzle will show once this is applied, which is not what is
    // painted when some of it was left blank: the puzzle has to put
    // something in those places.  Remembering what it will show is what
    // lets a later change be told from this one, so that following the
    // position does not wipe the blanks out again.
    this.#fromPosition = serializeColors(shown);
    const player = this.app.twistyPlayer;
    const kpuzzle = await player.experimentalModel.kpuzzle.get();
    player.alg = "";
    player.experimentalSetupAlg = "";
    player.experimentalSetupAnchor = "start";
    player.experimentalModel.setupTransformation.set(new KTransformation(kpuzzle, data));
  }
}
