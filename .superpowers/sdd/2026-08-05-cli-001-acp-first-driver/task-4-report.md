# Task 4 Report: ACP v1 host adapter and transport

## Scope

Added `acp-host.ts` and `acp-transport.ts` with their focused tests. Existing Task 1–3 source and tests were not modified.

## Implemented behavior

- Advertises ACP filesystem capabilities only for injected file callbacks and terminal capability only for the complete terminal callback set.
- Registers SDK v1 request and notification handlers without an implicit filesystem or terminal bridge.
- Rejects permission once by default when offered, never auto-approves, and resolves pending permission requests as cancelled during disposal/cancellation.
- Uses `ndJsonStream`, `ClientApp.connectWith`, initialize, and `ActiveSession` APIs from `@agentclientprotocol/sdk` v1.3.0.
- Emits normalized message, tool-call, and plan events; preserves cancellation/timeout terminal precedence over later child exits.
- Treats only connection failures before `markSessionStarted` as `acp_unavailable`; later ACP failures are protocol terminal errors.
- Diagnostics retain counters and lifecycle phase only; stderr is counted but never retained.

## TDD evidence

1. `pnpm exec vitest run packages/cli-driver/test/acp-host.test.ts` initially failed because `acp-host.ts` did not exist.
2. After the host implementation, the same focused test passed: 5 tests.
3. `pnpm exec vitest run packages/cli-driver/test/acp-transport.test.ts` initially failed because `acp-transport.ts` did not exist.
4. After the transport implementation, both ACP focused suites passed: 9 tests.

## Verification

- `pnpm exec vitest run packages/cli-driver/test/acp-host.test.ts packages/cli-driver/test/acp-transport.test.ts` — 2 files, 9 tests passed.
- `pnpm typecheck` — passed.
- `git diff --check` — passed.

## SDK compatibility note

The v1.3.0 `acp.client()` API accepts `AppOptions` with `name`, but no `version` property. The implementation therefore uses `{ name: "cline2api" }` for the SDK app and retains `{ name: "cline2api", version: "0.1.0" }` in the required ACP initialize `clientInfo` payload.

## Review follow-up — 2026-08-05

Addressed Task 4 review findings with new regression coverage:

- An SDK peer close before the connection callback rejects the returned port as `AcpUnavailableError`; the connect promise is bridged instead of silently swallowed.
- `acp_unavailable` is selected only when the local `markSessionStarted` callback has not run. A later `AcpUnavailableError` is reported as `protocol_error`.
- A zero child exit is buffered until the asynchronous ACP stop arrives, allowing `end_turn` to succeed regardless of event-loop ordering.
- Cancellation records terminal intent and starts the grace timer before issuing a best-effort, non-awaited ACP cancel request, so a never-settling RPC cannot hold the result open.
- A child that settles while connection creation is pending causes a later port to be disposed without a prompt or update loop.
- ACP stdout is counted, unsupported SDK updates are skipped rather than normalized as messages, and cancelled permission entries unregister from their pending registry.

Follow-up verification: `pnpm exec vitest run packages/cli-driver/test/acp-host.test.ts packages/cli-driver/test/acp-transport.test.ts` passed with 14 tests; `pnpm typecheck` and `git diff --check` passed.
