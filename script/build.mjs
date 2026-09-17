// Builds the Explorer into dist/.  With --serve, rebuilds on change and
// serves dist/ at http://localhost:3334/.
import { cpSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

const serve = process.argv.includes("--serve");
const src = new URL("../src/", import.meta.url).pathname;
const dist = new URL("../dist/", import.meta.url).pathname;

mkdirSync(dist, { recursive: true });
for (const file of ["index.html", "help.html", "favicon.ico", "app-icon.png"]) {
  cpSync(src + file, dist + file);
}

const options = {
  entryPoints: [src + "main.ts", src + "twsearch-worker.ts", src + "index.css"],
  outdir: dist,
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  chunkNames: "chunks/[name]-[hash]",
  sourcemap: true,
  loader: { ".woff": "file", ".woff2": "file" },
  logLevel: "info",
};

if (serve) {
  const context = await esbuild.context(options);
  await context.watch();
  const { port } = await context.serve({ servedir: dist, port: 3334 });
  console.log(`Explorer: http://localhost:${port}/`);
} else {
  await esbuild.build(options);
}
