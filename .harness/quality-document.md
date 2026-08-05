# Quality Document

This snapshot evaluates the repository itself, separately from the evaluator score for an individual feature.

| Domain                  | Current grade | Evidence status                                                                                                                                                                                                       | Next check              |
| ----------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| API compatibility       | Not assessed  | No API feature implemented                                                                                                                                                                                            | After `API-001`         |
| Stream correctness      | Not assessed  | No stream feature implemented                                                                                                                                                                                         | After `API-002`         |
| CLI boundary discipline | B             | Focused 67-test suite and all local repository/Harness gates pass, covering ACP-first fallback safety, typed terminal errors, bounded startup, process exits, framing, lifecycle, and callback-injected host behavior | Run cross-platform CI   |
| Portability             | C             | Node bootstrap helpers tested; full matrix pending                                                                                                                                                                    | After cross-platform CI |
| Security and redaction  | C             | Redaction policy documented; runtime coverage pending                                                                                                                                                                 | After `SAFE-001`        |
| Plugin isolation        | Not assessed  | Plugin SDK not implemented                                                                                                                                                                                            | After `PLUGIN-001`      |
| Test stability          | B             | Focused 67-test CLI suite and full 77-test repository suite pass locally; CI not run                                                                                                                                  | After first CI run      |

Grades are updated only from recorded verification evidence. No domain is marked healthy from documentation alone.
