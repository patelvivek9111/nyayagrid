# NYAYAGRID PHASE 6K — DEPOSITION ANALYSIS RELIABILITY

Synthetic-fixture evaluation only. This is **not** attorney review.

Phase 6I / Baseline AN1 remains frozen and is **not** overwritten.
Phase 6J Analysis → Ask Nyaya trust boundary remains frozen and is **not** reopened.
Contract Analysis is **out of scope**. No V3. Contradiction B.2 is **not** merged into Deposition Analysis.

Companion files (written after the production fix and live run):

- `BASELINE_DA1_DEPOSITION_ANALYSIS.md`
- `BASELINE_DA1_DEPOSITION_ANALYSIS.json`

Naming: **DA1** is the first deposition-specific overlay/baseline. It maps back to the AN1 deposition subset (`SYNTH-V2-006-AN007`, `AN008`, `AN010`).

---

## 1. Root-cause analysis (written before production edits)

### 1.1 Complete production path (verified)

```text
ready document + document_chunks for that version
  → analyzeDeposition (packages/intelligence/src/analysis/deposition.ts)
  → ai.generate schemaName="deposition_analysis"
       system: buildDepositionAnalysisSystemPrompt
       user:   buildDepositionAnalysisUserPrompt
       prompt version: DEPOSITION_ANALYSIS_PROMPT_VERSION
  → JSON.parse(generation.text)
       on invalid JSON: silently { summary: null, findings: [] }
  → depositionAnalysisSchema.parse(raw)     // all-or-nothing Zod
  → loadAuthorizedChunks(sourceChunkIds)
  → resolveValidatedSources + findSupportingSpan
       skip finding if sources.length === 0  (rejectedNoSource)
  → persist analysis_runs (runType=deposition, status=proposed)
       + analysis_findings (status=proposed)
       + analysis_finding_sources
  → reviewFinding → reviewed | dismissed
  → loadProfessionalAnalysisContext (Phase 6J): proposed findings do not enter Ask Nyaya
```

Exact schemas / functions:

| Step | Symbol | File |
| --- | --- | --- |
| Prompt | `buildDepositionAnalysisSystemPrompt`, `buildDepositionAnalysisUserPrompt` | `packages/ai/src/professional.ts` |
| Prompt version | `DEPOSITION_ANALYSIS_PROMPT_VERSION` (`deposition-analysis-v1` at AN1) | same |
| Model output schema | `depositionFindingSchema`, `depositionAnalysisSchema` | same |
| Confidence enum | `confidenceLevelSchema` = `low \| medium \| high` | `packages/ai/src/intelligence.ts` |
| Attention enum | `analysisAttentionSchema` = `informational \| review \| high_attention` | `professional.ts` |
| Finding type | `findingType: z.string()` (free text, **no production enum**) | `depositionFindingSchema` |
| Parse | `depositionAnalysisSchema.parse` (throws on first invalid row) | `analyzeDeposition` |
| Provenance | `loadAuthorizedChunks`, `resolveValidatedSources`, `findSupportingSpan` | `packages/intelligence/src/provenance.ts` |
| Persist | `analysis_runs`, `analysis_findings`, `analysis_finding_sources` | `analyzeDeposition` |
| Review | `reviewFinding` | `deposition.ts` |
| List | `listFindings` | `deposition.ts` |
| Ask Nyaya | `loadProfessionalAnalysisContext` (frozen 6J) | `packages/intelligence/src/analysis/context.ts` |

HTTP: professional deposition analysis routes call `analyzeDeposition`. Agents may call the same function. Neither path uses Contradiction `detectContradictionCandidates`.

Input preparation at AN1: **all chunks of the single deposition document version**. No retrieval ranker. **No related-matter evidence** (access log, minutes, contracts) was in the prompt. Actor-trap / tension tests that need the badge log therefore could not be exercised by Deposition Analysis itself.

### 1.2 Output contract at AN1 (gap)

Prompt required `findingType, title, explanation, confidence, attention, sourceChunkIds` but:

- did **not** constrain `confidence` to lowercase `low|medium|high`
- did **not** constrain `attention` to `informational|review|high_attention`
- did **not** require a supporting quote field

The model therefore emitted variants such as `confidence: 0.91` and `attention: "High"` / `"Medium"`.

Contradiction analysis already had `normalizeConfidenceLevel` (string case-fold; numbers `>= 0.75` → `high`, `>= 0.4` → `medium`, else `low` if `>= 0`) and a preprocess on `contradictionCandidatesSchema`. **Deposition did not use that helper.** Numeric confidence already has product semantics in this repo; 6K reuses those thresholds rather than inventing new ones.

Attention `"High"` is **not** the confidence enum. Canonical attention is `high_attention`. Mapping `"High"`/`"high"` → `high_attention` and `"Medium"`/`"medium"` → `review` (deposition default) is representation normalization, not a factual repair.

### 1.3 Why one bad row destroyed the run

`depositionAnalysisSchema` is `z.object({ findings: z.array(depositionFindingSchema) })`. Zod fails the **entire payload** if any array element fails. AN007 / AN010 threw before insert. That is infrastructure, not a valid empty analysis.

### 1.4 Provenance / quote quality

After a successful parse, `analyzeDeposition` passed

`authorized.get(id)?.content.slice(0, 400)`

as `sourceQuotes`. That is the **start of the chunk**, typically the synthetic header (`SYNTH - FICTIONAL TEST DOCUMENT...`), not the testimony span. `findSupportingSpan` then “validates” that substring against the same chunk (it matches) and persists it as `supportingText`. This is not an arbitrary first-**chunk** fallback, but it **is** an arbitrary first-**span** fallback. Quotes were not required from the model.

If `findSupportingSpan` returns null, the finding is dropped (`rejectedNoSource`). No fabricated chunk ids.

### 1.5 Review state

New findings are inserted with `status: "proposed"`. There is no auto-review. Phase 6J already excludes proposed Analysis from Ask Nyaya. 6K must not change that.

### 1.6 Finding taxonomy (actual)

Production `findingType` is unconstrained text (max 120). Mock helper uses `memory_gap` / `denial` / `admission`. Contradiction runs use `contradiction` / `tension` on a **different** `runType`. 6K does **not** invent a new enum or benchmark-only types. Prompt may *prefer* ordinary labels (`admission`, `denial`, `inconsistency`, `tension`, `uncertainty`, `testimony_statement`, `credibility_issue`, `date_discrepancy`) without making them exclusive.

### 1.7 AN1 deposition failure classes (A–J)

Observed AN1 deposition tasks (live persist `2026-08-19T10-31-15-343Z`):

| Task | Outcome | Classes |
| --- | --- | --- |
| AN007 | INFRA Zod (`confidence` number, `attention` `"High"`/`"Medium"`) | **B** useful rows likely present, **D** parser too strict for representation variants. Entire run aborted before persist. Not A. |
| AN010 | same INFRA | **B** + **D** (same) |
| AN008 | completed, **0** persisted findings, no Zod throw | Parse succeeded. Zero persist is **not** the same defect as AN007. Possible **A** (model empty), **C** (invalid JSON coerced to `{findings:[]}`), **E/F** (rows dropped in normalization/provenance). Raw generation text was not stored, so A vs C vs F cannot be counted separately from AN1 artifacts. Actor trap **not exercised**. |

Not observed in AN1 deposition:

- **G** retrieval missing evidence: deposition-only prompt omitted the access log by architecture (relevant to tension/actor, not to AN007 parse).
- **H** missed testimony: cannot score when parse throws or persist is empty.
- **I** unsupported inference: not exercised (zero/invalid persist).
- **J** persistence failed after valid parse: no evidence of DB insert errors.

Silent JSON failure (class **C**) was indistinguishable from a valid empty analysis (class **A**) because `JSON.parse` catch returned `{findings:[]}`.

### 1.8 V2-006 deposition content (fixture, not production logic)

`05_Deposition_Mercer.pdf` testimony that actually exists:

- Admission of attendance: arrived shortly before 3:00 p.m. at the 2026-11-15 review meeting.
- Denial: never entered the records room on 2026-11-15.
- Approximate date: “Near the middle of November, at the review meeting” (compatible with 2026-11-15).
- Uncertainty: does not recall seeing a deductible.

`06_Access_Log.pdf`: badge assigned to the witness, ACCESS GRANTED, explicit limitation that the log does not independently prove who carried the badge.

No second sworn statement that the meeting did **not** occur on November 15. **Direct contradiction of two sworn testimonies is not present in V2-006.** DA003 is therefore graded as *do not invent a direct contradiction*, not as a forced positive recall of a missing conflict.

Invoice `07_Invoice_and_Remittance.pdf` is not a transcript (correct zero-finding case if analyzed as a deposition).

Contract notice-period amendments are unrelated to this testimony.

### 1.9 Planned general fix (not score-chasing)

1. Deterministic normalization of confidence (reuse existing thresholds) and attention representation variants.
2. Per-finding `safeParse`; keep valid rows; count `rejectedMalformed`.
3. Record JSON parse failure instead of disguising it as empty findings; still persist a proposed run without throwing.
4. Require verbatim `supportingQuotes` in the prompt; persist only spans that appear in authorized chunks; drop findings without defensible provenance; **stop** using chunk-prefix as a fake quote.
5. Include capped **related matter chunks** in the user prompt, labeled as non-testimony evidence, so tension/actor rules can be applied **inside Deposition Analysis** without calling `detectContradictionCandidates`.
6. Strengthen the output contract (enums, empty-if-insufficient, attribution, actor/tension/compatible dates, unrelated contracts).
7. Independent overlay `npm run bench -- v2 run deposition`. Grade persisted findings only.

---

## 2. Production changes

Deposition Analysis only. Contradiction B.2, Contract Analysis, 6J `context.ts`, Case Q&A, Compare, Timeline, Memory, Graph, Draft, Research, and Agents were not modified.

| Change | Where |
| --- | --- |
| Prompt v2: canonical enums, supportingQuotes, empty-if-nothing, attribution, actor/tension/compatible dates, unrelated contracts | `buildDepositionAnalysisSystemPrompt` |
| Related matter chunks (round-robin cap 32), labeled non-testimony | `selectRelatedChunksForDeposition` + `analyzeDeposition` |
| Confidence reuse of existing `normalizeConfidenceLevel` (`>=0.75` high, `>=0.4` medium) | `parseDepositionAnalysis` |
| Attention `"High"`/`"high"` → `high_attention`; `"Medium"` → `review` | `normalizeAnalysisAttention` |
| Per-finding `safeParse`; invalid rows counted as `rejectedMalformed` | `parseDepositionAnalysis` |
| JSON parse failure recorded; run still persists; no second model call | `analyzeDeposition` |
| Quotes from model `supportingQuotes` only; drop if no defensible span; **no** chunk-prefix fake quote | `analyzeDeposition` + `resolveValidatedSources` |
| Findings remain `proposed` | unchanged insert |
| Independent overlay `npm run bench -- v2 run deposition` | `datasets/v2/deposition/`, mode `deposition` |

`findingType` remains free text. Prompt may prefer ordinary labels; no new production enum and no DA-ID logic.

Contradiction still uses `detectContradictionCandidates` only. Deposition does not call it.

---

## 3. Targeted safety gate

Gate metrics are the designated subset of the DA1 live persist (one ingest, same run). Perfect recall was not required.

| Gate item | Task | Result |
| --- | --- | --- |
| 1. AN1 parse-failure scenario | DA012 | **PASS** — 0 INFRA, 4 findings persisted |
| 2. Previous zero-finding / empty persist | DA014 (correct zero); DA002/DA005 now persist findings | **PASS** |
| 3. Actor trap | DA005 | **PASS** — 0 actor overclaims |
| 4. Tension vs contradiction | DA003 pass (no invented direct contradiction); DA004 fail (tension not identified) | **partial** |
| 5. Approximate-date compatibility | DA006 | **PASS** |
| 6. Clear admission / denial | DA001 / DA002 | **PASS** |

Required safety gate:

- **0** infrastructure parse failures
- **0** actor overclaims
- **0** fabricated provenance (DA010/DA011 pass; quotes contain testimony)
- **all** persisted findings `proposed`; `proposedInAskNyayaCount=0`

**Gate: PASS** (tension recall is not a safety-gate requirement).

---

## 4. Full Deposition overlay (DA1)

Command: `npm run bench -- v2 run deposition`

Live persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T12-16-25-081Z`

| Count | Value |
| --- | --- |
| Tasks | 16 |
| Pass | 15 |
| Fail | 1 (DA004, major, not critical) |
| Needs work | 0 |
| Infrastructure | 0 |
| Critical fails | 0 |

| Metric | Value |
| --- | --- |
| Finding recall (DA001/002/004/015) | 0.75 |
| Finding precision (no forbidden resolved fact) | 1.00 |
| Admission accuracy (DA001) | 1.00 |
| Denial accuracy (DA002) | 1.00 |
| Actor accuracy (DA005) | 1.00 |
| Contradiction discipline (DA003) | 1.00 |
| Tension accuracy (DA004) | **0.00** |
| Compatible date (DA006) | 1.00 |
| Uncertainty (DA007) | 1.00 |
| Attribution (DA008) | 1.00 |
| Provenance | 1.00 |
| Quote/span | 1.00 |
| Zero-finding (DA014) | 1.00 |
| Schema parse failure rate | 0 |
| Persistence success | 1.00 |
| Proposed-status accuracy | 1.00 |
| Ask Nyaya proposed leakage | 0 |

Remaining wrong task after the general defect was fixed (not score-chased):

**DA004** — four persisted testimony findings (attendance, denial of entry, approximate November, deductible uncertainty) with supportive quotes. The access-log badge `ACCESS GRANTED` tension was **not** emitted. This is class **H** (model missed related evidence), not A–D. No actor overclaim. Contradiction engine was not used.

DA013 live is the same production path as DA012; isolation of one malformed row is proven in unit tests (`parseDepositionAnalysis` keeps the valid sibling).

---

## 5. Before / after vs AN1

AN1 deposition subset is unchanged as a baseline. DA1 is the deposition-specific successor.

| AN1 task | AN1 | 6K / DA1 analogue | Transition |
| --- | --- | --- | --- |
| AN007 parse (`confidence` number, `attention` `"High"`) | **INFRA** | DA012 | **INFRA → PASS** |
| AN010 same parse crash | **INFRA** | DA012 | **INFRA → PASS** |
| AN008 0 findings; actor trap not exercised | **FAIL** | DA005 (+ DA002 persist) | **FAIL → PASS**; findings persist; no physical-entry overclaim |
| Admission/denial (AN007) | n/a (infra) | DA001 / DA002 | **unscored → PASS** |
| Provenance | n/a / header-span | DA010 / DA011 | **PASS** with testimony quotes |
| Proposed status / 6J | proposed insert; 6J keeps proposed out of Ask Nyaya | DA016 | **PASS** (`proposedInAskNyaya=[]`) |

Contract Analysis scores are **not** mixed into DA1.

---

## 6. Performance

| Field | Value |
| --- | --- |
| Model | openai `gpt-4o-mini` |
| Model calls | 1 per task (16 total); **0** repair retries |
| Median latency | 8840 ms |
| p95 latency | 11713 ms |
| Max latency | 12016 ms |
| Parse-retry count | 0 |
| Normalization count (live) | 0 (model emitted canonical enums after prompt v2) |
| Rejected malformed findings | 0 |
| Rejected no-source | 1 (DA008 only) |
| Token impact | not returned on bench answer artifacts |
| Second model call for formatting | **not added** |

---

## 7. Regression

| Suite | Result |
| --- | --- |
| `@nyayagrid/ai` tests (incl. `professional.test.ts`, contradiction-semantics) | **259 passed** |
| `@nyayagrid/intelligence` tests (incl. 6J `context.test.ts`) | **96 passed** |
| `@nyayagrid/nyaya-bench` tests | **87 passed** |
| `eval:ai` mock (Case Q&A 51 + Contradiction 26) | **88 passed**; contradiction workflow bar PASS |
| typecheck `ai`, `intelligence`, `nyaya-bench` | **pass** |
| Prettier on 6K TS files | applied |
| Contradiction evals | **not changed**; mock suite green |
| Case Q&A | mock eval green; production Case Q&A not tuned |
| 6J trust boundary | `context.ts` untouched; DA016 `proposedInAskNyayaCount=0` |

---

## 8. Beta assessment

1. Does Deposition Analysis execute reliably? **Yes** — 0 infrastructure parse failures, 16/16 persisted runs.
2. Can harmless schema variation crash the entire analysis? **No** — per-finding parse + normalization. AN1 crash class is gone.
3. Does one malformed finding destroy valid findings? **No** (unit-proven). Live DA013 did not need a planted bad row.
4. Does it correctly identify clear admissions? **Yes** (DA001).
5. Does it correctly preserve denials? **Yes** (DA002); quotes contain “never entered”.
6. Can it distinguish tension from contradiction? **Partially** — it does not invent a direct contradiction (DA003) and does not overclaim the actor (DA005), but it **missed** emitting the badge-vs-denial tension (DA004).
7. Does it avoid actor inference? **Yes**.
8. Does it preserve approximate/uncertain testimony? **Yes** (DA006, DA007).
9. Does it reject unrelated evidence? **Yes** (DA009).
10. Is provenance specific and defensible? **Yes** on persisted findings (chunk + supporting span).
11. Are quotes actually supportive? **Yes** on scored denial/admission quotes.
12. Are all AI findings proposed? **Yes**.
13. Can proposed deposition findings enter Ask Nyaya after 6J? **NO.**
14. Is Deposition Analysis safe enough for controlled beta review? **Yes**, with the documented tension-recall gap.
15. Largest remaining Deposition Analysis risk: **missed evidentiary tension** between denial of physical entry and credential/badge activity, if reviewers rely on Deposition Analysis alone for that pairing. Contradiction B.2 remains a separate frozen engine for that pattern.

---

## 9. Freeze decision (Deposition Analysis only)

**FREEZE DEPOSITION ANALYSIS**

Reasons: 0 critical failures, 0 parse/infrastructure failures, actor safety held, provenance/quotes held, all findings proposed, 6J boundary held, admission/denial recall held. One remaining task (DA004) is a **non-critical recall miss**, not a dangerous overclaim.

Contract Analysis is **not** frozen. Analysis as a whole is **not** frozen.

---

## 10. Next recommendation

**Phase 6L — Contract Analysis Reliability**

AN1 still showed missed MSA 45-day notice value and weak contract source-span quality. 6J did not fix extraction. 6K did not tune Contract Analysis.

Do **not** start 6L in this phase.
