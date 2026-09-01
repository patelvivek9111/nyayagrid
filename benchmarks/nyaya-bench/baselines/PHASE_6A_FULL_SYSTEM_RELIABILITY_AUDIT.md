# NYAYAGRID PHASE 6A — FULL-SYSTEM RELIABILITY AUDIT

**Date:** 2026-08-18  
**Scope:** Audit only. No production, prompt, grader, V1/V2, ground-truth, or V3 changes.  
**Case Q&A:** Frozen after Phase 5B. Last official 500-task score is Baseline A.4 (`nyaya-matter-qa-v11`). This audit does **not** recommend reopening Case Q&A optimization. Two downstream trust-boundary defects can *influence* Ask Nyaya; they belong to Timeline and Analysis, not to the Q&A prompt.

Inspection is of the repository as implemented. Product specs and README claims were used only as labels, never as evidence of existence.

---

## 1. Executive Summary

### What is actually implemented?

Professional NyayaGrid is a single Next.js + PostgreSQL + MinIO system. The live professional path is **synchronous API code**, not Inngest. `packages/jobs` registers only a `ping` handler; Inngest jobs for malware, extract, graph, analysis, research, and agents return success stubs when no domain handler exists.

Implemented in production code:

- Document upload, storage, text extract, chunk, embed, retrieve
- Case Q&A (`askNyayaAboutMatter`)
- Contract compare (`compareDocuments`)
- Contradiction/tension detection (`detectContradictionCandidates`)
- Timeline / facts / entities / deadlines extraction + review
- Graph candidate extraction + verified materialization
- Memory propose / create / review / supersede
- Contract analysis, deposition analysis, evidence matrix (derived), discovery classify/tags/duplicates, redlines
- Draft generate / version / revise
- Research over a **local imported authority corpus only**
- Nine agents that invoke **real** NyayaGrid tools (not empty scaffolding)

### What is mature?

- **Case Q&A** is the only subsystem with independent NYAYA-BENCH grading, a frozen production path, and a published 500-task baseline (A.4: 391/500 pass, 78.2%).
- **Ingestion** is the same pipeline NYAYA-BENCH uses (`processDocumentPipeline`). Text PDFs that parse successfully are production-ready enough for Q&A.
- **Permissions** (org + matter membership + capability checks) are implemented and covered by phase integration tests, including Student/Public isolation from professional `document_chunks`.
- **Research** already refuses to search matter-document fields and warns that the corpus is not comprehensive. Beta does **not** require Westlaw/Lexis.

### What is largely untested?

Independently graded by NYAYA-BENCH today: **Case Q&A only** (default `case-qa` mode).

Full-system mode *invokes* Compare, Contradiction, and Timeline, then grades the serialized blob with the **same chat/needle grader**. Graph, Memory, Research, Draft, Analysis, and Agents have **zero** V1/V2 categories and are `NOT_APPLICABLE_TO_SUBSYSTEM` unless smoke-overridden. Smoke is not a score.

`eval:ai` has structured Compare and Contradiction graders on golden snippets. Those graders are **not** wired to NYAYA-BENCH.

### Top beta risks

1. **Compare / Contradiction are production features lawyers will use, but NYAYA-BENCH does not independently grade their structured output.** Default bench still scores chat answers. Full-system extras (`comparisonId`, finding counts) are not scored.
2. **Verified Timeline dates can look exact in Ask Nyaya** because `formatVerifiedIntelligenceForPrompt` omits `datePrecision`.
3. **Proposed/unreviewed analysis findings are injected into Ask Nyaya** (labeled, but present). Comparison summaries are injected without a reviewed/proposed split.
4. **Manual Memory writes are immediately `approved` and become Case facts.** There is no expiry and no memory-vs-document contradiction check.
5. **Draft body text is not citation-locked.** Unknown chunk IDs are dropped from assertions; the narrative can still invent uncited facts.
6. **Async job infrastructure is a stub.** Production reliability today is the sync API. Horizontal scale and crash-recovery of long extracts are not demonstrated.

---

## 2. Architecture Map

What the **code** does (not the conceptual product diagram).

```text
Upload POST /api/v1/matters/:matterId/documents
    │  AUTOMATIC (sync)
    ▼
processDocumentPipeline
    malware scan → extract (pdf-parse / mammoth / txt)
    → chunkSegments (1200/150) → embeddings → documentChunks
    │  OCR exists but is NOT wired; image PDFs stop at requires_ocr
    ▼
extractMatterIntelligenceForDocument   AUTOMATIC after successful ingest
    proposed timeline / facts / entities / deadlines
    │
    ├─► Attorney review (reviewTimelineEvent / facts / entities / deadlines)
    │     APPROVED-ONLY for Q&A, Draft, Graph nodes, agent getVerifiedTimeline
    │
    ├─► materializeVerifiedGraph          MANUAL / API-triggered
    │     nodes from verified intel; AI edges start proposed
    │     APPROVED edges only → Ask Nyaya / Draft / graph_agent
    │
    ├─► proposeMatterMemories             MANUAL / agent (writes proposed)
    │     createMatterMemory origin=manual → immediately approved
    │     APPROVED + not superseded → Ask Nyaya / Draft
    │
    └─► Retrieval (PostgresHybridRetriever)
          AUTOMATIC for Ask Nyaya

Ask Nyaya  POST .../ask  mode=ask
    retrieval + deterministic evidence assessment + v11 prompt
    defaults ON: verified intel, graph, memory, professional analysis
    legal authority ON in product, OFF in NYAYA-BENCH

Analysis (separate HTTP, not automatic on upload)
    compareDocuments | analyzeContract | analyzeDeposition
    detectContradictionCandidates | discovery classify/tags/duplicates
    evidence matrix is a derived read model
    findings persist as proposed; some proposed findings enter Ask Nyaya (labeled)

Draft  generateDraft
    verified intel + approved graph + approved memory
    + first 48 chunks by chunkIndex (not hybrid rank)
    + saved matter authorities only (no live Research search)
    OPTIONAL research notes if includeLegalAuthority

Research  runResearchQuery
    LocalImportedAuthorityProvider / AuthorityHybridRetriever
    legal_authority_chunks only; matterId/documentId fields forbidden
    OPTIONAL; not on the ingest path

Agents  NyayaOrchestrator.runTask
    plan → execute real tools → persist run/steps/tool calls
    high-risk writes need reviewApproval
    prohibited forever: sendEmail, fileCourt, makePayment,
                        deleteEvidence, approvePrivilege, contactExternal
```

Connection types (from code):

| Edge | Kind |
| --- | --- |
| Upload → pipeline → chunks | Automatic |
| Pipeline → intelligence extract | Automatic after ready ingest |
| Extracted intel → Q&A / Draft / Graph nodes | Approved-only |
| Graph AI edges → Q&A | Approved-only |
| Memory AI propose → Q&A | Approved-only |
| Memory manual create → Q&A | Immediate approved (no extra review) |
| Analysis findings → Q&A | Optional default-on; **includes proposed** (labeled) |
| Comparison summaries → Q&A | Optional default-on; **no review split** |
| Research → Draft | Optional; saved authorities only, not live search |
| Agents → tools | Manual run; tools hit real packages |
| Inngest → domain work | Currently unused (ping only) |

---

## 3. Documents / Ingestion

### Implementation

Production entry: `POST /api/v1/matters/[matterId]/documents` → `processDocumentPipeline` (`packages/documents/src/pipeline.ts`).

Pipeline: malware scan → extract → chunk → embed → persist `documentChunks`. Storage is `S3CompatibleStorageProvider` (`packages/documents/src/storage.ts`). Object keys are `org/{organizationId}/documents/{documentId}/versions/{versionId}/{filename}` (`storageKeyForOrganization`). Downloads go through `requireMatterAccess` + `authorizeAndSignDocumentDownload` (quarantine/malware-blocked states refused).

Limits observed in pipeline: large-document caps (on the order of 2000 pages / 2M extracted characters). Chunking is 1200 tokens with 150 overlap.

NYAYA-BENCH uses the **same** `processDocumentPipeline` (`benchmarks/nyaya-bench/runner/ingest.ts`), forcing `DevelopmentMalwareScanner`. After ingest it can call `extractMatterIntelligenceForReadyDocuments`.

Gaps in the ingest path:

- `ocr.ts` exists; the pipeline **does not call it**. Image PDFs remain `requires_ocr` and never chunk.
- Upload always writes `versionNumber: 1`. There is no matter-document DELETE route and no multi-version replace on that POST.
- Inngest `document.malware_scan` / extract jobs are stubs (`apps/web/src/inngest/functions.ts`; `domainHandlers` in `packages/jobs/src/index.ts` is ping-only). Live processing is the sync request.

### Tests

Package/integration coverage exists for pipeline, storage keys, download authorization, and Student/Public isolation (`packages/permissions` phase 2–8 tests). NYAYA-BENCH 500-task ingest is the strongest end-to-end proof that text PDFs chunk and retrieve.

### Benchmark coverage

V1/V2 PDFs are ingested through production extract/chunk/embed. That is implicit coverage of the text-PDF path, not of OCR, deletion, versioning, or malware-true-positive handling.

### Risks

- Scanned/image PDFs silently fail extraction (`requires_ocr`).
- No document delete/update versioning in the professional upload API (retention / correction workflow incomplete).
- Bench malware scanner is development-only; production scanner wiring is not proven by NYAYA-BENCH.
- Async retry/crash recovery for ingest is not implemented (sync only).

Beta risk for text-PDF professional use: **MEDIUM**. Beta risk if scanned PDFs are in-scope: **HIGH**.

---

## 4. Case Q&A

### Frozen state

Do not optimize. Last official run: Baseline A.4, prompt `nyaya-matter-qa-v11`, 391/500 (78.2%), 0 infra, 1 remaining critical (`SYNTH-010-Q008` addressed in 5B follow-up on product; A.5 was not run). Phase 5B freeze: `PHASE_5B_COMPLETION_REPORT.md`. T014 is a documented benchmark-date erratum, not a product reopen.

Production path:

- HTTP `POST /api/v1/matters/[matterId]/ask` with `mode=ask`
- `askNyayaAboutMatter` (`packages/search/src/nyaya.ts`)
- Hybrid retrieve → deterministic `assessRetrievedEvidence` (no extra LLM) → v11 generate → citation validate → `constrainCitedAnswer`

Defaults **on** unless the caller disables them: verified intelligence, graph, memory, professional analysis. Legal authority is on in product; NYAYA-BENCH sets `includeLegalAuthority: false`.

Independently graded: **yes**, default `case-qa` mode. Hidden GT isolated. Persist-then-grade.

### Dependencies other subsystems have on it

- HTTP `mode=task` / auto may hand off to `NyayaOrchestrator`; bench `case-qa` never does.
- Timeline / Graph / Memory / Analysis **feed into** Q&A; Q&A does not write them.
- Agents may classify `simple_qa` and return to Ask Nyaya.

### Integration defects (do not treat as Q&A prompt work)

1. `formatVerifiedIntelligenceForPrompt` prints `eventDate.toISOString()` and omits `datePrecision` (`packages/intelligence/src/verified.ts`). Approved approximate dates can appear exact inside Ask Nyaya.
2. `formatProfessionalAnalysisForPrompt` injects `[PROPOSED/UNREVIEWED]` findings and unlabeled comparison summaries (`packages/intelligence/src/analysis/context.ts`).

These are **consumer-side trust-boundary defects in Timeline/Analysis formatting**, not Case Q&A retrieval/prompt defects. Do not reopen Q&A optimization to fix them.

---

## 5. Compare

### Implementation

`compareDocuments` in `packages/intelligence/src/analysis/compare.ts`.

- Loads chunks for two matter-scoped document versions
- Deterministic `computeParagraphDiffs`
- Optional AI summary, then `applyComparisonSummaryAlignmentPolicy` / `scoreComparisonSummaryAgainstDiffs`
- Persists `documentComparisons` + `documentComparisonChanges`
- Idempotency key `document_comparison:{sortedVersionIds}`

This is **not** `analyzeContract` and not the redline suggestion flow.

### Production path

`POST /api/v1/matters/[matterId]/analysis/comparisons`. Agent tool: `compareDocuments`. Contract agent calls it when `wantsContractCompare` is true.

### Existing tests

- `packages/intelligence/src/evals/grade-contract-compare.ts` (diff identity, empty, material vs decoy-style cases via `eval:ai`)
- Integration tests in permissions/intelligence packages for the API/persistence path

### V1/V2 coverage

| Dataset | Mapped categories | Approx. tasks |
| --- | --- | --- |
| V2 | `contract_compare` (16), `contract_decoy` (32) | 48 |
| V1 | `contract_compare`, `decoy` | ~15 |

**Default `case-qa` mode:** these tasks are still answered by Ask Nyaya. Compare output is not graded.

**`full-system` / `--mode compare`:** calls real `compareDocuments`, serializes `summary + changes` JSON, grades with the **chat/needle grader** against chat-shaped GT (`material_changes`, `non_material_change`). Extras (`comparisonId`, `comparisonSummary`, `comparisonChangeCount`) are **not scored**.

### Ground truth available

**Directly usable for a structured grader:** V2 T007-style `canonical_answer` lists (e.g. notice 45→30 days; cap $255,000→$510,000) and T008/T009 decoy (exhibit renumber, typo) are written into the PDFs and GT.

**Not independently graded today:** material vs non-material classification on the *persisted change rows*.

### Risks

- Lawyers may treat the AI summary as the amendment. Alignment policy exists; NYAYA-BENCH does not score it.
- Full-system “pass” can be a chat needle hitting JSON text, not a correct change list.
- Agent compare picks the first two retrieved versions, which may not be the intended pair.

### Recommended evaluation

Deterministic (change list, decoy exclusion) + adversarial (renumber/typo/recital) + light rubric on summary alignment. Human review eventually for “material” edge cases. **Do not implement in this phase.**

---

## 6. Contradiction

### Implementation

`detectContradictionCandidates` (`packages/intelligence/src/analysis/deposition.ts`).

- Caps retrieval at 48 chunks
- LLM candidates + deterministic filters (`filterImpreciseDateContradictionCandidates`, `findExactCrossDocumentDateConflicts`)
- Cross-document sources → `findingType: "contradiction"`; same-document → `"tension"`
- Status **`proposed`**; sources required on both sides or the candidate is rejected
- Optional timeline linking (read-only; skipped for `rejected` events)

### Production path

`POST /api/v1/matters/[matterId]/analysis/contradictions`. Agent tool: `detectContradictions`. Evidence agent invokes it.

### Existing tests

`packages/ai/src/evals/grade-contradiction.ts` (CX-* golden snippets, decoy chunk bans, imprecise-date rejects). Not used by NYAYA-BENCH.

### V1/V2 coverage

V2: 16 `contradiction` + 16 `false_contradiction` (T010 testimony vs badge log; T011 “near mid-November” vs 2026-11-10). Same pattern as Compare: case-qa = chat; full-system = real engine + chat grader on JSON. Finding counts are extras, not scores.

### Ground truth available

**Derivable / partially direct:** T010/T011 encode the intended legal distinction (tension with limitation vs compatible date precision). The engine’s `tension` vs `contradiction` labels do not match chat GT wording (“genuine evidentiary tension”).

**Not sufficient as-is for independent structured grading** without a mapping from findingType + sources to those expectations.

### Risks

- False contradictions (strategy noise) and missed real conflicts (malpractice-adjacent if relied on).
- Proposed findings can still enter Ask Nyaya labeled `[PROPOSED/UNREVIEWED]`.
- 48-chunk cap can miss a pair in large matters.

### Recommended evaluation

Deterministic (pair identity, source docs, tension vs contradiction, false-contradiction reject) + adversarial (paraphrase, imprecise dates, decoy chunks). Human review for “does this change case theory?” **Do not implement yet.**

---

## 7. Timeline

### Implementation

Automatic after successful document ingest: `extractMatterIntelligenceForDocument` writes **proposed** events (plus facts, entities, deadlines). Dates stored with `datePrecision`. Conservative dedupe (`findDuplicateTimelineEvent`: same type + same calendar day + Jaccard ≥ 0.4 + actor overlap; **rejected rows are skipped**, so a rejected event can be re-proposed). Missing dates stay unknown; extraction should not invent ISO dates (prompt/schema require precision labels).

Approval: `reviewTimelineEvent`. Approve/edit_and_approve **requires at least one source row**. Rejected events are excluded from default `listTimelineEvents` (default status = approved / edited_and_approved). Q&A uses `loadVerifiedMatterIntelligence` (approved only).

### Production path

Extract on upload; `GET /api/v1/matters/[matterId]/timeline`; review route. Agent `getVerifiedTimeline` loads **approved only**.

Does Timeline affect Ask Nyaya? **Yes, if events are approved.** Proposed events do not load in `verified.ts`. The dangerous gap is formatting: approved events are rendered without precision, so “approximate” can look like an exact timestamp.

### Existing tests

Intelligence extract/dedupe/review unit and integration tests exist. No independent NYAYA-BENCH Timeline score.

### V1/V2 coverage

V2: 32 tasks tagged `timeline`. T012-style GT is a dated event list from the invoice/remittance PDF (directly useful as extraction GT). T025 is `must_abstain` about badge-carrier identity — a **Case Q&A trap**, not Timeline extraction GT. Full-system lists **proposed + approved**, so unreviewed invented events would be in the blob the chat grader sees.

### Ground truth available

**Directly usable (narrow):** invoice/remittance date chains (T012).  
**Insufficient:** invented events, participant support, approximate-vs-exact, duplicate merge, rejection exclusion, approval workflow.

### Risks (dangerous failure modes)

| Mode | Code status |
| --- | --- |
| Invented events | Possible at extract; gated by review for Q&A |
| Wrong dates | Possible; precision dropped in Q&A prompt |
| Duplicates | Conservative dedupe; uncertain matches kept |
| Combining separate events | Possible if titles similar on same day |
| Unsupported participants | `actors` are model-proposed; approval requires sources, not actor proof |
| Approximate treated as exact | **Yes, in Q&A formatting** |
| Losing citations | Approve blocked without sources; prompt may still omit them |
| Unapproved as verified | Q&A/Draft/agents using verified loader: no. Bench timeline list: includes proposed |

### Recommended evaluation

Deterministic event/date/source checks on proposed output; adversarial date-precision and invention traps; workflow for reject-stays-out. Human review for “is this one event or two?”

---

## 8. Graph

### Implementation

- Nodes: materialized from **verified** entities/intel (`materializeVerifiedGraph`).
- AI edges: `extractGraphRelationshipCandidates` — requires approved nodes; 40 nodes / 24 chunks; edges start **proposed** with `sourceChunkIds`.
- Types include `works_for`, `signed`, `communicates_with`, `party_to`, `supported_by`, etc. (`GRAPH_RELATIONSHIP_TYPES`). No signer-identity validator. Mislabel (`communicates_with` stored as `works_for`) stays proposed until review.
- Auto-approved structural `supported_by` exists for verified-source links.
- Q&A: `loadVerifiedGraphContext` — **approved edges only**.
- Aliases live on entities (`entityAliases`); duplicate people are a resolution/review problem, not an automatic merger with conflict detection.

Deletion/update: edge review can reject; no evidence of a full graph-delete API analogous to document delete (which also does not exist).

### Production path

`POST .../graph/extract`, `GET .../graph`, review routes. `graph_agent` tools: `getMatterGraphNeighborhood`, `getVerifiedTimeline` (read-only).

### Existing tests

Package tests around materialize/extract. **Zero V1/V2 graph categories.** Full-system `--mode graph` is not_applicable on V1/V2 unless smoke override.

### V1/V2 coverage

Documents contain people, orgs, signatures, and communications, but **no graph relationship GT**. Entity-resolution Q&A tasks test chat naming, not edge types.

### Ground truth available

**Derivable with care** from synthetic PDFs (who signed which amendment; who emailed whom). **Requires new rubric/scenario** for employment vs communication, wrong-signer, alias collapse, conflicting edges.

### Risks

Exactly the examples in the brief: `works_for` vs `communicates_with`; `signed` attached to the wrong person. Mitigated **until approval**. After rubber-stamp approval, those edges enter Q&A and Draft.

### Recommended evaluation

Deterministic relationship-type and endpoint identity + adversarial signer/employment traps. Workflow: proposed must not appear in `loadVerifiedGraphContext`.

---

## 9. Memory

### Implementation

- AI: `proposeMatterMemories` → `createMatterMemory` with `status: "proposed"`.
- Manual: `status` defaults to **`approved`** when `origin === "manual"`; confidence defaults to `high`.
- Types: `verified_context`, `strategic_note`, `entity_resolution`, `document_significance`, `factual_caveat`, `user_instruction`, `matter_preference`, `procedural_context`, `other`.
- Active retrieval (`retrieveActiveMatterMemories`): `approved` / `edited_and_approved` and `supersededBy IS NULL`. Loads **all** active rows then ranks in process (embedding + importance + lexical).
- Supersession: new approved memory, old set `superseded`.
- `expiresAt` is **unused**. No memory-vs-document contradiction detector.
- Q&A and Draft consume `formatActiveMemoryForPrompt` of active memories.

### Primary safety question

**Yes. Nyaya Memory can turn an uncertain or outdated proposition into a persistent Case fact** if:

1. A human creates it as `verified_context` (immediate approve), or  
2. A human approves an AI proposal that overstated the documents.

Proposed AI memories do **not** enter Q&A until approval. That gate is real. The product does not prevent approving low-confidence or stale content, and it will not expire.

### Existing tests

Memory present/review integration tests. **Zero V1/V2 memory categories.**

### Ground truth available

Not in V1/V2 as memory GT. Some Q&A caveats (badge log limitation, email recollection) could **derive** “must not persist as verified_context” tests, but that needs new task design.

### Risks

Stale approved memory outranks newer documents in Q&A. Unverified AI text becomes durable after one click. Agents can `proposeMemory` (proposed) and `createTaskProposal` (high-risk approval).

### Recommended evaluation

Adversarial promotion traps + workflow (proposed excluded; superseded excluded; reject excluded) + deterministic provenance. Human review for “is this strategy or fact?”

---

## 10. Analysis

Every capability below exists in code unless marked otherwise.

### 10.1 Contract analysis

| | |
| --- | --- |
| Entry | `analyzeContract`; HTTP `.../analysis/contracts`; agent `analyzeContract` |
| Path | LLM structured items + persist `documentAnalyses` / items; idempotent per version |
| Schema | Contract analysis item schema in `@nyayagrid/ai` |
| Citations | Item-level source chunks |
| Persistence | Yes |
| Approval | Items reviewable (`accepted` / `rejected`); run-level proposed vs reviewed |
| Tests | Package/eval snippets; **not** NYAYA-BENCH |
| V1/V2 | No `analyzeContract` tasks. `numeric_precision` is **Case Q&A**, not this engine |
| Risk | **HIGH** — clause misread feeds Q&A if reviewed or even if still proposed (labeled) |

### 10.2 Redlines

Separate from Compare. Contract analysis can generate redline suggestions; review route `.../redlines`. Not independently benchmarked. Risk **HIGH** if applied without reading the base text; **MEDIUM** if treated as suggestions only.

### 10.3 Deposition analysis

| | |
| --- | --- |
| Entry | `analyzeDeposition`; HTTP `.../analysis/depositions`; agent `analyzeDeposition` |
| Path | LLM over deposition chunks; findings persisted proposed |
| Citations | Finding sources |
| V1/V2 | Deposition PDFs exist; tasks are Q&A/contradiction, not deposition-analysis schema |
| Risk | **HIGH** (testimony characterization) |

### 10.4 Contradiction findings

Covered in §6. Also listed here because they persist as `analysisFindings` and enter professional analysis context.

### 10.5 Evidence matrix

`getEvidenceIntelligence` (`packages/intelligence/src/evidence/index.ts`). **Derived**, not an LLM: approved facts/events/graph/discovery review states. Agent tool `getEvidenceMatrix`. HTTP evidence routes exist. Risk **MEDIUM** (wrong if upstream intel is wrong; lower hallucination). Not independently bench’d. V1/V2 insufficient as matrix GT.

### 10.6 Discovery review

Classify, tags, near-duplicates, privilege **proposal** vs `humanPrivilegeFinal`. Agent cannot `approvePrivilege` (prohibited). Risk **MEDIUM** (privilege false-negative is serious, but human-final flag exists). No V1/V2 discovery GT.

### 10.7 Document comparison

See §5.

### 10.8 Findings / tags / duplicate grouping

Findings: analysis runs + review. Tags/duplicates: discovery package. Implemented, not spec-only.

### 10.9 Bench stand-in defect

`executionTarget=analysis` in `execute-subsystems.ts` calls **`generateDraft`**, not `analyzeContract` / `analyzeDeposition`. Smoke must not be read as analysis coverage.

---

## 11. Draft

### Implementation

`generateDraft` (`packages/intelligence/src/draft/index.ts`). HTTP `POST .../drafts`; versions; restore; `transformDraftSection` / revise.

Context actually loaded:

- Verified timeline/facts/entities/deadlines
- Verified graph neighborhood
- Active (approved) memories
- Up to **48 chunks ordered by `chunkIndex`** (not hybrid retrieval)
- Saved matter legal authorities if `includeLegalAuthority` (NYAYA-BENCH draft stand-in sets this **false**)

**Not used:** live `runResearchQuery`. Comments in helpers: external research note / incomplete-authority note.

### Grounding architecture

`resolveDraftAssertions` drops assertions whose chunk IDs are not in matter chunks or saved authorities. That constrains the **assertion list**, not the free-text body. Unsupported facts can still appear in the narrative. `classifyDraftAssertions` counts provenance; placeholders/assumptions are extracted.

User editing: version history + restore. Distinguishing verified vs unverified facts in the **body** is prompt/context-dependent; unverified intel is not loaded, but analysis proposed findings are **not** in `buildDraftVerifiedContext` (Draft is stricter than Ask Nyaya here).

### Risks

- Invented facts in body despite dropped assertions
- First-48-chunks may omit the operative amendment
- Approved Memory/Timeline errors propagate into work product
- Lawyers may send a “draft” after light review (product still labels drafts; enforcement is social)

### Evaluation requirements

Deterministic support/conflict/missing-info tests; adversarial “requested proposition unsupported”; revision-without-new-facts; citation preservation. Rubric + human review for professional quality. **Zero V1/V2 draft tasks.**

---

## 12. Research

### Current sources

**`LocalImportedAuthorityProvider` only.** No Westlaw/Lexis/premium connector in the research package. Beta **does not** depend on premium legal databases.

Corpus = imported `legal_authorities` / versions / `legal_authority_chunks`. Import CLI exists. Matter documents are **forbidden** in authority SQL (`FORBIDDEN_MATTER_FIELDS`: `documentId`, `documentVersionId`, `matterId`, `organizationId`).

### Retrieval / synthesis / memos / citations / notes

`runResearchQuery` → hybrid authority search → synthesis with citation allow-list / quote checks → persist session/query/results/artifacts. Memos and notes APIs exist. Jurisdiction and date filters exist on search options. Treatment is displayed when source-reported; otherwise unverified.

Coverage warning (actual string in `packages/research/src/synthesize.ts`):

> Search covered only the authorities imported into this NyayaGrid corpus; it is not a comprehensive survey of the law of any jurisdiction.

Product code does **not** claim comprehensive coverage in that synthesis path.

### Hallucination risks

Invented cases/citations/holdings remain possible in model text; citation validation and allow-lists reduce but do not eliminate them. Wrong jurisdiction / outdated law: filters exist; “current law” is not a live Shepardizing engine. Unsupported quotations: quote validation exists in research. Empty corpus + user asking for “the leading case” is the highest-risk prompt.

### V1/V2

**Zero** research tasks. Matter PDFs are not an authority corpus.

### Evaluation requirements

Adversarial invented-citation traps against a **known small corpus**; deterministic “must abstain / coverage warning”; jurisdiction filter; refuse to cite matter evidence as authority. Human review for memo usefulness.

**Confirm:** no premium database is required for a responsible limited-corpus beta, provided UI copy matches the corpus warning.

---

## 13. Agents

Agents execute **real tools** wrapping `@nyayagrid/intelligence`, `@nyayagrid/research`, and `@nyayagrid/search`. They are not empty orchestrator stubs. They **are** thin planners over those tools; reliability is bounded by the tools.

Shared: `NyayaOrchestrator`, `planAgentRun`, `createAgentRun` / `executeAgentRun`, budgets (default maxSteps 12, maxToolCalls 40, timeout 120s), `MAX_ORCHESTRATION_DEPTH = 1`, persist steps/tool calls, `reviewApproval` for high-risk writes. HTTP `POST .../matters/[matterId]/agents` and ask `mode=task`.

Prohibited tools (hard fail): `sendEmail`, `fileCourt`, `makePayment`, `deleteEvidence`, `approvePrivilege`, `contactExternal`.

NYAYA-BENCH `--mode agents` calls `NyayaOrchestrator.runTask`. Process metrics are **not measurable** without agent GT. V1/V2: not_applicable.

---

### research_agent

**Purpose:** Search local authority corpus; save research artifact.  
**Tools:** `searchLegalAuthorities`, `saveResearchArtifact`, `getVerifiedTimeline`, `retrieveMatterMemory`.  
**Inputs:** goal/objective. **Outputs:** synthesis + citations + coverage warnings.  
**Approval:** low-risk research writes; no court filing.  
**Matter data:** optional verified timeline/memory for question framing; authorities are the corpus.  
**Failure:** tool deny / empty hits.  
**UI:** agents run / research intent.  
**Tests:** agent package tests; no bench GT.  
**Readiness:** usable against imported corpus; not a Westlaw replacement.  
**Risks:** invented citations if validation missed; users over-trust memos.

### draft_agent

**Purpose:** Generate/revise drafts.  
**Tools:** `retrieveMatterChunks`, `getVerifiedTimeline`, `retrieveMatterMemory`, `createDraft`, `reviseDraft`.  
**Approval:** medium-risk; draft is internal (not sent).  
**Readiness:** same as Draft.  
**Risks:** same as Draft; may not call Compare/Research.

### contract_agent

**Purpose:** Clause review or version compare.  
**Tools:** `retrieveMatterChunks`, `analyzeContract`, `compareDocuments`.  
**Approval:** low; findings proposed.  
**Readiness:** real tools; version pairing is retrieval-heuristic.  
**Risks:** wrong document pair; unreviewed findings later enter Q&A.

### evidence_agent

**Purpose:** Retrieve, matrix, contradictions.  
**Tools:** `searchMatterDocuments`, `retrieveMatterChunks`, `getEvidenceMatrix`, `detectContradictions`, `getVerifiedTimeline`, `retrieveMatterMemory`.  
**Approval:** contradictions remain proposed.  
**Risks:** same as Contradiction + Timeline/Memory if approved intel is wrong.

### discovery_agent

**Purpose:** Queue + propose classification.  
**Tools:** `getDiscoveryReview`, `proposeDiscoveryClassification`, `retrieveMatterChunks`.  
**Approval:** cannot finalize privilege.  
**Risks:** privilege proposal misread as final if UI is weak.

### deposition_agent

**Purpose:** Deposition analysis.  
**Tools:** `retrieveMatterChunks`, `analyzeDeposition`, `getVerifiedTimeline`.  
**Risks:** same as deposition analysis.

### timeline_agent

**Purpose:** Read verified timeline (does **not** extract or approve).  
**Tools:** `getVerifiedTimeline`, `searchMatterDocuments`, `retrieveMatterMemory`.  
**Readiness:** read-only over approved intel. Empty if nothing approved.  
**Risks:** low write-risk; can echo bad approved dates.

### graph_agent

**Purpose:** Read approved neighborhood.  
**Tools:** `getMatterGraphNeighborhood`, `getVerifiedTimeline`.  
**Readiness:** read-only. Does not extract/approve edges.  
**Risks:** same as approved graph.

### memory_agent

**Purpose:** Propose memories and task proposals.  
**Tools:** `retrieveMatterMemory`, `proposeMemory`, `createTaskProposal`, `getVerifiedTimeline`.  
**Approval:** memories written **proposed**; tasks via `reviewApproval` (high).  
**Risks:** if a later path auto-approves, this becomes a fact pump. Current write path is gated.

---

**Production readiness overall:** orchestration is real; agent reliability **cannot** exceed Compare/Contradiction/Draft/Research/Timeline. Do not harden Agents first.

---

## 14. Verified / Unverified Trust Boundaries

### Status vocabulary in code

| Domain | States |
| --- | --- |
| Timeline / facts / entities / deadlines | `proposed`, `approved`, `edited_and_approved`, `rejected` |
| Memory | those plus `archived`, `superseded` |
| Graph edges/nodes | proposed / approved / edited_and_approved / rejected |
| Analysis findings | `proposed`, `reviewed` (and item accept/reject) |
| Discovery privilege | AI proposal vs `humanPrivilegeFinal` |
| Drafts | drafts until explicit use; not the same enum |

Uncertain: confidence labels (`low`/`medium`/`high`) on intel and memory. Contradicted: finding types + timeline links, not a first-class “fact is contradicted” flag on Memory. Superseded: Memory only.

### Where unverified can flow

| Path | Unverified consumed as Case fact? |
| --- | --- |
| Timeline → Q&A | No, if status gate holds. **Precision dropped** after approval. |
| Graph → Q&A | No until edge approved. |
| Memory → Q&A | No for AI-proposed. **Yes immediately for manual create.** |
| Analysis → Q&A | **Yes, labeled proposed findings + unlabeled comparison summaries.** Weakest gate. |
| Analysis → Draft | Draft verified builder does **not** load analysis context. Safer than Q&A. |
| Research → Draft | Only saved authorities, optional flag. |
| Agents → all | Read tools respect verified loaders; write tools mostly proposed + approval. Compare/analyze persist proposed findings that later enter Q&A. |

### Safeguards that exist

Matter/org scoping; source-required timeline approval; memory proposed vs approved; prohibited agent tools; research corpus isolation; citation allow-lists on Q&A/research/draft assertions.

### Potential problems (do not fix in 6A)

1. Ask Nyaya professional analysis context includes proposed findings and comparison summaries.  
2. Timeline datePrecision omitted in Q&A/Draft prompt formatting.  
3. `normalizeSourceChunkIds` falls back to **all available chunk IDs** when the model omits UUIDs (`packages/ai/src/intelligence.ts`) — can attach whole-document provenance to a proposal.  
4. Manual memory approve-on-create.  
5. Rejected timeline events can be re-extracted (dedupe skips rejected).  
6. Benchmark full-system Timeline grades **proposed** events.

No Case Q&A prompt change is required to list these. They are intelligence/analysis formatting and status bugs.

---

## 15. NYAYA-BENCH Current Coverage

### Datasets (inspected)

- **V1:** 10 matters, 50 PDFs, 100 tasks  
- **V2:** 16 matters, 128 PDFs, 400 tasks (25-task template × 16)

### What default mode tests today

**Case Q&A only.** All categories, including `contract_compare` and `contradiction`, go through `askNyayaAboutMatter`.

### Full-system mapping (`runner/routing.ts`)

| Target | Invoked? | Persisted? | Independently graded? | Hidden GT isolated? | Grade after persist? |
| --- | --- | --- | --- | --- | --- |
| Case Q&A | Yes | Yes (answer + citations) | **Yes** | Yes | Yes |
| Compare | Yes in full-system | Comparison rows + answer blob | **No** (chat grader on JSON; extras unscored) | Yes | Yes |
| Contradiction | Yes in full-system | Findings + blob | **No** (same) | Yes | Yes |
| Timeline | Yes in full-system | Extracted events + blob (includes proposed) | **No** (chat grader; T025 is Q&A GT) | Yes | Yes |
| Graph | Executor exists | Yes if invoked | No V1/V2 tasks | N/A | N/A |
| Memory | Executor exists | Proposals | No V1/V2 tasks | N/A | N/A |
| Research | Executor exists | Session/query | No V1/V2 tasks | N/A | N/A |
| Draft | Executor exists | Draft | No V1/V2 tasks | N/A | N/A |
| Analysis | **Stand-in `generateDraft`** | Draft | No | N/A | N/A |
| Agents | Orchestrator real | Run records | No agent GT; metrics not measurable | N/A | N/A |

Hidden GT remains isolated from production prompts. Compare and Contradiction **are** recorded as extras in full-system; that is still true in current runner code, not only in older Phase 4/5 reports.

---

## 16. V1/V2 Reuse Matrix

| Subsystem | Directly usable | Derivable GT | Needs new rubric | Needs new scenario |
| --- | --- | --- | --- | --- |
| Case Q&A | Yes (entire V1/V2) | — | — | Frozen; do not expand for Q&A |
| Compare | V2 T007–T009 answers + PDFs | Structured change rows from the same amendments | Materiality edge cases | Not required for core compare |
| Contradiction | T010/T011 intent | Map findings to tension vs compatible | Source-pair identity grader | Not required for the two core traps |
| Timeline | T012 date lists | Event extraction from invoice/email/minutes | Invention, participants, precision, reject workflow | T025 is **not** Timeline GT; do not treat as extraction |
| Graph | No | Signer/party/email relations from existing PDFs | Type-correctness (works_for vs communicates_with) | Recommended: 1–2 packets designed as relationship traps |
| Memory | No | “Must not persist badge=person” from T025 docs | Promotion / stale / supersede | Yes for expiry and contradiction-with-docs |
| Contract analysis | No | Clause values already in agreements | Item schema completeness | Optional; Q&A already stresses operative terms |
| Deposition analysis | No | Mercer transcript exists | Issue/admission schema | Yes if we grade deposition-specific output |
| Evidence matrix | No | Derived from approved intel (circular unless intel GT exists) | — | After Timeline/Graph GT exists |
| Discovery | No | — | Privilege/responsiveness | New scenario (V1/V2 are not a discovery set) |
| Draft | No | “Use only supported notice-period facts” from agreements | Grounding/revision rubrics | Small add-on tasks on existing matters possible |
| Research | No | — | Corpus-bounded citation | **New authority corpus + questions** (matter PDFs cannot serve) |
| Agents | No | Workflow over existing tools | Plan/tool/approval traces | Small workflow scenarios; not 400 clones |

---

## 17. Reliability Coverage Matrix

| Capability | Implemented | Production path identified | Existing unit tests | V1/V2 usable | Independently benchmarked | Beta risk |
| --- | --- | --- | --- | --- | --- | --- |
| Case Q&A | Yes | Yes | Strong | Yes | Yes (A.4) | **LOW** |
| Documents / ingest (text PDF) | Yes | Yes | Strong | Yes (implicit) | Indirect via Q&A | **MEDIUM** |
| OCR / image PDF | Code unused | No wired path | Limited | No | No | **HIGH** if scanned docs expected |
| Compare | Yes | Yes | Medium (`eval:ai` + package) | Yes (GT exists) | No (chat/extras only) | **HIGH** |
| Contradiction | Yes | Yes | Medium (`eval:ai`) | Partial | No | **HIGH** |
| Timeline | Yes | Yes | Medium | Partial (T012) | No | **HIGH** |
| Graph | Yes | Yes | Limited | Derivable only | No | **MEDIUM** |
| Memory | Yes | Yes | Limited | No | No | **HIGH** |
| Contract analysis | Yes | Yes | Limited | No | No | **HIGH** |
| Deposition analysis | Yes | Yes | Limited | No | No | **HIGH** |
| Evidence matrix | Yes (derived) | Yes | Limited | No | No | **MEDIUM** |
| Discovery review | Yes | Yes | Limited | No | No | **MEDIUM** |
| Redlines | Yes | Yes | Limited | No | No | **MEDIUM** |
| Draft | Yes | Yes | Limited | Derivable | No | **HIGH** |
| Research | Yes (local corpus) | Yes | Medium | No | No | **HIGH** |
| Agents | Yes (real tools) | Yes | Medium (orchestration) | No | No | **HIGH** |

Risk = severity × exposure × (lack of) safeguards. Untested ≠ automatically CRITICAL. Case Q&A is LOW because it is tested and frozen. Graph is MEDIUM because Q&A/Draft only see approved edges and usage is behind review. Memory is HIGH because one approve (or a manual create) becomes a durable fact. OCR is HIGH only if beta includes scans.

---

## 18. Dependency Map

Actual code dependencies (what must be trustworthy before a downstream feature is trustworthy):

```text
Documents (parse/chunk/embed/retrieve)
  ↓
Case Q&A                         ← FROZEN; consumes retrieval + optional intel
  ↑
Intelligence extraction (proposed)
  ↓  attorney review
Verified Timeline / Facts / Entities / Deadlines
  ↓
Graph nodes (materialize) → Graph edges (propose → review)
  ↓
Memory (optional; approved only, except manual create)
  ↓
Ask Nyaya (verified intel + graph + memory + analysis context)
  ↓
Analysis engines (Compare, Contradiction, Contract, Deposition)
  │    persist proposed findings → can flow into Ask Nyaya (labeled)
  ↓
Draft (verified intel + memory + graph + chunks; not live Research)
  ↓
Research (separate corpus; optional saved authorities into Draft)
  ↓
Agents (call all of the above tools)
```

Textual DAG for hardening:

1. Documents (already sufficient for text PDFs used in Q&A)  
2. Compare + Contradiction (independent engines; feed Analysis context + agents)  
3. Timeline formatting + review semantics (feeds Q&A/Draft/Graph/agents)  
4. Memory promotion rules (feeds Q&A/Draft/agents)  
5. Contract / deposition analysis (feed Q&A; agents)  
6. Graph type-correctness (after verified entities exist)  
7. Draft grounding  
8. Research corpus honesty  
9. Discovery / evidence matrix (derived; privilege UX)  
10. Agents last  

Do not harden Agents before the tools they wrap.

---

## 19. Recommended Hardening Order

Remaining systems only (Case Q&A frozen):

1. **Compare** — Daily lawyer use (amendments). Production path real. V2 already has material/decoy GT. `eval:ai` graders exist but are disconnected from NYAYA-BENCH. Highest yield per week of work.
2. **Contradiction** — Same pattern; T010/T011 already encode the hard traps; proposed findings leak into Q&A.
3. **Timeline** — Automatic extract; feeds Q&A; datePrecision dropped; invented events if review is careless. T012 GT is a starting point.
4. **Memory** — Persistent fact store; manual create auto-approves; no expiry.
5. **Contract analysis** — Clause-level reliance; proposed items in Q&A context.
6. **Deposition analysis** — Testimony mischaracterization.
7. **Draft** — Work product lawyers may reuse; body not citation-locked; depends on 3–6.
8. **Graph** — Lower first-week usage; gated by approval; type-confusion is severe **after** approve.
9. **Research** — Limited corpus already warned; still citation-hallucination risk; needs its own corpus GT.
10. **Evidence matrix / Discovery** — Derived / human-final privilege; harden after intel.
11. **Agents** — Real tools, last: they multiply every upstream error.

OCR/versioning/delete are infrastructure, not the next intelligence phase, unless beta requires scans.

---

## 20. V3 Decision

### SMALL V3

**Do not build it in this phase.**

V1/V2 are **not** sufficient as currently graded, but they are **not** fundamentally the wrong documents for Compare, Contradiction, Timeline extraction (T012), and a future Draft-grounding slice.

**NO V3** would be wrong: Graph, Memory promotion, Research, Agents, Discovery, and honest Timeline workflow (reject/precision/invention) cannot be scored from chat keys alone.

**FULL V3** would be wrong: cloning another 16×25 template would not add Graph/Memory/Research GT. V2’s limitation is **task/GT shape**, not an empty cupboard of contracts, emails, depositions, and access logs.

### If a later phase builds SMALL V3, exact scope

**Not hundreds of tests because V2 has 400.**

| Gap | Why V1/V2 cannot | Approx. size |
| --- | --- | --- |
| Structured Compare/Contradiction **graders** | Can be done **without V3** on existing GT | 0 new matters |
| Timeline extraction / precision / reject | T025 is Q&A; need extraction keys | Prefer extend GT on existing matters, not V3 |
| Graph type traps | No relationship GT | 2–3 matters, ~8–12 docs, ~15–25 tests |
| Memory promotion / stale | No memory tasks | Can attach to existing matters; ~10–15 tests |
| Draft grounding | No draft tasks | Existing matters + new task files; ~10–15 tests |
| Research corpus | Matter PDFs are not authorities | 1 small imported corpus, ~8–12 authorities, ~15–20 queries |
| Agent workflow | No run/tool GT | 5–10 workflow cases over the above |
| Discovery privilege | Not this dataset | Defer post-beta unless required |

**Approximate SMALL V3 envelope (only if grader extension is not enough):** 4–6 new or heavily annotated matters, ~25–40 documents including a tiny authority corpus, ~60–90 tests across graph / memory / draft / research / agent-workflow. Not 400.

First move after 6A should still be **graders on existing V2 Compare/Contradiction**, which is not V3.

---

## 21. Beta Blockers

Only items supported by this repo:

### Reliability

- Compare and Contradiction not independently graded; lawyers may still use the UI.
- Timeline datePrecision omitted in verified prompt text.
- Proposed analysis findings and comparison summaries enter Ask Nyaya.
- Manual Memory auto-approve; no staleness.
- Draft body can invent facts.
- OCR not wired (blocker **if** scanned PDFs are in the beta corpus).
- Inngest domain handlers missing (blocker **if** beta assumes async jobs; today UI uses sync APIs).

### Security / privacy

- Tenant isolation via `organizationId` + `requireMatterAccess` is real; storage keys prefixed by org; download refuses out-of-scope docs.
- Student/Public use separate tables; phase 8 tests assert they cannot read professional chunks.
- Research corpus is **shared authority**, not tenant matter data; matter fields forbidden in authority SQL. Confirm import pipeline never copies matter PDFs into `legal_authorities`.
- NYAYA-BENCH uses org slug `nyaya-bench` / “SYNTH Nyaya Bench” — must not be a production tenant with real client files.
- No matter-document DELETE (retention/correction), not isolation.
- Logging: audit events record IDs/metadata; do not treat that as a proven “never log snippet” guarantee without a log-redaction review (quick pass only; no full security phase).

### Performance

- Sync ingest+extract on upload (timeout risk for large PDFs).
- Contradiction 48-chunk cap; Draft 48 chunks by index; Q&A retrieve 8 (follow-up ≤12).
- Memory ranking loads all active memories in process.
- Graph extract 24 chunks / 40 nodes.
- Agent timeout 120s / 40 tool calls.
- Inngest concurrency is irrelevant until handlers exist.
- Bulk Compare of many version pairs is sequential API work; no batch job.

### UX

- Proposed vs verified must stay visually distinct; analysis-in-Q&A labeling is easy to miss.
- Compare extras/summaries can look like ground truth.
- Research “not comprehensive” warning must appear in the UI the lawyer sees, not only in synthesis strings.

### Infrastructure

- Inngest = ping + stub jobs.
- Production malware scanner vs `DevelopmentMalwareScanner` in bench.
- No document versioning/delete on the professional upload route.

---

## 22. Two-Month Beta Implications

### Realistically complete before strong beta

- Keep Case Q&A frozen; do not spend the window re-tuning v11.
- Independently grade **Compare** and **Contradiction** on V2 (structured graders; persist-then-grade; no GT rewrite unless an erratum-class defect appears).
- Close the two trust-boundary leaks that feed Ask Nyaya: Timeline `datePrecision` in prompt text; stop treating proposed analysis/compare summaries as ambient Case context (or keep them out of the default Q&A path).
- Memory: do not let unverified AI text become `verified_context` without review; treat manual `verified_context` as a conscious attorney act in UI copy.
- Research: ship **only** with corpus-limitation UX matching the synthesis warning. No premium DBs.
- Draft: label as draft; do not enable send/file; know body-grounding is unbenchmarked — either restrict Draft in beta or add a small grounding eval.
- Agents: optional/preview; never autonomous external actions (already prohibited in code).
- Ingest: text PDFs only unless OCR is wired.

### Defer after beta

- FULL Graph reliability program and alias resolution
- Discovery-as-e-discovery
- OCR at scale
- Real Inngest domain handlers / ingest queues (unless upload latency forces it)
- Agent-first UX
- Independent deposition-analysis and evidence-matrix benches
- V3 dataset build, unless Compare/Contradiction graders prove V2 GT is unusable (unlikely for T007–T011)

Do not propose new product features to fill a Harvey-shaped gap.

---

## 23. Next Phase Recommendation

### Compare / Contradiction Reliability

**Exactly one next engineering phase. Do not start it in this audit.**

Why this, not Matter Intelligence or V3:

1. Production engines already run in full-system mode; the gap is **honest grading and output quality**, not greenfield features.  
2. V2 already contains 48 compare-mapped and 32 contradiction-mapped tasks with hidden GT (`material_changes`, `non_material_change`, `possible_contradiction`, `not_contradiction`).  
3. Structured graders already exist in `eval:ai` and are disconnected from NYAYA-BENCH.  
4. Outputs persist and feed Ask Nyaya analysis context and agents — so this also reduces a trust-boundary leak.  
5. Two-month beta: this is the highest lawyer-reliance untested path after frozen Q&A.  
6. Does **not** reopen Case Q&A prompts.  
7. Does **not** require V3.

Matter Intelligence (Timeline datePrecision, Memory promotion, Graph) should be the phase **after** Compare/Contradiction, unless a beta date forces a hotfix of the Q&A formatting leak as a small patch inside that later phase.

---

**STOP.** This file is the Phase 6A deliverable. No fixes, prompt edits, agent changes, V3, V1/V2 edits, GT edits, or expensive full benchmark runs were performed.
