# API-001: OpenAI-Compatible Discovery and Health

**Status:** Approved design — Tasks 1-4 implemented; Tasks 5-6 intentionally paused
**Date:** 2026-08-05
**Scope:** The first HTTP surface for `cline2api`: a local health endpoint and an OpenAI-compatible model-discovery endpoint.

## 1. Purpose

`cline2api` is a provider adapter around the official Cline CLI. API-001 gives existing routers a deterministic way to discover the adapter and verify that its local HTTP process is ready. It does not execute a Cline turn, discover undocumented Cline/ClinePass protocols, or become a general-purpose model router.

The design borrows the useful part of OpenCodeX's provider architecture: a canonical registry feeds public projections, configuration overlays are explicit, and live discovery is a separate capability rather than an implicit request-side dependency. OpenCodeX documents its registry as the source for provider pickers and seeds, its configuration precedence, and a per-provider cache with stale fallback for live model lists:

- [OpenCodeX provider registry and contribution rules](https://opencodex.me/contributing/)
- [OpenCodeX configuration reference](https://opencodex.me/reference/configuration/)
- [OpenCodeX architecture: caching and catalog](https://opencodex.me/reference/architecture/)
- [OpenCodeX management API](https://opencodex.me/reference/management-api/)

Those ideas are intentionally narrowed to this adapter. API-001 does not copy OpenCodeX's routing, combos, account pools, dashboards, or remote management API.

## 2. Goals

- Expose `GET /health` with a stable, local readiness contract.
- Expose `GET /v1/models` with a minimal OpenAI-compatible model-list contract.
- Return a deterministic, checked-in reference catalog by default.
- Allow an operator to append, replace, or disable entries through one JSON configuration file.
- Validate configuration before the HTTP server is returned or bound.
- Keep all catalog data in memory after startup; do not read the file on every request.
- Keep the HTTP package independent from the Cline ACP/NDJSON driver.
- Make the catalog seam extensible for a future bounded live-discovery source without implementing network discovery in API-001.
- Preserve model IDs exactly as configured so existing routers do not receive an implicit namespace rewrite.

## 3. Non-goals

- `POST /v1/chat/completions`, Responses API, SSE, or any streaming translation.
- Starting, monitoring, cancelling, or translating an official Cline CLI run.
- Live calls to a provider or to an undocumented Cline/ClinePass endpoint.
- Authentication, CORS, remote binding policy, API keys, or management mutations.
- Hot-reloading the catalog or writing configuration from the HTTP server.
- Provider/model routing, combos, failover, quotas, account pools, or dashboards.

These belong to API-002, SAFE-001, PLUGIN-001, or OPS-001 as appropriate.

## 4. Package boundary

Add one package, `packages/api`, published internally as `@cline2api/api`. It uses only Node's built-in `node:http` and `node:fs/promises` modules plus the existing `@cline2api/core` identity type. It must not import `@cline2api/cli-driver`.

The package has these focused responsibilities:

```text
packages/api/src/
├── catalog/
│   ├── types.ts       # model entry and catalog configuration types
│   ├── reference.ts   # checked-in reference catalog
│   ├── loader.ts      # file reading and JSON parsing
│   └── resolver.ts    # validation, merge, disable, immutable snapshot
├── http/
│   ├── routes.ts      # method/path dispatch
│   ├── responses.ts   # JSON and error projections
│   └── server.ts      # node:http server factory
└── index.ts           # public exports
```

The source modules remain small and communicate through typed values. No live provider source is added to this package in API-001. A future source may implement the same internal catalog-loading boundary, but it must be introduced by a separately approved feature.

## 5. Catalog model

The internal model is intentionally smaller than an upstream provider record:

```ts
export interface ModelCatalogEntry {
  readonly id: string;
  readonly ownedBy?: string;
  readonly created?: number;
}
```

The reference catalog is a checked-in ordered array exported by `catalog/reference.ts`. It is the default source of truth for the adapter. The implementation must use the maintained reference IDs available to the project and must not invent provider support or claim that a model is executable merely because it is listed. If the maintained reference array is empty, configuration may still populate it; `/v1/models` remains valid with an empty `data` array.

The public projection maps each enabled entry to:

```ts
export interface OpenAiModel {
  readonly id: string;
  readonly object: "model";
  readonly created: number;
  readonly owned_by: string;
}
```

Projection rules:

- `id` is copied without adding `cline/`, provider prefixes, or aliases.
- `created` uses the configured value, otherwise `0`.
- `owned_by` uses `ownedBy`, otherwise `"cline2api"`.
- Internal source, URL, capability, status, and diagnostic fields are never projected.
- The resolved order is preserved exactly.

## 6. Configuration and merge semantics

The optional path is supplied by `CLINE2API_MODEL_CATALOG_FILE`. The factory also accepts explicit options for embedding and tests:

```ts
export interface ApiServerOptions {
  readonly identity: RuntimeIdentity;
  readonly catalog?: readonly ModelCatalogEntry[];
  readonly catalogFile?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly maxCatalogBytes?: number;
}
```

Source precedence is:

```text
options.catalog
  > options.catalogFile
  > environment.CLINE2API_MODEL_CATALOG_FILE
  > built-in reference catalog
```

When `options.catalog` is supplied, no file is read. This makes tests and embedding deterministic. Otherwise, an explicit `catalogFile` wins over the environment. With no file, the reference catalog is used as-is.

The configuration file is a UTF-8 JSON object:

```json
{
  "mode": "append",
  "models": [
    {
      "id": "custom/model",
      "ownedBy": "custom-provider",
      "created": 0
    }
  ],
  "disabled": ["reference/model"]
}
```

Rules:

1. `mode` is optional and defaults to `"append"`; the only other value is `"replace"`.
2. `models` is an array of entries and defaults to an empty array.
3. In `append`, file entries follow the reference order; an ID already present in the reference is replaced in its original position.
4. In `replace`, only file entries are used, in file order.
5. `disabled` is applied after merge and removes matching IDs.
6. IDs are trimmed for validation, are case-sensitive, must be non-empty, must contain no control characters, and are limited to 256 UTF-8 bytes.
7. `ownedBy`, when present, must be a non-empty trimmed string of at most 128 UTF-8 bytes.
8. `created`, when present, must be a finite non-negative integer that is safe to represent in JSON.
9. Duplicate IDs in one input array are invalid. A file entry may intentionally override a reference entry only in `append` mode.
10. Unknown top-level or entry fields are invalid so configuration typos fail closed.
11. The default maximum JSON file size is 1 MiB. If supplied, `maxCatalogBytes` must be a finite integer from 1 through 1 MiB; it can only lower the effective limit and cannot raise it.
12. Missing, unreadable, oversized, malformed, or invalid configuration rejects startup with a typed configuration error containing the path/field and a safe reason, never the file contents. Explicit `options.catalog` entries use the same validation rules.

The resolver returns an immutable snapshot. API-001 has no watcher or reload route; new configuration takes effect when the server is recreated.

## 7. HTTP contract

`createApiServer(options)` is asynchronous because catalog loading and validation complete before a server is returned:

```ts
export async function createApiServer(options: ApiServerOptions): Promise<http.Server>;
```

The returned server is not listening. The caller owns `listen`, port selection, bind address, and `close`. A caller can therefore bind only after a successful catalog load.

### 7.1 `GET /health`

After successful factory creation, this endpoint returns `200`:

```json
{
  "status": "ok",
  "service": "cline2api",
  "version": "0.1.0",
  "ready": true
}
```

`version` comes from `options.identity.version`. `ready` means the process and immutable catalog snapshot are initialized; it does not mean that a provider credential is valid or that a Cline turn can execute. The endpoint performs no child-process spawn and no network request.

### 7.2 `GET /v1/models`

The response is `200` with:

```json
{
  "object": "list",
  "data": [
    {
      "id": "provider/model",
      "object": "model",
      "created": 0,
      "owned_by": "cline2api"
    }
  ]
}
```

The endpoint returns only enabled entries from the startup snapshot. It never performs live discovery, file I/O, or provider authentication. One optional trailing slash is accepted for `/health/` and `/v1/models/`; other paths are not normalized.

### 7.3 Errors and headers

All JSON responses use `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

Unknown routes return `404`; a known route with a method other than `GET` returns `405` and `Allow: GET`. Both use this stable shape:

```json
{
  "error": {
    "message": "route not found",
    "type": "invalid_request_error",
    "code": "not_found"
  }
}
```

The method error uses `message: "method not allowed"` and `code: "method_not_allowed"`. Error bodies contain no paths, headers, credentials, provider payloads, or stack traces.

## 8. Runtime and safety behavior

- Catalog loading occurs before the server is returned, so invalid configuration cannot create a partially ready HTTP surface.
- The request path reads only immutable in-memory data and performs bounded JSON serialization.
- The server does not expose a mutation or reload operation.
- Health and model responses never include API keys, bearer tokens, cookies, authorization headers, provider URLs, raw upstream payloads, or CLI diagnostics.
- No API authentication is added in this feature; the caller should bind locally. Remote access policy is reserved for SAFE-001/OPS-001.
- The implementation uses Node APIs that are available on the supported Windows, macOS, and Linux runtimes and does not require a POSIX shell.

## 9. Verification plan

Add focused tests under `packages/api/test`:

### Catalog unit tests

- reference catalog is returned when no override exists;
- append mode preserves order and replaces a duplicate reference ID;
- replace mode ignores the reference catalog;
- disabled IDs are removed after merge;
- duplicate file IDs, invalid IDs, invalid metadata, unknown fields, invalid JSON, unreadable files, and size limits fail with safe typed errors;
- explicit `catalog` wins over explicit path and environment path;
- resolved snapshots do not change when the input array is mutated.

### HTTP contract tests

- health status, version, readiness, content type, and no-upstream behavior;
- model-list envelope, projection defaults, configured metadata, disabled entries, and stable ordering;
- empty catalog response;
- accepted trailing slash;
- `404`, `405`, `Allow`, error shape, and no sensitive detail;
- real `node:http` server listen on an ephemeral port and clean close.

The feature verification commands are:

```text
pnpm exec vitest run packages/api/test
pnpm typecheck
pnpm format:check
CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init
git diff --check
```

The feature cannot be marked passing until all declared commands pass and redacted evidence is recorded in `.harness/feature_list.json`, `.harness/progress.md`, and `.harness/session-handoff.md`.

## 10. Acceptance criteria

API-001 is accepted when:

1. Existing OpenAI-compatible clients can call `/v1/models` and receive a deterministic valid model list.
2. A local health check can call `/health` and distinguish a ready process from a failed startup.
3. Reference entries and file configuration obey the exact precedence and merge rules above.
4. Invalid configuration fails before binding and never leaks file contents.
5. The package has no dependency on Cline transport code and makes no provider/Cline network calls.
6. Focused HTTP tests, typecheck, formatting, harness bootstrap, and diff checks all pass.
7. Harness evidence is redacted, the feature is the only `in_progress` entry during implementation, and no unrelated feature is marked passing.

## 11. Risks and mitigations

| Risk                                           | Mitigation                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Reference IDs become stale                     | Keep the catalog checked in and make file overlay explicit; live discovery remains a separately bounded capability. |
| Config typo silently hides a model             | Reject unknown fields and invalid entries before bind.                                                              |
| Router depends on provider-prefixed IDs        | Preserve configured IDs and do not add an implicit namespace.                                                       |
| Health endpoint implies upstream auth is valid | Define readiness as local process/config readiness only.                                                            |
| Request-time file I/O causes latency or races  | Resolve and freeze the catalog at startup.                                                                          |
| Sensitive data leaks through diagnostics       | Use safe typed errors and fixed JSON error bodies.                                                                  |

## 12. Explicit exclusions

- Reverse engineering Cline or ClinePass internals.
- Calling undocumented provider or Cline endpoints.
- Implementing live model discovery in API-001.
- Building a second routing or account-management layer.
- Adding authentication or remote-access semantics before SAFE-001/OPS-001.
