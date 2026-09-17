// Bundles a test .ts file for node and runs it: node test/run-ts.mjs test/x.ts args...
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import * as esbuild from "esbuild";
const [entry, ...args] = process.argv.slice(2);
const outfile = new URL(`../dist/test/${basename(entry, ".ts")}.mjs`, import.meta.url).pathname;
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile, logLevel: "warning",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
process.exit(spawnSync("node", [outfile, ...args], { stdio: "inherit" }).status ?? 1);
