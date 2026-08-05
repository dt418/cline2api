# cline2api Production Harness Design

**Status:** Approved design — implementation has not started  
**Date:** 2026-08-05  
**Scope:** Agent-development harness only; this document does not implement the cline2api provider adapter.

## 1. Purpose

cline2api is a production-grade, cross-platform TypeScript monorepo that exposes the official Cline CLI as a provider for existing AI routing and coding systems. The project must remain provider-adapter-first: it is not an AI router and must not reverse engineer Cline or ClinePass internal protocols.

This harness makes multi-session agent work reliable, auditable, and bounded. It supplies the instruction layer, state layer, verification layer, scope control, and session lifecycle needed for contributors to advance cline2api one verified feature at a time.

## 2. Non-negotiable constraints

- Use only documented, official Cline CLI behavior at the Cline boundary.
- Do not inspect, emulate, or derive undocumented Cline/ClinePass network protocols.
- Preserve an OpenAI-compatible, streaming-first, plugin-first, backward-compatible design.
- Support Windows, macOS, and Linux.
- Treat credentials, provider responses, and logs as sensitive; record only redacted evidence.
- Keep `AGENTS.md` as the canonical instruction source. `CLAUDE.md` is a compatibility entrypoint and must not duplicate or override the canonical rules.
- This planning phase produces specifications only. Implementation tasks must use Luna with ultra reasoning, as directed by the project owner.

## 3. Harness architecture

```text
cline2api/
├── AGENTS.md
├── CLAUDE.md
├── package.json
├── scripts/
│   └── harness-init.mjs
└── .harness/
    ├── feature_list.json
    ├── progress.md
    ├── session-handoff.md
    ├── clean-state-checklist.md
    ├── evaluator-rubric.md
    └── quality-document.md
```

### 3.1 Instruction layer

`AGENTS.md` is read before any repository change. It requires the agent to read `.harness/progress.md` and `.harness/feature_list.json`, run the baseline command, select exactly one feature, execute only that feature’s acceptance checks, and update all state artifacts before ending the session.

`CLAUDE.md` contains only a compatibility notice and a direct reference to `AGENTS.md`. Any contradiction is resolved in favor of `AGENTS.md`.

### 3.2 State and scope layers

`.harness/feature_list.json` is the machine-readable source of truth for work scope. Every entry contains:

- `id`: stable, unique feature identifier;
- `priority`: positive integer, lower values first;
- `area`: cline2api product domain;
- `title`: concise outcome;
- `user_visible_behavior`: observable success behavior;
- `status`: `not_started`, `in_progress`, `blocked`, or `passing`;
- `dependencies`: feature identifiers that must be `passing` first;
- `verification`: exact commands and observable assertions;
- `evidence`: redacted command output, test reports, or CI references recorded after success;
- `notes`: constraints and known risks.

At most one feature may be `in_progress`. A blocked feature must explain the blocker, its reproduction command, and the next safe action. A feature cannot be `passing` without non-empty verification evidence.

`.harness/progress.md` is the human-readable cross-session record: verified baseline, active feature, current blocker, completed changes, commands run, known risks, and next best action. `.harness/session-handoff.md` is the concise end-of-session continuation note. Neither document may claim behavior that is absent from the feature evidence.

### 3.3 Cross-platform verification layer

The primary bootstrap entrypoint is `pnpm harness:init`, implemented by `scripts/harness-init.mjs`. It must:

1. verify the caller is in the repository root;
2. report the active platform, Node.js version, package-manager version, and git revision when available;
3. install dependencies using the locked package-manager workflow;
4. run the repository baseline verification command;
5. stop on failure and print the exact recovery-oriented next command;
6. print the standard development and focused-test commands on success.

Optional `init.sh` and `init.ps1` wrappers may call the package script, but contain no authoritative logic. This keeps bootstrap behavior equivalent on Windows, macOS, and Linux.

## 4. Agent operating lifecycle

1. **Start:** Read `AGENTS.md`, progress, and feature state; run `pnpm harness:init`.
2. **Baseline decision:** If bootstrap fails, record a `blocked` baseline and resolve it before selecting product work.
3. **Scope lock:** Select the highest-priority unblocked feature whose dependencies are passing; set it to `in_progress`.
4. **Implementation:** Make only changes necessary for the selected feature. Do not blend refactors or unrelated features.
5. **Verification:** Run all required static, unit, contract, integration, and end-to-end checks for that feature.
6. **Evidence:** Store redacted commands and results in the feature entry; update quality and progress records.
7. **Clean exit:** Complete the checklist and session handoff. Leave no unstated partial work.

## 5. Failure and safety policy

| Condition                             | Required response                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline verification fails           | Record the failure and reproduction command; mark the affected work `blocked`; do not begin a different product feature.                                                               |
| A feature test fails                  | Keep the feature `in_progress`; fix or document the failure; do not mark it passing.                                                                                                   |
| Cline CLI or provider execution fails | Record Cline CLI version, exit code, redacted stderr/stdout, timeout/cancellation outcome, and observed streaming behavior. Do not reverse engineer or fabricate an internal protocol. |
| Secret may appear in output           | Redact before it reaches `.harness`, test artifacts, commits, or CI logs.                                                                                                              |
| A test is flaky                       | Classify the source, stabilize or isolate it, then rerun the complete affected verification set before acceptance.                                                                     |

## 6. Verification model

Each feature declares the applicable layers; omitted layers require an explicit rationale in its notes.

- **Static:** formatting, linting, type checking, dependency and license policy.
- **Unit:** protocol-neutral domain logic, plugin contracts, configuration, validation, and error behavior.
- **Contract:** Cline CLI integration using only documented/official CLI behavior.
- **Integration:** OpenAI-compatible API behavior, server lifecycle, non-streaming output, SSE streaming, timeout, and cancellation.
- **End-to-end:** an authorized Cline CLI installation and valid configured provider, with secrets redacted.
- **Cross-platform CI:** Windows, macOS, and Linux bootstrap plus process/streaming coverage appropriate to the affected code.

## 7. Initial feature registry

The initial registry is ordered as vertical slices. Integration packages depend on the validated core rather than each creating a separate path.

| ID                | Outcome                                                    | Dependencies             |
| ----------------- | ---------------------------------------------------------- | ------------------------ |
| `HARN-001`        | Production Harness bootstrap and self-validation           | None                     |
| `CORE-001`        | Monorepo/toolchain baseline across supported platforms     | `HARN-001`               |
| `CLI-001`         | Official Cline CLI process lifecycle driver                | `CORE-001`               |
| `API-001`         | OpenAI-compatible discovery and health endpoints           | `CORE-001`               |
| `API-002`         | Chat completions and SSE stream translation                | `CLI-001`, `API-001`     |
| `SAFE-001`        | Configuration, secret redaction, timeout, and cancellation | `API-002`                |
| `PLUGIN-001`      | Plugin SDK and capability contracts                        | `SAFE-001`               |
| `INTEGRATION-001` | 9Router adapter package                                    | `PLUGIN-001`             |
| `INTEGRATION-002` | OmniRoute adapter package                                  | `PLUGIN-001`             |
| `INTEGRATION-003` | OpenCodeX adapter package                                  | `PLUGIN-001`             |
| `OPS-001`         | Observability, diagnostics, and release CI matrix          | `SAFE-001`, `PLUGIN-001` |

## 8. Acceptance and quality controls

`evaluator-rubric.md` scores each completed feature from 0 to 2 in six dimensions: Correctness, Verification, Scope discipline, Reliability, Maintainability, and Handoff readiness.

Feature acceptance requires:

- Correctness, Verification, Scope discipline, and Reliability each score 2;
- Maintainability and Handoff readiness each score at least 1;
- total score at least 10/12;
- all declared verification evidence is present and redacted.

Milestone acceptance requires a score of 12/12 and no unresolved documented blocker within that milestone.

`quality-document.md` tracks codebase health separately from individual feature quality, with grades recorded only after verification evidence exists. It evaluates API compatibility, stream correctness, CLI boundary discipline, portability, security/redaction, plugin isolation, and test stability.

Harness components may be simplified only through a benchmark comparison: capture a quality snapshot, remove one component, run the benchmark suite, capture a second snapshot, and restore the component when quality declines.

## 9. Definition of done

A feature is complete only when its code change is within scope, all applicable verification layers pass, its evidence is recorded, the evaluator score meets the feature threshold, the quality document and progress log are current, and the clean-state checklist plus handoff are complete.

## 10. Explicit exclusions

- Building an AI router or competing routing layer.
- Reverse engineering Cline or ClinePass internal protocols.
- Marking features passing from manual assertion without command evidence.
- Maintaining divergent rules in `AGENTS.md` and `CLAUDE.md`.
- Introducing POSIX-only bootstrap logic as the canonical workflow.

## 11. Reference

This design adapts the Production Harness concepts and templates from [Learn Harness Engineering — Template Guide](https://walkinglabs.github.io/learn-harness-engineering/en/resources/templates/), particularly the instruction, feature-state, progress, handoff, clean-exit, evaluator, and quality-document components.
