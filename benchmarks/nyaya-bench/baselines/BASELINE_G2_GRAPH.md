# NYAYA GRAPH — Baseline G2

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline G2 — Graph after trust-lifecycle fixes (do not overwrite G1)

Live persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T15-43-10-288Z`

Production changes vs G1:
- `createManualGraphEdge` stores `proposed` (not auto-approved)
- `getGraphNeighborhood` defaults to approved / edited_and_approved only

## Score

| | |
| --- | --- |
| Tasks | 18 |
| Pass | 18 |
| Needs work | 0 |
| Fail | 0 |
| Infrastructure | 0 |
| Critical | 0 |

## G1 → G2

| Task | G1 | G2 |
| --- | --- | --- |
| G017 | FAIL (critical) | PASS |
| All other G001–G016, G018 | PASS | PASS |

Regressions: none.
