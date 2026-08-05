# Session Handoff

## Currently verified

The ACP-first `CLI-001` implementation is present through commit `eafae8a` on `work/cli-001-acp-driver` and passes its declared local verification gates. Its focused suite exits 0 with 67 tests across 9 files; the full suite exits 0 with 77 tests across 12 files.

## Changes this session

- Preserved SDK authentication-required and typed terminal errors across both pre-session ACP layers so they cannot start NDJSON.
- Bounded ACP spawn/initialization with abort, child cleanup, late-connection disposal, grace settlement, and no leaked timers.
- Made post-session non-zero exits and signals immediately terminal while preserving zero-exit/end-turn buffering and cancellation/timeout precedence.
- Corrected exact-boundary CRLF framing and normalized all 17 current Prettier discrepancies.
- Recorded redacted Harness evidence and marked `CLI-001` passing only after every declared gate exited 0.

## Still unverified

Cross-platform CI has not run and remains a later operations gate. No local CLI-001 gate is outstanding.

## Next best action

Select `API-001` in a separate scoped session. The sandbox default pnpm store is not writable; use `CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store` for store access. Do not inspect or emulate undocumented Cline/ClinePass protocols.

## Commands

```bash
pnpm exec vitest run packages/cli-driver/test
pnpm verify
CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init
git diff --check
```
