import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AsyncQueue } from "../src/async-queue.js";
import { BoundedDiagnostics } from "../src/diagnostics.js";
import { consumeNdjsonOutput, normalizeNdjsonMessage } from "../src/ndjson-parser.js";

describe("normalizeNdjsonMessage", () => {
  it("normalizes documented say fields without retaining unknown fields", () => {
    expect(
      normalizeNdjsonMessage({
        type: "say",
        text: "hello",
        say: "text",
        ts: 1,
        partial: true,
        secret: "do not retain",
      }),
    ).toEqual({
      transport: "ndjson",
      kind: "message",
      text: "hello",
      subtype: "text",
      partial: true,
    });
  });

  it("normalizes the documented ask event", () => {
    expect(normalizeNdjsonMessage({ type: "ask", text: "Continue?", ask: "approval" })).toEqual({
      transport: "ndjson",
      kind: "ask",
      text: "Continue?",
      subtype: "approval",
    });
  });

  it("ignores unknown and non-object messages", () => {
    expect(normalizeNdjsonMessage({ type: "unknown", text: "ignore" })).toBeUndefined();
    expect(normalizeNdjsonMessage("not an object")).toBeUndefined();
  });
});

describe("consumeNdjsonOutput", () => {
  it("frames split UTF-8 and CRLF records incrementally", async () => {
    const stream = new PassThrough();
    const queue = new AsyncQueue();
    const diagnostics = new BoundedDiagnostics({ maxEvents: 4 });
    const complete = consumeNdjsonOutput(stream, queue, diagnostics, {
      maxLineBytes: 100,
      maxEvents: 4,
    });

    stream.write(Buffer.from('{"type":"say","text":"'));
    stream.write(Buffer.from([0xe2, 0x82]));
    stream.write(
      Buffer.from([
        0xac, 0x22, 0x2c, 0x22, 0x73, 0x61, 0x79, 0x22, 0x3a, 0x22, 0x74, 0x65, 0x78, 0x74, 0x22,
        0x7d, 0x0d, 0x0a,
      ]),
    );
    stream.end();

    await complete;
    expect(await queue[Symbol.asyncIterator]().next()).toEqual({
      done: false,
      value: { transport: "ndjson", kind: "message", text: "€", subtype: "text" },
    });
    expect(diagnostics.snapshot()).toMatchObject({
      stdoutBytes: 42,
      eventCount: 1,
      malformedMessageCount: 0,
    });
  });

  it("accepts a CRLF record whose payload is exactly maxLineBytes", async () => {
    const stream = new PassThrough();
    const queue = new AsyncQueue();
    const diagnostics = new BoundedDiagnostics({ maxEvents: 1 });
    const payload = '{"type":"say","text":"x"}';
    const complete = consumeNdjsonOutput(stream, queue, diagnostics, {
      maxLineBytes: Buffer.byteLength(payload),
      maxEvents: 1,
    });

    stream.write(`${payload}\r`);
    stream.end("\n");
    await complete;

    expect(await queue[Symbol.asyncIterator]().next()).toEqual({
      done: false,
      value: { transport: "ndjson", kind: "message", text: "x" },
    });
    expect(diagnostics.snapshot()).toMatchObject({
      eventCount: 1,
      malformedMessageCount: 0,
      truncated: false,
    });
  });

  it("counts malformed, non-object, and oversized records without emitting them", async () => {
    const stream = new PassThrough();
    const queue = new AsyncQueue();
    const diagnostics = new BoundedDiagnostics({ maxEvents: 2 });
    const complete = consumeNdjsonOutput(stream, queue, diagnostics, {
      maxLineBytes: 20,
      maxEvents: 2,
    });

    stream.end('{bad}\n"scalar"\n{"type":"say","text":"this line is too long"}\n');
    await complete;

    expect(await queue[Symbol.asyncIterator]().next()).toEqual({ value: undefined, done: true });
    expect(diagnostics.snapshot()).toMatchObject({
      malformedMessageCount: 3,
      eventCount: 0,
      truncated: true,
    });
  });

  it("stops emitting after the configured event limit", async () => {
    const stream = new PassThrough();
    const queue = new AsyncQueue();
    const diagnostics = new BoundedDiagnostics({ maxEvents: 1 });
    const complete = consumeNdjsonOutput(stream, queue, diagnostics, {
      maxLineBytes: 100,
      maxEvents: 1,
    });

    stream.end('{"type":"say","text":"one"}\n{"type":"say","text":"two"}\n');
    await complete;

    expect(await queue[Symbol.asyncIterator]().next()).toMatchObject({
      value: { text: "one" },
      done: false,
    });
    expect(diagnostics.snapshot()).toMatchObject({ eventCount: 1, truncated: true });
  });
});
