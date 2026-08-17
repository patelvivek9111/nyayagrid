# NyayaGrid Agent Quality Spec

**Status:** Active engineering standard  
**Audience:** Product, AI, backend  
**Scope:** Three revenue workflows that must feel industrial before we claim Harvey-class insight quality.

This document defines *what good looks like*, how we measure it, and what the code must enforce. It does not invent new product surfaces. It hardens Case Q&A, contract compare, and contradiction/timeline insight on top of existing Phase 3–7 architecture.

---

## Product principle

**Useful insight > impressive fluency.**

An answer that refuses when evidence is thin is more valuable than a confident guess. NyayaGrid is a legal operating system: every material claim must be source-backed, reviewable, and honest about uncertainty.

Agents compose authorized tools. They do not invent authority, do not auto-approve intelligence, and do not silently escalate privileges.

---

## Workflows in scope (v1)

| # | Workflow | Primary entry | Industrial outcome |
|---|---|---|---|
| 1 | **Case Q&A** | `askNyayaAboutMatter` / Case Chat | Fact answers grounded in matter evidence or an explicit insufficient-evidence refusal |
| 2 | **Contract compare** | Contract agent + `compareDocuments` | Material differences between two versions, with deterministic diffs and attorney-facing summary |
| 3 | **Contradiction / timeline tension** | Evidence / deposition tools + Timeline suggestions | Dual-sided, source-backed conflicts; never a single “truth” from the model |

Out of scope for this quality bar (still supported, not yet quality-gated the same way): discovery privilege finalization, licensed reporter research, autonomous filings.

---

## Shared quality gates (all three)

1. **No citation, no persist** for AI proposals that claim factual content from documents.
2. **Quote fidelity** — cited quotes must appear verbatim in the cited chunk (typography/whitespace normalization only).
3. **Matter isolation** — retrieval and tools re-check organization + matter authorization.
4. **Honest completion** — if budgets, missing docs, or thin evidence block a useful answer, say so (`insufficient`, `partially_completed`, limitations).
5. **Human review for consequential writes** — Memory, Graph edges, Timeline proposals remain proposed until verified.
6. **No fabricated legal authorities** in matter-grounded answers unless retrieved from the research corpus and quote-validated.

---

## 1. Case Q&A

### Acceptance criteria

| ID | Criterion | Pass condition |
|---|---|---|
| QA-01 | Grounded answer cites ≥1 retrieved matter chunk | `evidenceState=grounded` and sources nonempty |
| QA-02 | Every source quote is verbatim in its chunk | Quote validator accepts all retained sources |
| QA-03 | Unknown chunk/doc IDs are dropped | Rejected count ≥1 for fabricated IDs; may force insufficient |
| QA-04 | Unanswerable / empty retrieval → insufficient | Fixed insufficient copy; **zero** sources |
| QA-05 | Model “insufficient” with valid cites → partial | Not silently upgraded to grounded |
| QA-06 | Verified intel / graph / memory may support an answer | If used without document cites → at most **`partial`**, with explicit assumptions — never `grounded` without document quotes |
| QA-07 | No training-data legal rules presented as Case facts | Prompt + insufficient path; eval fixtures |

### Code ownership

- Validator: `packages/ai/src/index.ts` → `validateCitedAnswerAgainstPassages`
- Quote helper: `packages/ai/src/quotes.ts`
- Ask path: `packages/search/src/nyaya.ts`
- Evals: `packages/ai/src/evals/`

### Eval suite: `case_qa`

Fixtures must include:

- Direct answerable fact → grounded + verbatim quote
- Fabricated quote on a real chunkId → rejected / insufficient or partial with quote dropped
- Unrelated question with passages present → insufficient
- Empty passages → insufficient
- Partial: model cites real quotes but hedges / incomplete coverage (`expectEvidenceState=partial`)
- QA-06: verified intel / graph / memory with no document cite → at most `partial`
- Adversarial: near-miss dates, similarly-worded non-matching clauses, questions that require combining two chunks

Run: `npm run eval:ai` (mock) / `npm run eval:ai:stress` (GullibleMock vs adversarial subset; must pass before first live run) / `npm run eval:ai:live` (optional OpenAI). The runner always executes grader canaries (hand-crafted bad answers that must fail), then prints citation accuracy, hallucination, false-insufficient, false-confidence, and citation-relevance failure rates per workflow against the written bars.

---

## 2. Contract compare

### Acceptance criteria

| ID | Criterion | Pass condition |
|---|---|---|
| CC-01 | Diff is deterministic | Same inputs → same `DiffChange[]` (LCS paragraph diff) |
| CC-02 | Compare is a first-class contract path | Goals matching compare/amendment/version language schedule `compareDocuments` |
| CC-03 | Summary never invents clauses absent from the diff digest | Summary limited to supplied change digest; empty diff → fixed “no substantive differences” copy |
| CC-04 | Findings remain proposals | Contract analysis items still require `sourceChunkIds`; human review unchanged |
| CC-05 | Multi-doc ambiguity disclosed | If retrieval hits multiple docs without explicit IDs, limitation states closest-match only |

### Code ownership

- Diff: `packages/intelligence/src/draft/helpers.ts` → `computeParagraphDiffs`
- Persist/compare: `packages/intelligence/src/analysis/compare.ts`
- Agent: `packages/agents/src/agents/contract-agent.ts`, `packages/agents/src/planner.ts`
- Tool: `compareDocuments` in `packages/agents/src/tools/index.ts`

### Eval suite: `contract_compare`

- Paragraph add/remove/change fixtures for `computeParagraphDiffs`
- Planner: “compare the agreement and the amendment” includes `compareDocuments` in plan tools
- Empty equal texts → zero high-attention changes
- Graded pair: `packages/ai/src/evals/golden-contract-pair.ts` (≥8 planted material changes, ≥4 decoys) via `graded-cases-contract-compare.ts`

---

## 3. Contradiction / timeline tension

### Acceptance criteria

| ID | Criterion | Pass condition |
|---|---|---|
| CX-01 | Both sides required | Each contradiction candidate has two sides with `chunkIds.min(1)` |
| CX-02 | Invalid sides dropped | Missing/unauthorized chunk IDs → candidate not persisted |
| CX-03 | No single-truth synthesis | Product copy and agent summaries present conflict; do not pick a winner |
| CX-04 | Timeline suggestions stay proposed | Extracted events status=`proposed` until review |
| CX-05 | Verified timeline only uses approved events | Timeline agent / verified context excludes proposed |

### Code ownership

- Schema/prompts: `packages/ai/src/professional.ts` (`contradictionCandidatesSchema`)
- Detection: `packages/intelligence/src/analysis/deposition.ts` (and related)
- Timeline extract/review: `packages/intelligence/src/extract.ts`, review routes
- Evidence agent tool: `detectContradictions`

### Eval suite: `contradiction`

- Schema rejects a one-sided candidate
- Dual-sided fixture with valid synthetic chunk IDs validates
- Dual-sided fixture with fabricated chunk ID on one side fails persistence path (unit)
- Graded CAM-date-conflict fork: `graded-cases-contradiction.ts` (genuine dual-sided, false-positive traps, one-sided rejection)

---

## Measurement & CI

| Command | Purpose |
|---|---|
| `npm run eval:ai` | Deterministic quality suites (Case Q&A + contradiction + contract-compare diffs) with **per-workflow rates** |
| `npm run eval:ai:live` | Optional OpenAI (pinned model, budgets). Use `--export-review` for attorney-review packets. **Not a PR gate.** |
| `npm run test -w @nyayagrid/ai` | Unit tests including quote + citation validators |
| `npm run test -w @nyayagrid/agents` | Planner/intent/tool auth + retrieved-content prompt injection on research/drafting |
| `npm run test -w @nyayagrid/intelligence` | Diff / analysis units |

### Numeric pass bars (quality gate)

A workflow is **not industrial** until a *measured* suite meets these numbers. Record actual rates in [`AGENT_QUALITY_TRACKER.md`](./AGENT_QUALITY_TRACKER.md). Mock `eval:ai` rates are code-regression measurements only. **They are not sufficient without Section B attorney review.**

| Workflow | Citation accuracy | Hallucination (fabricated / unverifiable quotes) | False-insufficient | False-confidence (answered when refuse / one-sided / decoy expected) |
|---|---|---|---|---|
| Case Q&A | ≥ 90% | < 5% | < 10% | **0%** |
| Contract compare | ≥ 90% of planted material needles detected | < 5% invented-clause rate in scored summaries | < 10% missed material | **0%** decoys treated as high-attention material |
| Contradiction / timeline | ≥ 90% of required side-cites present | < 5% fabricated side chunk IDs | < 10% missed genuine dual-sided conflicts | **0%** one-sided or false-positive traps emitted as contradictions |

**Code-regression bar (necessary, not sufficient):** `eval:ai` green, related unit tests green, no weakening of approval/provenance rules.

**Quality bar (what “closed” actually requires):** the numeric bars above, measured on the graded suites (20–30+ cases per workflow), **plus** at least one recorded attorney review pass in [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](./AGENT_QUALITY_ATTORNEY_REVIEW.md). An automated suite passing with no human sign-off is not evidence of Harvey-level quality.

**Not yet claimed:** statistical precision/recall on large *real* golden matters (the suites here are still synthetic), licensed reporter treatment, live-model rates *meeting the written bar across all three workflows* (three `gpt-4o-mini` runs on 2026-08-14; live 3 contradiction meets the numeric bar, Case Q&A and live contract-compare summaries do not), attorney-reviewed quality until Section B has an `attorney` pass.

---

## Phase B (in progress)

1. **Golden matter + graded rubrics** — `packages/ai/src/evals/golden-matter.ts`, `grade.ts`, `graded-cases.ts`; run via `npm run eval:ai`
2. Multi-hop / need-more-docs — second retrieval hop via `buildFollowUpRetrievalQuery`; `assessNeedMoreDocuments` persisted on artifacts and surfaced in Case Chat
3. **Clause-aligned redline scoring** — `scoreComparisonSummaryAgainstDiffs` / `applyComparisonSummaryAlignmentPolicy` in `packages/intelligence`; compare API returns `summaryScore`; Documents + Analysis UI show alignment + flagged claims
4. **Contradiction ↔ Timeline linking** — `linkContradictionToTimelineEvents` (read-only); findings expose `relatedTimelineEventIds` / side A·B event IDs; timeline exposes `relatedFindingIds`; UI cross-links; never auto-merges sides
5. **Live regression suite** — pinned `gpt-4o-mini` by default, budget caps, mock baselines; optional nightly/manual workflow (see `docs/AI_EVAL_LIVE.md`) — never a PR gate
6. **Hardening** — SYNTH golden fixtures + `npm run seed:golden-matter`; Playwright grounded upload→ask path; CAM date-conflict graded cases (`golden-cam-date-conflict*`)
7. **Measurement track (reopened)** — ≥30 Case Q&A graded cases including `partial` + QA-06; contract-compare pair + ≥20 cases; contradiction suite ≥15; per-workflow rates vs numeric bars; attorney review (not yet recorded)

**Open risks:** Live 6 Case Q&A (`nyaya-matter-qa-v5`, `gpt-4o-mini-2024-07-18`, `fp_6ec6bfb92d`, rerank off, temp=0) misses the bar: cite acc 63.1% (56.8–70.3), hallu 36.9%, false-insufficient **7.0%** (mean meets &lt;10%), false-confidence 1.8%. Combine cases often fail JSON (`documentId` missing), not stock refusal. QA-05 indemnity stays `partial` 3/3; QA-05 term is model-`grounded` 3/3. Live 6 compare decoy-discrimination **fired n=36**, FPR 55.6%; workflow 61.2% cite acc. Live 2 is not a config baseline. Section B stays open. Bars not softened.

Graded dimensions: `evidence_state`, `faithfulness` (verbatim quotes, forbidden phrases, dates not in retrieved/verified text), `completeness` (required phrases/cites), `need_more_docs`, `citation_relevance` (cited chunk is in `forbiddenChunkIds` — real passage, wrong support).

---

## Non-goals

- Autonomous court filing, email send, settlement acceptance
- Auto-verifying AI Memory or Graph
- Replacing attorney judgment with a confidence percentage
- Pretending synthetic research corpus equals Westlaw/Lexis
