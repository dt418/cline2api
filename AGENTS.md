# cline2api Agent Instructions

This file is the canonical instruction source for Codex, Cline, Claude Code, and other coding agents working in this repository. `CLAUDE.md` is only a compatibility entrypoint; it must not contain conflicting rules.

## Startup workflow

Before editing anything:

1. Confirm the repository root with `pwd` and `git rev-parse --show-toplevel`.
2. Read `.harness/progress.md` and `.harness/feature_list.json`.
3. Run `pnpm harness:init`. In the restricted Codex workspace, set `CLINE2API_PNPM_STORE_DIR=/workspace/.pnpm-store` when the default pnpm store is not writable.
4. If bootstrap or verification fails, record the exact redacted error in progress and resolve the baseline before selecting product work.
5. Select the highest-priority unblocked feature whose dependencies are `passing`.
6. Set exactly that feature to `in_progress`; do not work on another feature in the same session.

## Scope and implementation rules

- Work only within the selected feature's declared behavior and verification steps.
- Use test-driven development for every production function: write a focused failing test, run it and confirm the expected failure, implement the smallest passing change, then refactor while green.
- Keep package boundaries small and explicit. Do not add speculative abstractions or unrelated refactors.
- The project is a provider adapter around the official Cline CLI, not a new AI router.
- Use only documented official Cline CLI behavior. Do not reverse engineer, inspect, emulate, or depend on Cline/ClinePass internal network protocols.
- Preserve OpenAI-compatible, streaming-first, plugin-first, backward-compatible interfaces.
- Keep process execution and bootstrap behavior cross-platform. Canonical logic belongs in Node.js; shell files may only be thin wrappers.
- Never print or commit API keys, tokens, cookies, authorization headers, raw provider payloads containing secrets, or unredacted logs.

## Verification and state rules

- Run the feature's declared static, unit, contract, integration, and end-to-end checks as applicable.
- A feature may become `passing` only after its verification commands pass and its `evidence` field contains the redacted commands and results.
- A blocked feature must include the blocker, reproduction command, and next safe action in `notes` or progress.
- Keep exactly one feature `in_progress`; never mark a feature passing from a manual assertion alone.
- Update `.harness/quality-document.md` after a significant milestone and keep the evaluator score aligned with the evidence.

## End-of-session workflow

Before stopping:

1. Run the selected feature's complete verification set and `pnpm verify`.
2. Run `git diff --check`.
3. Update `.harness/feature_list.json` with the actual status and evidence.
4. Update `.harness/progress.md` and `.harness/session-handoff.md` with verified state, changes, risks, and next best action.
5. Complete `.harness/clean-state-checklist.md`.
6. Review `git diff` and commit only intentional changes using a conventional commit message.

Never claim completion without command evidence. During the coding phase, use the project-owner requested Luna model with ultra reasoning.
