import { TwizzleExplorerApp } from "./app";
import markup from "./app.html";

/*
 *   The page's own markup travels with the program, so that a page carrying
 *   nothing but a script tag becomes Gyrelab.  That is how twsearch serves
 *   it: `twsearch --serve` answers with a few lines of HTML that fetch this
 *   script, and the page then belongs to the same origin as the searches it
 *   asks for, which is what browsers now insist on.
 */
function buildPage(): void {
  if (document.querySelector("side-panel")) {
    return; // a page that came with its own markup
  }
  document.body.insertAdjacentHTML("afterbegin", markup);
}

// The static site build (script/build.mjs --site) defines this as the
// bundled twsearch worker's source, so the worker can start from a Blob URL:
// that works even when the page is opened from the filesystem, where
// browsers refuse worker scripts loaded by URL.
declare const TWSEARCH_WORKER_SOURCE: string | undefined;

function createTwsearchWorker(): Worker {
  if (typeof TWSEARCH_WORKER_SOURCE === "string") {
    const blob = new Blob([TWSEARCH_WORKER_SOURCE], { type: "text/javascript" });
    return new Worker(URL.createObjectURL(blob));
  }
  // The dev build: the worker is its own module next to this file.  (The URL
  // is computed here, in the entry file, so it is relative to this page's
  // directory rather than to a shared chunk.)
  return new Worker(new URL("./twsearch-worker.js", import.meta.url), {
    type: "module",
  });
}

buildPage();
// Which build this is.  A browser holding an old page looks exactly like a
// new one otherwise, and then every difference in behaviour is a mystery.
declare const GYRELAB_BUILD: string;
const stamp = typeof GYRELAB_BUILD === "string" ? GYRELAB_BUILD : "unknown";
const stampElem = document.getElementById("build-stamp");
if (stampElem) {
  stampElem.textContent = stamp;
}
(globalThis as any).gyrelabBuild = stamp;
// Expose as a global for debugging.
(globalThis as any).app = new TwizzleExplorerApp(createTwsearchWorker);
