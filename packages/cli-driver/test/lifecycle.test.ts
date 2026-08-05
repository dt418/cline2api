import { describe, expect, it } from "vitest";
import { transitionPhase } from "../src/lifecycle.js";

describe("transitionPhase", () => {
  it("advances a running operation to a terminal success phase", () => {
    expect(transitionPhase("running", "succeeded")).toBe("succeeded");
  });

  it("preserves an existing terminal phase", () => {
    expect(transitionPhase("succeeded", "failed")).toBe("succeeded");
  });

  it("lets timeout win over a later child exit", () => {
    const timedOut = transitionPhase("running", "timed_out");

    expect(timedOut).toBe("timed_out");
    expect(transitionPhase(timedOut, "succeeded")).toBe("timed_out");
  });

  it("lets cancellation win over a later child exit", () => {
    const cancelled = transitionPhase("running", "cancelled");

    expect(transitionPhase(cancelled, "failed")).toBe("cancelled");
  });
});
