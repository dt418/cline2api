import { AsyncQueue } from "./async-queue.js";
import { BoundedDiagnostics } from "./diagnostics.js";
import { transitionPhase, type RunPhase } from "./lifecycle.js";
import { consumeNdjsonOutput } from "./ndjson-parser.js";
import type {
  ClineCliEvent,
  ClineCliResult,
  ClineCliRun,
  NdjsonTransportOptions,
} from "./types.js";

type TerminalPhase = "succeeded" | "failed" | "cancelled" | "timed_out";

function errorCodeFor(phase: TerminalPhase, exitCode: number | null): ClineCliResult["errorCode"] {
  if (phase === "cancelled") return "cancelled";
  if (phase === "timed_out") return "timeout";
  if (phase === "failed") return exitCode === null ? "protocol_error" : "process_exit";
  return undefined;
}

class TransportQueue extends AsyncQueue<ClineCliEvent> {
  constructor(private readonly onEvent: (event: ClineCliEvent) => void) {
    super();
  }

  override push(event: ClineCliEvent): void {
    super.push(event);
    this.onEvent(event);
  }
}

export function startNdjsonTransport(options: NdjsonTransportOptions): ClineCliRun {
  let phase: RunPhase = "starting";
  let requestedTerminal: TerminalPhase | undefined;
  let stopReason: string | undefined;
  let child: ReturnType<NdjsonTransportOptions["spawnProcess"]> | undefined;
  let exitCode: number | null = null;
  let signal: string | null = null;
  let settled = false;
  let killed = false;
  let cancellationTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let outputDone: Promise<void> = Promise.resolve();
  let resolveResult: (result: ClineCliResult) => void = () => undefined;
  const diagnostics = new BoundedDiagnostics({ maxEvents: options.maxEvents });

  const setPhase = (next: RunPhase): void => {
    phase = transitionPhase(phase, next);
    diagnostics.setPhase(phase);
  };

  const queue = new TransportQueue((event) => {
    if (event.kind === "ask" && options.request.autoApprove !== true) {
      void terminate("failed", "permission_unavailable");
    }
  });

  const result = new Promise<ClineCliResult>((resolve) => {
    resolveResult = resolve;
  });

  const finish = (next: TerminalPhase): void => {
    if (settled) return;
    setPhase(next);
    settled = true;
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    if (cancellationTimer !== undefined) clearTimeout(cancellationTimer);
    queue.close();
    const terminalPhase = phase as TerminalPhase;
    resolveResult({
      transport: "ndjson",
      status: terminalPhase,
      stopReason,
      exitCode,
      signal,
      diagnostics: diagnostics.snapshot(),
      errorCode:
        terminalPhase === "failed" && stopReason === "permission_unavailable"
          ? "permission_unavailable"
          : terminalPhase === "failed" && stopReason === "spawn_failed"
            ? "spawn_failed"
            : terminalPhase === "failed" && stopReason === "protocol_error"
              ? "protocol_error"
              : errorCodeFor(terminalPhase, exitCode),
    });
  };

  const terminate = async (
    next: Exclude<TerminalPhase, "succeeded">,
    reason: string,
  ): Promise<void> => {
    if (settled || requestedTerminal !== undefined) return;
    requestedTerminal = next;
    stopReason = reason;
    setPhase("cancelling");
    if (child !== undefined && !killed) {
      killed = true;
      child.kill();
    }
    cancellationTimer = setTimeout(() => finish(next), options.cancellationGraceMs);
  };

  const onExit = (code: number | null, nextSignal: NodeJS.Signals | null): void => {
    exitCode = code;
    signal = nextSignal;
    void outputDone.then(() => {
      if (requestedTerminal !== undefined) {
        finish(requestedTerminal);
      } else if (code === 0) {
        finish("succeeded");
      } else {
        requestedTerminal = "failed";
        stopReason = "process_exit";
        finish("failed");
      }
    });
  };

  try {
    child = options.spawnProcess(
      options.launch.command,
      options.launch.args,
      options.launch.options,
    );
    setPhase("running");
    child.stderr.on("data", (chunk: Buffer | string) =>
      diagnostics.recordStderr(Buffer.byteLength(chunk)),
    );
    child.once("exit", onExit);
    child.once("error", () => {
      if (!settled && requestedTerminal === undefined) {
        requestedTerminal = "failed";
        stopReason = "spawn_failed";
        finish("failed");
      }
    });
    outputDone = consumeNdjsonOutput(child.stdout, queue, diagnostics, options).catch(() => {
      if (!settled) {
        void terminate("failed", "protocol_error");
      }
    });
    timeoutTimer = setTimeout(() => {
      void terminate("timed_out", "timeout");
    }, options.timeoutMs);
  } catch {
    requestedTerminal = "failed";
    stopReason = "spawn_failed";
    finish("failed");
  }

  return {
    transport: "ndjson",
    events: queue,
    result,
    cancel: (reason?: string) => terminate("cancelled", reason ?? "cancelled"),
  };
}
