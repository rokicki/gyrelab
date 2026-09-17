// Builds the Explorer.
//
//    node script/build.mjs              dev build into dist/
//    node script/build.mjs --serve      dev build, rebuilt on change, served
//                                       at http://localhost:3334/
//    node script/build.mjs --site DIR   static site into DIR
//
// The static site works from any web server and also opened directly from
// the filesystem (file://).  Browsers refuse module scripts and worker
// scripts from file:// URLs, so the site build uses one classic script, with
// the twsearch worker's code embedded in it and started from a Blob URL.
import { cpSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as esbuild from "esbuild";

const src = new URL("../src/", import.meta.url).pathname;

// Which cubing.js to build against.  With CUBING_LIB set (the top-level
// Makefile sets it for `CUBING = local`), "cubing/..." comes from that
// directory, which is the local cubing.js checkout's build, so changes to it
// show up here.  Without it, the published cubing package in node_modules is
// used.  See the Makefile in the directory above this repository.
const cubingLib = process.env.CUBING_LIB;
const localCubing = {
  name: "local-cubing",
  setup(build) {
    build.onResolve({ filter: /^cubing\// }, (args) => ({
      path: `${cubingLib}/${args.path.slice("cubing/".length)}/index.js`,
    }));
  },
};
const cubingPlugins = cubingLib ? [localCubing] : [];
console.log(
  cubingLib
    ? `cubing.js: the local checkout (${cubingLib})`
    : "cubing.js: the published cubing package in node_modules",
);
const assets = ["help.html", "favicon.ico", "app-icon.png"];
const siteIndex = process.argv.indexOf("--site");

if (siteIndex >= 0) {
  const out = resolve(process.argv[siteIndex + 1] ?? "site");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // The worker, as a classic script to embed.
  const worker = await esbuild.build({
    entryPoints: [src + "twsearch-worker.ts"],
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: true,
    write: false,
    define: { "import.meta.url": "self.location.href" },
    plugins: cubingPlugins,
    logLevel: "warning",
  });
  await esbuild.build({
    entryPoints: [src + "main.ts", src + "index.css"],
    outdir: out,
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: true,
    define: {
      TWSEARCH_WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text),
      "import.meta.url": "document.baseURI",
    },
    loader: { ".woff": "file", ".woff2": "file" },
    assetNames: "assets/[name]-[hash]",
    plugins: cubingPlugins,
    logLevel: "warning",
  });
  for (const file of assets) cpSync(src + file, `${out}/${file}`);
  // A classic, deferred script instead of a module.
  const html = readFileSync(src + "index.html", "utf8").replace(
    /<script src="\.\/main\.js"[^>]*><\/script>/,
    '<script src="./main.js" defer></script>',
  );
  writeFileSync(`${out}/index.html`, html);
  console.log(`Static site in ${out}`);
} else {
  const dist = new URL("../dist/", import.meta.url).pathname;
  mkdirSync(dist, { recursive: true });
  // esbuild doesn't watch these, so copy them on every (re)build.
  const copyStatic = {
    name: "copy-static",
    setup(build) {
      build.onStart(() => {
        for (const file of ["index.html", ...assets]) cpSync(src + file, dist + file);
      });
    },
  };
  const options = {
    plugins: [copyStatic, ...cubingPlugins],
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
  if (process.argv.includes("--serve")) {
    const context = await esbuild.context(options);
    await context.watch();
    // An edit to only the HTML triggers no esbuild rebuild; copy it directly.
    for (const file of ["index.html", ...assets]) {
      watch(src + file, () => cpSync(src + file, dist + file));
    }
    const { port } = await context.serve({ servedir: dist, port: 3334 });
    console.log(`Explorer: http://localhost:${port}/`);
  } else {
    await esbuild.build(options);
  }
}
