# NYAYA CONTRACT ANALYSIS — Baseline CA1

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline CA1 — Contract Analysis after Phase 6L reliability work

Maps to the AN1 contract subset (`SYNTH-V2-001-AN001`, `AN002`, `AN005`, `AN006`, plus 6J `AN013`/`AN016` as regression). AN1 / DA1 are **not** overwritten or combined.

Do not overwrite:

- `BASELINE_AN1_ANALYSIS.md` / `.json`
- `PHASE_6I_ANALYSIS_BASELINE.md`
- `BASELINE_AN2_ANALYSIS_TRUST.md` / `.json`
- `PHASE_6J_ANALYSIS_TRUST_BOUNDARY.md`
- `BASELINE_DA1_DEPOSITION_ANALYSIS.md` / `.json`
- `PHASE_6K_DEPOSITION_ANALYSIS_RELIABILITY.md`

Companion: `PHASE_6L_CONTRACT_ANALYSIS_RELIABILITY.md`, `BASELINE_CA1_CONTRACT_ANALYSIS.json`

Live persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T13-23-03-813Z`

---

## Configuration

| Field | Value |
| --- | --- |
| Mode | `contract` (`npm run bench -- v2 run contract`) |
| Dataset | V2 overlay, SYNTH-V2-001, **18 contract tasks** |
| Structured grader | `ca1-2026-08-19` |
| Model | openai `gpt-4o-mini` |
| Production API | `analyzeContract` → `getContractAnalysis` → 6J Ask Nyaya context (read-only) |
| Prompt version | `contract-analysis-v2` |
| Git commit recorded on run | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` (6L files were uncommitted at persist) |

Overlay: `datasets/v2/contract/catalog.json`. Hidden GT: `datasets/v2/hidden_ground_truth/contract/`. Production never sees GT.

---

## Score (Contract Analysis only)

| | |
| --- | --- |
| Pass | 17 / 18 |
| Fail | 1 (CA012 supporting-span header check, major, not critical) |
| Infrastructure | 0 |
| Critical | 0 |
| Material recall | 1.00 |
| Material precision | 1.00 |
| Numeric accuracy | 1.00 |
| Operative-source accuracy | 1.00 |
| Amendment accuracy | 1.00 |
| Missing-evidence accuracy | 1.00 |
| Decoy FP rate | 0.00 |
| Provenance accuracy | 1.00 |
| Supporting-span accuracy (quote phrases) | 1.00 |
| Negation accuracy | 1.00 |
| Duplicate/noise rate | 0.00 |
| Summary alignment | 1.00 |
| Proposed-status accuracy | 1.00 |
| Proposed findings in Ask Nyaya | 0 |

Deposition Analysis is not included.

---

## AN1 → CA1

| AN1 | CA1 |
| --- | --- |
| AN001 MSA 45-day miss | **CA001 pass** — 45 days in title/explanation and Notice clause span |
| AN002 Amendment 1 operative notice | **CA002 pass** — 30 days |
| AN005 missing exhibit | **CA008 pass** — Exhibit Z contents not invented |
| AN006 informal email | **CA009 pass** — email not treated as controlling |
| AN013 / AN016 6J | **CA017 / CA018 pass** — proposed leakage 0; dismissed excluded (regression only) |

---

## Freeze

**FREEZE CONTRACT ANALYSIS** for controlled beta review.

Known remaining gap: CA012. Clause-scoped spans work for Notice/Liability/Payment. A legitimate Parties finding still contains the heading “Parties and Purpose”, which this overlay flagged as a header span. Not score-chased.

Compare B.2, Deposition DA1, and 6J remain separately frozen.
