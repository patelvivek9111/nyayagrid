# NYAYAGRID PHASE 6P — RESEARCH RELIABILITY BASELINE

Synthetic-fixture evaluation only. This is **not** attorney review. Beta Research is **local/public-corpus only**. Not Westlaw/Lexis. Not exhaustive legal research.

Frozen: Case Q&A, Compare, Contradiction, Timeline T2, Memory M2, Analysis/6J, DA1, CA1, EM2, **Draft D2**, **Graph G2**, Agents, Security P0, Performance P0, UX, V1/V2 PDFs, existing hidden GT, existing frozen baselines.

Production Research was **not** tuned before R1.

Companions: `BASELINE_R1_RESEARCH.md` / `.json`. If production changes: `BASELINE_R2_RESEARCH.md` / `.json` (do not overwrite R1).

---

## 1. Existing Research Architecture (verified in code)

```text
importAuthority (packages/research/src/ingest.ts)
  → legal_authorities (shared corpus, NO organizationId/matterId)
  → legal_authority_versions (immutable; superseded valid_to set)
  → legal_authority_chunks (+ embeddings)
  → legal_authority_citations (parsed outbound cites)

query: runResearchQuery (synthesize.ts)
  optional loadResearchMatterContext
    loadVerifiedMatterIntelligence  (approved Timeline/Facts)
    loadVerifiedGraphContext        (approved Graph G2)
    retrieveActiveMatterMemories    (approved Memory M2)
    used only to extractSearchConcepts + MatterContext prompt block
  AuthorityHybridRetriever.search (legal_authority_chunks ONLY)
    FTS + pgvector, citation/title boosts
    filters: jurisdiction, court, authorityType, dates, citation, ready, current version
  optional contrary query generation (LLM query strings only)
  loadAuthorizedAuthorityChunks
  LLM research-synthesis-v2
  validateSynthesisAgainstRetrieval (drop unknown ids, mismatched chunk/authority, unverified quotes)
  persist research_queries / research_results / research_artifacts
  coverage warnings always include LIMITED_CORPUS_WARNING + TREATMENT_UNVERIFIED_NOTICE

memo: generateResearchMemo (memo.ts)
  same retrieval; matter chunks → FACT_SOURCE facts/assumptions only
  validateMemoAgainstRetrieval
```

| Letter | Implementation |
| --- | --- |
| A ingestion | `importAuthority`; explicit metadata; no filename titles |
| B schema | `legal_authorities`, versions, chunks, citations, relationships; `research_sessions/queries/results/artifacts/notes`; `matter_authorities` |
| C chunking | `chunkSegments`; opinion parts / statute sections |
| D–E retrieval | hybrid FTS+vector; exact citation boost 0.75 |
| F–H filters | SQL equality on jurisdiction/court/dates |
| I metadata | title, citation, type, jxn, court, dates, treatmentStatus unknown\|source_reported |
| J sessions | `ensureResearchSession` |
| K matter-scoped | verified context for issue framing; matter docs not searched as authority |
| L synthesis | LLM + deterministic validator |
| M memo | separate artifact; not Draft D2 |
| N notes | `createResearchNote` origin manual\|ai |
| O treatment | no citator; `getTreatmentDisplay` refuses editorial terms unless source_reported |
| P downstream | Ask Nyaya legal-authority block; Agents `runResearchQuery` tool; Draft frozen and not modified |
| Q verified case context | approved Timeline/Facts/Graph/Memory only |

LLM: concept extraction, contrary queries, synthesis, memo. Deterministic: retrieval SQL, quote validation, id allow-lists, coverage warnings, weight labels (`potentially_binding` never “binding”).

---

## 2. Trust Model

| Class | Meaning |
| --- | --- |
| A | retrieved primary authority text |
| B | retrieved secondary (`authorityType=other`) |
| C | corpus metadata |
| D | model synthesis |
| E | model treatment/characterization |
| F | verified Case context (issue framing) |
| G | proposed Case context |
| H | missing / thin corpus |

Must not upgrade D/E/G/H into A.

---

## 3. Case context boundary

`loadResearchMatterContext` uses the same verified loaders as Draft/Graph freeze. Proposed Memory/Graph/Timeline are **not** in those loaders. R013 plants a proposed memory and fails if its text appears as law.

---

## 4. Corpus honesty

`LIMITED_CORPUS_WARNING` is mandatory in `buildCoverageWarnings`. Empty retrieval uses `NO_CORPUS_SYNTHESIS_ANSWER` / `NO_AUTHORITY_HITS_WARNING` — “not performed,” not “no such law exists.”

---

## 5–12. Audit notes (pre-R1)

Retrieval can filter jurisdiction; wrong-jxn decoys exist in overlay corpus. Weight classifier never emits “controlling/binding.” Treatment editorial vocabulary is blocked in display helpers; synthesis still must be graded because the LLM can emit those words in `conciseAnswer` before/without using those helpers.

Memo is a Research artifact (`research-memo-v1`), not Draft.

---

## 13. Benchmark design

`npm run bench -- v2 run research`. Overlay 18 tasks R001–R018 on SYNTH-V2-001. Corpus: production synthetic fixtures + bench `datasets/v2/research/corpus.json` imported through `importAuthority`. Hidden GT after persist.

---

## 14. R1 Baseline

Unchanged production. Live answers: `2026-08-19T16-09-49-522Z`. Official grades after R015 grader correction: `regrade-A1-2026-08-19T16-14-43-552Z`.

| | Official |
| --- | --- |
| Tasks | 18 |
| Pass | 15 |
| Needs work | 3 |
| Fail | 0 |
| Infrastructure | 0 |
| Critical | 0 |

Separate metrics (not one blended score):

| Metric | Result |
| --- | --- |
| Exact-citation retrieval (R001) | PASS |
| Case-name retrieval (R002) | NEEDS WORK — 999 F.3d 1 retrieved, but 888 F.3d 9 also in the hit set |
| Statute retrieval (R003) | Retrieval ranked § 100 first; synthesis **ungrounded** (validator dropped propositions) → NEEDS WORK |
| Semantic issue (R004) | Same ungrounded-synthesis pattern → NEEDS WORK |
| Jurisdiction filter (R005) | PASS |
| Primary vs secondary (R006) | PASS |
| Holding vs dissent (R007) | PASS |
| Citation/quote provenance (R008) | PASS |
| Treatment overclaim (R009) | PASS |
| Controlling/persuasive (R010) | PASS |
| Missing authority (R011) | PASS |
| Corpus silence (R012) | PASS |
| Proposed Case leak (R013) | PASS |
| Approved context (R014) | PASS |
| Wrong-authority cite (R015) | PASS after grader fix |
| Memo grounding (R016) | PASS |
| Malformed citation (R017) | PASS |
| Matter/corpus isolation (R018) | PASS |

Wall clock ~3.2 min for 18 tasks after corpus import. R003 latency ~6.8s synthesis.

---

## 15. Root causes

| Task | Class | Product vs bench |
| --- | --- | --- |
| R015 original FAIL | **L** benchmark | Grader used retrieval hits; question named the decoy |
| R002 | **B** ranking | Near-name decoy included in top-12 (target still present) |
| R003, R004 | **E/J** synthesis/schema | Hits correct; `grounded=false` because no proposition survived citation validation. Fail-closed, incomplete |

No A retrieval miss of § 100 on R003. No fabricated authority/quote on this overlay. No I proposed-context leak.

---

## 16. Production changes

**None.** Safety-critical classes passed. Remaining issues are recall/ranking noise and fail-closed ungrounded synthesis, not false law.

**No BASELINE_R2.**

---

## 17. Safety priority vs freeze bar

Critical classes on this overlay: **0** after official grades.

R003/R004 assert the conservative abstention string rather than inventing a rule. That is safer than hallucinated law and is scored needs_work (completeness), not fail.

---

## 18. Beta questions

1. Exact citations? **Yes on R001.** Citation filter + hybrid boost.
2. Semantic retrieval? **Partial.** Passages retrieve; synthesis sometimes drops all propositions (R003/R004).
3. Jurisdiction metadata? **Yes** (R005 filter; R010 not treated as controlling).
4. Primary vs secondary? **Yes enough for beta** (R006).
5. Holding vs party/dissent? **Yes on R007** for this fixture.
6. Fabricate authority names/citations? **Not observed**; validator strips unknown ids.
7. Fabricate quotations? **R008 pass** (unverified quotes stripped).
8. Unsupported treatment? **R009 pass.**
9. Persuasive as controlling? **R010 pass.**
10. Every material synthesis claim defensible? **When grounded, ids/quotes validated. When ungrounded, no claim is asserted.**
11. Proposed Case intelligence? **Does not enter as law** (R013). Loaders are approved-only.
12. Approved Case context? **Framing only** (R014). Law still from corpus.
13. Corpus silence as “no authority exists”? **No** (R011/R012/R017).
14. Memos grounded enough for human review? **R016 pass**, with mandatory corpus + treatment warnings.
15. Largest remaining Research risk? **Near-name / neighboring authorities in the hit list, plus synthesis that cites chunks incorrectly and then drops all propositions (incomplete answers). A lawyer might still over-read a decoy snippet in the raw hit list.**
16. Safe enough for controlled beta as **local/public-corpus research with lawyer review?** **Yes.**

---

## 19. Freeze decision

**FREEZE RESEARCH** at R1 (official regrade).

Conditions met: 0 critical trust failures; 0 fabricated authorities/quotes on the overlay; 0 proposed-context leakage; citation alignment when grounded; conservative silence; jurisdiction not materially overclaimed. Remaining problems are ranking noise and fail-closed incompleteness.

Not perfect. Not exhaustive. Not attorney-validated.

---

## 20. Exactly one next phase

**PHASE — AGENT RELIABILITY**

Do not start it here. Do not reopen Graph, Draft, Analysis, Memory, Timeline, Compare, Contradiction, or Case Q&A.
