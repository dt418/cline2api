import { open } from "node:fs/promises";
import { CatalogConfigError } from "./errors.js";
import type { CatalogFileConfig, CatalogMode, ModelCatalogEntry } from "./types.js";

export const DEFAULT_MAX_CATALOG_BYTES = 1_048_576;

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/u;
const MAX_ID_BYTES = 256;
const MAX_OWNED_BY_BYTES = 128;
const CONFIG_KEYS = new Set(["mode", "models", "disabled"]);
const ENTRY_KEYS = new Set(["id", "ownedBy", "created"]);

export function validateCatalogEntry(
  input: unknown,
  source: string,
  field: string,
): ModelCatalogEntry {
  if (!isPlainJsonObject(input)) {
    throw schemaError(source, field);
  }

  rejectUnknownKeys(input, ENTRY_KEYS, source, field);

  const id = normalizeRequiredString(input, "id", source, field, MAX_ID_BYTES);
  const ownedBy = hasOwn(input, "ownedBy")
    ? normalizeRequiredString(input, "ownedBy", source, field, MAX_OWNED_BY_BYTES)
    : undefined;
  const created = hasOwn(input, "created")
    ? validateCreated(input.created, source, field)
    : undefined;

  return {
    id,
    ...(ownedBy === undefined ? {} : { ownedBy }),
    ...(created === undefined ? {} : { created }),
  };
}

export function validateCatalogConfig(input: unknown, source: string): CatalogFileConfig {
  if (!isPlainJsonObject(input)) {
    throw schemaError(source, "config");
  }

  rejectUnknownKeys(input, CONFIG_KEYS, source, "config");

  const mode = hasOwn(input, "mode") ? validateMode(input.mode, source) : "append";
  const models = hasOwn(input, "models") ? validateModels(input.models, source) : [];
  const disabled = hasOwn(input, "disabled") ? validateDisabled(input.disabled, source) : [];

  return { mode, models, disabled };
}

export async function loadCatalogFile(
  filePath: string,
  maxCatalogBytes?: number,
): Promise<CatalogFileConfig> {
  const effectiveLimit = validateCatalogByteLimit(filePath, maxCatalogBytes);
  const bytes = await readCatalogBytes(filePath, effectiveLimit);

  if (bytes.byteLength > effectiveLimit) {
    throw new CatalogConfigError("catalog_size_error", filePath, "file");
  }

  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CatalogConfigError("catalog_json_error", filePath, "file");
  }

  try {
    return validateCatalogConfig(input, filePath);
  } catch (error) {
    if (error instanceof CatalogConfigError) {
      throw error;
    }

    throw new CatalogConfigError("catalog_schema_error", filePath, "config");
  }
}

async function readCatalogBytes(filePath: string, effectiveLimit: number): Promise<Buffer> {
  let file;
  try {
    file = await open(filePath, "r");
  } catch {
    throw new CatalogConfigError("catalog_file_error", filePath);
  }

  let bytes: Buffer | undefined;
  let failure: unknown;

  try {
    const buffer = Buffer.allocUnsafe(effectiveLimit + 1);
    let bytesRead = 0;

    while (bytesRead < buffer.byteLength) {
      const result = await file.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
      if (result.bytesRead === 0) {
        break;
      }

      bytesRead += result.bytesRead;
    }

    bytes = buffer.subarray(0, bytesRead);
  } catch (error) {
    failure = error;
  }

  try {
    await file.close();
  } catch (error) {
    failure ??= error;
  }

  if (failure !== undefined || bytes === undefined) {
    throw new CatalogConfigError("catalog_file_error", filePath);
  }

  return bytes;
}

function validateCatalogByteLimit(filePath: string, maxCatalogBytes: number | undefined): number {
  if (maxCatalogBytes === undefined) {
    return DEFAULT_MAX_CATALOG_BYTES;
  }

  if (
    !Number.isInteger(maxCatalogBytes) ||
    maxCatalogBytes < 1 ||
    maxCatalogBytes > DEFAULT_MAX_CATALOG_BYTES
  ) {
    throw new CatalogConfigError("catalog_size_error", filePath, "maxCatalogBytes");
  }

  return maxCatalogBytes;
}

function validateMode(value: unknown, source: string): CatalogMode {
  if (value !== "append" && value !== "replace") {
    throw schemaError(source, "mode");
  }

  return value;
}

function validateModels(value: unknown, source: string): ModelCatalogEntry[] {
  if (!Array.isArray(value)) {
    throw schemaError(source, "models");
  }

  const models: ModelCatalogEntry[] = [];
  for (let index = 0; index < value.length; index += 1) {
    models.push(validateCatalogEntry(value[index], source, `models[${index}]`));
  }

  rejectDuplicateIds(models, source, (index) => `models[${index}].id`);
  return models;
}

function validateDisabled(value: unknown, source: string): string[] {
  if (!Array.isArray(value)) {
    throw schemaError(source, "disabled");
  }

  const disabled: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    disabled.push(normalizeString(value[index], source, `disabled[${index}]`, MAX_ID_BYTES));
  }

  rejectDuplicateIds(disabled, source, (index) => `disabled[${index}]`);
  return disabled;
}

function normalizeRequiredString(
  input: Record<string, unknown>,
  key: string,
  source: string,
  field: string,
  maximumBytes: number,
): string {
  if (!hasOwn(input, key)) {
    throw schemaError(source, `${field}.${key}`);
  }

  return normalizeString(input[key], source, `${field}.${key}`, maximumBytes);
}

function normalizeString(
  value: unknown,
  source: string,
  field: string,
  maximumBytes: number,
): string {
  if (typeof value !== "string") {
    throw schemaError(source, field);
  }

  if (CONTROL_CHARACTER.test(value)) {
    throw schemaError(source, field);
  }

  const normalized = value.trim();
  if (normalized.length === 0 || Buffer.byteLength(normalized, "utf8") > maximumBytes) {
    throw schemaError(source, field);
  }

  return normalized;
}

function validateCreated(value: unknown, source: string, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw schemaError(source, `${field}.created`);
  }

  return value;
}

function rejectDuplicateIds(
  values: readonly (ModelCatalogEntry | string)[],
  source: string,
  fieldAt: (index: number) => string,
): void {
  const seen = new Set<string>();

  for (const [index, value] of values.entries()) {
    const id = typeof value === "string" ? value : value.id;
    if (seen.has(id)) {
      throw schemaError(source, fieldAt(index));
    }

    seen.add(id);
  }
}

function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  source: string,
  field: string,
): void {
  if (Reflect.ownKeys(input).some((key) => typeof key !== "string" || !allowedKeys.has(key))) {
    throw schemaError(source, field);
  }
}

function isPlainJsonObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return Reflect.ownKeys(input).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(input, key);
}

function schemaError(source: string, field: string): CatalogConfigError {
  return new CatalogConfigError("catalog_schema_error", source, field);
}
