import { TwizzleExplorerApp } from "./app";

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

// Expose as a global for debugging.
(globalThis as any).app = new TwizzleExplorerApp(createTwsearchWorker);
