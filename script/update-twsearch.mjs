// Refreshes vendor/twsearch/ from the twsearch submodule: builds its
// WebAssembly module (which needs emsdk; set EMSDK if it is not in ~/emsdk)
// and copies the result here, recording which twsearch commit it came from.
//
//    bun run update-twsearch
//
// The built copy is committed so that building Gyrelab needs only bun; this
// is for when twsearch moves on.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkTwsearchSubmodule, twsearchDir as twsearch } from "./twsearch-submodule.mjs";

const from = new URL("build/wasm/", twsearch);
const to = new URL("../vendor/twsearch/", import.meta.url);

checkTwsearchSubmodule();
const emsdk = process.env.EMSDK ?? `${process.env.HOME}/emsdk`;
execFileSync("make", ["-C", twsearch.pathname, "build-wasm", `EMSDK=${emsdk}`], {
  stdio: "inherit",
});

mkdirSync(to, { recursive: true });
const git = (...args) =>
  execFileSync("git", ["-C", twsearch.pathname, ...args], { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
for (const name of ["twsearch.mjs", "twsearch-session.mjs"]) {
  const body = readFileSync(new URL(name, from), "utf8");
  writeFileSync(new URL(name, to), `// @ts-nocheck\n${body}`);
}
writeFileSync(
  new URL("VERSION.txt", to),
  `twsearch ${commit}${dirty ? " (with uncommitted changes)" : ""}\n`,
);
console.log(`Copied twsearch ${commit}${dirty ? " (dirty)" : ""} to vendor/twsearch/`);
