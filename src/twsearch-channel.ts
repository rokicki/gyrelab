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

const BRIDGE_URL = "http://127.0.0.1:2023";

export async function bridgeAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${BRIDGE_URL}/v1/info`, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok && (await response.json())?.bridge === "twsearch-bridge";
  } catch {
    return false;
  }
}

export class BridgeChannel implements TwsearchChannel {
  readonly name = "native (twsearch bridge)";

  async solve(
    job: TwsearchJob,
    onEvent: (e: TwsearchEvent) => void,
  ): Promise<void> {
    let finished = false;
    const emit = (e: TwsearchEvent) => {
      if (e.type === "done" || e.type === "error") {
        finished = true;
      }
      onEvent(e);
    };
    try {
      const response = await fetch(`${BRIDGE_URL}/v1/solve`, {
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
        emit({ type: "error", message: `bridge: ${e}` });
      }
    }
    if (!finished) {
      emit({ type: "error", message: "bridge closed the connection" });
    }
  }

  cancel(id: string, abandon = false): void {
    void fetch(`${BRIDGE_URL}/v1/cancel`, {
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
