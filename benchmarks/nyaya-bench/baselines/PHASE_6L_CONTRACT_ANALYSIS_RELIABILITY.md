# NYAYAGRID PHASE 6L — CONTRACT ANALYSIS RELIABILITY

Synthetic-fixture evaluation only. This is **not** attorney review.

Agent 1 workstream: Contract Analysis only. Security/Privacy audit files were not touched.

Frozen and not modified: Case Q&A, Compare B.2, Contradiction B.2, Timeline T2, Memory M2, Phase 6J Ask Nyaya trust boundary, Deposition Analysis DA1.

Do not overwrite AN1 / AN2 / DA1 / 6I / 6J / 6K baselines.

Companion (after live run): `BASELINE_CA1_CONTRACT_ANALYSIS.md`, `BASELINE_CA1_CONTRACT_ANALYSIS.json`

---

## 1. Root-cause analysis (written before production edits)

### 1.1 Production path (verified)

```text
ready document + document_chunks for that version only
  → analyzeContract (packages/intelligence/src/analysis/contract.ts)
  → idempotency buildContractAnalysisIdempotencyKey(documentVersionId)
       existing && !force → skip, return getContractAnalysis
  → loadVersionChunks (all chunks of THIS version; no retrieval ranker; no related docs)
  → ai.generate schemaName="contract_analysis"
       system: buildContractAnalysisSystemPrompt
       user:   buildContractAnalysisUserPrompt({ documentTitle, chunks })
       prompt version: CONTRACT_ANALYSIS_PROMPT_VERSION = contract-analysis-v1
  → JSON.parse; on failure: { summary: generation.text, items: [] }
  → contractAnalysisSchema.parse(raw)   // all-or-nothing Zod
  → loadAuthorizedChunks(item.sourceChunkIds)
  → persist document_analyses (status=proposed, summary=model summary)
  → for each item:
       drop if no authorized chunk ids
       insert document_analysis_items (status=proposed, confidence hardcoded "medium")
       insert document_analysis_sources with supportingText = chunk.content.slice(0, 400)
  → reviewAnalysisItem → reviewed | dismissed
```

Exact symbols:

| Step | Symbol | File |
| --- | --- | --- |
| Prompt | `buildContractAnalysisSystemPrompt` / `UserPrompt` | `packages/ai/src/professional.ts` |
| Schema | `contractAnalysisItemSchema`, `contractAnalysisSchema` | same |
| Attention | `analysisAttentionSchema` informational \| review \| high_attention | same |
| Category | free text `z.string()` | same |
| Analyze | `analyzeContract` | `packages/intelligence/src/analysis/contract.ts` |
| Get/list | `getContractAnalysis`, `listContractAnalyses` | same |
| Review | `reviewAnalysisItem` | same |
| Idempotency | `buildContractAnalysisIdempotencyKey` | `packages/intelligence/src/draft/helpers.ts` |
| Provenance load | `loadAuthorizedChunks` | `packages/intelligence/src/provenance.ts` |
| **Not used** | `resolveValidatedSources` / `findSupportingSpan` | deposition uses these; contract does not |
| **Not used** | `compareDocuments` / `computeClauseDiffs` | Compare B.2 only |

Compare is a separate engine. Contract Analysis does not call it.

6J: proposed contract summaries/items do not enter Ask Nyaya. Reviewed contract items with document+chunk provenance may enter as `[REVIEWED ANALYSIS]`. Do not reopen `context.ts`.

### 1.2 AN1 contract failures (classes)

| Task | Outcome | Root class |
| --- | --- | --- |
| AN001 MSA | Notice item existed but omitted **45**; 11 items; **all sources were the same page-1 chunk** | **numeric omission** + **provenance/supporting-span** (first-400 of cited chunk, and/or model cited chunk 0 for everything). Input contained §4 Notice (“formal notice requires 45 days”). Not G (chunks were loaded). Not J. |
| AN002 Amendment 1 notice 30 | PASS | numbers present for that instrument |
| AN003 Amendment 1 30 and $510,000 | PASS | numeric completeness sometimes works when the model copies them |
| AN005 missing exhibit | PASS | did not invent Exhibit Z / deductible |
| AN006 email as contract | PASS on not-controlling; still 10 email “clauses” | informal-source discipline partial; **noise** |
| AN011 provenance presence | PASS | chunk ids present; span quality **not graded** — presence ≠ correctness |
| AN013 / AN016 | 6J trust (frozen) | not a Contract extractor defect; regression-only in 6L |

Deposition AN007–AN010 are **out of scope** (DA1 frozen).

### 1.3 Why page-1 spans

Persistence always stores:

`supportingText: chunk.content.slice(0, 400)`

That is the start of whatever chunk the model listed, typically the document header / Parties clause when `sourceChunkIds` is the first chunk. It is not clause-scoped. This is the AN1 “same page-1 chunk for Notice/Payment/Liability” defect.

`originalText` is stored on the item but is **not** used as `supportingText`.

### 1.4 Why 45 was omitted

The MSA source literally contains “formal notice requires 45 days”. The model emitted a Notice finding without the number. There is **no** post-parse quantity check. Prompt does not require copying amounts/durations/dates from Sources. Class: **model omission**, compounded by no deterministic numeric preservation from the supporting span.

### 1.5 Schema

`contractAnalysisSchema.parse` fails the **entire** payload if any item is invalid (same all-or-nothing pattern as AN1 deposition). Live AN1 contract runs did parse, so this was not the AN001 failure. Still fix generally (attention `High`, per-item keep).

Invalid JSON becomes `{summary: raw text, items: []}` — class C disguised as empty analysis.

### 1.6 Single-document input

`analyzeContract` only loads chunks for the requested version. That is correct for “what does **this instrument** say.” Operative-across-matter reasoning requires later instruments in Sources; dumping sibling amendments into MSA analysis would mix 30-day terms into the original-notice task. 6L will:

- keep single-instrument analysis
- prompt: report what **this instrument** states; do not treat informal email as a signed contract; do not invent missing exhibits; do not present this document’s term as matter-wide current unless Sources include the later signed instrument and effective date

Amendment 1 / 2 documents carry their own changed/future-effective language.

### 1.7 Planned general fix (not score-chasing)

1. Prompt v2: numbers from source, verbatim originalText, this-instrument role, email not controlling, missing exhibits, decoys, negation, empty-if-nothing.
2. Per-item safeParse + attention/confidence-style normalization (attention only on contract items).
3. Clause-scoped supporting span via `findSupportingSpan` + read-only `segmentLegalDocument` (Compare **not** invoked, Compare files **not** edited).
4. Drop items with no defensible span (`rejectedNoSource` / `rejectedBadSpan`).
5. Copy quantities and limiter tokens **from the supporting span** into explanation when the model omitted them (source copy, not invention).
6. Near-duplicate item collapse.
7. Summary must not deny material items that were persisted; must not be the only place a claim exists.
8. Status remains `proposed`. No 6J changes.

---

## 2. Production changes

Implemented generally (no SYNTH IDs, fixture names, or expected amounts in production):

| Change | Where |
| --- | --- |
| Prompt `contract-analysis-v2`: this-instrument, copy numbers, email not controlling, missing exhibits, decoys, negation, one item per obligation, summary alignment | `packages/ai/src/professional.ts` |
| Per-item `parseContractAnalysis` + attention normalization | same |
| Clause-scoped supporting spans via `segmentLegalDocument` (read-only Compare helper) + `findSupportingSpan`; drop items with no defensible span | `packages/intelligence/src/analysis/contract-span.ts`, `contract.ts` |
| Copy quantities and limiter phrases **from the supporting span** | `contract-span.ts` |
| Near-duplicate collapse (same explanation or high overlap) | `contract-span.ts` |
| Summary must not deny persisted items | `contract-span.ts` |
| Items remain `proposed`; no auto-review; 6J `context.ts` **not** edited | `contract.ts` |
| Overlay mode `contract`, grader `ca1-2026-08-19` | `benchmarks/nyaya-bench/` |

Compare / Deposition / Contradiction production files were **not** edited except Contract Analysis importing `segmentLegalDocument` and `extractNumericValues` without changing those functions.

---

## 3. Targeted safety gate

Pre-full-run CA001 (MSA 45-day): **PASS** (`2026-08-19T13-22-20-733Z`).

Full overlay then covered the remaining gate cases:

| Gate | Task | Result |
| --- | --- | --- |
| MSA 45-day | CA001 | PASS |
| Amendment 1 notice | CA002 | PASS |
| Liability cap | CA003 | PASS |
| Informal email | CA009 | PASS |
| Missing exhibit | CA008 | PASS |
| Typo/renumber decoy | CA014 | PASS |
| Source-span validation | CA012 | FAIL (non-critical; see remaining) |
| Proposed-status / 6J | CA017 | PASS (proposed leakage 0) |

---

## 4. Full CA1 overlay

Live run: `benchmarks/nyaya-bench/reports/runs/2026-08-19T13-23-03-813Z`

Command: `npm run bench -- v2 run contract`

**17 / 18 pass**, 0 infrastructure, **0 critical**.

Remaining: **CA012** (supporting-span header check). Notice findings in the same run have clause-scoped “45 days” spans. The fail is a Parties heading span that contains “Parties and Purpose”. Not score-chased.

---

## 5. AN1 → CA1 mapping

| AN1 | Result |
| --- | --- |
| AN001 MSA 45-day miss | **Fixed / CA001 pass** |
| AN002 Amendment 1 operative value | **CA002 pass** (was already pass in AN1) |
| AN005 missing exhibit | **CA008 pass** |
| AN006 informal email not controlling | **CA009 pass** |
| AN013 / AN016 6J | **Regression pass** (CA017/CA018). 6J not reopened. |

---

## 6. Metrics / performance

| Metric | Value |
| --- | --- |
| Tasks | 18 |
| Pass | 17 |
| Needs work | 0 |
| Fail | 1 |
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
| Supporting-span accuracy (required quote phrases) | 1.00 |
| Negation accuracy | 1.00 |
| Duplicate/noise rate | 0.00 |
| Summary alignment | 1.00 |
| Proposed-status accuracy | 1.00 |
| Model | gpt-4o-mini |
| Model calls | 1 per analysis |
| Median latency | 15891 ms |
| p95 latency | 19845 ms |
| Findings per document (avg) | 8.39 |
| Dropped unsupported | 0 |
| Duplicate suppression | 0 |
| Normalization count | 0 |
| Extra retrieval calls | 0 |
| Repair-model calls | 0 |

Same-chunk `chunkId` can still appear for many items on a page-sized chunk; **supportingText is clause-scoped**, unlike AN1’s first-400 header.

---

## 7. Regression

| Suite | Result |
| --- | --- |
| Contract Analysis unit (`professional` parse, `contract-span`) | pass |
| Compare `clause-compare` tests | pass (helpers read-only) |
| 6J `context.test.ts` | pass (file not edited) |
| nyaya-bench tests | pass |
| intelligence typecheck | pass |
| Compare semantics | unchanged |

Deposition 6K tests: no deposition production edits. Full deposition live overlay was not re-run (frozen). Contradiction tests not required (no shared source-logic change beyond unused Compare helpers).

---

## 8. Beta assessment

1. Material provisions: **yes** for notice, payment, termination, liability, insurance on the MSA overlay.
2. Important numbers: **yes** (45, 30, $63,750, $255,000, $510,000 preserved).
3. Correct operative source: **yes** for this-instrument analysis (MSA vs Amendment 1 vs email).
4. Amendment reasoning: **yes** for Amendment 1 changed terms and Amendment 2 future-effective 2027.
5. Informal email not controlling: **yes** (CA009).
6. Missing exhibits: **yes** (CA008; did not invent Exhibit Z).
7. Decoy/non-material: **yes** (CA014).
8. Provenance specific: **improved**. Chunk IDs may still be page-level; spans are clause-level for material clauses.
9. Supporting spans supportive: **yes for notice/liability/payment**. CA012 residual is heading-phrase grading, not a fabricated span.
10. Negation/limitation: **yes** (CA013; “will not exceed” preserved).
11. Duplicate/noise: **acceptable** (CA015 pass; ~8–13 items on MSA, distinct clauses).
12. All new findings proposed: **yes**.
13. 6J proposed-out of Ask Nyaya: **yes** (CA017; proposedInAskNyayaCount 0).
14. Remaining critical classes: **none on this overlay**.
15. Safe enough for controlled beta review: **yes**, with human review of every item (already required).
16. Largest remaining Contract Analysis risk: **page-sized chunks + heading findings** can still look like “same chunk” in the UI; clause spans are better than AN1 but not perfect page/segment coordinates. Cross-document operative-current (analyzing MSA alone vs matter-wide current) still depends on analyzing the later instrument separately.

---

## 9. Freeze decision (Contract Analysis only)

**FREEZE CONTRACT ANALYSIS**

Rationale: 0 critical failures, MSA 45-day captured, no fabricated clause/provenance on graded tasks, high material/numeric accuracy, 6J intact. Perfect supporting-span overlay score was not required; CA012 is non-critical.

---

## 10. Analysis-whole status

- Analysis trust boundary (6J): **frozen** (unchanged)
- Deposition Analysis: **frozen** (unchanged; DA1 not combined)
- Contract Analysis: **frozen** (this phase)
- Analysis as a whole: **not frozen**

Evidence matrix / Analysis integration (AN012-class) was not in this workstream and still blocks calling all of Analysis frozen.

---

## 11. Next recommendation

**A. Analysis Integration / Evidence Matrix Reliability**

Smallest high-impact next step toward a two-month beta: close the remaining Analysis surface (evidence matrix / cross-engine integration) before opening Draft. Draft is larger and should wait until Analysis-as-a-whole is freezeable.

Do **not** start that phase in this workstream.
