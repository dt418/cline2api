# Evaluator Rubric

Score each completed feature from 0 to 2 in every dimension.

| Dimension         | 0                                  | 1                                           | 2                                                    |
| ----------------- | ---------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Correctness       | Behavior is missing or wrong       | Main path works with a documented gap       | Acceptance behavior and edge cases pass              |
| Verification      | No command evidence                | Some checks pass but coverage is incomplete | All declared checks pass with evidence               |
| Scope discipline  | Unrelated or unsafe changes        | Minor scope drift is documented             | Only the selected feature changed                    |
| Reliability       | Fails on rerun or restart          | Works with a known limitation               | Survives rerun/restart on supported platforms        |
| Maintainability   | Boundaries or docs are unclear     | Usable with follow-up cleanup needed        | Interfaces and docs are clear                        |
| Handoff readiness | Next session must rediscover state | State exists but has gaps                   | A new session can continue from repository artifacts |

Feature acceptance requires 2/2 for Correctness, Verification, Scope discipline, and Reliability; at least 1/2 for Maintainability and Handoff readiness; and a total of at least 10/12. A milestone requires 12/12 and no unresolved blocker.

After each milestone, compare this score with human review. If the scores diverge, make the acceptance wording more specific and record the tuning change before the next evaluation.
