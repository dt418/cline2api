export type CatalogMode = "append" | "replace";

export interface ModelCatalogEntry {
  readonly id: string;
  readonly ownedBy?: string;
  readonly created?: number;
}

export interface CatalogFileConfig {
  readonly mode: CatalogMode;
  readonly models: readonly ModelCatalogEntry[];
  readonly disabled: readonly string[];
}

export interface ModelCatalogSnapshot {
  readonly entries: readonly ModelCatalogEntry[];
}
