import { describe, expect, it } from "vitest";
import { REFERENCE_CATALOG } from "../src/catalog/reference.js";

describe("REFERENCE_CATALOG", () => {
  it("is an ordered frozen array of valid-shaped entries", () => {
    expect(Array.isArray(REFERENCE_CATALOG)).toBe(true);
    expect(Object.isFrozen(REFERENCE_CATALOG)).toBe(true);
    for (const entry of REFERENCE_CATALOG) {
      expect(entry.id).toEqual(expect.any(String));
      expect(entry.id.trim()).toBe(entry.id);
    }
  });
});
