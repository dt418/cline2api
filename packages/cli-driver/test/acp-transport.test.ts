import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createSdkAcpConnection, startAcpTransport } from "../src/acp-transport.js";
import { AcpUnavailableError } from "../src/errors.js";
import type { AcpConnectionFactory, AcpSessionMessage, AcpTransportOptions } from "../src/types.js";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function startWith(
  child: FakeChild,
  factory: AcpConnectionFactory,
  overrides: Partial<AcpTransportOptions> = {},
) {
  return startAcpTransport({
    request: { prompt: "hello", cwd: "/workspace/project" },
    launch: {
      command: "cline",
      args: ["--acp"],
      options: {
        cwd: "/workspace/project",
        env: {},
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    },
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    createConnection: factory,
    timeoutMs: 1000,
    cancellationGraceMs: 10,
    maxLineBytes: 1024,
    maxEvents: 10,
    ...overrides,
  });
}

describe("startAcpTransport", () => {
  it("rejects an SDK connection when the peer closes before its connect callback", async () => {
    const child = new FakeChild();
    child.stdout.end();

    await expect(
      createSdkAcpConnection({
        child: child as unknown as ChildProcessWithoutNullStreams,
        cwd: "/workspace/project",
        host: undefined,
        signal: new AbortController().signal,
        emit: () => undefined,
        markSessionStarted: () => undefined,
      }),
    ).rejects.toBeInstanceOf(AcpUnavailableError);
  });

  it("preserves an SDK authentication-required response during initialize", async () => {
    const child = new FakeChild();
    let requestBytes = "";
    child.stdin.on("data", (chunk: Buffer | string) => {
      requestBytes += chunk.toString();
      const newline = requestBytes.indexOf("\n");
      if (newline === -1) return;
      const request = JSON.parse(requestBytes.slice(0, newline)) as { id: number };
      child.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: "Authentication required" },
        })}\n`,
      );
    });

    await expect(
      createSdkAcpConnection({
        child: child as unknown as ChildProcessWithoutNullStreams,
        cwd: "/workspace/project",
        host: undefined,
        signal: new AbortController().signal,
        emit: () => undefined,
        markSessionStarted: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
  });

  it("emits normalized updates and succeeds after end_turn with a zero child exit", async () => {
    const child = new FakeChild();
    const updates = [
      {
        kind: "update",
        event: {
          transport: "acp" as const,
          kind: "message" as const,
          text: "hello",
          partial: true,
        },
      },
      {
        kind: "update",
        event: {
          transport: "acp" as const,
          kind: "tool_call" as const,
          sessionUpdate: "tool_call",
        },
      },
      {
        kind: "update",
        event: { transport: "acp" as const, kind: "plan" as const, sessionUpdate: "plan" },
      },
      { kind: "stop", stopReason: "end_turn" },
    ] as AcpSessionMessage[];
    let marked = 0;
    const factory: AcpConnectionFactory = async (options) => {
      expect(options.cwd).toBe("/workspace/project");
      expect(options.host).toBeUndefined();
      options.markSessionStarted();
      marked += 1;
      return {
        sessionId: "session-1",
        prompt: async () => "",
        nextUpdate: async () => updates.shift()!,
        cancel: async () => undefined,
        dispose: () => undefined,
      };
    };

    const run = await startWith(child, factory);
    await expect(run.events[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { kind: "message", text: "hello" },
    });
    await expect(run.events[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { kind: "tool_call" },
    });
    await expect(run.events[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { kind: "plan" },
    });
    child.emit("exit", 0, null);
    expect(marked).toBe(1);
    await expect(run.result).resolves.toMatchObject({
      transport: "acp",
      status: "succeeded",
      stopReason: "end_turn",
      exitCode: 0,
    });
  });

  it("rejects a connection failure before session start as ACP unavailable", async () => {
    const child = new FakeChild();
    await expect(
      startWith(child, async () => {
        throw new Error("initialize failed");
      }),
    ).rejects.toBeInstanceOf(AcpUnavailableError);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("classifies an unavailable error after local session start as protocol_error", async () => {
    const child = new FakeChild();
    const run = await startWith(child, async (options) => {
      options.markSessionStarted();
      throw new AcpUnavailableError("initialize");
    });

    await expect(run.result).resolves.toMatchObject({
      status: "failed",
      errorCode: "protocol_error",
    });
  });

  it("waits for an asynchronously consumed end_turn after a zero child exit", async () => {
    const child = new FakeChild();
    const update = deferred<AcpSessionMessage>();
    const run = await startWith(child, async (options) => {
      options.markSessionStarted();
      return {
        sessionId: "session-1",
        prompt: async () => "",
        nextUpdate: () => update.promise,
        cancel: async () => undefined,
        dispose: () => undefined,
      };
    });

    child.emit("exit", 0, null);
    update.resolve({ kind: "stop", stopReason: "end_turn" });

    await expect(run.result).resolves.toMatchObject({
      status: "succeeded",
      stopReason: "end_turn",
      exitCode: 0,
    });
  });

  it("fails immediately when a started ACP child exits non-zero before stop", async () => {
    const child = new FakeChild();
    const run = await startWith(child, async (options) => {
      options.markSessionStarted();
      return {
        sessionId: "session-1",
        prompt: async () => "",
        nextUpdate: () => new Promise(() => undefined),
        cancel: async () => undefined,
        dispose: () => undefined,
      };
    });

    child.emit("exit", 2, null);

    await expect(run.result).resolves.toMatchObject({
      status: "failed",
      stopReason: "process_exit",
      errorCode: "process_exit",
      exitCode: 2,
    });
  });

  it("fails immediately when a started ACP child is signalled before stop", async () => {
    const child = new FakeChild();
    const run = await startWith(child, async (options) => {
      options.markSessionStarted();
      return {
        sessionId: "session-1",
        prompt: async () => "",
        nextUpdate: () => new Promise(() => undefined),
        cancel: async () => undefined,
        dispose: () => undefined,
      };
    });

    child.emit("exit", null, "SIGTERM");

    await expect(run.result).resolves.toMatchObject({
      status: "failed",
      stopReason: "process_exit",
      errorCode: "process_exit",
      exitCode: null,
      signal: "SIGTERM",
    });
  });

  it("cancels pending ACP work once and keeps cancellation ahead of a later non-zero exit", async () => {
    const child = new FakeChild();
    const update = deferred<AcpSessionMessage>();
    const cancel = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const run = await startWith(child, async (options) => {
      options.markSessionStarted();
      return {
        sessionId: "session-1",
        prompt: async () => "",
        nextUpdate: () => update.promise,
        cancel,
        dispose,
      };
    });

    await run.cancel("user");
    child.emit("exit", 2, null);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(run.result).resolves.toMatchObject({
      status: "cancelled",
      errorCode: "cancelled",
    });
  });

  it("uses the cancellation path for timeout and exposes counters-only diagnostics", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const cancel = vi.fn(async () => undefined);
    const run = await startWith(
      child,
      async (options) => {
        options.markSessionStarted();
        return {
          sessionId: "session-1",
          prompt: async () => "",
          nextUpdate: () => new Promise(() => undefined),
          cancel,
          dispose: () => undefined,
        };
      },
      { timeoutMs: 10 },
    );
    child.stderr.write("sensitive provider output");

    await vi.advanceTimersByTimeAsync(20);
    expect(cancel).toHaveBeenCalledTimes(1);
    const result = await run.result;
    expect(result).toMatchObject({ status: "timed_out", errorCode: "timeout" });
    expect(JSON.stringify(result.diagnostics)).not.toContain("sensitive");
    vi.useRealTimers();
  });

  it("settles cancellation after grace even when the ACP cancel request never resolves", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const run = await startWith(child, async (options) => {
      options.markSessionStarted();
      return {
        sessionId: "session-1",
        prompt: async () => "",
        nextUpdate: () => new Promise(() => undefined),
        cancel,
        dispose: () => undefined,
      };
    });

    const cancelling = run.cancel("user");
    await vi.advanceTimersByTimeAsync(10);
    await cancelling;
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(run.result).resolves.toMatchObject({ status: "cancelled" });
    vi.useRealTimers();
  });

  it("rejects and disposes a late connection after child exit before session start", async () => {
    const child = new FakeChild();
    const connection = deferred<ReturnType<AcpConnectionFactory>>();
    const prompt = vi.fn(async () => "");
    const dispose = vi.fn();
    const starting = startWith(child, () => connection.promise);

    child.emit("exit", 2, null);
    connection.resolve({
      sessionId: "session-1",
      prompt,
      nextUpdate: () => new Promise(() => undefined),
      cancel: async () => undefined,
      dispose,
    });
    await expect(starting).rejects.toBeInstanceOf(AcpUnavailableError);

    expect(prompt).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
