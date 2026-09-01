# NYAYA CASE Q&A BENCHMARK — Baseline A.4

Synthetic-fixture evaluation only. This is **not** attorney review and does **not** prove legal correctness.

**Label:** Baseline A.4 — Operative Fact Stabilization (product change, same graders)

Compared with Baseline A.3 (structured evidence assessment, `nyaya-matter-qa-v10`). This run uses `nyaya-matter-qa-v11` plus deterministic operative-fact selection (source role, temporal applicability, completeness, conservative contradiction, abstention invariant). Graders, V1/V2 fixtures, and hidden ground truth were not modified. Baseline A.3 files were not overwritten.

---

## Configuration

| Field | Value |
| --- | --- |
| V1 run | `benchmarks/nyaya-bench/reports/runs/2026-08-18T18-56-43-265Z` |
| V2 run | `benchmarks/nyaya-bench/reports/runs/2026-08-18T19-01-22-384Z` |
| Targeted gate | `2026-08-18T18-49-53-835Z` (001), `18-51-39-987Z` (002), `18-53-05-934Z` (006), `18-54-19-433Z` (010) |
| Grader version | `a1-2026-08-18` (unchanged) |
| Model | openai `gpt-4o-mini-2024-07-18` |
| Embeddings | openai |
| Prompt | `nyaya-matter-qa-v11` |
| Assessment | Deterministic only. Production path still does not pass an LLM assessor. Extra generations: **0**. |
| Git | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` (working tree dirty: Phase 5A uncommitted) |

---

## Official grader counts

| Metric | Baseline A.3 | Baseline A.4 | Delta |
| --- | ---: | ---: | ---: |
| Pass | 376 | 391 | +15 |
| Needs Work | 68 | 64 | −4 |
| Fail | 56 | 45 | −11 |
| Infrastructure | 0 | 0 | 0 |
| Pass rate (500) | 75.2% | 78.2% | +3.0 pp |
| Critical fails | 3 | 1 | −2 |
| V1 pass | 83 | 83 | 0 |
| V2 pass | 293 | 308 | +15 |

Folded presentation (critical fails isolated; other fails counted as Needs Work):

| Metric | A.3 | A.4 | Delta |
| --- | ---: | ---: | ---: |
| Pass | 376 | 391 | +15 |
| Needs Work | 124 | 109 | −15 |
| Fail (critical) | 3 | 1 | −2 |

---

## Transition matrix (A.3 → A.4)

| Transition | N |
| --- | ---: |
| PASS → PASS | 355 |
| PASS → NEEDS WORK | 12 |
| PASS → FAIL | 9 |
| NEEDS WORK → PASS | 5 |
| NEEDS WORK → NEEDS WORK | 47 |
| NEEDS WORK → FAIL | 16 |
| FAIL → PASS | 31 |
| FAIL → NEEDS WORK | 5 |
| FAIL → FAIL | 20 |

PASS → FAIL fell from **25** (A.2→A.3) to **9** (A.3→A.4). The 16 NEEDS WORK → FAIL are all V2 T010 (genuine evidentiary tension): A.3 scored every T010 as needs-work (“identified tension”); A.4 scored all 16 as fail (“missed tension”).

### PASS → FAIL (9)

| Cluster | N |
| --- | ---: |
| T014 email vs signed term (needle) | 6 |
| T006 numeric completeness | 1 |
| T008 decoy-as-material | 1 |
| V1 needle miss (`SYNTH-003-Q006`) | 1 |

---

## Primary clusters

| Cluster | A.3 | A.4 |
| --- | --- | --- |
| T025 activity vs actor | 16/16 pass | **16/16 pass** |
| T020 false retroactivity | 0 critical (12 pass / 4 NW) | **0 critical** (11 pass / 5 NW) |
| T002 current notice | 6 pass / 10 fail | **16/16 pass** |
| T003 future notice | 15 pass / 1 fail | **16/16 pass** |
| T011 false contradiction | 8 pass / 7 fail | **16/16 pass** |
| T021 convenience termination | 9 pass / 7 fail | **16/16 pass** |
| T015 missing-exhibit abstention | 14 pass / 2 critical | **16/16 pass** |
| T013 supporting citations | 10 pass / 4 fail | 8 pass / 8 NW / **0 fail** |
| T014 email vs signed term | 11 pass / 5 fail | 6 pass / **10 fail** |
| T010 genuine tension | 0 pass / 16 NW | 0 pass / **16 fail** |
| T006 numeric completeness | 1 pass / 8 fail | 0 pass / 9 fail |
| V1 silence `SYNTH-010-Q008` | critical fail | **still critical fail** |

---

## Infrastructure

**0** on A.4. Citation-shape normalization from A.3 remains in place.

---

## Performance (official A.4 500)

| Metric | A.3 | A.4 |
| --- | ---: | ---: |
| Median e2e latency | 2788 ms | 2708 ms |
| P95 e2e latency | 5108 ms | 4713 ms |
| Extra model calls / Case Q&A | 0 | **0** |
| Assessment trigger rate | 36.6% | 34.8% (174/500) |
| Median assessment CPU | 0 ms | 0 ms |
| P95 assessment | 2 ms | 1 ms |

---

Do not treat 78.2% as a Harvey-level result. Operative-fact selection recovered current-term, future-term, termination, false-contradiction, and missing-exhibit abstention. It over-suppressed genuine T010 tension and did not stabilize T014 (undated “current” vs later in-force amendments).
