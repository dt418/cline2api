# Clean-State Checklist

- [x] `pnpm harness:init` completed successfully.
- [x] `pnpm verify` completed successfully.
- [x] `.harness/progress.md` reflects the actual verified state.
- [x] `.harness/feature_list.json` has no false `passing` entries.
- [x] Every `passing` feature has redacted verification evidence.
- [x] No more than one feature is `in_progress`.
- [x] No half-finished work is absent from the progress or handoff records.
- [x] `git diff --check` is clean.
- [x] The next session has one explicit next best action.
