import { describe, expect, it } from "vitest";
import { validateFeatureList } from "./validate-harness.mjs";

const feature = (id: string, status: string, evidence = "") => ({
  id,
  priority: 1,
  area: "harness",
  title: "Example",
  user_visible_behavior: "The harness is verifiable",
  status,
  dependencies: [],
  verification: ["pnpm verify"],
  evidence,
  notes: "",
});

describe("validateFeatureList", () => {
  it("accepts one in-progress feature and passing evidence", () => {
    expect(
      validateFeatureList({
        version: 1,
        features: [
          feature("HARN-001", "in_progress"),
          feature("CORE-001", "passing", "tests: pass"),
        ],
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it("rejects multiple in-progress features", () => {
    const result = validateFeatureList({
      version: 1,
      features: [feature("HARN-001", "in_progress"), feature("CORE-001", "in_progress")],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("only one feature may be in_progress");
  });

  it("rejects passing features without evidence", () => {
    const result = validateFeatureList({ version: 1, features: [feature("CORE-001", "passing")] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("CORE-001: passing features require evidence");
  });
});
