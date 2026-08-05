# Session Handoff

## Currently verified

The ACP-first `CLI-001` implementation remains verified, and the `API-001` partial implementation is integrated on `work/api-001-partial`. API Tasks 1-4 pass the local package and repository checks; the feature intentionally remains `in_progress`.

## Changes this session

- Ran the required harness baseline successfully and selected `API-001` as the only active feature.
- Completed and documented the approved OpenCodeX-inspired hybrid catalog design for local health and model discovery.
- Preserved SDK authentication-required and typed terminal errors across both pre-session ACP layers so they cannot start NDJSON.
- Bounded ACP spawn/initialization with abort, child cleanup, late-connection disposal, grace settlement, and no leaked timers.
- Made post-session non-zero exits and signals immediately terminal while preserving zero-exit/end-turn buffering and cancellation/timeout precedence.
- Corrected exact-boundary CRLF framing and normalized all 17 current Prettier discrepancies.
- Recorded redacted Harness evidence and marked `CLI-001` passing only after every declared gate exited 0.
- Added API-001 Tasks 1-4: catalog types/reference, bounded malformed-input validation, immutable resolution, and safe JSON response projections for the planned health/model endpoints.
- Preserved API-001 as `in_progress`; Task 5 route/server wiring and Task 6 final Harness evidence are paused per user request.

## Still unverified

API-001 Tasks 5-6 are still unverified: no HTTP route/server wiring or final API-001 Harness evidence has been completed. Cross-platform CI has not run and remains a later operations gate. No local CLI-001 gate is outstanding.

## Next best action

Resume Task 5 (routes/server) in a new scoped session when requested, then run Task 6 verification. Keep `API-001` `in_progress` until both tasks pass. The sandbox default pnpm store is not writable; use `CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store` for store access. Do not inspect or emulate undocumented Cline/ClinePass protocols.

## Commands

```bash
pnpm exec vitest run packages/cli-driver/test
pnpm verify
CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init
git diff --check
```
