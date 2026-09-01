# BASELINE AG2 — Agents (after orchestration-only fixes)

**Run:** `benchmarks/nyaya-bench/reports/runs/2026-08-19T16-50-16-380Z`  
**Machine JSON:** `benchmarks/nyaya-bench/baselines/BASELINE_AG2_AGENTS.json`  
**Grader:** `ag1-2026-08-19` (same overlay/grader as AG1)

## Production changes (agent layer only)

1. Intent: `chronolog(?:y|ical|ies)?` so chronology requests route to `timeline_analysis`.
2. Intent: strip negated work requests (`do not draft`, `do not research`) before domain matching.
3. Evidence agent: if the goal names an exhibit that is not in retrieved quotes, record a missing-evidence limitation. No Exhibit-Z-specific rule.

Frozen tools, V1/V2 PDFs, hidden GT IDs, Research R1 production path, and `FEATURE_AGENTS` production default were **not** changed.

## Overall

| Metric | AG1 | AG2 |
| --- | --- | --- |
| Tasks | 24 | 24 |
| Pass | 21 | **24** |
| Needs work | 2 | **0** |
| Fail | 1 | **0** |
| Infrastructure | 0 | 0 |
| Critical | 0 | 0 |

## Transitions

| Task | AG1 | AG2 |
| --- | --- | --- |
| AG002 | FAIL | PASS |
| AG004 | NEEDS WORK | PASS |
| AG007 | NEEDS WORK | PASS |
| All other 21 | PASS | PASS |

No regressions.

`FEATURE_AGENTS` stays **globally off** in production. See `PHASE_6Q_AGENT_RELIABILITY.md`.
