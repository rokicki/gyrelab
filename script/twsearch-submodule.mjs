// Checks that the twsearch submodule is there and at the commit Gyrelab
// pins, and says how to fix it when it is not.  The scripts that build
// twsearch call this first; building Gyrelab itself does not need the
// submodule, since the WebAssembly twsearch is vendored.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export const twsearchDir = new URL("../twsearch/", import.meta.url);
const root = new URL("../", import.meta.url).pathname;

export function checkTwsearchSubmodule() {
  // `git submodule status` marks the state in its first character: a space
  // when the checkout matches the pinned commit, "-" when it was never
  // fetched, "+" when something else is checked out, "U" in a conflict.
  let status = "";
  try {
    status = execFileSync("git", ["-C", root, "submodule", "status", "twsearch"], {
      encoding: "utf8",
    });
  } catch {
    // Not a git checkout (a downloaded archive, say): fall back to looking.
  }
  const mark = status[0];
  if (mark === "-" || !existsSync(new URL("Makefile", twsearchDir))) {
    console.error(
      "The twsearch submodule is missing (probably cloned without --recursive).\n" +
        "Fetch it with:\n\n" +
        "    git submodule update --init\n",
    );
    process.exit(1);
  }
  if (mark === "U") {
    console.error("The twsearch submodule has a merge conflict; resolve it first.");
    process.exit(1);
  }
  if (mark === "+") {
    const pinned = execFileSync("git", ["-C", root, "ls-tree", "HEAD", "twsearch"], {
      encoding: "utf8",
    }).split(/\s+/)[2];
    const actual = status.slice(1).split(" ")[0];
    console.warn(
      `Note: twsearch is at ${actual.slice(0, 7)}, not the ${pinned.slice(0, 7)} Gyrelab pins.\n` +
        "If that is not on purpose (a `git pull` without --recurse-submodules\n" +
        "leaves it behind), put it back with:\n\n" +
        "    git submodule update\n",
    );
  }
}
