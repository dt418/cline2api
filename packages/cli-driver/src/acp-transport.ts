import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { AsyncQueue } from "./async-queue.js";
import { BoundedDiagnostics } from "./diagnostics.js";
import { AcpUnavailableError, ClineCliError } from "./errors.js";
import { transitionPhase, type RunPhase } from "./lifecycle.js";
import { buildClientCapabilities, createAcpClient } from "./acp-host.js";
import type {
  AcpConnectionOptions,
  AcpSessionMessage,
  AcpSessionPort,
  AcpTransportOptions,
  ClineCliEvent,
  ClineCliResult,
  ClineCliRun,
  PendingPermissionRegistry,
} from "./types.js";

class PendingPermissions implements PendingPermissionRegistry {
  private readonly pending = new Set<() => void>();

  register(cancel: () => void): () => void {
    this.pending.add(cancel);
    return () => this.pending.delete(cancel);
  }

  cancelAll(): void {
    for (const cancel of [...this.pending]) cancel();
  }
}

function classifyStartupError(phase: "spawn" | "initialize", error?: unknown): ClineCliError {
  if (error instanceof ClineCliError) return error;
  if (error instanceof acp.RequestError && error.code === -32000) {
    return new ClineCliError(
      "authentication_required",
      phase,
      "ACP authentication is required",
      error,
    );
  }
  return new AcpUnavailableError(phase, error);
}

function normalizeUpdate(update: acp.SessionUpdate): ClineCliEvent | undefined {
  if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
    return {
      transport: "acp",
      kind: "message",
      text: update.content.text,
      partial: true,
      sessionUpdate: update.sessionUpdate,
    };
  }
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    return { transport: "acp", kind: "tool_call", sessionUpdate: update.sessionUpdate };
  }
  if (
    update.sessionUpdate === "plan" ||
    update.sessionUpdate === "plan_update" ||
    update.sessionUpdate === "plan_removed"
  ) {
    return { transport: "acp", kind: "plan", sessionUpdate: update.sessionUpdate };
  }
  return undefined;
}

export async function createSdkAcpConnection(
  options: AcpConnectionOptions,
): Promise<AcpSessionPort> {
  const pending = new PendingPermissions();
  const stream = acp.ndJsonStream(
    Writable.toWeb(options.child.stdin),
    Readable.toWeb(options.child.stdout) as ReadableStream<Uint8Array>,
  );
  const app = createAcpClient(options.host, () => undefined, pending);
  let session: acp.ActiveSession | undefined;
  let context: acp.ClientContext | undefined;
  let finishConnection: (() => void) | undefined;
  let disposed = false;
  let sessionStarted = false;
  let resolvePort: (port: AcpSessionPort) => void = () => undefined;
  let rejectPort: (error: unknown) => void = () => undefined;
  const port = new Promise<AcpSessionPort>((resolve, reject) => {
    resolvePort = resolve;
    rejectPort = reject;
  });

  const connection = app.connectWith(stream, async (ctx) => {
    context = ctx;
    try {
      await ctx.request(
        acp.methods.agent.initialize,
        {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: buildClientCapabilities(options.host),
          clientInfo: { name: "cline2api", version: "0.1.0" },
        },
        { cancellationSignal: options.signal },
      );
      session = await ctx.buildSession(options.cwd).start({ cancellationSignal: options.signal });
      sessionStarted = true;
      options.markSessionStarted();
      resolvePort({
        sessionId: session.sessionId,
        prompt: async (prompt) => {
          const response = await session!.prompt(prompt);
          return response.stopReason;
        },
        nextUpdate: async () => {
          for (;;) {
            const message = await session!.nextUpdate();
            if (message.kind === "stop") return { kind: "stop", stopReason: message.stopReason };
            const event = normalizeUpdate(message.update);
            if (event !== undefined) return { kind: "update", event };
          }
        },
        cancel: () =>
          context!.notify(acp.methods.agent.session.cancel, { sessionId: session!.sessionId }),
        dispose: () => {
          if (disposed) return;
          disposed = true;
          pending.cancelAll();
          session?.dispose();
          finishConnection?.();
        },
      });
      await new Promise<void>((resolve) => {
        finishConnection = resolve;
      });
    } catch (error) {
      if (!sessionStarted) rejectPort(classifyStartupError("initialize", error));
      else rejectPort(error);
      throw error;
    }
  });
  void connection.catch((error: unknown) => {
    if (!sessionStarted) rejectPort(classifyStartupError("initialize", error));
    else rejectPort(error);
  });
  return port;
}

type TerminalPhase = "succeeded" | "failed" | "cancelled" | "timed_out";

export async function startAcpTransport(options: AcpTransportOptions): Promise<ClineCliRun> {
  let phase: RunPhase = "starting";
  let requestedTerminal: TerminalPhase | undefined;
  let stopReason: string | undefined;
  let sessionStarted = false;
  let child: ReturnType<AcpTransportOptions["spawnProcess"]> | undefined;
  let session: AcpSessionPort | undefined;
  let exitCode: number | null = null;
  let signal: string | null = null;
  let childExited = false;
  let childKilled = false;
  let settled = false;
  let startupFailure: ClineCliError | undefined;
  let disposeCalled = false;
  let cancellationTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let resolveResult: (value: ClineCliResult) => void = () => undefined;
  const diagnostics = new BoundedDiagnostics({ maxEvents: options.maxEvents });
  const queue = new AsyncQueue<ClineCliEvent>();
  const pending = new PendingPermissions();
  const startupController = new AbortController();
  let resolveStartupInterruption: (() => void) | undefined;
  const startupInterruption = new Promise<void>((resolve) => {
    resolveStartupInterruption = resolve;
  });

  const setPhase = (next: RunPhase): void => {
    phase = transitionPhase(phase, next);
    diagnostics.setPhase(phase);
  };
  const result = new Promise<ClineCliResult>((resolve) => {
    resolveResult = resolve;
  });
  const interruptStartup = (): void => {
    resolveStartupInterruption?.();
    resolveStartupInterruption = undefined;
  };
  const killChild = (): void => {
    if (child === undefined || childExited || childKilled) return;
    childKilled = true;
    child.kill();
  };
  const dispose = (): void => {
    if (disposeCalled) return;
    disposeCalled = true;
    pending.cancelAll();
    session?.dispose();
  };
  const finish = (next: TerminalPhase): void => {
    if (settled) return;
    setPhase(next);
    settled = true;
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    if (cancellationTimer !== undefined) clearTimeout(cancellationTimer);
    interruptStartup();
    startupController.abort();
    dispose();
    queue.close();
    const status = phase as TerminalPhase;
    resolveResult({
      transport: "acp",
      status,
      stopReason,
      exitCode,
      signal,
      diagnostics: diagnostics.snapshot(),
      errorCode:
        status === "cancelled"
          ? "cancelled"
          : status === "timed_out"
            ? "timeout"
            : status === "failed" && stopReason === "acp_unavailable"
              ? "acp_unavailable"
              : status === "failed" && stopReason === "spawn_failed"
                ? "spawn_failed"
                : status === "failed" && stopReason === "process_exit"
                  ? "process_exit"
                  : status === "failed"
                    ? "protocol_error"
                    : undefined,
    });
  };
  const failBeforeSession = (phase: "spawn" | "initialize", cause?: unknown): ClineCliError => {
    startupFailure ??= classifyStartupError(phase, cause);
    requestedTerminal = "failed";
    stopReason = startupFailure.code;
    killChild();
    finish("failed");
    return startupFailure;
  };
  const terminate = async (
    next: Exclude<TerminalPhase, "succeeded">,
    reason: string,
  ): Promise<void> => {
    if (settled || requestedTerminal !== undefined) return;
    requestedTerminal = next;
    stopReason = reason;
    setPhase("cancelling");
    cancellationTimer = setTimeout(() => finish(next), options.cancellationGraceMs);
    interruptStartup();
    startupController.abort();
    pending.cancelAll();
    void session?.cancel().catch(() => undefined);
    dispose();
    killChild();
  };
  const finishFromChildExit = (): void => {
    if (requestedTerminal !== undefined) {
      finish(requestedTerminal);
    } else if (!sessionStarted) {
      failBeforeSession("initialize");
    } else if ((exitCode !== null && exitCode !== 0) || signal !== null) {
      requestedTerminal = "failed";
      stopReason = "process_exit";
      finish("failed");
    } else if (session === undefined) {
      requestedTerminal = "failed";
      stopReason = "protocol_error";
      finish("failed");
    } else if (stopReason !== undefined) {
      if (exitCode === 0 && stopReason === "end_turn") finish("succeeded");
      else {
        requestedTerminal = "failed";
        stopReason = "process_exit";
        finish("failed");
      }
    }
  };
  const onExit = (code: number | null, nextSignal: NodeJS.Signals | null): void => {
    exitCode = code;
    signal = nextSignal;
    childExited = true;
    finishFromChildExit();
  };

  try {
    child = options.spawnProcess(
      options.launch.command,
      options.launch.args,
      options.launch.options,
    );
    child.stderr.on("data", (chunk: Buffer | string) =>
      diagnostics.recordStderr(Buffer.byteLength(chunk)),
    );
    child.stdout.on("data", (chunk: Buffer | string) =>
      diagnostics.recordStdout(Buffer.byteLength(chunk)),
    );
    child.once("exit", onExit);
    child.once("error", (error) => {
      if (!settled && requestedTerminal === undefined) {
        if (!sessionStarted) failBeforeSession("spawn", error);
        else {
          requestedTerminal = "failed";
          stopReason = "protocol_error";
          finish("failed");
        }
      }
    });
    setPhase("initializing");
    timeoutTimer = setTimeout(() => {
      void terminate("timed_out", "timeout");
    }, options.timeoutMs);
    const connecting = options
      .createConnection({
        child,
        cwd: options.request.cwd,
        host: options.request.host,
        signal: startupController.signal,
        emit: (event) => {
          if (diagnostics.recordEvent()) queue.push(event);
        },
        markSessionStarted: () => {
          sessionStarted = true;
        },
      })
      .then(
        (port) => ({ kind: "connected" as const, port }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
    const startup = await Promise.race([
      connecting,
      startupInterruption.then(() => ({ kind: "interrupted" as const })),
    ]);
    if (startup.kind === "interrupted") {
      void connecting.then((late) => {
        if (late.kind === "connected") late.port.dispose();
      });
      if (startupFailure !== undefined) throw startupFailure;
      return {
        transport: "acp",
        events: queue,
        result,
        cancel: (reason?: string) => terminate("cancelled", reason ?? "cancelled"),
      };
    }
    if (startup.kind === "error") throw startup.error;
    session = startup.port;
    if (startupFailure !== undefined) {
      session.dispose();
      throw startupFailure;
    }
    if (settled) {
      session.dispose();
      return {
        transport: "acp",
        events: queue,
        result,
        cancel: (reason?: string) => terminate("cancelled", reason ?? "cancelled"),
      };
    }
    setPhase("running");
    void session.prompt(options.request.prompt).catch(() => {
      void terminate("failed", "protocol_error");
    });
    void (async () => {
      while (!settled) {
        const message = await session!.nextUpdate();
        if (message.kind === "stop") {
          stopReason = message.stopReason;
          if (childExited) finishFromChildExit();
          return;
        }
        if (diagnostics.recordEvent()) queue.push(message.event);
      }
    })().catch(() => {
      if (!settled) void terminate("failed", "protocol_error");
    });
  } catch (error) {
    if (startupFailure !== undefined) {
      throw startupFailure;
    } else if (requestedTerminal !== undefined) {
      // Preserve cancellation or timeout when aborting initialization rejects the connection.
    } else if (!sessionStarted) {
      const unavailable = failBeforeSession("initialize", error);
      throw unavailable;
    } else {
      requestedTerminal = "failed";
      stopReason = "protocol_error";
      killChild();
      finish("failed");
    }
  }

  return {
    transport: "acp",
    events: queue,
    result,
    cancel: (reason?: string) => terminate("cancelled", reason ?? "cancelled"),
  };
}
