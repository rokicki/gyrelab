// Builds the Explorer.
//
//    bun script/build.mjs               dev build into dist/
//    bun script/build.mjs --serve       dev build, rebuilt on change, served
//                                       at http://localhost:3334/
//    bun script/build.mjs --site DIR    static site into DIR
//
// The static site works from any web server and also opened directly from
// the filesystem (file://).  Browsers refuse module scripts and worker
// scripts from file:// URLs, so the site build uses one classic script, with
// the twsearch worker's code embedded in it and started from a Blob URL.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as esbuild from "esbuild";

const src = new URL("../src/", import.meta.url).pathname;

// Which cubing.js to build against.  Normally the published cubing package
// in node_modules.  With CUBING_LIB set to the dist/lib/cubing directory of
// a built cubing.js checkout, "cubing/..." comes from there instead, for
// trying changes to cubing.js itself.
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
// What this build is, so a page can say which one it is: without that, an
// old page held by a browser looks exactly like a new one, and every
// difference in behaviour is a mystery.
function buildStamp() {
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["describe", "--always", "--dirty", "--tags"], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    }).trim();
  } catch {}
  return `${commit} ${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`;
}
const stamp = buildStamp();
console.log(`build: ${stamp}`);

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
    define: { GYRELAB_BUILD: JSON.stringify(stamp), "import.meta.url": "self.location.href" },
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
      GYRELAB_BUILD: JSON.stringify(stamp),
      "import.meta.url": "document.baseURI",
    },
    loader: { ".woff": "file", ".woff2": "file", ".html": "text" },
    assetNames: "assets/[name]-[hash]",
    plugins: cubingPlugins,
    logLevel: "warning",
  });
  for (const file of assets) cpSync(src + file, `${out}/${file}`);
  // Apache settings for serving the site (compression, caching); harmless
  // and ignored elsewhere.  See the file itself.
  cpSync(`${src}site.htaccess`, `${out}/.htaccess`);
  // A classic, deferred script instead of a module.
  const html = readFileSync(src + "index.html", "utf8").replace(
    /<script src="\.\/main\.js"[^>]*><\/script>/,
    '<script src="./main.js" defer></script>',
  );
  writeFileSync(`${out}/index.html`, html);
  // What a page needs to become Gyrelab: it works out where it came from
  // and brings in the rest from there.  twsearch --serve answers with a page
  // holding nothing but a script tag pointing at this, so that the page and
  // the searches it asks for share an origin; a released twsearch therefore
  // knows one URL and nothing else about what the site looks like.
  writeFileSync(
    `${out}/boot.js`,
    `(() => {
  const here = document.currentScript.src;
  const base = here.slice(0, here.lastIndexOf("/") + 1);
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = base + "index.css";
  document.head.append(style);
  for (const [rel, file] of [["icon", "favicon.ico"], ["apple-touch-icon", "app-icon.png"]]) {
    const icon = document.createElement("link");
    icon.rel = rel;
    icon.href = base + file;
    document.head.append(icon);
  }
  const app = document.createElement("script");
  app.src = base + "main.js";
  document.head.append(app);
})();
`,
  );
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
    define: { GYRELAB_BUILD: JSON.stringify(stamp) },
    plugins: [copyStatic, ...cubingPlugins],
    entryPoints: [src + "main.ts", src + "twsearch-worker.ts", src + "index.css"],
    outdir: dist,
    bundle: true,
    splitting: true,
    format: "esm",
    target: "es2022",
    chunkNames: "chunks/[name]-[hash]",
    sourcemap: true,
    loader: { ".woff": "file", ".woff2": "file", ".html": "text" },
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
