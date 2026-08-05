import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { createClineCliDriver } from "../src/driver.js";
import { AcpUnavailableError, ClineCliError } from "../src/errors.js";
import type {
  AcpTransportStarter,
  ClineCliDriverOptions,
  ClineCliRun,
  ClineCliRequest,
  NdjsonTransportStarter,
} from "../src/types.js";

const request: ClineCliRequest = {
  prompt: "inspect the repository",
  cwd: "/workspace/project",
};

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

function run(transport: "acp" | "ndjson"): ClineCliRun {
  return {
    transport,
    events: {
      async *[Symbol.asyncIterator]() {
        return;
      },
    },
    result: Promise.resolve({
      transport,
      status: "succeeded",
      exitCode: 0,
      signal: null,
      diagnostics: {
        stdoutBytes: 0,
        stderrBytes: 0,
        eventCount: 0,
        malformedMessageCount: 0,
        truncated: false,
        lastSafePhase: "succeeded",
      },
    }),
    cancel: async () => undefined,
  };
}

function driverOptions(
  acp: AcpTransportStarter = vi.fn(async () => run("acp")),
  ndjson: NdjsonTransportStarter = vi.fn(() => run("ndjson")),
): ClineCliDriverOptions {
  return {
    executable: "custom-cline",
    startAcpTransport: acp,
    startNdjsonTransport: ndjson,
    defaultTimeoutMs: 200,
    defaultCancellationGraceMs: 20,
    defaultMaxLineBytes: 2048,
    defaultMaxEvents: 25,
  };
}

describe("createClineCliDriver", () => {
  it("uses ACP only for an automatic request that starts a session", async () => {
    const acp = vi.fn(async () => run("acp"));
    const ndjson = vi.fn(() => run("ndjson"));

    const started = await createClineCliDriver(driverOptions(acp, ndjson)).start(request);

    expect(started.transport).toBe("acp");
    expect(acp).toHaveBeenCalledTimes(1);
    expect(ndjson).not.toHaveBeenCalled();
  });

  it("falls back to NDJSON once when ACP is unavailable before session start", async () => {
    const acp = vi.fn(async () => {
      throw new AcpUnavailableError("initialize");
    });
    const ndjson = vi.fn(() => run("ndjson"));

    const started = await createClineCliDriver(driverOptions(acp, ndjson)).start(request);

    expect(started.transport).toBe("ndjson");
    expect(acp).toHaveBeenCalledTimes(1);
    expect(ndjson).toHaveBeenCalledTimes(1);
  });

  it("falls back when the real ACP starter's connection factory fails before session start", async () => {
    const child = new FakeChild();
    const ndjson = vi.fn(() => run("ndjson"));
    const driver = createClineCliDriver({
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
      createAcpConnection: async () => {
        throw new Error("initialize failed");
      },
      startNdjsonTransport: ndjson,
    });

    const started = await driver.start(request);

    expect(started.transport).toBe("ndjson");
    expect(ndjson).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when the real ACP starter fails after session start", async () => {
    const child = new FakeChild();
    const ndjson = vi.fn(() => run("ndjson"));
    const driver = createClineCliDriver({
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
      createAcpConnection: async (options) => {
        options.markSessionStarted();
        throw new Error("post-session failure");
      },
      startNdjsonTransport: ndjson,
    });

    const started = await driver.start(request);

    expect(started.transport).toBe("acp");
    await expect(started.result).resolves.toMatchObject({ errorCode: "protocol_error" });
    expect(ndjson).not.toHaveBeenCalled();
  });

  it("preserves SDK authentication-required before session start without NDJSON fallback", async () => {
    const child = new FakeChild();
    const ndjson = vi.fn(() => run("ndjson"));
    const driver = createClineCliDriver({
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
      createAcpConnection: async () => {
        throw acp.RequestError.authRequired();
      },
      startNdjsonTransport: ndjson,
    });

    await expect(driver.start(request)).rejects.toMatchObject({
      code: "authentication_required",
    });
    expect(ndjson).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it.each([
    "spawn_failed",
    "authentication_required",
    "permission_unavailable",
    "protocol_error",
    "timeout",
    "cancelled",
    "process_exit",
  ] as const)("preserves real-starter terminal error %s before session start", async (code) => {
    const child = new FakeChild();
    const ndjson = vi.fn(() => run("ndjson"));
    const driver = createClineCliDriver({
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
      createAcpConnection: async () => {
        throw new ClineCliError(code, "initialize", "terminal ACP failure");
      },
      startNdjsonTransport: ndjson,
    });

    await expect(driver.start(request)).rejects.toMatchObject({ code });
    expect(ndjson).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("times out a never-settling ACP connection without falling back or leaking timers", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const ndjson = vi.fn(() => run("ndjson"));
      let startupSignal: AbortSignal | undefined;
      const driver = createClineCliDriver({
        spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
        createAcpConnection: (options) => {
          startupSignal = options.signal;
          return new Promise(() => undefined);
        },
        startNdjsonTransport: ndjson,
        defaultTimeoutMs: 10,
        defaultCancellationGraceMs: 5,
      });

      const starting = driver.start(request);
      let startSettled = false;
      void starting.then(() => {
        startSettled = true;
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(startSettled).toBe(true);
      const started = await starting;

      expect(started.transport).toBe("acp");
      expect(ndjson).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(startupSignal?.aborted).toBe(true);

      await vi.advanceTimersByTimeAsync(5);
      await expect(started.result).resolves.toMatchObject({
        status: "timed_out",
        stopReason: "timeout",
        errorCode: "timeout",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps startup timeout ahead of the connection's abort rejection", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const ndjson = vi.fn(() => run("ndjson"));
      const driver = createClineCliDriver({
        spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
        createAcpConnection: (options) =>
          new Promise((_, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(new Error("connection initialization aborted")),
              { once: true },
            );
          }),
        startNdjsonTransport: ndjson,
        defaultTimeoutMs: 10,
        defaultCancellationGraceMs: 5,
      });

      const starting = driver.start(request);
      await vi.advanceTimersByTimeAsync(10);
      const started = await starting;

      expect(started.transport).toBe("acp");
      expect(ndjson).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5);
      await expect(started.result).resolves.toMatchObject({
        status: "timed_out",
        errorCode: "timeout",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "authentication_required",
    "permission_unavailable",
    "protocol_error",
    "timeout",
    "cancelled",
  ] as const)("does not fall back when ACP fails with %s", async (code) => {
    const acp = vi.fn(async () => {
      throw new ClineCliError(code, "initialize", "terminal ACP failure");
    });
    const ndjson = vi.fn(() => run("ndjson"));

    await expect(
      createClineCliDriver(driverOptions(acp, ndjson)).start(request),
    ).rejects.toMatchObject({
      code,
    });
    expect(ndjson).not.toHaveBeenCalled();
  });

  it("uses only ACP for an explicit ACP request", async () => {
    const acp = vi.fn(async () => run("acp"));
    const ndjson = vi.fn(() => run("ndjson"));

    await createClineCliDriver(driverOptions(acp, ndjson)).start({ ...request, transport: "acp" });

    expect(acp).toHaveBeenCalledTimes(1);
    expect(ndjson).not.toHaveBeenCalled();
  });

  it("uses only NDJSON for an explicit NDJSON request", async () => {
    const acp = vi.fn(async () => run("acp"));
    const ndjson = vi.fn(() => run("ndjson"));

    await createClineCliDriver(driverOptions(acp, ndjson)).start({
      ...request,
      transport: "ndjson",
    });

    expect(acp).not.toHaveBeenCalled();
    expect(ndjson).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid requests before starting either transport", async () => {
    const acp = vi.fn(async () => run("acp"));
    const ndjson = vi.fn(() => run("ndjson"));

    await expect(
      createClineCliDriver(driverOptions(acp, ndjson)).start({ ...request, prompt: "  " }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(acp).not.toHaveBeenCalled();
    expect(ndjson).not.toHaveBeenCalled();
  });

  it("merges defaults with request overrides without mutating either input", async () => {
    const acp = vi.fn(async () => run("acp"));
    const ndjson = vi.fn(() => run("ndjson"));
    const options = driverOptions(acp, ndjson);
    const supplied = { ...request, timeoutMs: 500, maxEvents: 10 };

    await createClineCliDriver(options).start(supplied);

    expect(acp).toHaveBeenCalledWith(
      expect.objectContaining({
        request: supplied,
        launch: expect.objectContaining({ command: "custom-cline", args: ["--acp"] }),
        timeoutMs: 500,
        cancellationGraceMs: 20,
        maxLineBytes: 2048,
        maxEvents: 10,
      }),
    );
    expect(supplied).toEqual({ ...request, timeoutMs: 500, maxEvents: 10 });
    expect(options.defaultTimeoutMs).toBe(200);
  });
});
