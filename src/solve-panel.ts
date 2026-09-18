import { Alg } from "cubing/alg";
import { puzzleChecks } from "./reachability";
import type { TwizzleExplorerApp } from "./app";
import {
  BridgeChannel,
  bridgeAvailable,
  type TwsearchChannel,
  type TwsearchEvent,
  WasmChannel,
} from "./twsearch-channel";
import { getMoveSetText, moveSetEvents, setMoveSetText } from "./move-set";
import {
  bridgeCommands,
  bridgeOriginCommand,
  renderHelpOptions,
} from "./solver-help";
import {
  patternToScrambleState,
  setOmissionFromArgs,
  TwsearchStateError,
} from "./twsearch-state";

// Default pruning table memory for WebAssembly, in MB, when the options do
// not give -M.  (The bridge applies its own cap.)
const WASM_DEFAULT_MEGABYTES = 512;
// How long to wait for "Search canceled" before offering to abandon a
// pruning table fill.
const CANCEL_GRACE_MS = 750;

// Exported searches are numbered so that no two files saved from this
// browser have the same name; twsearch takes a puzzle's name from the part
// before the first dot, so "4x4x4.3.tws" and "4x4x4.7.tws" still share
// pruning tables.  The count is kept in localStorage so that it survives a
// reload and is shared by every tab; it is the only thing the Explorer
// stores there.
const EXPORT_SEQUENCE_KEY = "twsearch-export-sequence";

function nextExportSequence(): number {
  let next = 1;
  try {
    next = (Number(localStorage.getItem(EXPORT_SEQUENCE_KEY)) || 0) + 1;
    localStorage.setItem(EXPORT_SEQUENCE_KEY, String(next));
  } catch {
    // Storage can be unavailable (private windows, blocked site data); the
    // name is then only unique within this page.
    next = ++fallbackSequence;
  }
  return next;
}

let fallbackSequence = 0;

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
  movesInput = element<HTMLInputElement>("twsearch-moves");
  statusElem = element<HTMLDivElement>("twsearch-status");
  solutionsElem = element<HTMLOListElement>("twsearch-solutions");
  logElem = element<HTMLPreElement>("twsearch-log");
  exportButton = element<HTMLButtonElement>("twsearch-export-button");
  exportDialog = element<HTMLDialogElement>("twsearch-export-dialog");
  exportText = element<HTMLTextAreaElement>("twsearch-export-text");
  exportCommand = element<HTMLPreElement>("twsearch-export-command");
  exportNote = element<HTMLSpanElement>("twsearch-export-note");

  bridge = new BridgeChannel();
  wasm: WasmChannel;
  running: { id: string; channel: TwsearchChannel } | null = null;
  nextID = 1;

  constructor(
    private app: TwizzleExplorerApp,
    createWorker: () => Worker,
  ) {
    this.wasm = new WasmChannel(createWorker);
    this.solveButton.addEventListener("click", () => void this.solve());
    // The move set, per puzzle, for the session.
    this.movesInput.addEventListener("input", () => {
      setMoveSetText(this.app.configUI.descInput.value, this.movesInput.value);
    });
    app.twistyPlayer.experimentalModel.puzzleLoader.addFreshListener(() => {
      this.movesInput.value = getMoveSetText(this.app.configUI.descInput.value);
    });
    moveSetEvents.addEventListener("change", () => {
      const text = getMoveSetText(this.app.configUI.descInput.value);
      if (this.movesInput.value !== text && document.activeElement !== this.movesInput) {
        this.movesInput.value = text;
      }
    });
    this.cancelButton.addEventListener("click", () => this.cancel());
    this.exportButton.addEventListener("click", () => void this.showExport());
    const helpDialog = element<HTMLDialogElement>("twsearch-help-dialog");
    renderHelpOptions(element("twsearch-help-options"));
    element("twsearch-help-bridge-commands").textContent = bridgeCommands();
    element("twsearch-help-bridge-origin").textContent = bridgeOriginCommand(
      globalThis.location.origin,
    );
    element<HTMLButtonElement>("twsearch-help-button").addEventListener(
      "click",
      () => helpDialog.showModal(),
    );
    element<HTMLButtonElement>("twsearch-help-close").addEventListener(
      "click",
      () => helpDialog.close(),
    );
    element<HTMLButtonElement>("twsearch-export-close").addEventListener(
      "click",
      () => this.exportDialog.close(),
    );
    element<HTMLButtonElement>("twsearch-export-copy").addEventListener(
      "click",
      () => void this.copyExport(),
    );
    element<HTMLButtonElement>("twsearch-export-download").addEventListener(
      "click",
      () => this.downloadExport(),
    );
  }

  /** The twsearch options for a search, as solve() would run it. */
  searchArgs(): string[] {
    const args = this.argsInput.value.trim().split(/\s+/).filter(Boolean);
    if (!args.includes("--checkbeforesolve")) {
      args.push("--checkbeforesolve");
    }
    return args;
  }

  /** The file name shown in the popup, set when it opens. */
  exportName = "puzzle.tws";

  /** A fresh file name for an exported search, from the puzzle's name. */
  nextExportFileName(): string {
    const name =
      this.app.configUI.puzzleNameSelect.value ||
      this.app.configUI.descInput.value;
    const base =
      name.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") ||
      "puzzle";
    return `${base}.${nextExportSequence()}.tws`;
  }

  /**
   * Show the file for the current search: the puzzle definition with the
   * position to solve at the end of it, which twsearch reads on its own,
   * and the command line that runs the same search natively.
   */
  async showExport(): Promise<void> {
    const args = this.searchArgs();
    this.exportNote.textContent = "";
    let input: { tws: string; scramble: string };
    try {
      input = await this.input(args);
    } catch (e) {
      this.setStatus(
        e instanceof TwsearchStateError ? e.message : `Error: ${e}`,
      );
      return;
    }
    this.exportName = this.nextExportFileName();
    const command = `twsearch ${[...args, this.exportName].join(" ")}`;
    // The command goes in the file as a comment; comments do not change the
    // puzzle's checksum, so the file still shares the puzzle's pruning
    // tables.
    const file = `# ${command}\n${input.tws.replace(/\n*$/, "")}\n\n${input.scramble.replace(/\n*$/, "")}\n`;
    this.exportText.value = file;
    this.exportCommand.textContent = command;
    this.exportDialog.showModal();
  }

  async copyExport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.exportText.value);
      this.exportNote.textContent = "Copied.";
    } catch {
      // Clipboard access is refused in some contexts (including file://).
      this.exportText.focus();
      this.exportText.select();
      this.exportNote.textContent = document.execCommand("copy")
        ? "Copied."
        : "Press Ctrl-C (Command-C) to copy the selected text.";
    }
  }

  downloadExport(): void {
    const url = URL.createObjectURL(
      new Blob([this.exportText.value], { type: "text/plain" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = this.exportName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    this.exportNote.textContent = `Saved ${this.exportName}.`;
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

  /**
   * The twsearch input for the position at the end of the alg (including a
   * setup from the Scramble button or a setup alg).  The displayed state is
   * mapped onto twsearch's puzzle (see twsearch-state.ts).
   */
  async input(args: string[]): Promise<{ tws: string; scramble: string }> {
    const model = this.app.twistyPlayer.experimentalModel;
    const [start, algWithIssues] = await Promise.all([
      model.anchorTransformation.get(),
      model.puzzleAlg.get(),
    ]);
    if (algWithIssues.issues.errors.length > 0) {
      throw new TwsearchStateError(
        `The alg has errors: ${algWithIssues.issues.errors.join("; ")}`,
      );
    }
    const pattern = start.applyAlg(algWithIssues.alg).toKPattern();
    // Refuse positions the moves can't reach before starting a search that
    // would never end.  (twsearch's own --checkbeforesolve can't check
    // puzzles with identical pieces.)  This covers the orbits whose pieces
    // are all distinguishable.
    // Options that tell twsearch to ignore sets (--nocorners, --omit, ...)
    // apply to these checks too.
    const { checker, moveSet, tws } = await puzzleChecks(this.app, args);
    // With --distinguishall every piece is distinct, so twsearch's own
    // --checkbeforesolve decides exactly; our check, which can only look at
    // the orbits the display tells apart, would be guessing.
    const distinguishAll = args.includes("--distinguishall");
    const reach = distinguishAll ? "reachable" : checker.check(pattern);
    if (reach === "rotated") {
      throw new TwsearchStateError(
        moveSet.length > 0
          ? `This position can't be reached with the move set ${moveSet.join(",")}, only with the whole puzzle rotated as well (not supported yet).`
          : "This position is rotated relative to the solved puzzle, which the puzzle's moves can't undo (a rotation or a middle-slice move in the alg, or a Scramble made by a cubing.js from before scrambles kept to the puzzle's own moves).",
      );
    }
    if (reach === "unreachable") {
      throw new TwsearchStateError(
        moveSet.length > 0
          ? `This position can't be reached with the move set ${moveSet.join(",")}.`
          : "This position can't be reached with the puzzle's moves.",
      );
    }
    return {
      tws,
      scramble: patternToScrambleState(
        pattern,
        tws,
        undefined,
        setOmissionFromArgs(args),
        distinguishAll,
      ),
    };
  }

  async solve(): Promise<void> {
    if (this.running) {
      return;
    }
    this.solutionsElem.textContent = "";
    this.logElem.textContent = "";
    const args = this.searchArgs();
    let input: { tws: string; scramble: string };
    try {
      input = await this.input(args);
    } catch (e) {
      this.setStatus(
        e instanceof TwsearchStateError ? e.message : `Error: ${e}`,
      );
      return;
    }
    const channel = await this.chooseChannel();
    if (channel === this.wasm && !args.includes("-M")) {
      args.push("-M", String(WASM_DEFAULT_MEGABYTES));
    }
    if (channel === this.wasm) {
      // The browser build is single-threaded, and twsearch rejects -t there.
      const at = args.indexOf("-t");
      if (at >= 0) {
        args.splice(at, 2);
        this.logElem.append(
          "The browser build is single-threaded; ignoring -t (the native bridge uses it).\n",
        );
      }
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
        // twsearch reports each depth as it finishes it, so it is now
        // searching the next one.
        phase = `Searching depth ${Number(match[1]) + 1}`;
      } else if (line.startsWith("Solving")) {
        searching = true;
        phase = "Searching";
      } else if (searching && line.startsWith(" ")) {
        // twsearch prints ksolve move names, which the Explorer's puzzle
        // uses too (both come from PuzzleGeometry's notation mapper).  Other
        // indented output (the usage text after a bad option, say) is not a
        // solution, so anything that will not parse is left to the log.
        try {
          this.addSolution(Alg.fromString(line.trim()));
        } catch {
          /* not a move sequence */
        }
      } else if (line.startsWith("Ignoring unsolvable position")) {
        final =
          "This position can't be reached with the puzzle's moves (perhaps it is rotated relative to the solved puzzle).";
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

  addSolution(solution: Alg): void {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.textContent =
      solution.toString() === "" ? "(already solved)" : solution.toString();
    button.title = "Append to the alg";
    button.addEventListener("click", async () => {
      const model = this.app.twistyPlayer.experimentalModel;
      this.app.twistyPlayer.alg = (await model.alg.get()).alg.concat(solution);
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
