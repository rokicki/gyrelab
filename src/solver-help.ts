// What the Solver tab's Help button shows about twsearch's options.
//
// Every option here is one that works from the Solver tab on both channels
// (test/options-test.mjs tries them; test/help-test.mjs checks that the
// bridge allows each one).

export interface HelpOption {
  /** As it is typed, with a placeholder for a value. */
  option: string;
  /** The argument names the bridge checks, without values. */
  flags: string[];
  text: string;
}

export const HELP_OPTIONS: HelpOption[] = [
  { option: "-c <n>", flags: ["-c"], text: "Stop after n solutions (the default is one)." },
  { option: "--alloptimal", flags: ["--alloptimal"], text: "Every solution of the shortest length." },
  { option: "--mindepth <n>", flags: ["--mindepth"], text: "Start searching at depth n." },
  { option: "--maxdepth <n>", flags: ["--maxdepth"], text: "Give up past depth n, instead of searching on." },
  { option: "-M <mb>", flags: ["-M"], text: "Memory for the pruning table, in megabytes.  More memory usually means a much faster search.  The browser uses 512 unless you say otherwise; the bridge caps this at its own limit." },
  { option: "-t <n>", flags: ["-t"], text: "Threads to search with (the native bridge only; the browser build is single-threaded and ignores it)." },
  { option: "--microthreads <n>", flags: ["--microthreads"], text: "Microthreads per thread, which hides memory latency." },
  { option: "-q", flags: ["-q"], text: "Quarter turns only: count and use only the puzzle's smallest turns." },
  { option: "--moves <a,b,c>", flags: ["--moves"], text: "Restrict the search to these moves.  The Move set field above does this better, since the Colors tab then checks against the same moves." },
  { option: "--newcanon <n>", flags: ["--newcanon"], text: "Search-based canonical sequences to depth n, which helps puzzles whose moves can combine into a whole-puzzle rotation, such as the skewb." },
  { option: "--nosymmetry", flags: ["--nosymmetry"], text: "Do not use the puzzle's symmetry to shrink the pruning table." },
  { option: "--noearlysolutions", flags: ["--noearlysolutions"], text: "Also report a solution whose prefix already solves the position." },
  { option: "--randomstart", flags: ["--randomstart"], text: "Randomize the move order, for variety in the solutions found." },
  { option: "-R <n>", flags: ["-R"], text: "Seed for the random number generator." },
  { option: "--startprunedepth <n>", flags: ["--startprunedepth"], text: "Depth the pruning table starts at (the default is 3)." },
  { option: "--nocorners", flags: ["--nocorners"], text: "Ignore the corners: solve everything else." },
  { option: "--nocenters", flags: ["--nocenters"], text: "Ignore the centers." },
  { option: "--noedges", flags: ["--noedges"], text: "Ignore the edges." },
  { option: "--omit <set>", flags: ["--omit"], text: "Ignore one set of pieces by name, as the exported file names it (CORNERS, EDGES, CENTERS, ...)." },
  { option: "--omitperms <set>", flags: ["--omitperms"], text: "For this set, solve the orientations but not which piece is where." },
  { option: "--omitoris <set>", flags: ["--omitoris"], text: "For this set, solve the permutation but not the orientations." },
  { option: "--noorientation", flags: ["--noorientation"], text: "Ignore orientation everywhere." },
  { option: "--distinguishall", flags: ["--distinguishall"], text: "Tell apart pieces that look alike (the superpuzzle), for finding pure algorithms: a cycle of same-color centers, say, which the puzzle itself cannot show.  A position from the alg is used exactly; a painted position leaves look-alike pieces at home wherever it can, since the colors cannot say which is which." },
  { option: "--orientationgroup <n>", flags: ["--orientationgroup"], text: "Treat groups of n adjacent pieces as interchangeable." },
  { option: "--writeprunetables always", flags: ["--writeprunetables"], text: "Keep pruning tables on disk between searches (native only; the bridge does not keep them otherwise).  never, auto, or always." },
  { option: "-v2", flags: ["-v2"], text: "More output while searching; -v3 for more again, --quiet for less." },
];

/** How to get twsearch and start it serving, for the page it is shown on. */
export const BRIDGE_REPOSITORY = "https://github.com/rokicki/twsearch";
const LATEST = `${BRIDGE_REPOSITORY}/releases/latest/download`;

export function macCommands(): string {
  return [
    `curl -L -o twsearch ${LATEST}/twsearch-macos`,
    "chmod +x twsearch",
    "./twsearch --serve -M 8192",
  ].join("\n");
}

export function windowsCommands(): string {
  return [
    `curl.exe -L -o twsearch.exe ${LATEST}/twsearch-windows-x64.exe`,
    ".\\twsearch.exe --serve -M 8192",
  ].join("\n");
}

export function originOption(origin: string): string {
  // A page opened from a file has no origin that can be allowed.
  const allowed = /^https?:\/\//.test(origin) ? origin : "https://the.site";
  return `--allow-origin ${allowed}`;
}

/** Fills the dialog's option list. */
export function renderHelpOptions(list: HTMLElement): void {
  list.textContent = "";
  for (const { option, text } of HELP_OPTIONS) {
    const dt = document.createElement("dt");
    dt.textContent = option;
    const dd = document.createElement("dd");
    dd.textContent = text;
    list.append(dt, dd);
  }
}
