import { TwizzleExplorerApp } from "./app";

// Expose as a global for debugging.
// The worker URL is computed here, in the entry file, so that it is relative
// to this page's directory rather than to a shared chunk.
(globalThis as any).app = new TwizzleExplorerApp(
  new URL("./twsearch-worker.js", import.meta.url),
);
