# NYAYA CASE Q&A BENCHMARK — Baseline A.2

Synthetic-fixture evaluation only. This is **not** attorney review and does **not** prove legal correctness.

**Label:** Baseline A.2 — Evidence-bound Case Q&A (product change, same graders)

Compared with Baseline A.1 (corrected graders, `nyaya-matter-qa-v8` saved answers). This run uses `nyaya-matter-qa-v9` and live OpenAI Case Q&A. Graders and hidden ground truth were not modified.

---

## Configuration

| Field | Value |
| --- | --- |
| V1 run | `benchmarks/nyaya-bench/reports/runs/2026-08-18T11-35-07-966Z` |
| V2 run | `benchmarks/nyaya-bench/reports/runs/2026-08-18T11-40-00-604Z` |
| Sample | `benchmarks/nyaya-bench/reports/runs/2026-08-18T11-31-59-471Z` (SYNTH-V2-001) |
| Graph smoke | `benchmarks/nyaya-bench/reports/runs/smoke-subsystems-2026-08-18T11-31-00-951Z` |
| Grader version | `a1-2026-08-18` (unchanged) |
| Model | openai `gpt-4o-mini-2024-07-18` |
| Embeddings | openai |
| Prompt | `nyaya-matter-qa-v9` |
| Git | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` (working tree dirty: v9 + graph contract) |

---

## Official grader counts

| Metric | Baseline A.1 | Baseline A.2 | Delta |
| --- | ---: | ---: | ---: |
| Pass | 350 | 351 | +1 |
| Needs Work | 66 | 68 | +2 |
| Fail | 79 | 77 | −2 |
| Infrastructure | 5 | 4 | −1 |
| Pass rate (500) | 70.0% | 70.2% | +0.2 pp |
| Critical fails | 32 | 28 | −4 |
| V1 pass | 81 | 84 | +3 |
| V2 pass | 269 | 267 | −2 |

Folded presentation used in the Phase 3 brief (critical fails isolated; other fails + infra counted as Needs Work):

| Metric | A.1 | A.2 | Delta |
| --- | ---: | ---: | ---: |
| Pass | 350 | 351 | +1 |
| Needs Work | 118 | 121 | +3 |
| Fail (critical) | 32 | 28 | −4 |

---

## Transition matrix (A.1 → A.2)

| Transition | N |
| --- | ---: |
| PASS → PASS | 317 |
| PASS → NEEDS WORK | 6 |
| PASS → FAIL | 25 |
| PASS → INFRA | 2 |
| NEEDS WORK → PASS | 3 |
| NEEDS WORK → NEEDS WORK | 62 |
| NEEDS WORK → FAIL | 0 |
| NEEDS WORK → INFRA | 1 |
| FAIL → PASS | 27 |
| FAIL → NEEDS WORK | 0 |
| FAIL → FAIL | 51 |
| FAIL → INFRA | 1 |
| INFRA → PASS | 4 |
| INFRA → FAIL | 1 |
| INFRA → INFRA | 0 |

Net pass +1 hides churn: 27 former fails recovered, 25 former passes newly failed.

---

## Critical clusters

### Badge / evidence limitation (V2 T025)

A.1: **0 pass / 16 critical fail** (15 physical-entry overclaim + 1 determination without limitation).

A.2: **3 pass / 13 critical fail**.

- Pass: `SYNTH-V2-009-T025`, `SYNTH-V2-014-T025`, `SYNTH-V2-015-T025`
- Still overclaim physical entry: 7
- Still assert a determination without the limitation: 6

### Retroactivity false premise (V2 T020)

A.1: **1 pass / 14 critical fail / 1 infra** (`SYNTH-V2-012-T020` passed).

A.2: **1 pass / 14 critical fail / 1 infra** (`SYNTH-V2-010-T020` passed; `SYNTH-V2-012-T020` regressed).

No systematic improvement.

### V1 silence-as-proof

- `SYNTH-008-Q008`: fail → **pass**
- `SYNTH-010-Q008`: fail → fail (still critical)

---

## Over-refusal / current-term regressions

V2 T002 (current notice while Amendment 2 is not yet effective): A.1 **8 pass / 7 fail / 1 infra** → A.2 **6 pass / 10 fail**.

Several former passes on future-effective notice (T003) and email-vs-signed-term (T014) now return generic `insufficient` despite retrieved chunks.

False-contradiction (T011) improved: 9 → 13 pass, 5 → 2 fail.

---

## Infrastructure (A.2)

- `SYNTH-V2-002-T006` — OpenAI embeddings HTTP 500
- `SYNTH-V2-002-T020` — citation schema (`documentId` / `documentVersionId` missing)
- `SYNTH-V2-004-T015`, `SYNTH-V2-011-T015` — citation schema (`sources[0]` was a string)

Not counted as AI pass/fail.

---

## Graph smoke (separate)

`SMOKE_OK` for target `graph`. Extract no longer throws. With no verified (approved) nodes, the extractor skips the LLM (`skipped: "no_verified_nodes"`) instead of emitting non-UUID IDs and numeric confidence.

---

Do not treat 70.2% as a Harvey-level result. The general prompt change recovered some evidence-limitation and silence cases and improved false-contradiction handling, but did not fix retroactivity invention and increased some false refusals.
