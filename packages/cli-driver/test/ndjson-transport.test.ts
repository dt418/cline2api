import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { startNdjsonTransport } from "../src/ndjson-transport.js";
import type { NdjsonTransportOptions } from "../src/types.js";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

function startWith(child: FakeChild, overrides: Partial<NdjsonTransportOptions> = {}) {
  return startNdjsonTransport({
    request: { prompt: "hello", cwd: "/workspace/project", autoApprove: false },
    launch: {
      command: "cline",
      args: ["--json", "hello"],
      options: {
        cwd: "/workspace/project",
        env: {},
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    },
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    timeoutMs: 1000,
    cancellationGraceMs: 10,
    maxLineBytes: 1024,
    maxEvents: 10,
    ...overrides,
  });
}

describe("startNdjsonTransport", () => {
  it("reports a synchronous launch failure as spawn_failed", async () => {
    const child = new FakeChild();
    const run = startWith(child, {
      spawnProcess: () => {
        throw new Error("not found");
      },
    });

    expect(await run.result).toMatchObject({ status: "failed", errorCode: "spawn_failed" });
  });

  it("succeeds after a valid say message and zero exit", async () => {
    const child = new FakeChild();
    const run = startWith(child);
    child.stdout.end('{"type":"say","text":"done","say":"text"}\n');
    child.emit("exit", 0, null);

    expect(await run.events[Symbol.asyncIterator]().next()).toMatchObject({
      value: { kind: "message", text: "done" },
    });
    expect(await run.result).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      errorCode: undefined,
    });
  });

  it("reports a non-zero exit using counters-only diagnostics", async () => {
    const child = new FakeChild();
    const run = startWith(child);
    child.stderr.end("sensitive failure text");
    child.stdout.end();
    child.emit("exit", 2, null);

    const result = await run.result;
    expect(result).toMatchObject({ status: "failed", errorCode: "process_exit", exitCode: 2 });
    expect(result.diagnostics).toEqual(expect.objectContaining({ stderrBytes: 22 }));
    expect(JSON.stringify(result.diagnostics)).not.toContain("sensitive");
  });

  it("cancels idempotently and keeps cancellation ahead of a later exit", async () => {
    const child = new FakeChild();
    const run = startWith(child);

    await Promise.all([run.cancel("user"), run.cancel("again")]);
    child.emit("exit", 2, null);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(await run.result).toMatchObject({ status: "cancelled", errorCode: "cancelled" });
  });

  it("keeps cancellation terminal when the child emits error during its grace period", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const run = startWith(child);

    const cancelling = run.cancel("user");
    child.emit("error", new Error("late process error"));
    await vi.advanceTimersByTimeAsync(10);

    await cancelling;
    expect(await run.result).toMatchObject({ status: "cancelled", errorCode: "cancelled" });
    vi.useRealTimers();
  });

  it("times out and closes the event queue", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const run = startWith(child, { timeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(20);
    expect(await run.result).toMatchObject({ status: "timed_out", errorCode: "timeout" });
    expect(await run.events[Symbol.asyncIterator]().next()).toEqual({
      value: undefined,
      done: true,
    });
    vi.useRealTimers();
  });

  it("keeps timeout terminal when the child emits error during its grace period", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const run = startWith(child, { timeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    child.emit("error", new Error("late process error"));
    await vi.advanceTimersByTimeAsync(10);

    expect(await run.result).toMatchObject({ status: "timed_out", errorCode: "timeout" });
    vi.useRealTimers();
  });

  it("emits an ask then ends permission-unavailable when approvals are disabled", async () => {
    const child = new FakeChild();
    const run = startWith(child);
    child.stdout.end('{"type":"ask","text":"Allow?","ask":"approval"}\n');

    expect(await run.events[Symbol.asyncIterator]().next()).toMatchObject({
      value: { kind: "ask", text: "Allow?" },
    });
    expect(await run.result).toMatchObject({
      status: "failed",
      errorCode: "permission_unavailable",
    });
  });
});
