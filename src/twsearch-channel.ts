// One interface over the two ways to run twsearch: the native twsearch
// bridge (twsearch/src/js/twsearch-bridge.mjs) on this machine, or the
// WebAssembly build in a Worker.  Both take the same job and report the
// same events.

// Output text arrives as twsearch flushes it, so it may be a partial line.
export type TwsearchEvent =
  | { type: "out" | "err"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface TwsearchJob {
  id: string;
  tws: string;
  args: string[];
  scramble: string;
}

export interface TwsearchChannel {
  readonly name: string;
  /** Resolves after the final "done" or "error" event. */
  solve(job: TwsearchJob, onEvent: (e: TwsearchEvent) => void): Promise<void>;
  /** abandon: stop even if a pruning table fill is in progress. */
  cancel(id: string, abandon?: boolean): void;
}

/*
 *   Where to ask for a native search.  Usually the port twsearch serves on
 *   by default; but twsearch --serve also answers with this page, and may
 *   have been told to use another port, in which case the page's own address
 *   is where its twsearch is.  Which of the two it is cannot be told by
 *   looking -- a page served by anything else on this machine looks the same
 *   -- so ask the page's own address first and keep whichever answers.
 */
const USUAL_BRIDGE = "http://127.0.0.1:2023";
let bridgeURL = USUAL_BRIDGE;

function ownOrigin(): string | null {
  const origin = globalThis.location?.origin ?? "";
  return /^https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/.test(origin) &&
    origin !== USUAL_BRIDGE
    ? origin
    : null;
}

async function answers(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/v1/info`, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok && (await response.json())?.bridge === "twsearch-bridge";
  } catch {
    return false;
  }
}

/*
 *   Browsers ask the reader's permission before a page may reach a program
 *   on their own machine, and Chrome only offers that choice while a click
 *   of theirs is still fresh: a request made later is refused outright, and
 *   the refusal is remembered, so every later attempt fails too.  That is
 *   why the Solver asks for the bridge first thing when a button is pressed,
 *   before working out the position to solve.
 */
export type LocalNetworkPermission = "granted" | "prompt" | "denied" | "unknown";

export async function localNetworkPermission(): Promise<LocalNetworkPermission> {
  try {
    const status = await navigator.permissions.query({
      name: "local-network-access" as PermissionName,
    });
    return status.state as LocalNetworkPermission;
  } catch {
    // A browser that does not ask; the request itself will say.
    return "unknown";
  }
}

/**
 *   What to tell someone whose browser would not let the request through.
 *   No setting of theirs fixes this: browsers have stopped letting a page on
 *   the web reach a program on the reader's own machine, however either side
 *   asks.  What does work is a page served by that program, which twsearch
 *   answers with.
 */
export async function nativeUnreachableMessage(): Promise<string> {
  const blocked = (await localNetworkPermission()) !== "granted";
  return blocked
    ? "Your browser will not let a page on the web reach twsearch on your " +
        "computer.  Run twsearch as the Help pane describes and open " +
        "http://127.0.0.1:2023/ : the page it serves there is this one, and " +
        "it searches natively."
    : "No twsearch answered on this computer.  The Help pane says how to " +
        "start one.";
}

// Never ask the browser's permission machinery before making the request:
// only the request itself can bring up the choice, and a page that decides
// in advance that it is not allowed never gives anyone that choice.
let asked = false;

export async function bridgeAvailable(): Promise<boolean> {
  asked = true;
  const own = ownOrigin();
  if (own && (await answers(own))) {
    bridgeURL = own; // served by the twsearch that will do the searching
    return true;
  }
  if (await answers(USUAL_BRIDGE)) {
    bridgeURL = USUAL_BRIDGE;
    return true;
  }
  return false;
}

export class BridgeChannel implements TwsearchChannel {
  readonly name = "native (twsearch bridge)";

  async solve(
    job: TwsearchJob,
    onEvent: (e: TwsearchEvent) => void,
  ): Promise<void> {
    // Someone who asked for a native search outright still needs to know
    // which twsearch to ask (see above).
    if (!asked) {
      await bridgeAvailable();
    }
    let finished = false;
    const emit = (e: TwsearchEvent) => {
      if (e.type === "done" || e.type === "error") {
        finished = true;
      }
      onEvent(e);
    };
    try {
      const response = await fetch(`${bridgeURL}/v1/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
      if (!response.ok || !response.body) {
        emit({ type: "error", message: (await response.text()).trim() });
        return;
      }
      let buffered = "";
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffered += value;
        let newline = buffered.indexOf("\n");
        while (newline >= 0) {
          emit(JSON.parse(buffered.slice(0, newline)));
          buffered = buffered.slice(newline + 1);
          newline = buffered.indexOf("\n");
        }
      }
    } catch (e) {
      if (!finished) {
        // A browser that refuses to reach this computer fails the same way
        // as a bridge that is not running; say which it was.
        // A browser that will not reach this computer fails the same way as
        // a twsearch that is not running.  Only the first is worth
        // explaining; the second is covered by the Help pane.
        const blocked = e instanceof TypeError;
        emit({
          type: "error",
          message: blocked ? await nativeUnreachableMessage() : `bridge: ${e}`,
        });
      }
    }
    if (!finished) {
      emit({ type: "error", message: "bridge closed the connection" });
    }
  }

  cancel(id: string, abandon = false): void {
    void fetch(`${bridgeURL}/v1/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, abandon }),
    }).catch(() => {});
  }
}

export class WasmChannel implements TwsearchChannel {
  readonly name = "WebAssembly (in this browser)";
  #worker: Worker | null = null;
  #handlers = new Map<string, (e: TwsearchEvent) => void>();

  constructor(private createWorker: () => Worker) {}

  #getWorker(): Worker {
    if (!this.#worker) {
      const worker = this.createWorker();
      worker.addEventListener(
        "message",
        (e: MessageEvent<{ id: string; event: TwsearchEvent }>) =>
          this.#handlers.get(e.data.id)?.(e.data.event),
      );
      worker.addEventListener("error", (e) =>
        this.#failAll(`worker failed: ${e.message}`),
      );
      this.#worker = worker;
    }
    return this.#worker;
  }

  #failAll(message: string): void {
    for (const handler of [...this.#handlers.values()]) {
      handler({ type: "error", message });
    }
  }

  solve(job: TwsearchJob, onEvent: (e: TwsearchEvent) => void): Promise<void> {
    return new Promise((resolve) => {
      this.#handlers.set(job.id, (e) => {
        onEvent(e);
        if (e.type === "done" || e.type === "error") {
          this.#handlers.delete(job.id);
          resolve();
        }
      });
      this.#getWorker().postMessage({ type: "solve", ...job });
    });
  }

  cancel(id: string, abandon = false): void {
    if (abandon) {
      // A table fill never yields, so the worker cannot hear us; the only
      // way to stop it is to discard the worker (and its pruning table).
      this.#worker?.terminate();
      this.#worker = null;
      this.#failAll("abandoned");
    } else {
      this.#worker?.postMessage({ type: "cancel", id });
    }
  }
}
