import { describe, expect, it } from "vitest";
import { CatalogConfigError } from "../src/catalog/errors.js";
import { resolveCatalog, resolveExplicitCatalog } from "../src/catalog/resolver.js";

const reference = [{ id: "reference/one" }, { id: "reference/two", created: 10 }] as const;

describe("catalog resolution", () => {
  it("appends new entries and replaces a reference entry in place", () => {
    expect(
      resolveCatalog(reference, {
        mode: "append",
        models: [{ id: "reference/two", ownedBy: "override" }, { id: "custom/three" }],
        disabled: [],
      }).entries,
    ).toEqual([
      { id: "reference/one" },
      { id: "reference/two", ownedBy: "override" },
      { id: "custom/three" },
    ]);
  });

  it("replaces the reference and applies disabled ids last", () => {
    expect(
      resolveCatalog(reference, {
        mode: "replace",
        models: [{ id: "custom/one" }, { id: "custom/two" }],
        disabled: ["custom/one"],
      }).entries,
    ).toEqual([{ id: "custom/two" }]);
  });

  it("does not validate a lower-precedence reference in replace mode", () => {
    expect(
      resolveCatalog([{ id: "duplicate" }, { id: " duplicate " }], {
        mode: "replace",
        models: [{ id: "custom/model" }],
        disabled: [],
      }).entries,
    ).toEqual([{ id: "custom/model" }]);
  });

  it("freezes the snapshot and clones mutable input", () => {
    const input = [{ id: "custom/model" }];
    const snapshot = resolveExplicitCatalog(input);
    input[0] = { id: "changed" };

    expect(snapshot.entries).toEqual([{ id: "custom/model" }]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
  });

  it("rejects duplicate IDs in direct reference and file inputs", () => {
    expect(() =>
      resolveCatalog([{ id: "reference/one" }, { id: " reference/one " }], undefined),
    ).toThrow(CatalogConfigError);
    expect(() =>
      resolveCatalog(reference, {
        mode: "append",
        models: [{ id: "custom/model" }, { id: " custom/model " }],
        disabled: [],
      }),
    ).toThrow(CatalogConfigError);
  });

  it("normalizes direct entry and disabled IDs", () => {
    expect(
      resolveCatalog([{ id: " reference/one ", ownedBy: " reference-owner " }], {
        mode: "append",
        models: [{ id: " custom/model ", ownedBy: " custom-owner " }],
        disabled: [" missing/model "],
      }).entries,
    ).toEqual([
      { id: "reference/one", ownedBy: "reference-owner" },
      { id: "custom/model", ownedBy: "custom-owner" },
    ]);
  });

  it("resolves empty catalogs and ignores unknown disabled IDs", () => {
    expect(
      resolveCatalog([], { mode: "append", models: [], disabled: ["missing/model"] }).entries,
    ).toEqual([]);
  });

  it("uses explicit entries as a complete replacement", () => {
    expect(resolveExplicitCatalog([{ id: "explicit/model" }]).entries).toEqual([
      { id: "explicit/model" },
    ]);
  });
});
