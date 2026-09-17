// Copies the WebAssembly twsearch build (`make build-wasm` in ../twsearch)
// into vendor/twsearch/, recording which twsearch commit it came from.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const from = new URL("../../twsearch/build/wasm/", import.meta.url);
const to = new URL("../vendor/twsearch/", import.meta.url);
if (!existsSync(new URL("twsearch.mjs", from))) {
  console.error("Run `make build-wasm` in ../twsearch first.");
  process.exit(1);
}
mkdirSync(to, { recursive: true });
const git = (...args) =>
  execFileSync("git", ["-C", from.pathname, ...args], { encoding: "utf8" }).trim();
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
