import { KTransformation, type KTransformationData } from "cubing/kpuzzle";
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
import { setAlgParamEnabled } from "./url-params";

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
    if (this.puzzle?.description === description) return;
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

  async fromCurrentPosition(): Promise<void> {
    if (!this.puzzle) return;
    const model = this.app.twistyPlayer.experimentalModel;
    const [start, alg] = await Promise.all([model.anchorTransformation.get(), model.puzzleAlg.get()]);
    this.setColors(patternToColors(this.puzzle.model, start.applyAlg(alg.alg).toKPattern()), false);
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
      const { checker, moveSet } = checks;
      const reach = checker.check(reading.pattern);
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
        void this.applyPosition(data);
      }
      this.statusElem.textContent = "Valid; this is now the position.";
    } else {
      this.statusElem.textContent = "";
    }
  }

  /** Makes the position the Explorer's: set as the setup, alg cleared. */
  async applyPosition(data: KTransformationData): Promise<void> {
    const player = this.app.twistyPlayer;
    const kpuzzle = await player.experimentalModel.kpuzzle.get();
    player.alg = "";
    player.experimentalSetupAlg = "";
    player.experimentalSetupAnchor = "start";
    player.experimentalModel.setupTransformation.set(new KTransformation(kpuzzle, data));
    setAlgParamEnabled(false);
  }
}
