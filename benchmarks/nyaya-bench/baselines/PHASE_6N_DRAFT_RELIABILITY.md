# NYAYAGRID PHASE 6N — DRAFT RELIABILITY

Synthetic-fixture evaluation only. This is **not** attorney review.

Frozen and not modified: Case Q&A, Compare, Contradiction, Timeline T2, Memory M2, 6J, DA1, CA1, Evidence Matrix EM2, Graph, Research, Agents, Security P0, V1/V2 PDFs, existing hidden GT, existing baselines.

Draft may **read** frozen verified APIs. Do not change those systems to improve Draft scores.

Companions: `BASELINE_D1_DRAFT.md` / `.json` (unchanged production). After fixes: `BASELINE_D2_DRAFT.md` / `.json` (do not overwrite D1).

---

## 1. Existing Architecture (pre-change audit)

Verified in current code (`packages/intelligence/src/draft/index.ts`).

```text
UI / API POST /api/v1/matters/:matterId/drafts  (generateDraftSchema)
  → generateDraft
       loadMatterTitle
       buildDraftVerifiedContext
         loadVerifiedMatterIntelligence     // approved Timeline, Facts, entities, deadlines
         loadVerifiedGraphContext           // approved/edited_and_approved edges only
         retrieveActiveMatterMemories       // approved/edited_and_approved, not superseded
         formatVerifiedIntelligenceForPrompt + formatVerifiedGraphForPrompt + formatActiveMemoryForPrompt
       loadDraftContextChunks               // raw document_chunks, up to 48, optional documentIds
       loadDraftLegalAuthorityContext       // saved authorities (bench overlay disables)
       ai.generate(buildDraftGenerationSystemPrompt + UserPrompt)  // draft-generation-v1
       draftGenerationSchema { content, assertions[{text,chunkIds}], assumptions[] }
       resolveDraftAssertions → drop unauthorized chunk ids; split FACT_SOURCE vs LEGAL_AUTHORITY
       appendExternalResearchNoteIfNeeded / appendResearchDisclaimerIfNeeded
       persist drafts + draft_versions (append-only versions)
  → UI draft page; Agents createDraft/generateDraft (Agents not modified this phase)
```

Other APIs: `createDraft` (manual/empty), `saveDraftVersion` (manual edit, **does not copy sourceAssertions**), `transformDraftSection` (shorten/expand/change_tone/regenerate; new AI version), `restoreDraftVersion` (copies prior content + sourceAssertions), `updateDraftStatus` (`draft` | `in_review` | `archived`). There is **no export/filing** path.

Tables: `drafts` (`sourceContext` jsonb, prompt/provider/model, `aiGenerated`, status), `draftVersions` (`content`, `origin` manual|ai|ai_edited, `sourceAssertions` jsonb with chunkIds only).

Draft types implemented: `demand_letter`, `complaint`, `motion`, `brief`, `contract`, `settlement_agreement`, `discovery_request`, `correspondence`, `memo`, `other`. Overlay uses existing types only.

**Not consumed:** Contract/Deposition Analysis, Evidence Matrix, Compare, Contradiction, Research query engine (only a disclaimer if the model talks about authority).

### Trust answers (pre-change)

| Source | Enters Draft context? |
| --- | --- |
| Timeline proposed | **No** (`loadVerifiedMatterIntelligence` approved only) |
| Timeline approved | **Yes**, with `datePrecision` in the formatted line |
| Facts proposed | **No** |
| Facts approved | **Yes**; **origin not labeled** in the prompt formatter |
| Memory proposed | **No** (`isDownstreamEligibleMemory`) |
| Memory approved (manual/AI) | **Yes**, labeled via `memoryPromptTrustLabel` |
| Rejected/superseded memory | **No** |
| Graph proposed | **No** (`edgeStatus: approved,edited_and_approved`) |
| Graph approved | **Yes**, labeled **"Verified relationships"** (stronger than Graph reliability warrants) |
| Analysis proposed/reviewed | **No** |
| Evidence Matrix | **No** |
| Compare / Contradiction | **No** |
| Raw chunks | **Yes**, unreviewed document text (primary generation fuel) |
| User instructions | **Yes**, as `Instructions:` in the user prompt |

Explicit:

1. Proposed Timeline cannot enter verified context. **Yes it can still influence the draft via raw chunks** if extraction wrote similar text into documents (documents are source evidence, not proposed Timeline).
2. Proposed Memory cannot enter. Manual proposed Memory cannot enter.
3. Proposed Analysis cannot enter (not consumed).
4. Proposed Graph cannot enter.
5. Reviewed Analysis cannot enter (not consumed).
6. Disputed/tension findings are **not** injected as structured dispute; the model may flatten disputes from raw chunks.
7. Missing evidence can be filled in by the model; placeholders exist only if the model emits `[PLACEHOLDER|TODO|TBD]` or assumptions mention missing/unknown.
8. **User instructions are concatenated into the prompt with no deterministic veto.** A request to “write that Mercer entered” can become stated fact if the model complies.

### Provenance (pre-change)

- Assertions store `text` + `chunkIds` (+ optional `provenanceClass`). **Not** documentId/version/quote/span/review status on the assertion row.
- Chunk lookup can recover document/version from `document_chunks`; Draft does not persist that join.
- **Body is not citation-locked.** `content` can assert facts that never appear in `sourceAssertions`. Unauthorized assertion citations are dropped; the sentence in `content` remains.
- Quotes in `content` are not validated against chunk text.
- “Draft had verified context” ≠ “this sentence is supported by this span.”

Versioning: prior versions remain rows. Restore copies assertions. Manual `saveDraftVersion` starts with **empty** `sourceAssertions`. Transform creates a new AI version; it does not freeze numbers deterministically.

---

## 2. Trust Boundary

Policy for beta (enforced after D1 if live failures require it):

| Class | Draft may |
| --- | --- |
| A Source evidence | State with provenance |
| B Reviewed intelligence | Use with trust label |
| C Proposed AI | Must not become established fact |
| D User assertion / instruction | Attribute/qualify; must not become independently verified |
| E Disputed | Preserve qualification |
| F Missing | Placeholder / assumption / explicit unavailable |

---

## 3. Provenance Audit

See §1. Smallest safe architecture if D1 shows body/citation drift: **deterministic post-generation safety scan** in Draft (not a giant citation graph); keep assertion chunkIds; do not claim sentence-level lock unless implemented.

---

## 4. Draft Overlay

Mode: `npm run bench -- v2 run draft`. Hidden GT: `datasets/v2/hidden_ground_truth/draft/`. Grader: structured Draft output, not Case Q&A chat.

---

## 5. D1 Baseline

Live (unchanged production): `benchmarks/nyaya-bench/reports/runs/2026-08-19T14-30-01-693Z`

| | |
| --- | --- |
| Pass | 22 / 24 |
| Needs work | 0 |
| Fail | 0 |
| Infrastructure | 2 (D018, D023) |
| Critical | 0 |

Safety tasks for actor, silence, missing exhibit, retroactivity, proposed Timeline/Memory/Analysis isolation, and versioning **passed** on D1.

An intermediate run after content-object coerce (`2026-08-19T14-39-14-434Z`) is **not** D1 or D2: D018 quote fail, D005 invalid chunk UUID infra.

---

## 6. Root Causes

| Task | Class | Note |
| --- | --- | --- |
| D018, D023 (D1) | **L infrastructure** / **C prompt-generation** | `draftGenerationSchema` required `content: string`; model returned an object |
| D018 (intermediate) | **I citation** / **C** | Quoted spans not present in source chunk text |
| D005 (intermediate) | **L** | Assertion `chunkIds` were not UUIDs |
| Remaining architecture | **D provenance** | Body is still not sentence-locked; assertions are parallel metadata |
| Graph prompt label | **B context trust** (Draft consumption) | Approved graph is labeled “Verified relationships” though Graph is unfrozen |

Frozen Timeline/Memory/Analysis/Contradiction engines were **not** the D1 failures.

---

## 7. Production Changes

Only Draft (`packages/intelligence/src/draft/helpers.ts`, `draft/index.ts`):

1. `normalizeDraftGenerationRaw` — coerce object `content` to string; drop non-UUID chunk ids.
2. `neutralizeUnsupportedQuotes` — remove quotation marks when the span is not in provided source chunks.
3. Applied in `generateDraft` and `transformDraftSection`.

No SYNTH IDs. No frozen-system edits. Prompt version remains `draft-generation-v1`.

---

## 8. Factual Grounding

D1/D2: supported notice-period and current-term tasks passed. User-instruction cash-payment and retroactivity did not become verified fact on live runs. Body is still generated from raw chunks + instructions; assertions are validated after the fact.

---

## 9. Numeric / Temporal

D004/D019/D022 passed (255000/510000, 45 days, regenerate did not drop v1 numbers). D003/D005 passed (future amendment not current; no invented midnight timestamps). `datePrecision` is in verified Timeline lines when approved events exist; early overlay tasks used raw chunks only.

---

## 10. Actor Safety

D006/D007/D012 passed. Badge/access activity was not converted to “Mercer entered.” Treated as critical if it had.

---

## 11. Missing Evidence

D009/D010 passed. Exhibit Z not invented. Invoice silence not converted to “never paid/issued.”

---

## 12. Memory / Timeline / Analysis / Graph Boundaries

| Boundary | Live result |
| --- | --- |
| Proposed Timeline | Not in verified context (D013) |
| Proposed Memory | Not in prompt (D014) |
| Analysis | Not consumed (D015) |
| Graph | Only approved edges in verified graph text (D016). **Unproven Graph reliability** remains a Draft consumption risk via the “Verified relationships” label |

Evidence Matrix / Compare / Contradiction: not consumed.

---

## 13. Citations / Quotes

Assertions store chunkIds (FACT_SOURCE vs LEGAL_AUTHORITY). documentId recovered at grade time from chunks, not stored on the assertion row. D017/D023/D024 passed on D2. Quotes: D018 PASS after neutralizing unsupported quotation marks. **Not** a full sentence-level citation lock.

---

## 14. Versioning / Revision

Versions are append-only. D021: manual edit retains version 1. Restore copies assertions. `saveDraftVersion` still starts with empty `sourceAssertions` on the new row (non-critical). D022 regenerate preserved numbers.

---

## 15. Targeted Safety Gate (D2)

| Gate | Result |
| --- | --- |
| Proposed Timeline/Memory/Analysis not established | PASS |
| Badge ≠ physical entry | PASS |
| Silence ≠ universal negative | PASS |
| Missing exhibit not invented | PASS |
| False retroactivity not verified | PASS |
| Wrong-document attribution | PASS |
| Fabricated quotation | PASS |
| Version trail retained | PASS |

---

## 16. Final Draft Baseline (D2)

`2026-08-19T14-48-18-447Z` — **24/24 pass**, 0 fail, 0 infra, 0 critical.

Accuracy rates in summary all 1.00; unsupported assertion rate 0.

---

## 17. Transitions (D1 → D2)

| Transition | Count |
| --- | --- |
| PASS → PASS | 22 |
| INFRA → PASS | 2 (D018, D023) |
| PASS → FAIL | 0 |

Regressions: **none**.

---

## 18. Critical Failures

**0** on official D2. D1 critical count 0 (infra not scored as critical product lies).

---

## 19. Remaining Weaknesses

- Draft body is not citation-locked to each sentence.
- Manual edits do not copy `sourceAssertions`.
- Raw unreviewed chunks (up to 48) are the main generation fuel.
- User instructions still enter the prompt; refusal is model + overlay forbidden-phrase grading, not a full instruction firewall.
- Graph approved edges are labeled verified without an independent Graph freeze.
- Completeness: Draft does not use Analysis or Evidence Matrix (by design this phase).

---

## 20. Performance

D2 wall ~393s for 24 tasks (~16s median-class). Typically 1 model call per generate; extract/analyze/transform add calls. No performance work (not a beta blocker).

---

## 21. Regression Verification

Changed: Draft helpers + `generateDraft`/`transformDraftSection` parse/quote path. Overlay + grader only in nyaya-bench. Frozen Case Q&A, Compare, Contradiction, Timeline, Memory, Analysis, Evidence Matrix, Graph, Research, Agents, Security not modified to improve Draft.

Unit: `phase5-draft.test.ts`. Typecheck: intelligence + nyaya-bench.

---

## 22. Beta Assessment

1. Supported facts: yes on overlay.  
2. Material numbers: yes.  
3. Dates/temporal: yes on tested cases.  
4. Actor boundaries: yes.  
5. Missing facts: conservative on tested cases.  
6. Proposed intelligence as established: no on Timeline/Memory/Analysis.  
7. User assertions as verified: no on D011 live.  
8. Disputes: tension not collapsed on D012.  
9. Traceable material facts: chunk-level assertions, not sentence lock.  
10. Quotes: neutralized if unsupported.  
11. Revision provenance: versions kept; assertion copy on manual edit still weak.  
12. Remaining critical failures: 0 on D2.  
13. Safe enough for controlled beta **with lawyer review**: yes.  
14. Largest remaining risk: **Graph labeled as verified without Graph reliability**, plus **non-locked draft body**.

---

## 23. Freeze Decision

**FREEZE DRAFT** for controlled beta with mandatory attorney review. Drafts remain `draft` status; no filing/export automation.

---

## 24. Exactly One Next Phase

**PHASE 6O — GRAPH RELIABILITY**

Draft already injects approved graph edges as “Verified relationships.” Graph has not been independently proven. Do not start it in this workstream.
