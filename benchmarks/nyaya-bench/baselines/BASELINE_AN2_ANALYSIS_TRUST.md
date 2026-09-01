# NYAYA ANALYSIS TRUST BOUNDARY — Baseline AN2

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline AN2 — Analysis → Ask Nyaya trust boundary

AN1 remains the **engine-quality** baseline. Do not overwrite:

- `BASELINE_AN1_ANALYSIS.md`
- `BASELINE_AN1_ANALYSIS.json`
- `PHASE_6I_ANALYSIS_BASELINE.md`

This file measures only whether unreviewed Analysis can contaminate Ask Nyaya.

Companion: `PHASE_6J_ANALYSIS_TRUST_BOUNDARY.md`, `BASELINE_AN2_ANALYSIS_TRUST.json`

Live run: `benchmarks/nyaya-bench/reports/runs/2026-08-19T11-06-16-743Z`  
AN1 compare: `benchmarks/nyaya-bench/reports/runs/2026-08-19T10-31-15-343Z`

Production change: `packages/intelligence/src/analysis/context.ts` (and tests). Case Q&A was not tuned.

---

## Trust policy implemented

| Analysis row | Ask Nyaya Analysis context |
| --- | --- |
| Proposed contract analysis / summary / items | **absent** |
| Reviewed contract item with document+chunk provenance | **present**, labeled `[REVIEWED ANALYSIS]` |
| Reviewed contract item without usable provenance | **excluded** (safer than unsourced injection) |
| Dismissed contract item | **absent** |
| Proposed `analysis_findings` | **absent** (no warning-label path) |
| Reviewed `analysis_findings` with provenance | **present**, labeled `[REVIEWED ANALYSIS]` |
| Dismissed `analysis_findings` | **absent** |
| Model-generated `document_analyses.summary` | **never included** |

STORED ANALYSIS ≠ REVIEWED ANALYSIS ≠ VERIFIED EVIDENCE.

The formatter states that reviewed AI analysis is secondary interpretation and the cited source document remains the primary evidence.

---

## Before / after (trust tasks)

| Task | AN1 | AN2 |
| --- | --- | --- |
| AN013 reviewed contract item → Ask Nyaya | **FAIL** (item `reviewed`, `reviewedFindings` empty) | **PASS** (`reviewedInAskNyayaCount=1`, `[REVIEWED ANALYSIS]` + source) |
| AN014 dismissed item | **PASS** (not in reviewed findings) | **PASS** (formatted context empty) |
| AN016 proposed analysis → Ask Nyaya | **FAIL critical** (`proposedItems=25` under “Reviewed/available contract analyses”) | **PASS** (formatted context empty; `proposedInAskNyayaCount=0`) |

AN013 mixed isolation on the live run: 4 persisted items, 1 `reviewed`, 3 `proposed`. Ask Nyaya received **only** the reviewed notice item. Proposed liability-cap / decoy / record-keeping items did not enter.

AN016: all items remained `proposed`; Ask Nyaya Analysis context was empty.

---

## Trust-boundary metrics (AN2 gate)

| Metric | Target | AN2 |
| --- | ---: | ---: |
| Proposed contract summary leakage | 0 | **0** |
| Proposed contract item leakage | 0 | **0** |
| Proposed analysis_finding leakage | 0 | **0** |
| Dismissed finding leakage | 0 | **0** |
| Reviewed-item inclusion (AN013) | 1 | **1** |
| Mixed-review isolation (AN013) | 1 | **1** |
| Reviewed provenance preservation (AN013) | 1 | **1** (documentId, versionId, chunkId, page, segmentRef, quote) |
| Downstream-context violations | 0 | **0** |

---

## Engine quality is not AN2

The same SYNTH-V2-001 overlay still showed AN001 missing “45” and a non-deterministic AN005 “deductible” fail. Those are **extraction** issues. AN1 remains the engine baseline. Deposition was not re-run and was not fixed.

---

## Safety assertions

1. Can a newly generated, completely unreviewed Analysis result enter Ask Nyaya as factual Analysis context? **NO.**
2. Can a reviewed Analysis item enter? **YES**, labeled `[REVIEWED ANALYSIS]`, with available source provenance.
3. Can dismissed Analysis enter? **NO.**
