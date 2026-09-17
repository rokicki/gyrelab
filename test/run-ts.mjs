// Bundles a test .ts file for node and runs it: node test/run-ts.mjs test/x.ts args...
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import * as esbuild from "esbuild";
const [entry, ...args] = process.argv.slice(2);
const outfile = new URL(`../dist/test/${basename(entry, ".ts")}.mjs`, import.meta.url).pathname;
// CUBING_LIB (set by `make dev`/`make site` with CUBING=local) points at the
// local cubing.js build, so tests can run against the checkout too.
const cubingLib = process.env.CUBING_LIB;
const cubingPlugins = cubingLib
  ? [{
      name: "local-cubing",
      setup(build) {
        build.onResolve({ filter: /^cubing\// }, (args) => ({
          path: `${cubingLib}/${args.path.slice("cubing/".length)}/index.js`,
        }));
      },
    }]
  : [];
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile, logLevel: "warning", plugins: cubingPlugins,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
process.exit(spawnSync("node", [outfile, ...args], { stdio: "inherit" }).status ?? 1);
