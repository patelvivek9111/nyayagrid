# NYAYAGRID PHASE 6J — ANALYSIS → ASK NYAYA TRUST BOUNDARY

Synthetic-fixture evaluation only. This is **not** attorney review.

AN1 / Phase 6I is frozen. This phase changed **only** the Analysis context loader used by Ask Nyaya.

Production file: `packages/intelligence/src/analysis/context.ts`  
Tests: `packages/intelligence/src/analysis/context.test.ts`

Not modified: Case Q&A, Compare, Contradiction, Timeline, Memory, Draft, Graph, Research, Agents, deposition schema, contract extraction, `executionTarget=analysis`.

---

## 1. AN1 root cause

`loadProfessionalAnalysisContext` loaded proposed+reviewed `analysis_findings` and **all** `document_analyses` rows, then `formatProfessionalAnalysisForPrompt` emitted:

```text
Reviewed/available contract analyses:
- … status=proposed reviewedItems=0 proposedItems=25 summary=<model text>
```

Unreviewed model summaries entered Ask Nyaya as factual context.

---

## 2–6. Policy implemented

Ask Nyaya Analysis context is built only from **reviewed** rows:

- Reviewed `document_analysis_items` (not the parent `document_analyses.summary`)
- Reviewed `analysis_findings`

Proposed and dismissed rows are not loaded for this path.

**Contract summary rule:** the generated `document_analyses.summary` is never injected. One reviewed item cannot smuggle a 25-item summary. Mixed review → only reviewed items.

**Provenance (safer choice):** a reviewed row is excluded unless it has `documentId` **and** `chunkId`. Missing provenance is not filled with an arbitrary chunk. Documented: exclude unsourced reviewed Analysis rather than inject it.

Schemas stay separate. Contract items are **not** copied into `analysis_findings`.

---

## 7. Case Q&A frozen

`askNyayaAboutMatter` still calls `loadProfessionalAnalysisContext` / `formatProfessionalAnalysisForPrompt`. The filter happens **before** that context reaches the prompt. No change to nyaya-matter-qa, evidence assessment, retrieval, or guardrails.

---

## 8. Comparison / discovery residual risk

**Left unchanged.**

| Channel | Semantics | 6J action |
| --- | --- | --- |
| `document_comparisons.summary` | Compare B.2 AI summary; **no** Analysis `proposed/reviewed/dismissed` status | Residual: Compare summaries can still enter this loader. Not proposed Analysis items. Compare B.2 frozen. |
| `document_review_states` highlights | Discovery classification; human privilege final is authoritative; AI privilege is labeled proposal-only | Residual: not Analysis findings. Unchanged. |

These are not the AN1 “proposed Analysis becomes trusted” mechanism. Fixing them would broaden 6J into Compare/Discovery.

---

## 9–11. Out of scope (verified)

- **Agents:** still receive full `analyzeContract` / `analyzeDeposition` proposed payloads. Later Agent reliability dependency. Not fixed.
- **Draft:** still does not import Analysis context (`buildDraftVerifiedContext` uses verified intel, graph, approved Memory only). Unchanged.
- **Graph / Memory / Timeline:** Analysis still has no write path that launders findings into those tables.

---

## 12–14. Regression tests

`packages/intelligence/src/analysis/context.test.ts` covers A–L, adversarial propositions (Mercer entered, retroactivity, payment, $510k, service credit), mixed 25/1 isolation, provenance preservation, unsourced exclusion, and proposed → reviewed → dismissed lifecycle.

Nyaya-bench grader still fails if proposed context leaks; it now also has a pass fixture for empty Ask Nyaya Analysis context (AN016) and reviewed-item inclusion (AN013).

---

## 17–21. Targeted live gate

Run: `npm run bench -- v2 run analysis --scenario SYNTH-V2-001`  
Persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T11-06-16-743Z`

| | AN1 | AN2 |
| --- | --- | --- |
| AN013 | fail | **pass** |
| AN016 | fail critical (`proposedItems=25`) | **pass** (empty Analysis context) |
| Proposed leakage | yes | **0** |
| Downstream violations | 1 | **0** |

Unreviewed Analysis → Ask Nyaya through this loader is now **impossible**.

Engine tasks on the same overlay (AN001 miss of “45”, AN005 deductible mention, AN006 timeout) are **not** trust results. Do not read them as 6J extraction work.

Deposition was not re-run and was not fixed.

---

## 22. Critical safety assertion

- Can a newly generated, completely unreviewed Analysis result enter Ask Nyaya as factual Analysis context? **NO.**
- Can a reviewed Analysis item enter? **YES**, explicitly `[REVIEWED ANALYSIS]`, with available source provenance.
- Can dismissed Analysis enter? **NO.**

---

## 23–24. Explicitly not done

Deposition Zod (`confidence` number, `attention` `"High"`/`"Medium"`) and AN001 MSA 45-day / span quality were **not** fixed. Bad/unreviewed analysis can no longer contaminate Q&A through this loader; the proposed analysis itself is not yet more accurate.

---

## 25. Exactly one next phase

**Phase 6K — Deposition Analysis Reliability**

After 6J, Ask Nyaya no longer consumes unreviewed Analysis. The remaining largest **engine** failure class from AN1 is deposition: schema parse throws and runs can persist zero findings. Do not start 6K in this phase.

Agent proposed-payload access remains a later dependency, not 6K.

---

## STOP

Phase 6J is complete. AN1 engine baseline is preserved.
