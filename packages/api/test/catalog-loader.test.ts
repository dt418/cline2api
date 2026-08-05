import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogConfigError } from "../src/catalog/errors.js";
import {
  DEFAULT_MAX_CATALOG_BYTES,
  loadCatalogFile,
  validateCatalogConfig,
  validateCatalogEntry,
} from "../src/catalog/loader.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open) };
});

let catalogDirectory: string;
let catalogFile: string;

beforeEach(async () => {
  catalogDirectory = await mkdtemp(join(tmpdir(), "cline2api-catalog-"));
  catalogFile = join(catalogDirectory, "catalog.json");
});

afterEach(async () => {
  await rm(catalogDirectory, { force: true, recursive: true });
});

describe("catalog loading and validation", () => {
  it("defaults mode, models, and disabled", () => {
    expect(validateCatalogConfig({}, "config")).toEqual({
      mode: "append",
      models: [],
      disabled: [],
    });
  });

  it("accepts and trims a model entry without exposing source text", () => {
    expect(
      validateCatalogEntry({ id: " custom/model ", ownedBy: " vendor " }, "config", "models[0]"),
    ).toEqual({
      id: "custom/model",
      ownedBy: "vendor",
    });
  });

  it("rejects unknown fields, control characters, unsafe created values, and duplicate disabled ids", () => {
    expect(() => validateCatalogConfig({ extra: true }, "config")).toThrow(CatalogConfigError);
    expect(() => validateCatalogEntry({ id: "bad\nmodel" }, "config", "models[0]")).toThrow(
      CatalogConfigError,
    );
    expect(() => validateCatalogEntry({ id: "\nmodel" }, "config", "models[0]")).toThrow(
      CatalogConfigError,
    );
    expect(() => validateCatalogEntry({ id: "model\t" }, "config", "models[0]")).toThrow(
      CatalogConfigError,
    );
    expect(() =>
      validateCatalogEntry(
        { id: "model", created: Number.MAX_SAFE_INTEGER + 1 },
        "config",
        "models[0]",
      ),
    ).toThrow(CatalogConfigError);
    expect(() => validateCatalogConfig({ disabled: ["model", "model"] }, "config")).toThrow(
      CatalogConfigError,
    );
  });

  it("rejects duplicate normalized model IDs and unsafe object shapes", () => {
    const duplicateError = expectCatalogError(() =>
      validateCatalogConfig(
        { models: [{ id: " custom/model " }, { id: "custom/model" }] },
        "config",
      ),
    );
    expect(duplicateError).toMatchObject({
      code: "catalog_schema_error",
      source: "config",
      field: "models[1].id",
    });

    expect(() => validateCatalogConfig([], "config")).toThrow(CatalogConfigError);
    expect(() => validateCatalogEntry(null, "config", "models[0]")).toThrow(CatalogConfigError);
    expect(() => validateCatalogConfig({ models: new Array(1) }, "config")).toThrow(
      CatalogConfigError,
    );
    expect(() => validateCatalogConfig({ disabled: new Array(1) }, "config")).toThrow(
      CatalogConfigError,
    );
  });

  it("keeps schema errors to source, field, and a fixed reason", () => {
    const secret = "Bearer secret-value";
    const error = expectCatalogError(() =>
      validateCatalogEntry({ id: `bad\n${secret}` }, "config", "models[0]"),
    );

    expect(error).toMatchObject({
      code: "catalog_schema_error",
      source: "config",
      field: "models[0].id",
    });
    expect(String(error)).not.toContain(secret);
  });

  it("uses UTF-8 byte limits for IDs and ownership metadata", () => {
    const maximumId = "é".repeat(128);
    const maximumOwnedBy = "é".repeat(64);
    expect(Buffer.byteLength(maximumId)).toBe(256);
    expect(Buffer.byteLength(maximumOwnedBy)).toBe(128);
    expect(
      validateCatalogEntry({ id: maximumId, ownedBy: maximumOwnedBy }, "config", "models[0]"),
    ).toEqual({ id: maximumId, ownedBy: maximumOwnedBy });

    const overlongIdError = expectCatalogError(() =>
      validateCatalogEntry({ id: "é".repeat(129) }, "config", "models[0]"),
    );
    expect(overlongIdError).toMatchObject({ field: "models[0].id" });

    const overlongOwnedByError = expectCatalogError(() =>
      validateCatalogEntry({ id: "model", ownedBy: "é".repeat(65) }, "config", "models[0]"),
    );
    expect(overlongOwnedByError).toMatchObject({ field: "models[0].ownedBy" });
  });

  it("rejects missing, malformed, oversized, and invalid files without echoing contents", async () => {
    const missingFile = join(catalogDirectory, "missing.json");
    await expect(loadCatalogFile(missingFile)).rejects.toMatchObject({
      code: "catalog_file_error",
      source: missingFile,
    });

    const malformedSource = '{"models": [';
    await writeFile(catalogFile, malformedSource);
    const malformedFailure = await expectRejectedCatalogError(loadCatalogFile(catalogFile));
    expect(malformedFailure).toMatchObject({
      code: "catalog_json_error",
      source: catalogFile,
    });
    expect(String(malformedFailure)).not.toContain(malformedSource);

    const secret = "Bearer secret-value";
    const invalidSource = JSON.stringify({ extra: secret });
    await writeFile(catalogFile, invalidSource);
    const invalidFailure = await expectRejectedCatalogError(loadCatalogFile(catalogFile));
    expect(invalidFailure).toMatchObject({
      code: "catalog_schema_error",
      source: catalogFile,
      field: "config",
    });
    expect(String(invalidFailure)).not.toContain(secret);
    expect(String(invalidFailure)).not.toContain(invalidSource);
  });

  it("rejects malformed UTF-8 without echoing file contents", async () => {
    const secret = "Bearer secret-value";
    const invalidUtf8Source = Buffer.concat([
      Buffer.from('{"models":[{"id":"'),
      Buffer.from([0xff]),
      Buffer.from(`${secret}"}]}`),
    ]);
    await writeFile(catalogFile, invalidUtf8Source);

    const failure = await expectRejectedCatalogError(loadCatalogFile(catalogFile));
    expect(failure).toMatchObject({
      code: "catalog_json_error",
      source: catalogFile,
      field: "file",
    });
    expect(String(failure)).not.toContain(secret);
    expect(String(failure)).not.toContain(invalidUtf8Source.toString("utf8"));
  });

  it("accepts a file exactly at the default byte limit", async () => {
    const source = `{}${" ".repeat(DEFAULT_MAX_CATALOG_BYTES - Buffer.byteLength("{}"))}`;
    expect(Buffer.byteLength(source)).toBe(DEFAULT_MAX_CATALOG_BYTES);
    await writeFile(catalogFile, source);

    await expect(loadCatalogFile(catalogFile)).resolves.toEqual({
      mode: "append",
      models: [],
      disabled: [],
    });
  });

  it("rejects a file one UTF-8 byte over its effective limit", async () => {
    const source = JSON.stringify({ models: [{ id: "módel" }] });
    const effectiveLimit = Buffer.byteLength(source);
    await writeFile(catalogFile, `${source} `);
    expect(Buffer.byteLength(`${source} `)).toBe(effectiveLimit + 1);

    const failure = await expectRejectedCatalogError(loadCatalogFile(catalogFile, effectiveLimit));
    expect(failure).toMatchObject({
      code: "catalog_size_error",
      source: catalogFile,
      field: "file",
    });
  });

  it("bounds partial reads to one byte beyond the effective limit", async () => {
    const effectiveLimit = 7;
    const source = Buffer.from("0123456789");
    let cursor = 0;
    let largestBuffer = 0;
    let closed = false;

    vi.mocked(open).mockResolvedValueOnce({
      read: async (buffer: Buffer, offset: number, length: number) => {
        largestBuffer = Math.max(largestBuffer, buffer.byteLength);
        const bytesRead = Math.min(2, length, source.byteLength - cursor);
        source.copy(buffer, offset, cursor, cursor + bytesRead);
        cursor += bytesRead;
        return { bytesRead, buffer };
      },
      close: async () => {
        closed = true;
      },
    } as unknown as Awaited<ReturnType<typeof open>>);

    const failure = await expectRejectedCatalogError(loadCatalogFile(catalogFile, effectiveLimit));
    expect(failure).toMatchObject({
      code: "catalog_size_error",
      source: catalogFile,
      field: "file",
    });
    expect(largestBuffer).toBe(effectiveLimit + 1);
    expect(cursor).toBe(effectiveLimit + 1);
    expect(closed).toBe(true);
  });

  it("honors the minimum allowed maximum catalog size", async () => {
    await writeFile(catalogFile, "{}");

    const failure = await expectRejectedCatalogError(loadCatalogFile(catalogFile, 1));
    expect(failure).toMatchObject({
      code: "catalog_size_error",
      source: catalogFile,
      field: "file",
    });
  });

  it.each([0, DEFAULT_MAX_CATALOG_BYTES + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid maxCatalogBytes value %s without reading file contents",
    async (maxCatalogBytes) => {
      const secret = "Bearer secret-value";
      await writeFile(catalogFile, JSON.stringify({ extra: secret }));

      const failure = await expectRejectedCatalogError(
        loadCatalogFile(catalogFile, maxCatalogBytes),
      );
      expect(failure).toMatchObject({
        code: "catalog_size_error",
        source: catalogFile,
        field: "maxCatalogBytes",
      });
      expect(String(failure)).not.toContain(secret);
    },
  );
});

function expectCatalogError(action: () => unknown): CatalogConfigError {
  let failure: unknown;

  try {
    action();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(CatalogConfigError);
  return failure as CatalogConfigError;
}

async function expectRejectedCatalogError(promise: Promise<unknown>): Promise<CatalogConfigError> {
  const failure = await promise.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CatalogConfigError);
  return failure as CatalogConfigError;
}
