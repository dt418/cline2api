import { CatalogConfigError } from "./errors.js";
import { validateCatalogEntry } from "./loader.js";
import { REFERENCE_CATALOG } from "./reference.js";
import type {
  CatalogFileConfig,
  CatalogMode,
  ModelCatalogEntry,
  ModelCatalogSnapshot,
} from "./types.js";

const REFERENCE_SOURCE = "reference";
const OVERRIDE_SOURCE = "override";

export function resolveCatalog(
  reference: readonly ModelCatalogEntry[],
  override?: CatalogFileConfig,
): ModelCatalogSnapshot {
  if (override === undefined) {
    return createSnapshot(normalizeEntries(reference, REFERENCE_SOURCE, "entries"));
  }

  const mode = validateOverrideMode(override);
  const normalizedOverride = normalizeOverride(override);
  const merged =
    mode === "replace"
      ? normalizedOverride.models
      : appendEntries(
          normalizeEntries(reference, REFERENCE_SOURCE, "entries"),
          normalizedOverride.models,
        );
  const disabledIds = new Set(normalizedOverride.disabled);

  return createSnapshot(merged.filter((entry) => !disabledIds.has(entry.id)));
}

export function resolveExplicitCatalog(
  entries: readonly ModelCatalogEntry[],
): ModelCatalogSnapshot {
  return resolveCatalog(REFERENCE_CATALOG, {
    mode: "replace",
    models: entries,
    disabled: [],
  });
}

function validateOverrideMode(override: CatalogFileConfig): CatalogMode {
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    throw schemaError("config");
  }

  return validateMode(override.mode);
}

function normalizeOverride(
  override: CatalogFileConfig,
): Pick<CatalogFileConfig, "models" | "disabled"> {
  const models = normalizeEntries(override.models, OVERRIDE_SOURCE, "models");
  const disabled = normalizeDisabled(override.disabled);

  return { models, disabled };
}

function validateMode(mode: unknown): CatalogMode {
  if (mode !== "append" && mode !== "replace") {
    throw schemaError("mode");
  }

  return mode;
}

function normalizeEntries(
  entries: readonly ModelCatalogEntry[],
  source: string,
  fieldPrefix: string,
): ModelCatalogEntry[] {
  if (!Array.isArray(entries)) {
    throw new CatalogConfigError("catalog_schema_error", source, fieldPrefix);
  }

  const normalized: ModelCatalogEntry[] = [];
  const ids = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    const field = `${fieldPrefix}[${index}]`;
    const entry = validateCatalogEntry(entries[index], source, field);

    if (ids.has(entry.id)) {
      throw new CatalogConfigError("catalog_schema_error", source, `${field}.id`);
    }

    ids.add(entry.id);
    normalized.push(entry);
  }

  return normalized;
}

function normalizeDisabled(disabled: readonly string[]): string[] {
  if (!Array.isArray(disabled)) {
    throw schemaError("disabled");
  }

  const normalized: string[] = [];
  const ids = new Set<string>();

  for (let index = 0; index < disabled.length; index += 1) {
    const field = `disabled[${index}]`;
    const id = validateCatalogEntry({ id: disabled[index] }, OVERRIDE_SOURCE, field).id;

    if (ids.has(id)) {
      throw new CatalogConfigError("catalog_schema_error", OVERRIDE_SOURCE, field);
    }

    ids.add(id);
    normalized.push(id);
  }

  return normalized;
}

function appendEntries(
  reference: readonly ModelCatalogEntry[],
  override: readonly ModelCatalogEntry[],
): ModelCatalogEntry[] {
  const entries = [...reference];
  const indexById = new Map(reference.map((entry, index) => [entry.id, index]));

  for (const entry of override) {
    const existingIndex = indexById.get(entry.id);

    if (existingIndex === undefined) {
      entries.push(entry);
      continue;
    }

    entries[existingIndex] = entry;
  }

  return entries;
}

function createSnapshot(entries: readonly ModelCatalogEntry[]): ModelCatalogSnapshot {
  const frozenEntries = Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
  return Object.freeze({ entries: frozenEntries });
}

function schemaError(field: string): CatalogConfigError {
  return new CatalogConfigError("catalog_schema_error", OVERRIDE_SOURCE, field);
}
