# NYAYA CONTRADICTION BENCHMARK — Baseline B.2

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline B.2 — Contradiction Reliability (`detectContradictionCandidates`)

This is the Contradiction-engine baseline. It is **not** Compare B.2 (`BASELINE_B2_COMPARE`). Contradiction B.1 remains frozen in `BASELINE_B1_COMPARE_CONTRADICTION.*`. Compare was not rerun.

Case Q&A remains frozen (`nyaya-matter-qa-v11`). V1/V2 PDFs and hidden ground truth were not modified.

---

## Configuration

| Field | Value |
| --- | --- |
| Targeted gate | `benchmarks/nyaya-bench/reports/runs/2026-08-19T00-29-04-692Z` (SYNTH-V2-001), `2026-08-19T00-29-39-493Z` (SYNTH-V2-006, prior critical actor-overclaim), `2026-08-19T00-30-50-039Z` (SYNTH-V2-012, Nov 5 date-compat) — 6/6 pass |
| Official run | `benchmarks/nyaya-bench/reports/runs/2026-08-19T00-32-27-509Z` |
| Mode | `contradictions` |
| Dataset | V2 T010–T011, 16 scenarios = 32 tasks |
| Structured grader | `b1-2026-08-18` (unchanged) |
| Model | openai `gpt-4o-mini` |
| Prompt | `contradiction-analysis-v3` |
| Production engine | `detectContradictionCandidates` + `contradiction-semantics` |

---

## Pipeline (actual)

```text
matter chunks (cap 500)
↓
per-document stratified selection (48 for the model)
↓
LLM contradiction/tension proposal
↓
deterministic pair finder (all loaded chunks) + CAM date conflicts
↓
semantic refine: tension / contradiction / compatible / insufficient
↓
dual-sided source validation (actual chunk text)
↓
persist proposed findings with semantic findingType
```

T010 B.1 misses were not prompt failure first. They were **pair selection**: the 48-chunk window was contract-heavy; amendment notice terms dominated; the date-compatibility filter then dropped deposition/log pairs when the deposition chunk also contained “near the middle of November.”

---

## Contradiction B.1 → B.2

| Metric | B.1 | B.2 |
| --- | ---: | ---: |
| Pass | 16/32 | **32/32** |
| Needs work | 0 | 0 |
| Fail | 16 | **0** |
| Infrastructure | 0 | 0 |
| Critical | 1 | **0** |
| T010 tension accuracy | 0/16 | **16/16** |
| T011 compatible accuracy | 16/16 | **16/16** |
| Missed conflict/tension rate | 93.75% | **0%** |
| Actor overclaim | 1 | **0** |
| Provenance failures | 0 | 0 |
| Wrong/unrelated finding rate | 11/16 T010 (notice terms) | **1 extra finding / 16 T010** |
| Irrelevant contradiction rate | 11/16 T010 notice-period | **0 notice-period; 1 same-chunk invoice noise** |

All findings remained `proposed`. No T011 date-precision false hits. No actor-overclaim on the former critical case (SYNTH-V2-006-T010).

---

## Transition analysis

T010 (16 tasks, all FAIL in B.1):

| Transition | Count |
| --- | ---: |
| FAIL → PASS | **16** |
| FAIL → NEEDS WORK | 0 |
| FAIL → FAIL | 0 |

T011 (16 tasks, all PASS in B.1):

| Transition | Count |
| --- | ---: |
| PASS → PASS | **16** |
| PASS → NEEDS WORK | 0 |
| PASS → FAIL | 0 |

No T011 regressions.

---

## What changed in production

- Stratified candidate retrieval so testimony/log chunks are not dropped by contract ordering.
- Four semantic states: `contradiction`, `tension`, `compatible`, `insufficient`. Only the first two persist.
- Credential/system activity vs named-person physical action → `tension`, with a generic limitation in the explanation.
- Sequential amendment terms (notice/cap replaced later) → not contradiction.
- Approximate mid-month language vs an ISO date in that month → compatible (T011 gate).
- Persisted `findingType` is semantic (`tension` / `contradiction`), not merely cross-document vs same-document.

No SYNTH IDs, Mercer, badge numbers, or fixture filenames entered production logic.

---

## Analysis → Q&A trust boundary (not implemented)

`loadProfessionalAnalysisContext` still injects **proposed** findings into Ask Nyaya as `[PROPOSED/UNREVIEWED]` titles. Case Q&A was not modified.

Recommended later change (smallest safe default): only `reviewed` contradiction findings enter default Case Q&A context. Proposed findings can remain visible in the Analysis UI.

---

## Remaining risk

One T010 matter (SYNTH-V2-009) also persisted an LLM same-chunk invoice “contradiction” beside the correct tension pair. It did not fail the grader. A same-chunk reject was added after the official run; that filter is not part of the recorded 32/32 snapshot.

Proposed findings can still reach Ask Nyaya context if a user asks after contradiction detection.

---

## Beta decision

Safe enough for **controlled beta with human review**, because findings stay `proposed`, T011 compatibility held, actor/credential overclaim is gated, and the relevant T010 pair is recovered as tension.

Do not overwrite B.1. Do not start Timeline in this phase.

**Recommended next phase:** Timeline Reliability.
