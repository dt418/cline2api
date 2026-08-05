# API-001 Discovery and Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `node:http` package that exposes deterministic OpenAI-compatible model discovery and local health endpoints from a startup-resolved reference catalog with an optional JSON overlay.

**Architecture:** `packages/api` owns a small catalog domain and HTTP boundary. The catalog loader validates an explicit file before server creation, the resolver merges it with a checked-in reference array into an immutable snapshot, and the HTTP layer projects only safe OpenAI-compatible fields. The package has no dependency on `@cline2api/cli-driver`, performs no provider/Cline network calls, and leaves live discovery as a future source seam.

**Tech Stack:** Node.js 24+, TypeScript strict/NodeNext, built-in `node:http` and `node:fs/promises`, Vitest 4, pnpm 11, existing `@cline2api/core` identity type.

## Global Constraints

- Use only `node:http` and `node:fs/promises` for the API package; do not add a web framework.
- Keep `packages/api` independent from `@cline2api/cli-driver`; API-001 does not start Cline or ACP/NDJSON.
- Expose only `GET /health` and `GET /v1/models` (with one optional trailing slash); do not add chat, SSE, auth, CORS, mutation, reload, or live-provider routes.
- Resolve and validate the catalog before returning the server; invalid configuration must fail before bind.
- Apply precedence exactly: `options.catalog > options.catalogFile > environment.CLINE2API_MODEL_CATALOG_FILE > built-in reference catalog`.
- In file `append` mode, a file entry with a reference ID replaces the reference entry in its original position; duplicate IDs within one input array are invalid. In `replace`, only file entries remain; `disabled` is applied after merge.
- Validate IDs as trimmed, case-sensitive, non-empty strings with no control characters and at most 256 UTF-8 bytes; validate `ownedBy` at most 128 UTF-8 bytes and `created` as a finite non-negative safe integer.
- Cap catalog JSON at 1 MiB. `maxCatalogBytes` may be a finite integer from 1 through 1 MiB and may only lower the effective limit.
- Return `application/json; charset=utf-8` and `Cache-Control: no-store` for every JSON response; never expose credentials, headers, provider URLs, raw payloads, CLI diagnostics, paths, or stack traces.
- Preserve model IDs exactly as configured; do not add implicit `cline/` or provider namespaces.
- Use TDD for every production function: write a focused failing test, run it to prove the expected failure, implement the smallest passing change, rerun, then refactor while green.
- Keep changes cross-platform and POSIX-independent. Do not inspect or emulate undocumented Cline/ClinePass protocols.
- Every task ends with a focused test run and a conventional commit. Do not combine API-002, SAFE-001, or unrelated refactors.

---

## File Map

Create:

- `packages/api/package.json` — private workspace package manifest and `@cline2api/core` dependency.
- `packages/api/tsconfig.json` — composite TypeScript project configuration.
- `packages/api/src/catalog/types.ts` — catalog/configuration domain types.
- `packages/api/src/catalog/reference.ts` — frozen checked-in reference catalog.
- `packages/api/src/catalog/errors.ts` — safe typed catalog configuration errors.
- `packages/api/src/catalog/loader.ts` — bounded JSON file loading and schema validation.
- `packages/api/src/catalog/resolver.ts` — precedence-independent merge and immutable snapshot resolution.
- `packages/api/src/http/types.ts` — public response and route context types.
- `packages/api/src/http/responses.ts` — safe response projection and JSON writer.
- `packages/api/src/http/routes.ts` — method/path dispatch.
- `packages/api/src/http/server.ts` — asynchronous server factory and catalog initialization.
- `packages/api/src/index.ts` — public exports.
- `packages/api/test/catalog-reference.test.ts` — reference catalog invariants.
- `packages/api/test/catalog-loader.test.ts` — file/schema validation behavior.
- `packages/api/test/catalog-resolver.test.ts` — merge, disable, precedence, and freezing behavior.
- `packages/api/test/responses.test.ts` — health/model/error projections and headers.
- `packages/api/test/server.test.ts` — real `node:http` contract and lifecycle tests.

Modify:

- `tsconfig.json` — add the `packages/api` project reference after `packages/core`.
- `pnpm-lock.yaml` — update the workspace dependency graph with pnpm.
- `.harness/feature_list.json` — record exact API-001 verification commands and redacted evidence only after all checks pass.
- `.harness/progress.md` — record the verified API-001 state and next feature.
- `.harness/session-handoff.md` — record implementation, risks, and commands for the next session.
- `.harness/quality-document.md` — update API compatibility and test-stability grades from command evidence.
- `.harness/clean-state-checklist.md` — keep the checklist accurate after the feature state transition.

## Task 1: Scaffold the API package and catalog types

**Files:**

- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/src/catalog/types.ts`
- Create: `packages/api/src/catalog/reference.ts`
- Create: `packages/api/src/index.ts`
- Create: `packages/api/test/catalog-reference.test.ts`
- Modify: `tsconfig.json`
- Modify: `pnpm-lock.yaml` (through pnpm only)

**Interfaces:**

- Produces `ModelCatalogEntry`, `CatalogMode`, `CatalogFileConfig`, `ModelCatalogSnapshot`, and frozen `REFERENCE_CATALOG` for Tasks 2–5.
- Produces package export scaffolding; `createApiServer` is not exported until Task 5.

- [ ] **Step 1: Write the failing reference invariant test**

Create `packages/api/test/catalog-reference.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test to verify the expected failure**

Run:

```bash
pnpm exec vitest run packages/api/test/catalog-reference.test.ts
```

Expected: FAIL because `packages/api/src/catalog/reference.ts` and the package project do not exist.

- [ ] **Step 3: Add the package and type-only domain boundary**

Create the package manifest with the existing workspace conventions:

```json
{
  "name": "@cline2api/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "dependencies": { "@cline2api/core": "workspace:*" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Use a composite project extending `../../tsconfig.base.json`, with `rootDir: "src"`, `outDir: "dist"`, and a project reference to `../core`. Define the domain types exactly:

```ts
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
```

In `reference.ts`, export `REFERENCE_CATALOG` as a frozen ordered array. The current checkout has no existing maintained model inventory, so do not invent model IDs; keep it empty unless an owner-approved reference list is supplied before execution. Configuration remains the supported way to publish deployed model IDs.

Export the domain types from `src/index.ts` only; leave server exports for Task 5. Add `{ "path": "packages/api" }` to root `tsconfig.json` and run pnpm to update the workspace lockfile without manually editing lockfile internals.

- [ ] **Step 4: Run the focused test and package typecheck**

Run:

```bash
pnpm install --lockfile-only
pnpm exec vitest run packages/api/test/catalog-reference.test.ts
pnpm --filter @cline2api/api typecheck
pnpm typecheck
```

Expected: the reference test, API package typecheck, and root project-reference build pass.

- [ ] **Step 5: Commit the scaffold**

```bash
git add packages/api tsconfig.json pnpm-lock.yaml
git commit -m "feat: scaffold API package and catalog types"
```

## Task 2: Implement bounded catalog file loading and validation

**Files:**

- Create: `packages/api/src/catalog/errors.ts`
- Create: `packages/api/src/catalog/loader.ts`
- Create: `packages/api/test/catalog-loader.test.ts`
- Modify: `packages/api/src/catalog/types.ts`

**Interfaces:**

- Consumes: `ModelCatalogEntry`, `CatalogFileConfig`, and `CatalogMode` from Task 1.
- Produces:

```ts
export const DEFAULT_MAX_CATALOG_BYTES = 1_048_576;

export type CatalogErrorCode =
  "catalog_file_error" | "catalog_size_error" | "catalog_json_error" | "catalog_schema_error";

export class CatalogConfigError extends Error {
  readonly code: CatalogErrorCode;
  readonly source: string;
  readonly field?: string;
}

export function validateCatalogEntry(
  input: unknown,
  source: string,
  field: string,
): ModelCatalogEntry;
export function validateCatalogConfig(input: unknown, source: string): CatalogFileConfig;
export async function loadCatalogFile(
  filePath: string,
  maxCatalogBytes?: number,
): Promise<CatalogFileConfig>;
```

- [ ] **Step 1: Write failing loader and validation tests**

Create temporary JSON files with `mkdtemp`/`writeFile` in the test setup and remove only that test directory in teardown. Cover these concrete cases:

```ts
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

it("rejects missing, malformed, oversized, and invalid files without echoing contents", async () => {
  await expect(loadCatalogFile("/missing/catalog.json")).rejects.toMatchObject({
    code: "catalog_file_error",
  });
  const secret = "Bearer secret-value";
  await writeFile(file, JSON.stringify({ extra: secret }));
  const failure = await loadCatalogFile(file).catch((error) => error);
  expect(failure).toBeInstanceOf(CatalogConfigError);
  expect(String(failure)).not.toContain(secret);
});
```

Also test a file exactly at the effective byte limit, one byte over, `maxCatalogBytes: 1`, and `maxCatalogBytes` values `0`, `1_048_577`, and non-integers. Assert safe error fields include the source/field but never file contents or raw JSON.

- [ ] **Step 2: Run the focused tests to verify the expected failures**

Run:

```bash
pnpm exec vitest run packages/api/test/catalog-loader.test.ts
```

Expected: FAIL because the typed error, validator, and loader are not implemented.

- [ ] **Step 3: Implement safe validation and bounded file reads**

Implement `CatalogConfigError` with a safe message composed only from `source`, `field`, and a fixed reason. Validate plain JSON objects, reject unknown keys, normalize only leading/trailing whitespace, preserve case, reject control characters, and measure UTF-8 byte length with `Buffer.byteLength`.

Implement `loadCatalogFile` with `readFile(filePath)` as a `Buffer`, enforce the effective limit before `JSON.parse`, decode UTF-8, parse, and call `validateCatalogConfig`. Map filesystem, size, JSON, and schema failures to `CatalogConfigError`; do not include `error.message`, file bytes, or parsed values in the outward message. Use `Number.isSafeInteger` for `created` and `Number.isInteger`/range checks for the optional byte limit.

Keep validation pure so `validateCatalogEntry` and `validateCatalogConfig` can be reused for explicit `options.catalog` in Task 3.

- [ ] **Step 4: Run loader tests, typecheck, and formatting**

```bash
pnpm exec vitest run packages/api/test/catalog-loader.test.ts
pnpm --filter @cline2api/api typecheck
pnpm format:check
```

Expected: all loader tests pass and no formatting/type diagnostics are reported.

- [ ] **Step 5: Commit the loader**

```bash
git add packages/api/src/catalog packages/api/test/catalog-loader.test.ts
git commit -m "feat: add bounded model catalog validation"
```

## Task 3: Implement catalog merge and immutable snapshots

**Files:**

- Create: `packages/api/src/catalog/resolver.ts`
- Create: `packages/api/test/catalog-resolver.test.ts`
- Modify: `packages/api/src/catalog/types.ts`

**Interfaces:**

- Consumes: `REFERENCE_CATALOG`, `CatalogFileConfig`, `validateCatalogEntry`, and `CatalogConfigError` from Tasks 1–2.
- Produces:

```ts
export function resolveCatalog(
  reference: readonly ModelCatalogEntry[],
  override?: CatalogFileConfig,
): ModelCatalogSnapshot;

export function resolveExplicitCatalog(entries: readonly ModelCatalogEntry[]): ModelCatalogSnapshot;
```

- [ ] **Step 1: Write failing resolver tests**

Use this fixture and assert exact order/results:

```ts
const reference = [{ id: "reference/one" }, { id: "reference/two", created: 10 }] as const;

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

it("freezes the snapshot and clones mutable input", () => {
  const input = [{ id: "custom/model" }];
  const snapshot = resolveExplicitCatalog(input);
  input[0] = { id: "changed" };
  expect(snapshot.entries).toEqual([{ id: "custom/model" }]);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.entries)).toBe(true);
});
```

Test duplicate reference IDs, duplicate file IDs supplied directly to the resolver, whitespace normalization, empty catalogs, and disabled IDs that do not exist. Explicit entries use `resolveExplicitCatalog` and therefore replace the built-in reference without reading a file.

- [ ] **Step 2: Run the focused resolver tests to confirm red**

```bash
pnpm exec vitest run packages/api/test/catalog-resolver.test.ts
```

Expected: FAIL because resolver functions are absent.

- [ ] **Step 3: Implement deterministic merge and freezing**

Validate and normalize the reference and explicit arrays first. For append mode, build an ordered ID-to-index map from the reference, replace existing entries at their saved index, then append new file IDs in file order. For replace mode, start from file entries only. Validate `disabled`, remove matching IDs after merge, clone every entry, `Object.freeze` each entry and the final entries array, and return `{entries}` frozen as well.

Use a `Set` to detect duplicate IDs within each input before merging. Do not deduplicate silently. Keep disabled unknown IDs harmless after validating their shape.

- [ ] **Step 4: Run resolver tests and package checks**

```bash
pnpm exec vitest run packages/api/test/catalog-resolver.test.ts
pnpm --filter @cline2api/api typecheck
pnpm format:check
```

Expected: all resolver tests pass and the package remains type-safe/formatted.

- [ ] **Step 5: Commit the resolver**

```bash
git add packages/api/src/catalog/resolver.ts packages/api/src/catalog/types.ts packages/api/test/catalog-resolver.test.ts
git commit -m "feat: resolve immutable model catalog snapshots"
```

## Task 4: Add safe HTTP response projections and error helpers

**Files:**

- Create: `packages/api/src/http/types.ts`
- Create: `packages/api/src/http/responses.ts`
- Create: `packages/api/test/responses.test.ts`

**Interfaces:**

- Consumes: `ModelCatalogSnapshot` and `RuntimeIdentity` from Tasks 1–3.
- Produces:

```ts
export interface HealthResponse {
  readonly status: "ok";
  readonly service: "cline2api";
  readonly version: string;
  readonly ready: true;
}

export interface OpenAiModel {
  readonly id: string;
  readonly object: "model";
  readonly created: number;
  readonly owned_by: string;
}

export interface OpenAiModelsResponse {
  readonly object: "list";
  readonly data: readonly OpenAiModel[];
}

export interface ApiErrorBody {
  readonly error: {
    readonly message: "route not found" | "method not allowed";
    readonly type: "invalid_request_error";
    readonly code: "not_found" | "method_not_allowed";
  };
}

export function createHealthResponse(identity: RuntimeIdentity): HealthResponse;
export function createModelsResponse(snapshot: ModelCatalogSnapshot): OpenAiModelsResponse;
export function createApiErrorBody(code: "not_found" | "method_not_allowed"): ApiErrorBody;
export function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void;
```

- [ ] **Step 1: Write failing projection and header tests**

Assert exact health/model bodies, defaults, order, and fixed errors:

```ts
it("projects only OpenAI-compatible model fields", () => {
  expect(
    createModelsResponse({ entries: [{ id: "provider/model", created: 7, ownedBy: "vendor" }] }),
  ).toEqual({
    object: "list",
    data: [{ id: "provider/model", object: "model", created: 7, owned_by: "vendor" }],
  });
});

it("uses safe defaults and fixed error messages", () => {
  expect(createModelsResponse({ entries: [{ id: "model" }] })).toEqual({
    object: "list",
    data: [{ id: "model", object: "model", created: 0, owned_by: "cline2api" }],
  });
  expect(createApiErrorBody("not_found")).toEqual({
    error: { message: "route not found", type: "invalid_request_error", code: "not_found" },
  });
});
```

Use a minimal fake `ServerResponse` to capture `writeHead`/`end` and assert status, `Content-Type`, `Cache-Control`, serialized body, and no extra sensitive fields. Test `method_not_allowed` separately.

- [ ] **Step 2: Run the focused response tests to confirm red**

```bash
pnpm exec vitest run packages/api/test/responses.test.ts
```

Expected: FAIL because response types/functions do not exist.

- [ ] **Step 3: Implement projections and bounded JSON writer**

Map `ModelCatalogEntry` fields to snake_case public fields and preserve snapshot order. Build health from `identity.name`/`identity.version`, but emit the literal service name `cline2api` only after confirming the core identity name. Implement `writeJson` with `JSON.stringify`, fixed content type/cache headers, a caller-supplied status, and optional safe headers such as `Allow`. Do not serialize errors or request objects.

- [ ] **Step 4: Run response tests and checks**

```bash
pnpm exec vitest run packages/api/test/responses.test.ts
pnpm --filter @cline2api/api typecheck
pnpm format:check
```

Expected: all projection/header tests pass.

- [ ] **Step 5: Commit the response boundary**

```bash
git add packages/api/src/http packages/api/test/responses.test.ts
git commit -m "feat: add API response projections"
```

## Task 5: Implement route dispatch and the asynchronous server factory

**Files:**

- Create: `packages/api/src/http/routes.ts`
- Create: `packages/api/src/http/server.ts`
- Modify: `packages/api/src/index.ts`
- Create: `packages/api/test/server.test.ts`

**Interfaces:**

- Consumes: `RuntimeIdentity`, catalog loaders/resolvers, and response helpers from Tasks 1–4.
- Produces:

```ts
export interface ApiServerOptions {
  readonly identity: RuntimeIdentity;
  readonly catalog?: readonly ModelCatalogEntry[];
  readonly catalogFile?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly maxCatalogBytes?: number;
}

export interface RouteContext {
  readonly identity: RuntimeIdentity;
  readonly snapshot: ModelCatalogSnapshot;
}

async function resolveConfiguredCatalog(options: ApiServerOptions): Promise<ModelCatalogSnapshot>;

export function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RouteContext,
): void;

export async function createApiServer(options: ApiServerOptions): Promise<http.Server>;
```

- [ ] **Step 1: Write failing real HTTP contract tests**

Build a helper that awaits `createApiServer`, listens on `127.0.0.1` with port `0`, calls the returned address with `fetch`, and closes the server in `finally`. Use explicit catalogs so tests are deterministic. Cover:

```ts
it("serves health and model discovery without upstream calls", async () => {
  const server = await createApiServer({
    identity: createRuntimeIdentity("0.1.0"),
    catalog: [{ id: "provider/model" }],
  });
  const address = await listenEphemeral(server);
  try {
    const health = await fetch(`${address}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      status: "ok",
      service: "cline2api",
      version: "0.1.0",
      ready: true,
    });

    const models = await fetch(`${address}/v1/models/`);
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual({
      object: "list",
      data: [{ id: "provider/model", object: "model", created: 0, owned_by: "cline2api" }],
    });
  } finally {
    await closeServer(server);
  }
});

it("returns stable 404/405 errors and Allow header", async () => {
  const server = await createApiServer({
    identity: createRuntimeIdentity("0.1.0"),
    catalog: [],
  });
  const address = await listenEphemeral(server);
  try {
    const notFound = await fetch(`${address}/missing`);
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({
      error: { message: "route not found", type: "invalid_request_error", code: "not_found" },
    });

    const method = await fetch(`${address}/health`, { method: "POST" });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");
    expect(await method.json()).toEqual({
      error: {
        message: "method not allowed",
        type: "invalid_request_error",
        code: "method_not_allowed",
      },
    });
  } finally {
    await closeServer(server);
  }
});
```

Also test `options.catalogFile` over environment, environment over reference, append/replace/disabled through a real file, missing/invalid file rejection before `listen`, empty catalog, exact `/health/`, rejection of `/health//`, and that a closed server leaves no pending request. Assert every JSON response has the required content type/cache headers.

- [ ] **Step 2: Run server tests to confirm the expected failure**

```bash
pnpm exec vitest run packages/api/test/server.test.ts
```

Expected: FAIL because route and server modules are absent.

- [ ] **Step 3: Implement route dispatch**

Normalize only these exact path pairs: `/health`/`/health/` and `/v1/models`/`/v1/models/`. For a known path, reject any method other than `GET` with `405` and `Allow: GET`; for every other path return `404`. Do not parse request bodies or consult query parameters. Delegate all body/header writing to `responses.ts`.

- [ ] **Step 4: Implement startup catalog resolution and server factory**

Implement `createApiServer` as:

```ts
export async function createApiServer(options: ApiServerOptions): Promise<http.Server> {
  const snapshot =
    options.catalog !== undefined
      ? resolveExplicitCatalog(options.catalog)
      : await resolveConfiguredCatalog(options);
  return createServer((request, response) =>
    handleApiRequest(request, response, { identity: options.identity, snapshot }),
  );
}
```

`resolveConfiguredCatalog` selects `options.catalogFile`, then `options.environment?.CLINE2API_MODEL_CATALOG_FILE`, then the built-in reference. A selected file is loaded and resolved; no selected file means `resolveCatalog(REFERENCE_CATALOG)`. Do not fall back after a selected file fails. Pass `process.env` only when `environment` is omitted. The returned `http.Server` is not listening until the caller invokes `listen`.

- [ ] **Step 5: Run server tests, package tests, and typecheck**

```bash
pnpm exec vitest run packages/api/test/server.test.ts
pnpm exec vitest run packages/api/test
pnpm --filter @cline2api/api typecheck
pnpm typecheck
```

Expected: all API unit/contract tests pass and root project references build cleanly.

- [ ] **Step 6: Commit the HTTP surface**

```bash
git add packages/api/src packages/api/test/server.test.ts packages/api/package.json tsconfig.json pnpm-lock.yaml
git commit -m "feat: add OpenAI discovery and health endpoints"
```

## Task 6: Run feature gates and finalize Harness evidence

**Files:**

- Modify: `.harness/feature_list.json`
- Modify: `.harness/progress.md`
- Modify: `.harness/session-handoff.md`
- Modify: `.harness/quality-document.md`
- Modify: `.harness/clean-state-checklist.md` only if checklist text no longer matches the verified state

**Interfaces:**

- Consumes: the completed `packages/api` implementation and all focused tests from Tasks 1–5.
- Produces: redacted evidence and a clean handoff with API-001 marked `passing` only if every gate exits zero.

- [ ] **Step 1: Run the complete API-001 verification set**

Run each command separately and preserve only redacted summaries:

```bash
pnpm exec vitest run packages/api/test
pnpm typecheck
pnpm format:check
CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init
git diff --check
```

Expected: focused API tests pass, typecheck/format/harness pass, and diff check reports no whitespace errors. If any command fails, leave API-001 `in_progress`, record the safe reproduction and next action, and fix before continuing.

- [ ] **Step 2: Record exact feature evidence**

Update API-001 in `.harness/feature_list.json` with these verification commands and an evidence string containing date, branch, test count, and exit status. Do not include request bodies containing prompts, provider payloads, tokens, headers, or raw error text. Set `status` to `passing` only after all five commands pass; leave API-002 and later features `not_started`.

- [ ] **Step 3: Update progress, handoff, quality, and checklist**

In `.harness/progress.md`, record the API package, routes, catalog precedence, focused/full commands, known cross-platform CI gap, and next safe action (`API-002`). In `.harness/session-handoff.md`, give a new session the exact package/test commands and state that no live provider discovery or Cline execution was added. In `.harness/quality-document.md`, replace API compatibility `Not assessed` with a grade justified by the passing HTTP contract evidence and update test-stability evidence with the new total test count; leave stream correctness and later domains unchanged. Keep the clean-state checklist truthful.

- [ ] **Step 4: Run final repository gates**

```bash
pnpm verify
CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init
git diff --check
git status --short --branch
```

Expected: `pnpm verify` and harness initialization exit 0, diff check is clean, and the only changed files are the intentional API/Harness files.

- [ ] **Step 5: Commit evidence and handoff**

```bash
git add .harness
git commit -m "docs: record API-001 verification evidence"
```

## Plan Self-Review Checklist

- **Spec coverage:** Tasks 1–3 cover catalog shape, source precedence, validation, size limits, merge order, disable behavior, duplicate rejection, and immutable snapshots. Task 4 covers every public JSON projection and header/error rule. Task 5 covers both routes, trailing slash behavior, method/path errors, pre-bind failure, server lifecycle, and no I/O on request. Task 6 covers every declared verification command and Harness acceptance rule.
- **Placeholder scan:** No task contains unresolved markers or vague implementation instructions. The reference catalog rule explicitly forbids invented IDs and defines the empty-catalog fallback for the current checkout.
- **Type consistency:** `ModelCatalogEntry`, `CatalogFileConfig`, `ModelCatalogSnapshot`, `ApiServerOptions`, `RuntimeIdentity`, `HealthResponse`, `OpenAiModel`, `OpenAiModelsResponse`, `ApiErrorBody`, `RouteContext`, `resolveCatalog`, `resolveExplicitCatalog`, `loadCatalogFile`, `handleApiRequest`, and `createApiServer` are defined before consumers use them. `options.catalog` bypasses file loading and uses `resolveExplicitCatalog` consistently.
- **Scope check:** No task adds chat completions, streaming, auth, live discovery, Cline process calls, router logic, or unrelated refactors.
