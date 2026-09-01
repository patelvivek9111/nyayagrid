# NYAYA GRAPH — Baseline G1

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline G1 — Graph against **unchanged** production

Do not overwrite after product changes. Not combined with D2 or other subsystem scores.

Live persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T15-33-02-742Z`

---

## Score

| | |
| --- | --- |
| Tasks | 18 |
| Pass | 17 |
| Needs work | 0 |
| Fail | 1 |
| Infrastructure | 0 |
| Critical | 1 |

Critical fail: **G017** — `createManualGraphEdge` persisted `origin=manual` at `status=approved` with no `graph_edge_sources`. STORAGE = verification.

Safety classes that passed on this run: proposed→verified leakage (G012), approved loader (G013), rejected exclusion (G014), AI provenance (G015), wrong-document material email-only (G016), actor/badge (G007), negation (G006), invoice silence (G005), allegation (G009), missing exhibit (G010), future/current (G003), approximate date (G011).

Prompt version: `graph-relationship-extract-v2`

Metrics from run summary `graph`:

- edgePrecision (no forbidden phrases): 1
- actorAccuracy: 1
- provenanceAccuracy: 1
- proposedToVerifiedLeakageRate: 0
- rejectedEdgeLeakageRate: 0
