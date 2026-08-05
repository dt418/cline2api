# Clean-State Checklist

- [ ] `CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store HARNESS_SKIP_INSTALL=1 pnpm harness:init` completed successfully for the paused API-001 branch; global format is blocked only by ignored SDD brief artifacts.
- [ ] `pnpm verify` completed successfully for the paused API-001 branch; global format is blocked only by ignored SDD brief artifacts.
- [x] `pnpm exec vitest run packages/cli-driver/test` completed successfully (67 tests).
- [x] `pnpm test` completed successfully (111 tests) and `pnpm typecheck` completed successfully after API-001 Tasks 1-4.
- [x] `.harness/progress.md` reflects the actual verified state and blocker.
- [x] `.harness/feature_list.json` has no false `passing` entries.
- [x] Every `passing` feature has redacted verification evidence.
- [x] No more than one feature is `in_progress`.
- [x] No half-finished work is absent from the progress or handoff records.
- [x] `git diff --check` completed successfully.
- [x] The next session has one explicit next best action.
- [x] API-001 partial state and the intentional Task 5-6 pause are recorded in progress and handoff documents.
