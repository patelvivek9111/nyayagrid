# NYAYA CASE Q&A BENCHMARK — Baseline A.3

Synthetic-fixture evaluation only. This is **not** attorney review and does **not** prove legal correctness.

**Label:** Baseline A.3 — Structured Evidence Reasoning (product change, same graders)

Compared with Baseline A.2 (prompt-only `nyaya-matter-qa-v9`). This run uses `nyaya-matter-qa-v10` plus a structured evidence-assessment layer between retrieval and final generation. Graders, V1/V2 fixtures, and hidden ground truth were not modified. Baseline A.2 files were not overwritten.

Do not use `benchmarks/nyaya-bench/reports/runs/2026-08-18T17-36-27-621Z` (80× OpenAI HTTP 429). That run is **not** A.3.

---

## Configuration

| Field | Value |
| --- | --- |
| V1 run | `benchmarks/nyaya-bench/reports/runs/2026-08-18T17-18-03-355Z` |
| V2 run | `benchmarks/nyaya-bench/reports/runs/2026-08-18T17-59-29-753Z` |
| Targeted gate | `benchmarks/nyaya-bench/reports/runs/2026-08-18T17-10-35-431Z` (SYNTH-V2-001) |
| Discarded V2 | `benchmarks/nyaya-bench/reports/runs/2026-08-18T17-36-27-621Z` (rate-limited; not scored) |
| Grader version | `a1-2026-08-18` (unchanged) |
| Model | openai `gpt-4o-mini-2024-07-18` |
| Embeddings | openai |
| Prompt | `nyaya-matter-qa-v10` |
| Assessment | Deterministic structured assessment in production (`ai` is not passed). V1 A.3 still attempted an LLM assessor on 9 high-risk questions (parse failed → v9-style fallback). V2 A.3 is deterministic-only. |
| Git | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` (working tree dirty: Phase 4 assessment layer uncommitted) |

---

## Official grader counts

| Metric | Baseline A.2 | Baseline A.3 | Delta |
| --- | ---: | ---: | ---: |
| Pass | 351 | 376 | +25 |
| Needs Work | 68 | 68 | 0 |
| Fail | 77 | 56 | −21 |
| Infrastructure | 4 | 0 | −4 |
| Pass rate (500) | 70.2% | 75.2% | +5.0 pp |
| Critical fails | 28 | 3 | −25 |
| V1 pass | 84 | 83 | −1 |
| V2 pass | 267 | 293 | +26 |

Folded presentation (critical fails isolated; other fails + infra counted as Needs Work):

| Metric | A.2 | A.3 | Delta |
| --- | ---: | ---: | ---: |
| Pass | 351 | 376 | +25 |
| Needs Work | 121 | 124 | +3 |
| Fail (critical) | 28 | 3 | −25 |

---

## Transition matrix (A.2 → A.3)

| Transition | N |
| --- | ---: |
| PASS → PASS | 324 |
| PASS → NEEDS WORK | 2 |
| PASS → FAIL | 25 |
| PASS → INFRA | 0 |
| NEEDS WORK → PASS | 5 |
| NEEDS WORK → NEEDS WORK | 60 |
| NEEDS WORK → FAIL | 3 |
| NEEDS WORK → INFRA | 0 |
| FAIL → PASS | 44 |
| FAIL → NEEDS WORK | 5 |
| FAIL → FAIL | 28 |
| FAIL → INFRA | 0 |
| INFRA → PASS | 3 |
| INFRA → NEEDS WORK | 1 |
| INFRA → FAIL | 0 |
| INFRA → INFRA | 0 |

Net pass +25 hides churn: 44 former fails recovered, **25 former passes newly failed**.

### PASS → FAIL (25)

| Cluster | N | IDs |
| --- | ---: | --- |
| T002 current notice needles | 5 | `002/004/005/006/007-T002` |
| T021 termination needles | 5 | `002/004/006/007/011-T021` |
| T011 false contradiction | 4 | `001/013/014/016-T011` |
| T014 email vs signed term | 3 | `002/006/014-T014` |
| T013 missing citation | 2 | `002/010-T013` |
| T015 expected abstention | 2 | `006/010-T015` |
| V1 needle miss | 2 | `SYNTH-001-Q002`, `SYNTH-007-Q004` |
| T012 / T006 | 2 | `010-T012`, `014-T006` |

### PASS → NEEDS WORK (2)

- `SYNTH-V2-002-T011` — did not clearly reject a false contradiction
- `SYNTH-V2-009-T013` — missing required supporting citation

---

## Critical clusters

### Badge / activity vs actor (V2 T025)

A.2: **3 pass / 13 critical fail**.

A.3: **16 pass / 0 fail**. All 16 preserved the badge/system-activity vs physical-entry distinction.

### Retroactivity false premise (V2 T020)

A.2: **1 pass / 14 critical fail / 1 infra**.

A.3: **12 pass / 4 needs work / 0 fail / 0 critical**.

The 4 needs-work cases challenged the premise but graders scored corrective facts as thin. None accepted the false retroactivity premise.

### V1 silence-as-proof

- `SYNTH-008-Q008`: pass → pass
- `SYNTH-010-Q008`: fail → fail (still critical: treated silence / original figure as proof)

---

## Current-term / future-term / controlling-source

| Task | A.2 | A.3 | Note |
| --- | --- | --- | --- |
| T002 current notice | 6 pass / 10 fail | **6 pass / 10 fail** | Count unchanged; 5 recovered and 5 former passes newly missed needles. Isolated gate `001-T002` passed; full V2 `001-T002` failed (variance + source-role vs duration). |
| T003 future notice | 11 pass / 5 fail | **15 pass / 1 fail** | Recovered. Remaining fail: `SYNTH-V2-001-T003` (0/2 needles). Isolated gate `001-T003` passed. |
| T014 email vs signed term | 8 pass / 8 fail | **11 pass / 5 fail** | Improved. Isolated gate `001-T014` failed; full V2 `001-T014` passed. |

---

## Infrastructure (A.3)

**0** citation-shape or embedding infrastructure failures on the official A.3 runs.

A.2 infra (`sources[0]` string-shaped / missing `documentId`, plus one embeddings HTTP 500) did not recur. Canonical source shape is `{ chunkId?, documentId, documentVersionId, page?, paragraph?, quote }`, normalized in `normalizeCitedSources` before Zod.

---

## Performance (official A.3 500)

| Metric | A.2 | A.3 |
| --- | ---: | ---: |
| Median end-to-end latency | 3184 ms | 2788 ms |
| P95 end-to-end latency | 6810 ms | 5108 ms |
| Extra model calls / Case Q&A (production path) | 0 | **0** |
| Structured-assessment trigger rate | n/a | 183/500 = **36.6%** |
| Median assessment CPU | n/a | 0 ms |
| P95 assessment | n/a | 2 ms combined (V2 p95 1 ms; V1 p95 2139 ms from 9 failed LLM assessor attempts) |

Production `askNyayaAboutMatter` does not pass an AI client into the assessor. Expected incremental cost is the assessment paragraph in the user prompt on ~37% of questions, not a second generation.

---

Do not treat 75.2% as a Harvey-level result. Structured assessment materially reduced evidence overclaim and false-premise acceptance and cleared citation-shape infra. It did not fix current-term needle reliability (T002), and it introduced false-contradiction and termination-needle regressions that keep the architecture from being an unqualified success on answerability.
