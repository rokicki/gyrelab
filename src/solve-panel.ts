import { Alg } from "cubing/alg";
import { getPuzzleGeometryByDesc } from "cubing/puzzle-geometry";
import type { TwizzleExplorerApp } from "./app";
import {
  BridgeChannel,
  bridgeAvailable,
  type TwsearchChannel,
  type TwsearchEvent,
  WasmChannel,
} from "./twsearch-channel";
import { algToScrambleAlg, TwsearchInputError } from "./twsearch-input";

// Default pruning table memory for WebAssembly, in MB, when the options do
// not give -M.  (The bridge applies its own cap.)
const WASM_DEFAULT_MEGABYTES = 512;
// How long to wait for "Search canceled" before offering to abandon a
// pruning table fill.
const CANCEL_GRACE_MS = 750;

const END_OF_SOLVE =
  /^(Found \d+ solutions? |No solution found in |Ignoring unsolvable position\.|Search canceled at depth )/;

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** The "Solve" tab: solves the position at the end of the alg with twsearch. */
export class TwsearchSolvePanel {
  solveButton = element<HTMLButtonElement>("twsearch-solve-button");
  cancelButton = element<HTMLButtonElement>("twsearch-cancel-button");
  channelSelect = element<HTMLSelectElement>("twsearch-channel");
  argsInput = element<HTMLInputElement>("twsearch-args");
  statusElem = element<HTMLDivElement>("twsearch-status");
  solutionsElem = element<HTMLOListElement>("twsearch-solutions");
  logElem = element<HTMLPreElement>("twsearch-log");

  bridge = new BridgeChannel();
  wasm: WasmChannel;
  running: { id: string; channel: TwsearchChannel } | null = null;
  nextID = 1;

  constructor(
    private app: TwizzleExplorerApp,
    workerURL: URL,
  ) {
    this.wasm = new WasmChannel(workerURL);
    this.solveButton.addEventListener("click", () => void this.solve());
    this.cancelButton.addEventListener("click", () => this.cancel());
  }

  setStatus(text: string): void {
    this.statusElem.textContent = text;
  }

  async chooseChannel(): Promise<TwsearchChannel> {
    switch (this.channelSelect.value) {
      case "bridge":
        return this.bridge;
      case "wasm":
        return this.wasm;
      default:
        return (await bridgeAvailable()) ? this.bridge : this.wasm;
    }
  }

  /** The twsearch input for the position at the end of the alg. */
  async input(): Promise<{ tws: string; scramble: string }> {
    const model = this.app.twistyPlayer.experimentalModel;
    if (await model.setupTransformation.get()) {
      throw new TwsearchInputError(
        "Positions from the Scramble button can't be solved yet; enter the scramble as an alg.",
      );
    }
    if ((await model.setupAnchor.get()) !== "start") {
      throw new TwsearchInputError(
        "Only setups anchored at the start are supported.",
      );
    }
    const alg = (await model.setupAlg.get()).alg.concat(
      (await model.alg.get()).alg,
    );
    // The default ksolve file (as from the base PuzzleGeometry) plus the
    // puzzle's rotations (PG's --rotations), which twsearch uses for
    // symmetry.  twsearch refuses rotations in the alg itself.
    const tws = getPuzzleGeometryByDesc(this.app.configUI.descInput.value, {
      allMoves: false,
      orientCenters: false,
      addRotations: true,
    }).writeksolve("TwizzlePuzzle");
    return { tws, scramble: algToScrambleAlg(alg) };
  }

  async solve(): Promise<void> {
    if (this.running) {
      return;
    }
    this.solutionsElem.textContent = "";
    this.logElem.textContent = "";
    let input: { tws: string; scramble: string };
    try {
      input = await this.input();
    } catch (e) {
      this.setStatus(
        e instanceof TwsearchInputError ? e.message : `Error: ${e}`,
      );
      return;
    }
    const channel = await this.chooseChannel();
    const args = this.argsInput.value.trim().split(/\s+/).filter(Boolean);
    if (channel === this.wasm && !args.includes("-M")) {
      args.push("-M", String(WASM_DEFAULT_MEGABYTES));
    }
    const id = `solve-${this.nextID++}`;
    this.running = { id, channel };
    this.solveButton.disabled = true;
    this.cancelButton.disabled = false;

    const start = performance.now();
    let phase = "Starting";
    let final: string | null = null;
    const showStatus = () => {
      const seconds = ((performance.now() - start) / 1000).toFixed(1);
      this.setStatus(final ?? `${phase} (${seconds}s, ${channel.name})`);
    };
    const ticker = setInterval(showStatus, 250);
    showStatus();

    // stdout text not yet ended by a newline; twsearch flushes partial
    // lines such as "Filling depth 8 val 2" before long operations.
    let partial = "";
    let searching = false;
    const onLine = (line: string) => {
      let match: RegExpMatchArray | null;
      if ((match = line.match(/^Filling depth (\d+)/))) {
        phase = searching
          ? `Searching (pruning table depth ${match[1]} filled)`
          : `Building pruning table (depth ${match[1]} filled)`;
      } else if ((match = line.match(/^Depth (\d+) in /))) {
        phase = `Searching (depth ${match[1]} finished)`;
      } else if (line.startsWith("Solving")) {
        searching = true;
        phase = "Searching";
      } else if (line.startsWith(" ")) {
        this.addSolution(line.trim());
      } else if (END_OF_SOLVE.test(line)) {
        final = line;
      }
    };
    const onEvent = (e: TwsearchEvent) => {
      if (e.type === "out" || e.type === "err") {
        this.logElem.append(e.text);
        this.logElem.scrollTop = this.logElem.scrollHeight;
      }
      if (e.type === "out") {
        const lines = (partial + e.text).split("\n");
        partial = lines.pop() ?? "";
        lines.forEach(onLine);
        const match = partial.match(/^Filling depth (\d+)/);
        if (match) {
          phase = searching
            ? `Searching (extending pruning table: filling depth ${match[1]})`
            : `Building pruning table (filling depth ${match[1]})`;
        }
      } else if (e.type === "error") {
        final = `Error: ${e.message}`;
      }
      showStatus();
    };

    try {
      await channel.solve({ id, args, ...input }, onEvent);
    } finally {
      clearInterval(ticker);
      final ??= "Finished";
      showStatus();
      this.running = null;
      this.solveButton.disabled = false;
      this.cancelButton.disabled = true;
    }
  }

  addSolution(solution: string): void {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.textContent = solution === "" ? "(already solved)" : solution;
    button.title = "Append to the alg";
    button.addEventListener("click", async () => {
      const model = this.app.twistyPlayer.experimentalModel;
      this.app.twistyPlayer.alg = (await model.alg.get()).alg.concat(
        Alg.fromString(solution),
      );
      this.app.twistyPlayer.jumpToEnd();
      this.solutionsElem.textContent = "";
    });
    item.appendChild(button);
    this.solutionsElem.appendChild(item);
  }

  cancel(): void {
    const running = this.running;
    if (!running) {
      return;
    }
    running.channel.cancel(running.id);
    setTimeout(() => {
      if (
        this.running === running &&
        confirm(
          "twsearch is still building its pruning table, which can't be interrupted.\n\n" +
            "OK: stop now and abandon the table (the next solve rebuilds it).\n" +
            "Cancel: let the table finish building; the search stops after that.",
        )
      ) {
        running.channel.cancel(running.id, true);
      }
    }, CANCEL_GRACE_MS);
  }
}
