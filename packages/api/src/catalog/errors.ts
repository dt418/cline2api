export type CatalogErrorCode =
  "catalog_file_error" | "catalog_size_error" | "catalog_json_error" | "catalog_schema_error";

const REASON_BY_CODE: Readonly<Record<CatalogErrorCode, string>> = {
  catalog_file_error: "catalog file could not be read",
  catalog_size_error: "catalog size is invalid",
  catalog_json_error: "catalog JSON is invalid",
  catalog_schema_error: "catalog configuration is invalid",
};

export class CatalogConfigError extends Error {
  readonly code: CatalogErrorCode;
  readonly source: string;
  readonly field?: string;

  constructor(code: CatalogErrorCode, source: string, field?: string) {
    super(createSafeMessage(code, source, field));
    this.name = "CatalogConfigError";
    this.code = code;
    this.source = source;
    this.field = field;
  }
}

function createSafeMessage(code: CatalogErrorCode, source: string, field?: string): string {
  const location = field === undefined ? source : `${source} (${field})`;
  return `Catalog configuration error at ${location}: ${REASON_BY_CODE[code]}`;
}
