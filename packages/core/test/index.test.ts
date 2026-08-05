import { describe, expect, it } from "vitest";
import { createRuntimeIdentity } from "../src/index.js";

describe("createRuntimeIdentity", () => {
  it("returns the stable project name and supplied version", () => {
    expect(createRuntimeIdentity("0.1.0")).toEqual({
      name: "cline2api",
      version: "0.1.0",
    });
  });

  it("rejects a blank version", () => {
    expect(() => createRuntimeIdentity("   ")).toThrow("version must not be empty");
  });
});
