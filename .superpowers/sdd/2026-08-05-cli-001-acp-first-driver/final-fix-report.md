# CLI-001 Final Fix Report

## Outcome

The final review findings are resolved in implementation commit `eafae8a`. Automatic
NDJSON fallback remains limited to genuine pre-session `AcpUnavailableError` failures.
Authentication-required and existing typed terminal errors retain their codes, ACP
startup is bounded by the request timeout, abnormal post-session process exits settle
as `process_exit`, and CRLF framing applies `maxLineBytes` to payload bytes only.

## TDD evidence

The initial focused regression run failed 12 tests for the expected missing behaviors:
nine real-starter authentication/typed-error/startup-timeout cases, two abnormal ACP
exit cases, and one exact-boundary CRLF case. A later SDK-style abort regression also
failed by selecting NDJSON after timeout. Each regression passed after its minimal
production change, and the final focused suite passed 67 tests across 9 files.

## Implementation

- ACP startup errors are classified once at both SDK and transport boundaries. SDK
  `RequestError` code `-32000` becomes `authentication_required`; existing
  `ClineCliError` instances are preserved; unknown spawn/connect/initialize failures
  remain fallback-eligible `acp_unavailable` errors.
- The timeout starts immediately after spawn. Initialization receives an `AbortSignal`,
  timeout wakes the async starter, kills the child once, disposes any late connection,
  observes cancellation grace, and clears all timers. Timeout remains terminal when
  SDK initialization rejects because of that abort.
- A non-zero exit code or signal after session creation resolves immediately as
  `failed`/`process_exit`. Zero exit remains buffered until `end_turn`, and an already
  requested cancellation or timeout keeps precedence.
- The NDJSON parser delays a possible carriage return across chunk boundaries and
  excludes it only when the following byte is LF. A standalone carriage return remains
  payload and is still subject to the byte limit.
- Prettier normalized the 17 live discrepancies reported by the final review. The
  historical Task 6 count remains recorded as 15; the current count is zero.

## Final verification

| Command                                                                                    | Result                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `pnpm exec vitest run packages/cli-driver/test`                                            | Exit 0: 9 files, 67 tests                                       |
| `pnpm verify`                                                                              | Exit 0: format check, typecheck, 12 files and 77 tests          |
| `CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init` | Exit 0: Harness initialized successfully; 12 files and 77 tests |
| `pnpm typecheck`                                                                           | Exit 0                                                          |
| `pnpm test`                                                                                | Exit 0: 12 files, 77 tests                                      |
| `git diff --check`                                                                         | Exit 0                                                          |

Evidence contains no live secrets, prompts, provider payloads, or stderr content.
Cross-platform CI remains a later operations gate and was not claimed here.
