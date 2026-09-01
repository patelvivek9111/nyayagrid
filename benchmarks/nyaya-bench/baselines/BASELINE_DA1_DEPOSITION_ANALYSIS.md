# NYAYA DEPOSITION ANALYSIS — Baseline DA1

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline DA1 — Deposition Analysis after Phase 6K reliability work

Maps to the AN1 deposition subset (`SYNTH-V2-006-AN007`, `AN008`, `AN010`). AN1 is **not** overwritten.

Do not overwrite:

- `BASELINE_AN1_ANALYSIS.md` / `.json`
- `PHASE_6I_ANALYSIS_BASELINE.md`
- `BASELINE_AN2_ANALYSIS_TRUST.md` / `.json`
- `PHASE_6J_ANALYSIS_TRUST_BOUNDARY.md`

Companion: `PHASE_6K_DEPOSITION_ANALYSIS_RELIABILITY.md`, `BASELINE_DA1_DEPOSITION_ANALYSIS.json`

Live persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T12-16-25-081Z`

---

## Configuration

| Field | Value |
| --- | --- |
| Mode | `deposition` (`npm run bench -- v2 run deposition`) |
| Dataset | V2 overlay, SYNTH-V2-006, **16 deposition tasks** |
| Structured grader | `da1-2026-08-19` |
| Model | openai `gpt-4o-mini` |
| Production API | `analyzeDeposition` → `listFindings` → 6J Ask Nyaya context (read-only) |
| Prompt version | `deposition-analysis-v2` |
| Git commit recorded on run | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` (6K bench/production files were uncommitted at persist) |

Overlay: `datasets/v2/deposition/catalog.json`. Hidden GT: `datasets/v2/hidden_ground_truth/deposition/`. Production never sees GT.

---

## Score (Deposition only)

| | |
| --- | --- |
| Pass | 15 / 16 |
| Fail | 1 (DA004 tension recall, major, not critical) |
| Infrastructure | 0 |
| Critical | 0 |
| Admission accuracy | 1.00 |
| Denial accuracy | 1.00 |
| Actor accuracy | 1.00 |
| Tension accuracy | 0.00 |
| Schema parse failure rate | 0 |
| Proposed-status accuracy | 1.00 |
| Proposed findings in Ask Nyaya | 0 |

Contract Analysis is not included.

---

## Freeze

**FREEZE DEPOSITION ANALYSIS** for controlled beta review.

Known remaining gap: DA004 did not persist badge-vs-denial evidentiary tension. Contradiction B.2 remains frozen and separate.

Contract Analysis is **not** frozen.
