# Task 3 Report — Bounded NDJSON CLI Transport

## Status

Completed. The NDJSON parser and transport are implemented without ACP or orchestrator changes.

## Files

- `packages/cli-driver/src/ndjson-parser.ts`
- `packages/cli-driver/src/ndjson-transport.ts`
- `packages/cli-driver/test/ndjson-parser.test.ts`
- `packages/cli-driver/test/ndjson-transport.test.ts`

## Tests and Verification

- `pnpm exec vitest run packages/cli-driver/test/ndjson-parser.test.ts`
  - RED: confirmed missing parser module.
  - GREEN: 6 tests passed.
- `pnpm exec vitest run packages/cli-driver/test/ndjson-transport.test.ts`
  - RED: confirmed missing transport module.
  - GREEN: 6 tests passed.
- `pnpm exec vitest run packages/cli-driver/test/ndjson-parser.test.ts packages/cli-driver/test/ndjson-transport.test.ts`
  - 12 tests passed.
- `pnpm typecheck`
  - Passed.
- `git diff --check`
  - Passed.

## Self-review

- Incremental UTF-8 record decoding preserves split multibyte characters and supports LF/CRLF.
- Diagnostics retain counters and safe phase only; raw stdout/stderr are never stored in results.
- Oversized lines are discarded through their newline boundary, malformed records are counted, and event limits truncate emission.
- Ask events are emitted first; disabled approval requests terminate with `permission_unavailable`.
- Terminal state handling preserves cancellation/timeout over later process exits, and cancellation calls `kill()` once.

## Concerns

- The transport is intentionally scoped to documented NDJSON behavior. ACP selection and the higher-level orchestrator remain for later tasks.

## Commit

- `853deb9eee7ff7522107fb550c6c026e5ee03876` — `feat: add bounded NDJSON CLI transport`

## Follow-up Fix

- Added regression coverage for child `error` events during cancellation and timeout grace periods.
- Child errors now preserve an already requested cancellation or timeout terminal result.
- Removed trailing whitespace from the parser test.
- Verification: `pnpm exec vitest run packages/cli-driver/test/ndjson-parser.test.ts packages/cli-driver/test/ndjson-transport.test.ts` (14 tests passed), `pnpm typecheck` passed, `git diff --check` passed, and `git diff --check c7ef3d0..HEAD` passed.
- Fix commit: `af3ed40` — `fix: preserve NDJSON terminal precedence`.
