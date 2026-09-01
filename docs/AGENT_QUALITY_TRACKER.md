# Agent Quality — Task Tracker

Living checklist for industrial Case Q&A / contract / contradiction quality.
Mark items `[x]` in this file as they ship. Do **not** create a new plan `.md` for each slice — update this one.

Spec: [`AGENT_QUALITY.md`](./AGENT_QUALITY.md) · Evals notes: [`AI_EVALUATIONS.md`](./AI_EVALUATIONS.md) · Attorney review: [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](./AGENT_QUALITY_ATTORNEY_REVIEW.md)

Historical `eval:ai:live` markdown export packets were removed from the repository (gitignored under `docs/agent-quality-review/`). Measured rates in this tracker remain the record. Re-export locally with `EVAL_EXPORT_REVIEW=1` if a packet is needed.

**Reopened (measurement track).** The prior “hardening slice complete / To do: none” close-out was premature. `AGENT_QUALITY.md` itself never claimed statistical precision/recall on golden matters, and its old “definition of done” (`eval:ai` green + unit tests green) is a code-regression bar, not a quality bar. **An automated suite passing with no human sign-off is not evidence of Harvey-level quality.**

This track does **not** add Case tabs or product surfaces. Do not close this tracker until Section B is recorded with actual attorney scores. Mock rates below meet the written numeric bars as a *code-regression* measurement only — they do **not** substitute for live-model rates or attorney review.

**Section A (2026-08-17): closed-with-documented-residual.** That is **not** closed-clean, **not** “bars met,” and **not** still-open for another prompt-example round. Contradiction fully meets its numeric bar on the **measured** live-9 config (`nyaya-matter-qa-v7`). Case Q&A and contract-compare do not, for the named residuals in [`AGENT_QUALITY.md`](./AGENT_QUALITY.md). Prompt-example stacking is deliberately paused. Production Case Q&A prompt is now `nyaya-matter-qa-v8` (thoroughness UX only — not a live remasure, not a new worked example). **Section B is unchanged (not started) and is now the only active blocker** on any Harvey-level claim for these workflows.

---

## Done (prior hardening — not a quality close-out)

These items shipped. They do **not** by themselves satisfy the measurement bar.

- [x] Agent Quality Spec (3 money workflows)
- [x] Verbatim quote validation on Case Q&A
- [x] Verified intel without doc cites → `partial` (never `grounded`)
- [x] Contract compare wired in planner + contract agent
- [x] Case Chat quality surfaces (`evidenceState`, sources drawer, insufficient UX)
- [x] Documents: Compare versions UI
- [x] Evidence: dual-sided contradiction cards + detect/review
- [x] Timeline: proposed vs verified callout; link to Evidence conflicts
- [x] Playwright smoke (insufficient path, Documents compare, Evidence contradictions)
- [x] Golden matter corpus + graded rubrics (`faithfulness`, `completeness`, `need_more_docs`)
- [x] Multi-hop retrieval + `needsMoreDocuments` in ask path + Case Chat banner
- [x] `npm run eval:ai` smoke + golden graded suite (mock)
- [x] Clause-aligned comparison summary scoring vs deterministic diffs (+ Documents/Analysis UI cues)
- [x] Contradiction ↔ Timeline linking (read-only related IDs; dual sides never auto-merged)
- [x] Live regression suite (pinned model, budgets, baselines, optional nightly/manual CI)
- [x] Seeded SYNTH golden matter fixtures + `seed:golden-matter` demo CLI
- [x] Playwright grounded answer path (upload synth lease → sources + grounded badge)
- [x] Issue-spotting graded cases (CAM date conflict across depo + email)

### Section A — Golden dataset coverage (closed-with-documented-residual)

**Status: closed-with-documented-residual (2026-08-17).** Suites, canaries, mock rates, and live 1–9 measurement exist. Live 9 on the current config (`nyaya-matter-qa-v7`, `compare-summary-v4`, `gpt-4o-mini-2024-07-18`) is the last prompt-stacking remasure. **This close-out does not mean the written bars are met.** Contradiction **fully meets** its bar (21/21 × 3). Case Q&A **misses** false-confidence 0% (2.6%, all `golden-false-rent-amount`) and hallucination **range** straddles &lt;5% (max 5.3%). Contract-compare **misses** citation accuracy ≥90% (47.2%; golden-pair “as is” 3/3 since live 7; `cc-live-mixed-term-labelled` 1/3). Further prompt-example stacking is **deliberately paused**: live 7–9 reshuffled failures as often as they fixed them, even though failure magnitude decreased (compare decoy FPR 50% → 0%). Named residuals and the unbuilt validator-coerce candidate are in [`AGENT_QUALITY.md`](./AGENT_QUALITY.md) “Not yet claimed.” **Do not read any `[x]` below as “bars passed.”** Mock `npm run eval:ai` (2026-08-14) still meets the written bars after the harness was strengthened (canaries, `citation_relevance`, adversarial density). **These bars are not trusted as a quality close-out until Section B.** The mock 100% result is recorded below — **treat it as worth double-checking, not as reassurance.** `MockAIProvider` keyword-matches passages and tends not to grab decoys; the canary suite is what proves the grader can fail.

- [x] Grader canaries (always-run, not `EVAL_LIVE`): `packages/ai/src/evals/canary.ts` feeds `gradeCitedAnswer` three hand-crafted bad answers (invented date → `faithfulness`; real-but-irrelevant chunk → `citation_relevance`; grounded when rubric expects `insufficient` → `evidence_state`). If a canary does not fail as expected, `eval:ai` exits immediately.
- [x] Case Q&A: 38 cases in `packages/ai/src/evals/graded-cases.ts` against the golden lease matter, including `partial` (QA-05 hedge), QA-06 verified intel/graph/memory with no document cite, ≥5 two-chunk-combine cases, ≥5 near-miss decoys in the retrieved set, and ≥8 cases with `forbiddenChunkIds` / `citation_relevance`.
- [x] Contract compare: `packages/ai/src/evals/golden-contract-pair.ts` + `graded-cases-contract-compare.ts` — 8 planted material changes, 9 decoy-FPR cases (renumbering, typo fixes, reformatted paragraph, exhibit numbering, plus prior spelling/identical-substance decoys), 27 cases grading CC-01–CC-05. Runner prints decoy false-positive rate separately from planted-change recall.
- [x] Contradiction/timeline: `packages/ai/src/evals/graded-cases-contradiction.ts` — 21 cases (genuine dual-sided, ≥5 one-sided/false-positive rejects: imprecise phrasing, rounding, paraphrase/synonym, on-or-about same date, one-sided source), plus `forbiddenChunkIds` on genuine CAM/before-after fixtures.
- [x] `npm run eval:ai` prints per-workflow citation accuracy, hallucination, false-insufficient, false-confidence, and citation-relevance failure rates against the written bars (`packages/ai/src/evals/metrics.ts` + `run.ts`; contract-compare runner in `@nyayagrid/intelligence`).
- [x] Numeric pass bars written in `AGENT_QUALITY.md` (0% false-confidence, <5% hallucination, ≥90% citation accuracy, <10% false-insufficient). Mock-measured numbers recorded below. Bars were not raised or softened.
- [x] Stress harness (`npm run eval:ai:stress`, 2026-08-14): `GullibleMockProvider` takes decoy/forbidden/one-sided bait on the adversarial subset. Scoring caught it — citation-relevance fail **100%**, contract-compare decoy FPR **100%**, false-confidence **100%** (max across workflows). Harness **PASS**. Default `eval:ai` is unchanged (honest mock still 100%). **Run stress before the first `eval:ai:live`.** A live 0% is no longer ambiguous with “scoring never fires.”

**Measured rates (mock / deterministic — code regression only, 2026-08-14):**

| Workflow | Provider | n | Citation accuracy | Hallucination | False-insufficient | False-confidence | Citation-relevance fail | Meets written bar? |
|---|---|---|---|---|---|---|---|---|---|
| Case Q&A | mock | 38 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% (8 cases checked) | yes (mock only) |
| Contract compare | deterministic diffs | 27 | 100.0% | 0.0% | 0.0% | 0.0% | n/a (decoy FPR 0.0% on 9; material recall miss 0.0% on 9) | yes (mock only) |
| Contradiction / timeline | mock | 21 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% | yes (mock only) |

**Still 100% after citation-relevance and adversarial cases.** That is not evidence the live model is safe. It is evidence that (1) the canaries prove the grader can fail, (2) `eval:ai:stress` proves decoy scoring fires when a provider takes the bait, and (3) the default mock provider does not take the traps. Do not treat this table as grounds to close Section B.

**Measured rates (live 1 — OpenAI `gpt-4o-mini`, 2026-08-14, before schema/QA-06/prompt fixes):** pinned `EVAL_LIVE_MODEL=gpt-4o-mini`. In-process cap `EVAL_LIVE_MAX_USD=0.75` (actual **~$0.0068**, 59 requests, 23,289 tokens). 25/68 evals failed. **Neither live workflow meets the written bar.** First real model signal; mock 100% was never a proxy. Export packet removed from the repo.

| Workflow | Provider | Model | n | Citation accuracy | Hallucination | False-insufficient | False-confidence | Citation-relevance fail | Meets written bar? |
|---|---|---|---|---|---|---|---|---|---|---|
| Case Q&A | openai | gpt-4o-mini | 38 | 58.3% | 41.7% | 18.4% | 0.0% | 0.0% | **no** |
| Contradiction / timeline | openai | gpt-4o-mini | 21 | 100.0% | 0.0% | 14.3% | 23.8% | 0.0% | **no** |
| Contract compare | — | not live-model this run | — | — | — | — | — | — | not measured on a live compare agent |

Read live-1 hallucination % with care: a large share of those Case Q&A fails were schema-shape (`answer` as object, `confidence` as `"High"` / `0.9`), not invented reporters.

**Measured rates (live 2 — remasure after filed fixes, 2026-08-14 evening):** same pin and cap. Actual **~$0.0068**, 59 requests, 26,538 tokens. 11/68 evals failed. Export packet removed from the repo. **Still misses the written bar.** Do not overwrite live 1.

| Workflow | Provider | Model | n | Citation accuracy | Hallucination | False-insufficient | False-confidence | Citation-relevance fail | Meets written bar? |
|---|---|---|---|---|---|---|---|---|---|---|
| Case Q&A | openai | gpt-4o-mini | 38 | 80.6% | 19.4% | 15.8% | 0.0% | 0.0% | **no** |
| Contradiction / timeline | openai | gpt-4o-mini | 21 | 100.0% | 0.0% | 0.0% | 14.3% | 0.0% | **no** |
| Contract compare | — | not live-model this run | — | — | — | — | — | — | not measured on a live compare agent |

What moved: schema-shape inflation dropped (combine answers are strings; contradiction `"High"` / `0.9` now parse; QA-06 three cases **pass** via the `partial` cap; question-echo Jan 15 **pass**; synonym / on-or-about contradiction traps **pass**). What did not: decoy-adjacent over-refusal (rent vs late-fee / term sheet / 90-day draft; indemnity-with-amendment refused in this run), imprecise “end of February” still emitted as a conflict (3/21 false-confidence), QA-05 hedges labeled `grounded` instead of `partial`. Operator remasure is in [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](./AGENT_QUALITY_ATTORNEY_REVIEW.md) (**role=`operator`**, Section B still open).

**Live 2 export files were later overwritten** by a mock `eval:ai` in the same shell (`EVAL_EXPORT_DIR` leaked). The **rates above still stand.** A mock-export guard now refuses to write mock output into a `*live*` path. Do not score files currently in `exports-live-remeasure/` as live.

**Measured rates (live 3 — after imprecise-date filter + retrieval ranking + `EVAL_LIVE_REPEATS=3`, 2026-08-14 night):** same pin. Case Q&A + contradiction: **~$0.0205**, 177 requests, 82,124 tokens. 39/194 evals failed — the same 13 Case Q&A cases on every repeat. Export packet removed from the repo. Contract-compare live summaries were in that packet. **Bar judged on the mean; min/max shown. Ranges did not straddle any bar.** Do not overwrite live 1 or live 2.

| Workflow | Provider | Model | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Citation-relevance fail | Meets written bar? |
|---|---|---|---|---|---|---|---|---|---|---|
| Case Q&A | openai | gpt-4o-mini | 38 | 3 | 55.6% (55.6–55.6) | 44.4% (44.4–44.4) | 28.9% (28.9–28.9) | 0.0% (0.0–0.0) | 0.0% | **no** |
| Contradiction / timeline | openai | gpt-4o-mini | 21 | 3 | 100.0% (100–100) | 0.0% (0.0–0.0) | 0.0% (0.0–0.0) | 0.0% (0.0–0.0) | 0.0% | **yes (numeric only; Section B still open)** |
| Contract compare (live summaries) | openai | gpt-4o-mini | 2 scenarios | 3 | 50.0% (50.0–50.0) | 50.0% (50.0–50.0) | 50.0% (50.0–50.0) | 0.0% (0.0–0.0) | n/a | **no** |
| Contract compare (deterministic diffs) | — | not a model | 27 | — | 100.0% | 0.0% | 0.0% | 0.0% | decoy FPR 0.0% | yes (code regression only) |

What moved vs live 2: imprecise-date contradiction FPs are **gone from the product path** (21/21 × 3 pass; the model still emits Feb 28 vs “end of February”; `filterImpreciseDateContradictionCandidates` drops them). Ranking + prompt v4 did **not** close over-refusal: false-insufficient 15.8% → 28.9%, and the fail set was identical on all three repeats (not noise). `golden-rent-amount` answered 3/3; the same question+retrieval `golden-adv-similar-clause-rent-vs-late-fee` refused 3/3 (live 2 had the opposite split). Combine-two-chunk cases refused 5/5 × 3. Contract compare live is measured for the first time: empty pair does not invent (3/3); golden-pair harness fails 3/3 on “60 days” vs planted `sixty (60) days` (operator: substance is the planted change; scorer is lexical). Operator live 3 is in [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](./AGENT_QUALITY_ATTORNEY_REVIEW.md) (**role=`operator`**, Section B still open).

Engineering shipped this round (not a quality close-out): deterministic imprecise-date reject (`packages/ai/src/imprecise-date.ts`), question-overlap ranking that never drops passages (`packages/ai/src/retrieval-rank.ts`, evals + production ask/hybrid), `EVAL_LIVE_REPEATS` + min/mean/max printer, live contract-compare summaries, mock-export guard.

**Isolation (2026-08-14 night, after live 3 — no new over-refusal lever):** temperature was already `0` on Case Q&A / contradiction (`LIVE_EVAL_TEMPERATURE`; prior default in `OpenAIProvider` was also `request.temperature ?? 0`). API `model` field on this machine: **`gpt-4o-mini-2024-07-18`**. `system_fingerprint`: **`fp_9afcdcbeed`**. Eval reranking reverted (`gradedCaseToPrompt` uses fixture order). Production search/hybrid ranking was left in place (out of this isolation session). Imprecise-date filter kept.

`golden-adv-similar-clause-rent-vs-late-fee` × 5 (ranking still on, temp=0): **refused 5/5**. Same case without ranking (live 4 below): **refused 3/3**. Recorded live 2 operator score for this id was **answered**; live 3 was **refused 3/3**. Within-session sampling on the current snapshot is stable-refuse. That does **not** close the cross-session flip (live 2 vs later runs). Do not treat 5× stability as “resolved.”

**Measured rates (live 4 — Case Q&A only, rerank reverted, imprecise-date still in, 3 repeats):** ~$0.0148, 114 requests, 57,478 tokens. Snapshot `gpt-4o-mini-2024-07-18`. Export packet removed from the repo.

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Case Q&A | 38 | 3 | 66.7% (64.9–67.6) | 33.3% (32.4–35.1) | 21.9% (18.4–23.7) | 0.0% | **no** |

Vs recorded baselines (do not swap live 1 and live 2):

| Run | Cite acc. | Hallu. | False-insuf. |
|---|---|---|---|
| Live 1 | 58.3% | 41.7% | 18.4% |
| Live 2 | 80.6% | 19.4% | 15.8% |
| Live 3 (rerank on) | 55.6% (55.6–55.6) | 44.4% (44.4–44.4) | 28.9% (28.9–28.9) |
| Live 4 (rerank off) | 66.7% (64.9–67.6) | 33.3% (32.4–35.1) | 21.9% (18.4–23.7) |

Reranking accounts for about **11 points** of cite-acc drop and **~7 points** of false-insufficient vs live 3, not the whole live-2 → live-3 regression. Live 4 is still well below live 2. Range on live 4 **does not straddle** the written bars.

### Live 2 vs live 3 Case Q&A config — reconstruction (2026-08-14)

**Git cannot recover the live-2 or live-3 runtime config.** Last commit touching `packages/ai/src/index.ts` is `4141457` (2026-08-13), with `NYAYA_PROMPT_VERSION = "nyaya-matter-qa-v2"`. `v3` and `v4` exist only in the uncommitted working tree. There is no commit, tag, or blame line that distinguishes what live 2 loaded from what live 3 loaded.

**Export packets do not record prompt version or a dated snapshot.** Live 1 README: `model=gpt-4o-mini` (alias), 2026-08-14T21:42:09Z. Live 3 README: same alias, 2026-08-15T00:49:47Z. Item files have no `promptVersion` / `resolvedModel` fields. Live 2 files were overwritten by a later mock run; nothing remains to inspect.

**API snapshot for live 1–3: unknown.** Isolation/live 4 was the first run that read `data.model` from the OpenAI body. Earlier runs echoed the requested alias. The live-1 operator note that “API did not return a dated snapshot id” was that logging gap, not evidence the API omitted one.

**Contemporaneous markdown (not a runtime log):** after live 1, `AGENT_QUALITY_ATTORNEY_REVIEW.md` filed `nyaya-matter-qa-v3` as code “not yet live-remeasured,” then live 2 ran. Before live 3, ranking + `nyaya-matter-qa-v4` were added in the same uncommitted tree. That sequence is a **note**, not a verified process table. Do not treat it as proof of the exact strings the model received.

**Finding:** live 2’s 80.6% cite-acc **cannot be used as a trustworthy configuration baseline** going forward. The rate stays on the record as a historical point estimate. Comparisons that need “same prompt + snapshot + rerank + temperature” start at **live 4** (snapshot + rerank + temperature recorded) and must include the `=== Live run config ===` block from this point on.

**Required on every live tracker row (same cell/block as the rates, not a side note):** `prompt.*` per workflow, `model.requested`, `model.resolved` (API snapshot, not the alias), `system_fingerprint`, `rerank=on|off`, `temperature`. The runner prints this as `=== Live run config ===` (`packages/ai/src/evals/live-config.ts`). A live number without that block is not a baseline. Do not backfill guessed values for live 1–3.

**Measured rates (live 4 — contract-compare summaries after numeral scorer fix, 3 repeats):** export packet removed from the repo. **Scorer-bugfix verified on n=2, workflow-level rate not yet measured.** Do not cite this 100% as a workflow result.

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Contract compare (live summaries) | 2 scenarios | 3 | 100.0% (100–100) | 0.0% | 0.0% | 0.0% | **n=2 scorer-bugfix only — not a workflow-level measurement** |

**Measured rates (live 5 — expanded live compare, first workflow-level read):** 16 scenarios × 3 (8 isolated planted material including 4 numeric-phrasing pairs, 6 decoys, full golden pair, empty). Export packet removed from the repo. 48/48 passed.

```
prompt.contract_compare=compare-summary-v1
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_98f538dc1a
rerank=off
temperature=0
```

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Contract compare (live summaries) | 16 | 3 | 100.0% (100–100) | 0.0% | 0.0% | 0.0% | **yes on summarization/scorer only; citation_relevance 0/48; not a decoy-discrimination close-out; Section B still open** |

Numeric-phrasing isolates (30→60 days, 12%→15%, $4,000→$4,500, $1M→$2M) passed 3/3. Empty pair did not invent. Decoy spelling/renumber/reformat/exhibit did not pick up unsupported high-attention claims. **Adversarial-dimension check (live 5):** `citation_relevance` / `forbiddenChunkIds` fired on **0/48** runs — that dimension does not exist on the live compare path. Printed decoy FPR stayed n=0 because live ids (`cc-live-decoy-*`) do not match deterministic `diff_decoy` ids. Isolated decoys are a single-paragraph swap with no planted material in the same digest; the model summarizes an already-computed diff, and restating a spelling/renumber change still passes. The full golden-pair summary even mentioned the Recitals heading update and still passed. Treat live 5 as a **summarization-faithfulness + scorer** pass, not as proof the model distinguished material from decoy. **Fix (mock-verified, not live):** 6 mixed material+decoy-in-same-pair scenarios; live grader `gradeLiveCompareScenario` (decoy-discrimination, not citation_relevance); `aggregateWorkflowRates` counts `cc-live-decoy-*` / `cc-live-mixed-*` after stripping `#repeat`. Mock dry-run: decoy-discrimination fired on **36** flags (12 scenarios × 3 repeat ids). Isolated decoy restating spelling now **fails**. Do not report a new live compare number until live remasure.

### Case Q&A over-refusal / combine-two-chunk — recall vs model (diagnosis only)

Live Case Q&A **does not call production search**. `gradedCaseToPrompt` injects fixture `retrieved` into the user prompt. Production `rankByQuestionOverlap` in `packages/search` is unused by this harness.

Fixture diagnosis of the live-3 stable 13 (`packages/ai/src/evals/recall-debug.ts`):

| Bucket | Count | Meaning |
|---|---|---|
| (1) retrieval_recall | **0** | required `mustCiteChunkIds` absent from the prompt |
| (3) partial_retrieval | **0** | combine: only one of two required chunks in the window |
| (2) model_behavior | **13** | every required chunk was already in context |

All five combine cases have **both** required chunks in the same prompt. Layout check: answering chunks are not buried (notice-period is 1/1; rent-vs-late-fee answering chunk is first of two). **Fix (mock-verified, not live):** `nyaya-matter-qa-v5` adds a SYNTH rent-vs-late-fee worked example (cite the answering chunk; do not refuse because a decoy is present) plus a two-source combine line. QA-05 is **not** a “cites should count as grounded” scorer bug: the rubric wants `partial` (`expectNeedsMoreDocuments=true`); the validator was upgrading `partial`→`grounded` whenever cites were valid. Validator now keeps `partial`. A model that still emits `grounded` on those questions will still fail, correctly. Conservatism probe mock: 13/13 pass with the example in the prompt; rent-vs-late-fee fails when the example is stripped.

**Measured rates (live 6 — Case Q&A v5 + mixed compare decoy-discrimination, 3 repeats, 2026-08-14 night):** export packet removed from the repo. Contradiction skipped (`EVAL_LIVE_WORKFLOW=case_qa`). In-process cap `$0.75` / `200000` tokens. Case Q&A: 114 requests, 80,904 tokens, **~$0.0182**. OpenAI project spend limit cannot be verified from this repo.

Case Q&A config:

```
prompt.case_qa=nyaya-matter-qa-v5
prompt.contradiction=contradiction-analysis-v2
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_6ec6bfb92d
rerank=off
temperature=0
```

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Case Q&A | 38 | 3 | 63.1% (56.8–70.3) | 36.9% (29.7–43.2) | 7.0% (5.3–10.5) | 1.8% (0.0–2.6) | **no** |

False-insufficient **mean meets** the &lt;10% bar (7.0%); worst repeat 10.5% straddles. Cite-acc / hallu / false-confidence miss. Bars not softened. False-confidence is `golden-false-rent-amount` answering “seven thousand” (2/3 evidence_state; 1/3 parse fail).

Previously-failing 13 (per repeat):

| Case | #1 | #2 | #3 |
|---|---|---|---|
| golden-adv-similar-clause-rent-vs-late-fee | pass | fail (JSON sources missing documentId) | pass |
| golden-notice-period | pass | pass | pass |
| golden-indemnity-with-amendment | fail (insufficient) | fail (insufficient) | fail (insufficient) |
| golden-adv-near-miss-term-sheet-rent | fail (JSON parse) | fail (JSON parse) | fail (JSON parse) |
| golden-adv-near-miss-cam-worksheet | fail (insufficient) | pass | fail (insufficient) |
| golden-adv-notice-vs-renewal | pass | pass | fail (insufficient) |
| golden-adv-combine-rent-and-term | fail (JSON parse: sources missing documentId/documentVersionId) | fail (same) | fail (same) |
| golden-adv-combine-notice-and-term | fail (JSON parse) | fail (JSON parse) | fail (JSON parse) |
| golden-adv-combine-indemnity-and-rent | pass | pass | pass |
| golden-adv-combine-dispute-and-late-fee | fail (JSON parse) | fail (JSON parse) | fail (JSON parse) |
| golden-adv-combine-renewal-and-expiration | fail (JSON parse) | fail (JSON parse) | fail (JSON parse) |
| golden-partial-hedge-indemnity (QA-05) | pass (`partial`) | pass (`partial`) | pass (`partial`) |
| golden-partial-hedge-term (QA-05) | fail (`grounded`) | fail (`grounded`) | fail (`grounded`) |

QA-05 indemnity: model hedge + cites → **partial** 3/3 (validator keep-partial held). QA-05 term: model says the term is “fully settled” with `evidenceState=grounded` 3/3 — validator correctly does **not** rewrite grounded→partial. Remaining QA-05 gap is the model labeling a complete-looking excerpt `grounded`, not the old upgrade bug.

Contract-compare config:

```
prompt.contract_compare=compare-summary-v2
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_f344a168a1
rerank=off
temperature=0
```

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Decoy-discrimination | Meets written bar? |
|---|---|---|---|---|---|---|---|---|
| Contract compare (live summaries) | 22 | 3 | 61.2% (58.8–64.7) | 38.8% (35.3–41.2) | 4.5% (4.5–4.5) | 30.3% (27.3–31.8) | **fired n=36; FPR 55.6%** | **no** |

Decoy-discrimination **fired on 36/36** decoy+mixed runs (6 isolated + 6 mixed × 3). That is the first nonzero live fire count. Mixed pairs: term/fee/notice/insurance mostly pass; assignment+Exhibit I flags the exhibit numbering 3/3; isolated decoys mostly fail because “No material changes detected” is marked misaligned against the digest even when decoy needles are absent (details say `kind=decoy pass` while the case FAILs). Isolated material isolates still pass. Golden pair misses `fifteen` / `sixty` / `as is` 3/3. **Do not cite live 5’s 48/48 as the compare baseline.** No new lever this session.

**Measured rates (live 7 — schema backfill + compare-scorer allowlist, 3 repeats, 2026-08-14 night):** export packet removed from the repo. Contradiction skipped (`EVAL_LIVE_WORKFLOW=case_qa`). In-process cap `$0.75` / `200000` tokens. Case Q&A: 114 requests, 81,055 tokens, **~$0.0183**. OpenAI project spend limit cannot be verified from this repo. **Measurement only — no new lever this session.**

Case Q&A config:

```
prompt.case_qa=nyaya-matter-qa-v5
prompt.contradiction=contradiction-analysis-v2
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_6ec6bfb92d
rerank=off
temperature=0
```

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Case Q&A | 38 | 3 | 92.8% (89.2–94.6) | 7.2% (5.4–10.8) | 6.1% (5.3–7.9) | 1.8% (0.0–2.6) | **no** |

Cite-acc **mean meets** ≥90%; min 89.2% straddles. False-insufficient **mean meets** &lt;10% (range stays under). Hallucination mean 7.2% misses &lt;5% (range all ≥5.4%). False-confidence misses 0% (`golden-false-rent-amount` echoing “seven thousand” 2/3; #3 parse-fail missing `quote`). Bars not softened.

Previously-tracked Case Q&A set (per repeat):

| Case | #1 | #2 | #3 |
|---|---|---|---|
| golden-adv-combine-rent-and-term | pass | pass | pass |
| golden-adv-combine-notice-and-term | pass | pass | pass |
| golden-adv-combine-indemnity-and-rent | pass | pass | pass |
| golden-adv-combine-dispute-and-late-fee | pass | pass | pass |
| golden-adv-combine-renewal-and-expiration | pass | pass | pass |
| golden-adv-near-miss-term-sheet-rent | pass | pass | pass |
| golden-adv-similar-clause-rent-vs-late-fee | pass | pass | pass |
| golden-notice-period | pass | pass | pass |
| golden-indemnity-with-amendment | fail (insufficient) | fail (insufficient) | fail (insufficient) |
| golden-partial-hedge-indemnity (QA-05) | fail (completeness: missing “negligence”) | pass (`partial`) | pass (`partial`) |
| golden-partial-hedge-term (QA-05) | fail (`grounded`) | fail (`grounded`) | fail (`grounded`) |

Schema backfill held live: the 12 combine parse-fails and same-shape near-miss / rent-vs-late-fee#2 now **parse and grade grounded**. **indemnity-with-amendment still fails 3/3 insufficient** (chunks in the prompt; model still refuses) — expected, not touched. **QA-05 term still `grounded` 3/3** (“fully settled”) — expected, not touched. QA-05 indemnity: #1 is a **new completeness miss** (state is correctly `partial`, answer omits “negligence”); #2/#3 pass. Do not treat that #1 fail as a bonus, and do not treat the combine passes as closing over-refusal on indemnity/QA-05.

Contract-compare config:

```
prompt.contract_compare=compare-summary-v2
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_f344a168a1
rerank=off
temperature=0
```

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Decoy-discrimination | Meets written bar? |
|---|---|---|---|---|---|---|---|---|
| Contract compare (live summaries) | 22 | 3 | 57.4% (56.3–58.8) | 0.0% | 4.5% (4.5–4.5) | 4.5% (4.5–4.5) | **fired n=36; FPR 8.3%** | **no** |

Decoy-discrimination **fired on 36/36** decoy+mixed runs. Corrected FPR **8.3% (3/36)** — see the distinct open gap below; do not fold that 8.3% into the scorer-bug bucket. Isolated decoys (including `cc-live-decoy-recieve` 3/3) now **pass**; live-6 recieve#3 invented-notices FP **did not recur**. Isolated material isolates still pass. Golden pair `fifteen` / `sixty` were a number-word vs digit scorer gap (same family as sixty/60); `summaryMentionsNeedle` now matches either form generally — offline-verified against captured live-7 golden-pair output. Golden pair `as is` is a **real omission** (model reported quiet-enjoyment removal, not the as-is replacement) and still fails after that scorer fix. **Do not cite live 5’s 48/48 or live 6’s 55.6% FPR as the compare baseline.**

**Open gap (real decoy-discrimination — not a scorer bug):** `cc-live-mixed-assignment-exhibit` failed **3/3** on live 7 by restating Exhibit 1 → Exhibit I as a material change alongside the real assignment edit (`reasonable consent`). Isolated `cc-live-decoy-exhibit` passed 3/3 (“No material changes detected”). The fixture is correctly a style-only numbering decoy (`Exhibit 1 lists the statements of work` → `Exhibit I lists the statements of work`); `compare-summary-v2` already says not to treat exhibit numbering as material. This is the first fully clean over-inclusion miss in this measurement track. **Do not scorer-patch it.** It is a confirmed model-behavior miss and is grouped below with the other two worked-example prompt candidates — not with numeral/word matching or QA-05 term-grounded.

**Decided (Task 2, Option B — 2026-08-14):** `golden-false-rent-amount` rubric stays as-is (`expectEvidenceState: insufficient`, `forbiddenPhrases` unchanged). Do not relax the rubric to accept a hedged denial that echoes the bait number. Reasoning: a legal-product transcript should never contain an unverified figure in either polarity (asserted or denied) — “not seven thousand dollars” is as risky downstream (skimmed, copy-pasted, quoted out of context) as asserting it. This is a deliberate, stricter-than-conversational-norm bar, chosen on purpose, not a default. Needed fix is prompt-level: flat refusal (“insufficient information to confirm the rent amount”) instead of denial-with-echo.

**Measured rates (live 8 — v6/v3 worked-example remasure, 3 repeats, 2026-08-14 night):** export packet removed from the repo. Contradiction skipped (`EVAL_LIVE_WORKFLOW=case_qa`). In-process cap `$0.75` / `200000` tokens. Case Q&A: 114 requests, 109,936 tokens, **~$0.0228**. OpenAI project spend limit cannot be verified from this repo. **Measurement only — no new fix this session.**

Case Q&A config:

```
prompt.case_qa=nyaya-matter-qa-v6
prompt.contradiction=contradiction-analysis-v2
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_6ec6bfb92d
rerank=off
temperature=0
```

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Case Q&A | 38 | 3 | 95.6% (94.7–97.3) | 4.4% (2.7–5.3) | 0.0% (0.0–0.0) | 0.0% (0.0–0.0) | **mean yes; hallucination range straddles &lt;5% (max 5.3%) — not in full** |

Mean meets all four bars. Hallucination **range straddles** the &lt;5% bar (max 5.3%). Cite-acc range stays ≥90%; false-insufficient and false-confidence ranges stay inside. Bars not softened. Do not treat a straddling range as a full close.

Targeted v6 cases and the previously-fixed over-refusal set:

| Case | #1 | #2 | #3 |
|---|---|---|---|
| golden-false-rent-amount | pass (insufficient, no bait echo) | pass | pass |
| golden-indemnity-with-amendment | pass (grounded, cites amendment) | pass | pass |
| golden-adv-similar-clause-rent-vs-late-fee | pass | pass | pass |
| golden-notice-period | pass | pass | pass |
| golden-adv-near-miss-term-sheet-rent | pass | pass | pass |
| golden-adv-near-miss-cam-worksheet | pass | pass | pass |
| golden-adv-notice-vs-renewal | pass | pass | pass |
| golden-adv-combine-rent-and-term | pass | pass | pass |
| golden-adv-combine-notice-and-term | pass | pass | pass |
| golden-adv-combine-indemnity-and-rent | pass | pass | pass |
| golden-adv-combine-dispute-and-late-fee | pass | pass | pass |
| golden-adv-combine-renewal-and-expiration | pass | pass | pass |
| golden-partial-hedge-indemnity (QA-05) | fail (completeness: missing “negligence”; state `partial`) | fail (`grounded`) | fail (`grounded` + missing “negligence”) |
| golden-partial-hedge-term (QA-05) | fail (`grounded`, “fully settled”) | fail (`grounded`) | fail (`grounded`) |

The 11 over-refusal cases (the v5 conservatism set minus the two QA-05 labels) **did not regress**; indemnity-with-amendment is now in that pass set. `golden-false-rent-amount` held Option B live (flat insufficient, no “seven thousand”). **QA-05 term still `grounded` 3/3** (“fully settled”) — expected, untouched. QA-05 indemnity **regressed vs live 7** (live 7 #2/#3 were `partial`; live 8 #2/#3 are `grounded`). Other live-8 Case Q&A fails, not in the targeted three: `golden-cam-date-conflict` 3/3 (`partial` vs expected `grounded`; both dates are in the answer — same labeling shape as live 7’s export); `golden-qa06-memory-no-docs` #1/#2 parse/schema, #3 pass.

Contract-compare config:

```
prompt.contract_compare=compare-summary-v3
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_c881474fd1
rerank=off
temperature=0
```

Compare fingerprint **changed** vs live 7 (`fp_f344a168a1` → `fp_c881474fd1`). Same requested/resolved model.

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Decoy-discrimination | Meets written bar? |
|---|---|---|---|---|---|---|---|---|
| Contract compare (live summaries) | 22 | 3 | 50.0% (50.0–50.0) | 50.0% (50.0–50.0) | 4.5% (4.5–4.5) | 27.3% (27.3–27.3) | **fired n=36; FPR 50.0% (18/36)** | **no** |

`cc-live-mixed-assignment-exhibit` **pass 3/3** (reports reasonable consent only; does not restate Exhibit I). Isolated material isolates still pass. Other mixed pairs still pass. Golden pair still misses **`as is` only** 3/3 (`fifteen`/`sixty` no longer missing — numeral/word scorer held). **Isolated decoys regressed 18/18** vs live 7: model now emits “Document versions differ; review the detected changes” instead of “No material changes detected,” which the grader counts as an invented material change. That is the entire 50% FPR (18 isolated / 36 decoy+mixed). Do not scorer-patch in this measurement session. **Do not cite live 5’s 48/48, live 6’s 55.6% FPR, or live 7’s 8.3% FPR as the compare baseline.**

**Measured rates (live 9 — v7/v4 remasure + contradiction, 3 repeats, 2026-08-17):** export packet removed from the repo. All three workflows. In-process cap `$0.75` / `200000` tokens. Case Q&A + contradiction: 177 requests, 157,480 tokens, **~$0.0322**. OpenAI project spend limit cannot be verified from this repo. **Measurement only — no new fix this session.**

Case Q&A + contradiction config:

```
prompt.case_qa=nyaya-matter-qa-v7
prompt.contradiction=contradiction-analysis-v2
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_786821a2b4
rerank=off
temperature=0
```

Case Q&A fingerprint **changed** vs live 8 (`fp_6ec6bfb92d` → `fp_786821a2b4`). Same requested/resolved model.

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Case Q&A | 38 | 3 | 95.6% (94.7–97.4) | 4.4% (2.6–5.3) | 1.8% (0.0–2.6) | 2.6% (2.6–2.6) | **no** |
| Contradiction / timeline | 21 | 3 | 100.0% (100–100) | 0.0% (0.0–0.0) | 0.0% (0.0–0.0) | 0.0% (0.0–0.0) | **yes (numeric only; Section B still open)** |

Case Q&A: cite-acc **mean meets** ≥90% (range stays ≥90%). Hallucination **mean meets** &lt;5% but **range straddles** (max 5.3%). False-insufficient **mean meets** &lt;10%. False-confidence **misses** 0% (2.6%, all three `golden-false-rent-amount` repeats). Bars not softened.

Targeted v7/v4 cases and the previously-fixed over-refusal set:

| Case | #1 | #2 | #3 |
|---|---|---|---|
| golden-false-rent-amount | fail (`partial` + term cite; no bait echo) | fail (same) | fail (same) |
| golden-indemnity-with-amendment | pass (grounded, cites amendment) | pass | pass |
| golden-partial-hedge-indemnity (QA-05) | pass (`partial`, includes “negligence”) | pass | pass |
| golden-partial-hedge-term (QA-05) | fail (state `partial`; completeness missing “January 1, 2024”) | fail (same) | fail (same) |
| golden-adv-similar-clause-rent-vs-late-fee | pass | pass | pass |
| golden-notice-period | pass | pass | pass |
| golden-adv-near-miss-term-sheet-rent | pass | pass | pass |
| golden-adv-near-miss-cam-worksheet | pass | pass | pass |
| golden-adv-notice-vs-renewal | pass | pass | pass |
| golden-adv-combine-rent-and-term | pass | pass | pass |
| golden-adv-combine-notice-and-term | pass | pass | pass |
| golden-adv-combine-indemnity-and-rent | pass | pass | pass |
| golden-adv-combine-dispute-and-late-fee | pass | pass | pass |
| golden-adv-combine-renewal-and-expiration | pass | pass | pass |

The 11 over-refusal cases **did not regress**. Indemnity-with-amendment held. QA-05 indemnity **returned to partial 3/3** (live 8 was `grounded` 2/3). QA-05 term is no longer `grounded`/`fully settled` — state is now `partial` 3/3 — but still fails completeness (answer paraphrases dates, omits the required phrase). **`golden-false-rent-amount` regressed vs live 8:** Option B copy held (no “seven thousand”) but `evidenceState=partial` with a `chunk_lease_term` cite instead of `insufficient` and zero sources. Adjacent, not in the named v7 targets: `golden-adv-near-miss-ninety-day-draft` fail #1/#3 (`insufficient`); `golden-cam-date-conflict` fail #1/#3 (`partial` vs expected `grounded`, same labeling shape as live 8).

Contract-compare config:

```
prompt.contract_compare=compare-summary-v4
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_3cb74a061c
rerank=off
temperature=0
```

Compare fingerprint **changed** vs live 8 (`fp_c881474fd1` → `fp_3cb74a061c`). Same requested/resolved model.

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Decoy-discrimination | Meets written bar? |
|---|---|---|---|---|---|---|---|---|
| Contract compare (live summaries) | 22 | 3 | 47.2% (41.7–53.8) | 0.0% (0.0–0.0) | 6.1% (4.5–9.1) | 0.0% (0.0–0.0) | **fired n=36; FPR 0.0% (0/36)** | **no** |

Isolated decoys **18/18 pass** with a real `"No material changes detected."` — **zero** fallback strings (`Document versions differ; review the detected changes` is absent from the compare packet). `cc-live-mixed-assignment-exhibit` **pass 3/3**. Isolated material isolates still pass. Other mixed pairs pass except `cc-live-mixed-term-labelled#1` (emitted the isolated-decoy no-change summary on a mixed pair that contains a 2026→2027 term edit; #2/#3 pass). Golden pair still misses **`as is` only** 3/3. Harness 62/66; remaining misses are those four. Printed citation-accuracy remains the bar and still misses ≥90%. **Do not cite live 5’s 48/48, live 6–8 FPR, or this 62/66 harness count as a full compare close.**

**Live 9 diagnosis (offline, 2026-08-17 — no new fix):** see `packages/ai/src/evals/live9-regression-diagnosis.test.ts`.

- **`golden-false-rent-amount`.** Live 8: generic refuse, `insufficient`, no cites. Live 9: false-premise *copy* (“Sources do not contain enough information to confirm…”) with **no bait echo**, but cites `chunk_lease_term`. Validator coerces any retained cite from `insufficient`→`partial` (QA-05 path), which is the entire false-confidence 2.6%. Prompt collision: false-premise example uses `chunk_lease_term` as a non-answering Source and says `insufficient` / “Do not set partial” but never says `sources=[]`; v7 hedge example teaches cite + `partial` when an excerpt is incomplete; amendment (a) also names `chunk_lease_term` and says not to refuse because a base-lease excerpt is present. Keyword-probe ablation **cannot reproduce** the live cite: stripping the hedge (or the whole amendment pair) still probe-passes `insufficient`; only stripping the false-premise example flips the probe (bait-echo `partial`). Attribution is live-output blend + validator coerce, not a probe-reproducible marker leak.
- **`golden-adv-near-miss-ninety-day-draft`.** Live 9 fail #1/#3 (`insufficient`), pass #2. **Not a clean new regression.** Same case was already **1/3** on live 6 and live 7 (`grounded` / `insufficient` / `insufficient`). Live 8 was the first 3/3 pass (fingerprint `fp_6ec6bfb92d`); live 9 is 1/3 again (`fp_786821a2b4`). Not in the conservatism-13 set. Treat as historically noisy decoy-adjacent over-refusal.
- **`cc-live-mixed-term-labelled#1`.** Real but **low-frequency** adjacent over-correction. Live 6–8 passed 3/3 with a term-extension summary. Live 9 #1 is exactly the v4 isolated-decoy taught string `"No material changes detected."`; #2/#3 pass. Mixed example does not teach that string.

**Pattern live 6→9 (prompt-change rounds):** live 8 (v6/v3) fixed 3 targeted cases and introduced 2 new regressions (isolated decoys 18/18, QA-05 indemnity 3/3). Live 9 (v7/v4) **closed both of those** and introduced 1 solid adjacent miss (false-rent 3/3, copy held) plus 1 one-repeat compare miss. Magnitude is converging (FPR 50%→0%; new FC is 2.6% labeling). Count of “something moved” is not yet zero.

**Section A close-out (2026-08-17): closed-with-documented-residual.** Document-and-stop stacking worked examples. This is an **accepted gap**, not a passing result. Contradiction stays clean — leave it. Remaining named residuals (see [`AGENT_QUALITY.md`](./AGENT_QUALITY.md)):

- Case Q&A false-confidence **2.6%** — validator coerce of a correct insufficient refusal when `chunk_lease_term` is kept; not a false-fact assertion. Candidate scorer-only fix identified, **not built**.
- Case Q&A hallucination range still straddles &lt;5% (**max 5.3%**).
- Contract-compare citation accuracy still misses ≥90% — golden-pair **“as is”** (3/3 since live 7) and **`cc-live-mixed-term-labelled`** (1/3, isolated-decoy string on a mixed pair).
- **`golden-adv-near-miss-ninety-day-draft`** noisy (1/3 to 3/3 across rounds); not attributable to a prompt version; open item, not a regression to chase.

Do not add a fifth example. **Section B is now the only active step.**

### Section C — Adversarial / red-team (automated)

- [x] ≥3 adversarial cases per workflow: Case Q&A two-chunk combine + near-miss dates + similar clauses; contract-compare labelled/labeled decoy that reads like an edit; contradiction imprecise “end of February” vs exact February 28 (must not emit a candidate).
- [x] Prompt-injection coverage exercised against retrieved content for `research_agent` and `draft_agent` (`packages/agents/src/engine.test.ts`), not only the generic orchestration worker. Documented in `AI_EVALUATIONS.md`.

---

## To do — still blocking close-out

Prompt-example stacking on Section A is **paused**. The items below are **accepted residuals**, not a next engineering session. Do not treat them as “still open to chase.”

### Documented residuals (accepted; not a pass; stacking paused)

- [x] **`golden-false-rent-amount` — documented residual, not fixed.** Live 8 pass 3/3 (`insufficient`, no bait echo). Live 9 fail 3/3: refusal copy held (no “seven thousand”) but validator coerces to `partial` because `chunk_lease_term` was kept. Entire Case Q&A false-confidence **2.6%** (bar 0%). Candidate validator-coerce narrowing identified in [`AGENT_QUALITY.md`](./AGENT_QUALITY.md); **not built**. Do not add a new prompt example.
- [x] **Golden-pair `as is` — documented residual, not fixed.** Missing 3/3 on live 7–9. Isolated `cc-live-material-as-is` still passes. Real omission, not a scorer bug. Stable; not a v7/v4 regression.
- [x] **`cc-live-mixed-term-labelled#1` — documented residual, not fixed.** Live 9 1/3: isolated-decoy example over-applied to a mixed pair (emitted no-change; missing 2027). #2/#3 passed. Real, low-frequency. Do not chase with a third compare example.
- [x] **`golden-adv-near-miss-ninety-day-draft` — documented as noisy, not a regression to chase.** 1/3 (live 6–7) → 3/3 (live 8) → 1/3 (live 9). Not attributable to a specific prompt version.
- [x] **`golden-indemnity-with-amendment`.** Live 8 and live 9 pass 3/3.
- [x] **`cc-live-mixed-assignment-exhibit`.** Live 8 and live 9 pass 3/3.
- [x] **Isolated decoys.** Live 9 **pass 18/18**; FPR 0/36.

### Leftover graded-case miss (not a named bar driver; not chasing)

- [x] **QA-05 term (`golden-partial-hedge-term`) — documented leftover.** Live 9 state is `partial` 3/3 (labeling improved vs live 8 `grounded`) but still fails completeness (missing phrase “January 1, 2024”). Not treated as a Section A reopen.
- [x] **QA-05 indemnity (`golden-partial-hedge-indemnity`).** Live 9 **pass 3/3**.

### Section B — Real attorney review (not started; now the only active blocker)

Section B’s status is **unchanged: still not started.** Operator review exists and does **not** close it. This section is now the **only active blocker** on any Harvey-level claim for these workflows. Section A’s documented residual must not be misread as substituting for attorney scores.

- [x] Export 20–30 **live** agent outputs across Case Q&A + contradiction (`EVAL_EXPORT_REVIEW=1 npm run eval:ai:live` against pinned `gpt-4o-mini`, 2026-08-14) into a local gitignored export folder. Contract compare was **not** live-model in this packet.
- [x] Live remasure after filed fixes (same pin/cap, 2026-08-14 evening). **Rates recorded** in the live-2 table above. Those export files were later overwritten by a mock run and have been removed from the repo.
- [x] Live 3 after imprecise-date filter + ranking + variance harness (repeats=3, 2026-08-14 night) into a local gitignored export folder, including first live contract-compare summaries.
- [x] Layer 1 **operator** review recorded in [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](./AGENT_QUALITY_ATTORNEY_REVIEW.md) (role=`operator`, 2026-08-14 live 1 + evening remasure + live 3). **Does not close Section B.**
- [x] If findings show a systematic gap, file it as a specific fix — it **blocks treating Section A’s bar as sufficient for that workflow** even if the automated suite passed. Operator gaps filed as code 2026-08-14, remasured live 2, then ranking + imprecise-date filter remasured live 3. Live 3: contradiction meets the numeric bar; Case Q&A false-insufficient **regressed** (15.8% → 28.9%, range 28.9–28.9); live contract-compare summaries miss. Remaining engineering gaps were later remasured through live 9; Section A is now **closed-with-documented-residual**, not a bar pass. Do not overwrite the live-1 or live-2 tables. **Do not treat contradiction’s numeric pass, live 5 SYNTH compare, or the Section A residual close-out as closing Section B.**
- [ ] Get someone with legal judgment who did not write this code to blind-review each one: (1) Would I have caught this myself? (2) Is anything wrong or missing? (3) Would I send this to a client with light editing, or does it need a rewrite? Score pass / needs-work / fail. **Layer 2 (attorney / 2L–3L) still missing.**
- [ ] Record an **`attorney`** pass in [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](./AGENT_QUALITY_ATTORNEY_REVIEW.md). The operator row must not be relabeled attorney.
- [ ] This step must happen before Section A’s bars are trusted. **Attorney review still not recorded.** An automated suite passing with no human sign-off is not evidence of Harvey-level quality. A documented residual is also not evidence of Harvey-level quality.

---

## Do not close this tracker until

- All three workflows have graded suites at 20–30+ cases each with **measured** rates meeting the written numeric bar. **Section A is closed-with-documented-residual, not passed.** Live 9 contradiction **meets** (21/21 × 3, 0–0). Live 9 Case Q&A **misses** false-confidence 2.6% > 0% (false-rent `partial` 3/3 — validator coerce of a correct refusal, not a false-fact assertion); hallucination mean meets &lt;5% but **range straddles** (max 5.3%). Live 9 contract-compare **misses** citation accuracy 47.2% &lt; 90% (golden-pair `as is` 3/3; mixed-term-labelled#1); decoy FPR is now **0.0%**. **Live 2 is not a configuration baseline.** Those gaps are accepted and documented; they are not a license to claim the bars. Section B is still required and is now the only active blocker.
- At least one real attorney review pass (Section B) is recorded with actual scores, not “we plan to.”
- Any systematic gap found in review has a corresponding fix or is explicitly logged as an open risk in `AGENT_QUALITY.md`, not silently dropped.

When Section B is checked, move it into **Done** and only then leave **To do** empty. Do not mark this complete based on code existing — mark it complete based on live measured numbers plus attorney scores meeting the bar in `AGENT_QUALITY.md`. Do not mark it complete because Section A was closed-with-documented-residual.

---

## Out of scope (do not pull in unless asked)

- Autonomous filing / send / settle
- Auto-verifying Memory or Graph
- Licensed Westlaw/Lexis replacement
- Confidence % as mathematical certainty
- Expanding agent count before the three workflows feel industrial end-to-end
- Case Experience / Case Dogfood / Production Readiness / Nyaya Professor work (separate trackers)

---

## How to use

1. Pick the next unchecked section (**Section B is the only active blocker.** Section A is closed-with-documented-residual — do not reopen it for prompt-example stacking.)
2. Implement + measure. Check off a box only when the artifact exists.
3. Record measured rates in the table above in the same PR/session.
4. Move a whole section to **Done** only when all of its boxes are `[x]` **and** the written bars are actually met. Section A’s `[x]` residual boxes mean documented-and-accepted, not passed.
