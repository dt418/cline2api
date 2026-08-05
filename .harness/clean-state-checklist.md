# Clean-State Checklist

- [x] `CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init` completed successfully (77 tests).
- [x] `pnpm verify` completed successfully (77 tests).
- [x] `pnpm exec vitest run packages/cli-driver/test` completed successfully (67 tests).
- [x] `.harness/progress.md` reflects the actual verified state and blocker.
- [x] `.harness/feature_list.json` has no false `passing` entries.
- [x] Every `passing` feature has redacted verification evidence.
- [x] No more than one feature is `in_progress`.
- [x] No half-finished work is absent from the progress or handoff records.
- [x] `git diff --check` completed successfully.
- [x] The next session has one explicit next best action.
