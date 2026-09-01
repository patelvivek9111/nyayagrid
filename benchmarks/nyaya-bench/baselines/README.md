# Nyaya Bench baselines

These are synthetic-fixture scores, **not** attorney review.

| Label                    | File                                                       | What it measures                                                          |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `BASELINE_A_RAW_CASE_QA` | `BASELINE_A_RAW_CASE_QA.md` / `.json`                      | Original 500-task run, original graders, Case Q&A only                    |
| Baseline A.1             | `BASELINE_A1_CORRECTED_CASE_QA.md` / `.json`               | Same 500 saved answers, corrected graders                                 |
| Baseline A.2             | `BASELINE_A2_EVIDENCE_BOUND_CASE_QA.md` / `.json`          | Live 500 with prompt-only evidence-bound Case Q&A (`nyaya-matter-qa-v9`)  |
| Baseline A.3             | `BASELINE_A3_STRUCTURED_EVIDENCE_CASE_QA.md` / `.json`     | Live 500 with structured evidence assessment (`nyaya-matter-qa-v10`)      |

| Baseline A.4             | `BASELINE_A4_OPERATIVE_FACT_CASE_QA.md` / `.json`         | Live 500 with operative-fact selection (`nyaya-matter-qa-v11`)            |
| Baseline B.1             | `BASELINE_B1_COMPARE_CONTRADICTION.md` / `.json`          | Unchanged production Compare + Contradiction, structured graders (V2 T007–T011) |
| Baseline B.2             | `BASELINE_B2_COMPARE.md` / `.json`                        | Clause-level Compare reliability (V2 T007–T009 only; Contradiction frozen) |

Phase 6A audit: `PHASE_6A_FULL_SYSTEM_RELIABILITY_AUDIT.md`.  
Phase 6B report: `PHASE_6B_COMPARE_CONTRADICTION_BASELINE.md`.

T014 “current” vs Amendment 1: see `ERRATUM_T014_CURRENT_NOTICE.md`. Hidden ground truth was **not** rewritten; A.1–A.4 must not be recalculated.

Phase 5B freeze review: `PHASE_5B_COMPLETION_REPORT.md`. A.5 was not run.

Do not overwrite `BASELINE_A_RAW_CASE_QA*`, `BASELINE_A1_*`, `BASELINE_A2_*`, `BASELINE_A3_*`, `BASELINE_A4_*`, `BASELINE_B1_*`, or the raw run directories under `reports/runs/`.

`eval:ai` / `eval:ai:live` is a separate prompt/canary harness and is not replaced by these baselines.
