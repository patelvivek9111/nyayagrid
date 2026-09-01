# NYAYA COMPARE BENCHMARK — Baseline B.2

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline B.2 — Compare Reliability (clause-level diffs + delta materiality)

B.1 remains the frozen unchanged-production baseline. This run is Compare only. Contradiction B.1 is unchanged.

---

## Configuration

| Field | Value |
| --- | --- |
| Targeted gate | `benchmarks/nyaya-bench/reports/runs/2026-08-18T22-10-20-943Z` (SYNTH-V2-001 T007–T009, 3/3 pass) |
| Official run | `benchmarks/nyaya-bench/reports/runs/2026-08-18T22-11-25-794Z` |
| Mode | `compare` |
| Dataset | V2 T007–T009, 16 scenarios = 48 tasks |
| Structured grader | `b1-2026-08-18` (unchanged) |
| Model | openai `gpt-4o-mini` |

---

## Compare B.1 → B.2

| Metric | B.1 | B.2 |
| --- | ---: | ---: |
| Pass | 0/48 | **48/48** |
| Needs work | 0 | 0 |
| Fail | 48 | **0** |
| Critical | 32 | **0** |
| Material-change recall | 0 | **1.0** |
| Material-change precision | 0 | **1.0** |
| Decoy false-positive rate | 100% | **0%** |
| Provenance failures | 0 | 0 |
| Wrong-pair failures | 0 | 0 |
| Summary disagreement | 0* | 0 |

\*B.1 summary disagreement was 0 because the grader trusted production `summaryAlignment` against page-sized blobs, not because summaries were accurate.

All 48 tasks: FAIL → PASS. No Compare pass regressions (B.1 had zero passes).

Do not overwrite `BASELINE_B1_*`.
