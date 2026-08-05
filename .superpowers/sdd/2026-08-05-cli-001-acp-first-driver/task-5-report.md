# Task 5 Report: ACP-first driver

## Delivered

- Added `createClineCliDriver(options?)` with the default `cline` executable and automatic ACP-first transport selection.
- Validates every request before a transport starter is invoked.
- Uses NDJSON exactly once only when the ACP starter throws `AcpUnavailableError`; all other ACP errors are preserved without a second starter call.
- Keeps explicit `acp` and `ndjson` selections isolated to their selected transport.
- Wires the default Node child-process spawner, SDK ACP connection factory, ACP starter, and NDJSON starter while preserving injectable implementations for tests and callers.
- Applies driver limits as defaults and request values as overrides without mutating either input.
- Added the source entrypoint, exporting the driver, every public transport/request/result/host contract, and both public error classes.

## Test-first evidence

`pnpm exec vitest run packages/cli-driver/test/driver.test.ts` initially failed because `../src/driver.js` did not exist. After implementing the driver, the focused suite passed with 11 tests.

The tests cover ACP-only automatic success, one ACP-unavailable fallback, every non-fallback terminal error (`authentication_required`, `permission_unavailable`, `protocol_error`, `timeout`, and `cancelled`), explicit transport isolation, pre-spawn validation, and default/request limit merging without mutation.

## Verification

| Command                                                        | Result    |
| -------------------------------------------------------------- | --------- |
| `pnpm exec vitest run packages/cli-driver/test/driver.test.ts` | 11 passed |
| `pnpm exec vitest run packages/cli-driver/test`                | 51 passed |
| `pnpm test`                                                    | 61 passed |
| `pnpm typecheck`                                               | passed    |
| `git diff --check`                                             | passed    |

`pnpm format:check` remains nonzero because pre-existing files and Task briefing files outside Task 5 are not formatted. The Task 5 source and test files were formatted individually with Prettier.

## Follow-up: real ACP startup fallback

The real ACP transport previously caught a pre-session connection failure and returned a failed ACP run. That hid `AcpUnavailableError` from the orchestrator, so automatic transport selection could not reach its single NDJSON fallback.

Pre-session initializer failures, child spawn errors, and child exits while the connection factory is pending now finish cleanup and reject with `AcpUnavailableError`. A late connection is disposed before the rejection. Failures after `markSessionStarted` retain the failed ACP run with `protocol_error`, so they do not trigger a second child.

Focused Task 4 and Task 5 regressions pass (22 tests), including the driver integration that uses the real ACP starter, an injected failing connection factory, and an injected NDJSON starter. Repository verification after the fix: `pnpm test` passed 63 tests, `pnpm typecheck` passed, and `git diff --check` passed.
