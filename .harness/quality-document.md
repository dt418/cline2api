# Quality Document

This snapshot evaluates the repository itself, separately from the evaluator score for an individual feature.

| Domain                  | Current grade | Evidence status                                                      | Next check              |
| ----------------------- | ------------- | -------------------------------------------------------------------- | ----------------------- |
| API compatibility       | Not assessed  | No API feature implemented                                           | After `API-001`         |
| Stream correctness      | Not assessed  | No stream feature implemented                                        | After `API-002`         |
| CLI boundary discipline | Not assessed  | Official CLI driver not implemented                                  | After `CLI-001`         |
| Portability             | C             | Node bootstrap helpers tested; full matrix pending                   | After cross-platform CI |
| Security and redaction  | C             | Redaction policy documented; runtime coverage pending                | After `SAFE-001`        |
| Plugin isolation        | Not assessed  | Plugin SDK not implemented                                           | After `PLUGIN-001`      |
| Test stability          | B             | Core, validator, and bootstrap helper tests pass locally; CI not run | After first CI run      |

Grades are updated only from recorded verification evidence. No domain is marked healthy from documentation alone.
