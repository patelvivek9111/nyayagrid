# NYAYA ANALYSIS BENCHMARK — Baseline AN1

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline AN1 — unchanged production Analysis

Case Q&A, Compare B.2, Contradiction B.2, Timeline T2, and Memory M2 remain frozen. Production Analysis, Graph, Draft, Research, and Agents were **not** modified. `executionTarget=analysis` was **not** rerouted.

Companion files: `PHASE_6I_ANALYSIS_BASELINE.md`, `BASELINE_AN1_ANALYSIS.json`

Live persist / official grades: `benchmarks/nyaya-bench/reports/runs/2026-08-19T10-31-15-343Z`

---

## Configuration

| Field | Value |
| --- | --- |
| Mode | `analysis` (`npm run bench -- v2 run analysis`) |
| Dataset | V2 overlay, 2 ingested matters, **14 analysis tasks** |
| Structured grader | `an1-2026-08-19` |
| Model | openai `gpt-4o-mini` |
| Production APIs | `analyzeContract`, `getContractAnalysis`, `reviewAnalysisItem`, `analyzeDeposition`, `listFindings`, `getEvidenceIntelligence`, `loadProfessionalAnalysisContext`, `formatProfessionalAnalysisForPrompt` |
| Git commit at persist | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` |

Overlay catalog: `datasets/v2/analysis/catalog.json`. Hidden GT: `datasets/v2/hidden_ground_truth/analysis/`. Production never sees GT.

---

## Pipeline (actual)

```text
V2 synthetic PDFs (SYNTH-V2-001, SYNTH-V2-006)
↓
ingest (no Timeline/Memory extract)
↓
production Analysis action (contract / deposition / review / duplicate / evidence matrix / formatter)
↓
persist document_analyses / document_analysis_items / analysis_runs / analysis_findings
↓
adapt → canonical Analysis artifact
↓
write answer JSON
↓
THEN load hidden Analysis GT
↓
structured Analysis grade (not Case Q&A)
```

---

## Headline

| Metric | AN1 |
| --- | ---: |
| Scenarios | 2 |
| Analysis tasks | 14 |
| Pass | **8/14** |
| Needs work | **0/14** |
| Fail | **4/14** |
| Infrastructure | **2/14** |
| Critical (tally, excl. infra) | **2** |
| Critical (`criticalFailure` flag) | **1** (AN016) |

### CONTRACT ANALYSIS

| Metric | AN1 |
| --- | ---: |
| Material recall (AN001–AN003) | **0.667** |
| Material precision (AN001–AN003) | **0.667** |
| Numeric accuracy (AN003) | **1** |
| Operative-source accuracy (AN002) | **1** |
| Decoy/informal false-positive rate (AN005+AN006 fails) | **0** |

### DEPOSITION ANALYSIS

| Metric | AN1 |
| --- | ---: |
| Admission/denial accuracy (AN007) | **n/a** (schema parse infrastructure) |
| Actor accuracy (AN008) | **0** (zero findings persisted) |
| Tension/conflict accuracy | **n/a** (not an Analysis extractor; Contradiction frozen) |
| Unsupported-conclusion rate | **n/a** (AN010 infrastructure) |

### EVIDENCE MATRIX

| Metric | AN1 |
| --- | ---: |
| Proposition coverage (empty-view abstention) | **1** |
| Evidence-role accuracy | **n/a** (no verified facts/events on this ingest) |
| Cross-document accuracy | **n/a** |

### GLOBAL

| Metric | AN1 |
| --- | ---: |
| Provenance *presence* | **1.0** of scored tasks with `requireSourceChunks` |
| Unsupported-finding rate | **0.083** |
| Review-status accuracy | **0.917** |
| Downstream-context violations | **1** |
| Duplicate/noise rate (AN015 skip) | **0** (second run skipped) |

Provenance presence is not provenance *correctness*. MSA items all cited the same page-1 chunk (Parties and Purpose) even for Notice/Payment/Liability.

---

## Per-task results

| Task | Action | Verdict | Taxonomy / note |
| --- | --- | --- | --- |
| SYNTH-V2-001-AN001 | analyze MSA | **FAIL** | finding extraction — Notice item exists but omits **45** days; 11 items, all one chunk |
| SYNTH-V2-001-AN002 | analyze Amendment 1 | **PASS** | operative 30-day notice found |
| SYNTH-V2-001-AN003 | analyze Amendment 1 numeric | **PASS** | 30 and $510,000 present |
| SYNTH-V2-001-AN005 | MSA missing exhibit | **PASS** | did not invent Exhibit Z / deductible |
| SYNTH-V2-001-AN006 | email as contract | **PASS** | did not call email the controlling amendment; still extracted 10 email “clauses” |
| SYNTH-V2-001-AN011 | Amendment 1 provenance | **PASS** | chunks present (span quality not graded) |
| SYNTH-V2-001-AN013 | review → `reviewed` | **FAIL** | review lifecycle — item status `reviewed`, but Ask Nyaya `reviewedFindings` stays empty (contract items are not `analysis_findings`) |
| SYNTH-V2-001-AN014 | dismiss item | **PASS** | dismissed item did not appear in reviewed Ask Nyaya findings |
| SYNTH-V2-001-AN015 | duplicate without force | **PASS** | second call `skipped: true` |
| SYNTH-V2-001-AN016 | Ask Nyaya formatter | **FAIL critical** | downstream trust — `Reviewed/available contract analyses` with `proposedItems=25` and unlabeled summary text |
| SYNTH-V2-006-AN007 | deposition admissions | **INFRA** | Zod: `confidence` number, `attention` `"High"`/`"Medium"` |
| SYNTH-V2-006-AN008 | actor inference trap | **FAIL** | 0 findings persisted; trap not exercised |
| SYNTH-V2-006-AN010 | unsupported entry | **INFRA** | same deposition schema parse failure |
| SYNTH-V2-006-AN012 | evidence matrix view | **PASS** | 0 issues without verified Timeline/Facts extract |

Skipped vs proposed numbering: **AN004** (decoy) is Compare-owned; **AN009** (tension) is Contradiction-owned. Not scored as Analysis.

---

## executionTarget=analysis

**Does not execute Analysis. Does not execute `generateDraft`.**

`executeSubsystemTarget` throws:

> `executionTarget=analysis is not a single production engine. Use compare, contradiction, contract-analysis, or deposition-analysis.`

Overlay uses `professional_analysis` → `analyzeContract` / `analyzeDeposition` / `getEvidenceIntelligence`. The generic `analysis` throw is retained.

---

## Ask Nyaya proposed injection

**Yes.** After contract analysis, `formatProfessionalAnalysisForPrompt` injects:

```text
Reviewed/available contract analyses:
- analysisId=… documentId=… status=proposed reviewedItems=0 proposedItems=N summary=<model summary>
```

Individual contract items do **not** appear as `[PROPOSED/UNREVIEWED]` rows (`proposedFindings` is loaded from `analysis_findings`, not `document_analysis_items`). The summary text is unlabeled factual context. Classification: **unsafe factual contamination**, not merely informational uncertainty.

Deposition `[PROPOSED/UNREVIEWED]` rows were not observed on this run because deposition persistence failed.

Draft does **not** load this context. Agents receive the full `analyzeContract` / `analyzeDeposition` tool payload.
