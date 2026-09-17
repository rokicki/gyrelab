// Web Worker running the WebAssembly twsearch; the same as
// twsearch/src/js/twsearch-worker.mjs, but importing the vendored build
// (`npm run roll-twsearch`).
import createTwsearchModule from "../vendor/twsearch/twsearch.mjs";
import { TwsearchSession } from "../vendor/twsearch/twsearch-session.mjs";

const session = new TwsearchSession(
  createTwsearchModule,
  (id: string, event: unknown) => self.postMessage({ id, event }),
);

self.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data;
  if (msg?.type === "solve") {
    session.solve(msg);
  } else if (msg?.type === "cancel") {
    session.cancel(msg.id);
  }
});
