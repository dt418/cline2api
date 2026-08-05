import { describe, expect, it } from "vitest";
import { BoundedDiagnostics } from "../src/diagnostics.js";

describe("BoundedDiagnostics", () => {
  it("caps event counts and records only safe numeric diagnostics", () => {
    const diagnostics = new BoundedDiagnostics({ maxEvents: 1 });
    diagnostics.setPhase("running");
    diagnostics.recordStdout(10);
    diagnostics.recordStderr(7);
    diagnostics.recordEvent();
    diagnostics.recordEvent();

    expect(diagnostics.snapshot()).toEqual({
      stdoutBytes: 10,
      stderrBytes: 7,
      eventCount: 1,
      malformedMessageCount: 0,
      truncated: true,
      lastSafePhase: "running",
    });
  });

  it("tracks malformed messages without retaining their payload", () => {
    const diagnostics = new BoundedDiagnostics({ maxEvents: 2 });
    diagnostics.recordMalformedMessage();
    diagnostics.markTruncated();

    expect(diagnostics.snapshot()).toEqual({
      stdoutBytes: 0,
      stderrBytes: 0,
      eventCount: 0,
      malformedMessageCount: 1,
      truncated: true,
      lastSafePhase: "created",
    });
  });
});
