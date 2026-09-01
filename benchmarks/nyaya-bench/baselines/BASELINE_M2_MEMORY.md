# NYAYA MEMORY BENCHMARK — Baseline M2

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline M2 — Memory Reliability after Phase 6H

M1 remains frozen (`BASELINE_M1_MEMORY.md` / `.json`). Case Q&A, Compare, Contradiction, Timeline T2, Graph, Draft, Research, Agents, V1/V2 PDFs, and hidden GT remain frozen. No V3.

---

## Configuration

| Field | Value |
| --- | --- |
| Official run | `benchmarks/nyaya-bench/reports/runs/2026-08-19T03-24-02-546Z` |
| Targeted gate | M002, M012, M017, M003 — **4/4 pass, 0 critical** |
| Mode | `memory` |
| Dataset | V2 overlay, 2 scenarios × 16 tasks |
| Structured grader | `m1-2026-08-19` plus documented disputedResolved erratum |
| Model | openai `gpt-4o-mini` (AI propose only) |
| Prompt | `matter-memory-propose-v2` |
| Extra model calls | **0** |

---

## Headline

| Metric | M1 | M2 |
| --- | ---: | ---: |
| Tasks | 16 | 16 |
| Pass | 9 | **13** |
| Needs work | 3 | **3** |
| Fail | 4 | **0** |
| Infrastructure | 0 | 0 |
| Critical | **4** | **0** |
| Proposition accuracy | 0.8125 | 0.8125 |
| Provenance accuracy | 0.9375 | **1.0** |
| Trust-status accuracy | 0.8125 | **1.0** |
| Unsupported-memory rate | 2.3125 | 0.6875 |
| Manual-memory upgrade rate | 0.1875 | **0** |
| Disputed-fact error rate | 0.0625 | **0** |
| Stale-memory rate | 0 | 0 |
| Downstream-context violations | 3 | **0** |

The three remaining needs_work tasks (M001, M007, M010) are empty AI propose / missing “30 days”. That is completeness, not a trust-boundary failure.

---

## Safety gates

| Gate | M1 | M2 |
| --- | ---: | ---: |
| Critical failures | 4 | **0** |
| Manual auto-upgrade | 3/16 | **0** |
| Downstream unreviewed violations | 3 | **0** |
| Fabricated provenance | 1 | **0** |
| Rejected leakage | 0 | **0** |
| Superseded leakage | 0 | **0** |
| AI/agent auto-approval | 0 | **0** |

---

## Transition matrix (M1 → M2)

| From → To | Count | Tasks |
| --- | ---: | --- |
| PASS → PASS | 9 | M004, M008, M009, M011, M013, M014, M015, M005, M006 |
| FAIL → PASS | 4 | M002, M012, M017, M003 |
| NEEDS_WORK → NEEDS_WORK | 3 | M001, M007, M010 |
| PASS → NEEDS_WORK / FAIL | **0** | none |
| NEEDS_WORK → PASS / FAIL | 0 | none |

No safety regressions. Lifecycle (supersede, reject, edit) still passes.
