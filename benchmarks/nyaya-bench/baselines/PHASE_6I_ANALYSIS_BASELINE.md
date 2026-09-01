# NYAYAGRID PHASE 6I — ANALYSIS RELIABILITY BASELINE

Synthetic-fixture evaluation only. This is **not** attorney review.

Production Analysis was **not** tuned. Case Q&A, Compare B.2, Contradiction B.2, Timeline T2, Memory M2, Graph, Draft, Research, and Agents were **not** modified. No V3 dataset was created. `executionTarget=analysis` was **not** fixed.

Companion files: `BASELINE_AN1_ANALYSIS.md`, `BASELINE_AN1_ANALYSIS.json`

Live persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T10-31-15-343Z`

Command: `npm run bench -- v2 run analysis`

---

## 1. Production Analysis architecture (verified)

Analysis is **not one engine**. Implemented production workflows:

| Capability | Implemented? | Entrypoint | Persist |
| --- | --- | --- | --- |
| Contract analysis | **yes** | `analyzeContract` (`packages/intelligence/src/analysis/contract.ts`); HTTP `POST .../analysis/contracts` | `document_analyses`, `document_analysis_items`, `document_analysis_sources` |
| Redlines | **yes** (not scored) | `generateRedlineSuggestions` | `redline_suggestions` (`proposed` / `accepted` / `rejected`) |
| Deposition analysis | **yes** | `analyzeDeposition` (`packages/intelligence/src/analysis/deposition.ts`); HTTP deposition analysis | `analysis_runs` (`runType=deposition`), `analysis_findings`, `analysis_finding_sources` |
| Findings review | **yes** | `reviewAnalysisItem` (contract items); `reviewFinding` (run findings) | `reviewed` / `dismissed` |
| Document comparison | **yes, frozen** | `compareDocuments` | `document_comparisons` — **not scored as Analysis** |
| Contradiction | **yes, frozen** | `detectContradictionCandidates` | `analysis_runs` (`runType=contradiction`) — **not scored as Analysis** |
| Evidence matrix | **yes, as a view** | `getEvidenceIntelligence` (`packages/intelligence/src/evidence/index.ts`) | **no extractor writes**; reads verified Timeline/Facts/Graph + contradiction findings with status `proposed` or `reviewed` |
| Discovery tags / classification | **yes** | `document_review_states` | injected into Ask Nyaya as discovery highlights |
| Analysis summaries | **yes** | `document_analyses.summary`; run `summary` | also copied into Ask Nyaya contract-summary lines |
| Generic “Analysis” engine | **no** | — | — |

### Contract path

```text
user / agent analyzeContract(documentId, documentVersionId)
→ verify document in matter
→ load version chunks
→ model generate (schema contract_analysis)
→ drop items with zero authorized chunks
→ persist document_analyses (status=proposed) + items (status=proposed) + sources
→ reviewAnalysisItem → reviewed | dismissed
→ loadProfessionalAnalysisContext → contractSummaries (all analyses, item counts)
→ Ask Nyaya formatProfessionalAnalysisForPrompt
```

Exact functions: `analyzeContract`, `getContractAnalysis`, `listContractAnalyses`, `reviewAnalysisItem`, `loadAuthorizedChunks`.

### Deposition path

```text
user / agent analyzeDeposition(documentId, documentVersionId)
→ load transcript chunks
→ model generate (schema deposition_analysis)
→ Zod parse (throws if confidence/attention enums mismatch)
→ skip findings with no validated sources (rejectedNoSource)
→ persist analysis_runs + analysis_findings (status=proposed) + sources
→ reviewFinding → reviewed | dismissed
→ loadProfessionalAnalysisContext → proposedFindings + reviewedFindings
```

Exact functions: `analyzeDeposition`, `listFindings`, `reviewFinding`, `resolveValidatedSources`.

### Evidence matrix path

```text
getEvidenceIntelligence
→ verified timeline events/facts (approved | edited_and_approved)
→ approved graph edges/nodes
→ contradiction findings (proposed | reviewed)
→ buildEvidenceMatrix issues: supporting / contrary / gaps
```

This is **not** an Analysis extractor. On AN1 ingest (no `extractIntelligence`) it was empty.

---

## 2. executionTarget=analysis

**Definitive:** it does **not** execute Analysis and it does **not** execute `generateDraft`.

`packages`/bench `execute-subsystems.ts` still throws when `target === "analysis"`. Routing test asserts that string remains.

Where selected: `CATEGORY_TARGET` / smoke / full-system unmapped leftovers. Overlay mode `analysis` maps category `analysis` to **`professional_analysis`**, which calls `executeAnalysisTarget`.

UI: Analysis screens call `analyzeContract` / `analyzeDeposition` directly, not this bench target.

Agents: contract/deposition agents call those tools directly. They do not use `executionTarget=analysis`.

Severity if someone wired a generic “analysis” agent target through the bench executor: **hard fail**, not silent draft generation. Remaining defect: the name `analysis` is still not a production engine. **Not fixed in 6I.**

---

## 3. Analysis trust states (actual schema)

Shared enum `analysis_item_status`: **`proposed` | `reviewed` | `dismissed`**.

There is **no** `approved`, `edited_and_approved`, `rejected`, or `superseded` on Analysis items/findings.

| Field | Contract item | Deposition finding |
| --- | --- | --- |
| status | proposed / reviewed / dismissed | same |
| confidence | `low` / `medium` / `high` (items default medium) | same enum; model often emits a number → parse throw |
| provenance | `document_analysis_sources`: documentId, documentVersionId, chunkId, page, segmentRef, supportingText | `analysis_finding_sources`: same + optional `side` |
| category/type | `category` text | `findingType` text |
| origin | `createdByUserId` on analysis row; items have no origin column | `createdByUserId` on run |
| review | `reviewedByUserId`, `reviewedAt` | plus `reviewNote` |

Redlines use a separate enum: `proposed` / `accepted` / `rejected`.

---

## 4. Analysis → Ask Nyaya (trust-boundary defect)

`askNyayaAboutMatter` (`packages/search/src/nyaya.ts`) loads professional analysis unless `includeProfessionalAnalysis === false`.

`loadProfessionalAnalysisContext`:

- `analysis_findings` with status **`proposed` and `reviewed`** (not `dismissed`)
- **all** `document_analyses` summaries, including `status=proposed`, with `proposedItemCount` / `reviewedItemCount`
- comparison summaries (unfiltered)
- discovery highlights

Formatter (`formatProfessionalAnalysisForPrompt`):

```text
Reviewed/available contract analyses:
- analysisId=… status=proposed reviewedItems=0 proposedItems=N summary=<text>

Reviewed analytical findings (may use as structured context):
- [REVIEWED] type=… title=… explanation=…

Proposed (UNREVIEWED) analytical findings — label clearly if referenced; do not treat as verified facts:
- [PROPOSED/UNREVIEWED] type=… title=…
```

**AN1 observed:** after Amendment 1 analysis, Ask Nyaya context contained **`proposedItems=25`** contract summaries under the header **“Reviewed/available contract analyses”**, with model summary text and **no** `[PROPOSED/UNREVIEWED]` per-item labels. `proposedFindings` / `reviewedFindings` arrays were empty because those come from `analysis_findings`, not contract items.

Even with a warning, the model can treat summary sentences as facts. Classification: **unsafe factual contamination**. Recommended fix lives in `packages/intelligence/src/analysis/context.ts`, **not** in Case Q&A. **Not fixed in 6I.**

---

## 5. Analysis → Draft

`generateDraft` / `buildDraftVerifiedContext` loads verified intelligence, verified graph, and **approved Memory** only. **No** Analysis import.

Proposed Analysis findings **do not** enter Draft on the current path. An unsupported Analysis finding cannot become a draft fact *through this boundary*. Draft can still retrieve the same raw chunks independently.

---

## 6. Analysis → Agents

Contract agent tools: `analyzeContract`, `compareDocuments`. Deposition agent: `analyzeDeposition`. Evidence: `getEvidenceMatrix`.

`analyzeContract` description says findings are proposals. The tool **returns the full proposed payload** (items, summary). Agents cannot distinguish reviewed vs proposed unless they inspect `status`. They **can** act on unreviewed findings (further tools, later user-visible artifacts). `getEvidenceMatrix` includes **proposed** contradiction findings as `contrary`. Agents were not modified.

---

## 7. Analysis → Graph / Memory / Timeline

Analysis **does not write** Graph, Memory, or Timeline.

Indirect: evidence matrix **reads** verified Timeline/Facts/Graph and **proposed+reviewed** contradiction findings. Trust/review state of contradiction findings is **not** preserved as a matrix role (they become `contrary` regardless of proposed vs reviewed). Dismissed contradiction findings are excluded.

No “Analysis inference → verified Timeline/Memory fact” write path was found.

---

## 8–14. What AN1 actually exercised

Contract: MSA + Amendment 1 + email chain. Deposition: Mercer transcript (schema failed). Evidence matrix: empty view. Review: `reviewed` / `dismissed` on contract items. Duplicate: idempotent skip. Downstream: formatter snapshot.

Not implemented as Analysis extractors: decoy materiality (Compare), evidentiary tension classification (Contradiction).

---

## 15–21. Independent Analysis benchmark

Overlay only. Graded persisted structured output, not chat. No fixture-specific production logic. Hidden GT loaded after persist. V1/V2 PDFs reused. No V3.

---

## 23. Baseline AN1 headline

| | |
| --- | ---: |
| Scenarios | 2 |
| Tasks | 14 |
| Pass | **8** |
| Needs work | **0** |
| Fail | **4** |
| Infrastructure | **2** |
| Critical (excl. infra) | **2** |

See `BASELINE_AN1_ANALYSIS.md` for per-task rows and subsystem metrics.

---

## 24. Failure taxonomy

| Task | Cause(s) |
| --- | --- |
| AN001 | **finding extraction** (+ numeric omission); provenance span is the page-1 chunk for every item |
| AN013 | **review lifecycle** — `reviewed` on `document_analysis_items` does not populate Ask Nyaya `reviewedFindings` |
| AN016 | **downstream trust boundary** — unlabeled proposed contract summaries |
| AN008 | **finding extraction** / empty persist after prior schema noise; grader reported review-lifecycle `status=none` |
| AN007, AN010 | **infrastructure** — deposition Zod schema vs model (`confidence` number, `attention` `"High"`/`"Medium"`) |

---

## 25. Proposed findings in Ask Nyaya

**Yes.** Exact observed line shape:

`Reviewed/available contract analyses:` + `status=proposed` + `proposedItems=25` + `summary=…`

This is **unsafe factual contamination**. The header says “Reviewed/available” while status is proposed. Individual contract items are not labeled `[PROPOSED/UNREVIEWED]`.

---

## 26. executionTarget=analysis

Throws. Does not run Analysis. Does not run `generateDraft`. Severity: routing leftover / naming trap, currently fail-closed. Do not “fix” by pointing it at `generateDraft`. If wired, use explicit `analyzeContract` / `analyzeDeposition`.

---

## 27. Performance (AN1, gpt-4o-mini)

| Operation | Model calls | Typical latency |
| --- | ---: | ---: |
| `analyzeContract` (new) | 1 | ~6–23 s (MSA ~16 s, email ~23 s, amendment ~6 s) |
| Duplicate second call | 0 additional (skipped after 1 first call) | combined ~15 s |
| `analyzeDeposition` | 1 then throw, or 1 then 0 findings | 1.7–3.6 s |
| `getEvidenceIntelligence` | 0 | 32 ms |
| Retrieval | version chunk load only (no extra embedding query beyond ingest) | in those latencies |
| DB writes | 1 analysis row + N items + N sources per contract run | |

Token usage was not persisted. Duplicate cost is avoided when `force` is false.

---

## 28. Beta assessment

1. **Contract Analysis for controlled beta review?** Only as an **attorney-review queue of proposed items**, not as context for Ask Nyaya. **No** for any path that feeds Q&A.
2. **Deposition Analysis?** **No.** Schema parse often throws; when it does not, AN1 persisted **zero** findings.
3. **Evidence Matrix?** Safe as a **read-only view of already-verified** Timeline/Facts/Graph. **Not** an Analysis engine. Empty without extract. Proposed contradiction findings can appear as `contrary`.
4. **Can Analysis fabricate findings?** It can omit material numbers and attach every item to the wrong chunk. It did **not** invent Exhibit Z on AN005. Email analysis produced many non-controlling “clause” rows (noise, not scored fail).
5. **Wrong operative source?** Amendment 1 notice **30** was found (AN002 pass). Email was not labeled controlling (AN006 pass). MSA **45** was missing (AN001 fail).
6. **Overclaim actor identity?** **Not measured.** Deposition did not persist findings.
7. **Abstain when evidence missing?** AN005 did not fill Exhibit Z. Missing-number behavior was omission, not an explicit “not established” finding.
8. **Provenance reliable?** **Presence** yes (unauthorized chunks dropped). **Correct span** no on MSA (all items → page-1 chunk).
9. **Rejected/dismissed stay out of reviewed findings?** **Yes** (AN014). Dismissed items still sit in the analysis record; Ask Nyaya reviewed-findings list does not include them. Contract **summaries** still enter.
10. **Proposed contaminate Ask Nyaya?** **Yes.**
11. **Contaminate Draft?** **Not through Analysis context.** Draft does not load it.
12. **Contaminate Agents?** **Yes** — full proposed payloads; matrix includes proposed contradiction findings.
13. **Contaminate Graph/Memory/Timeline?** **No writes.** Matrix can surface proposed contradiction findings.
14. **executionTarget=analysis correctly routed?** **No** (throw, not Analysis). Fail-closed vs the old draft stand-in.
15. **Single largest Analysis risk:** unlabeled **proposed contract summaries** injected into Ask Nyaya under a “Reviewed/available” header.

---

## 29. Do not fix after AN1

This baseline is frozen. Do not tune prompts, retrieval, statuses, formatter, or routing as part of 6I.

---

## 30. Exactly one next phase

**Phase 6J — Analysis Ask Nyaya trust boundary**

Largest general failure class: **downstream trust**, not a single MSA number miss.

Smallest change: in `loadProfessionalAnalysisContext` / `formatProfessionalAnalysisForPrompt` only:

- do not inject `status=proposed` contract summaries as unlabeled factual context
- do not inject `proposed` `analysis_findings` as usable facts
- keep dismissed out
- do **not** modify Case Q&A, Compare, Contradiction, Timeline, Memory, Draft, or Agents

Do not start 6J in this phase. Deposition Zod/schema robustness is the next-next engine issue after the trust boundary.

---

## STOP

Phase 6I is complete. Production Analysis behavior is unchanged.
