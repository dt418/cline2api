import { describe, expect, it } from "vitest";
import { buildLaunchSpec, validateClineRequest } from "../src/launch.js";

const request = {
  prompt: "inspect the repository",
  cwd: "/workspace/project",
  transport: "acp" as const,
};

describe("Cline CLI launch contract", () => {
  it("rejects an empty prompt and a relative cwd", () => {
    expect(() => validateClineRequest({ ...request, prompt: "  " })).toThrow("prompt");
    expect(() => validateClineRequest({ ...request, cwd: "project" })).toThrow("absolute");
  });

  it("builds an ACP launch without a prompt argument or shell", () => {
    const launch = buildLaunchSpec("acp", request, "cline", {});
    expect(launch.command).toBe("cline");
    expect(launch.args).toEqual(["--acp"]);
    expect(launch.options.cwd).toBe("/workspace/project");
    expect(launch.options.shell).toBe(false);
  });

  it("builds a documented NDJSON launch with explicit approval", () => {
    const launch = buildLaunchSpec(
      "ndjson",
      { ...request, model: "provider/model", autoApprove: true },
      "cline",
      {},
    );
    expect(launch.args).toEqual([
      "--json",
      "--auto-approve",
      "true",
      "--model",
      "provider/model",
      "inspect the repository",
    ]);
  });
});
