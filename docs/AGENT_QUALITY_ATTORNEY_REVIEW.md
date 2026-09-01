# Agent Quality — Review Log

Blind review of **live** agent outputs (Case Q&A, contract compare, contradiction/timeline).

An automated suite passing with no human sign-off is **not** evidence of Harvey-level quality. Section A numeric bars in [`AGENT_QUALITY.md`](./AGENT_QUALITY.md) must not be treated as sufficient until an **`attorney`** pass is recorded below. An `operator` pass unblocks engineering; it does **not** close Section B.

## How to run a pass

1. Export live outputs (not mock):

   ```bash
   EVAL_LIVE=1 OPENAI_API_KEY=... EVAL_LIVE_MODEL=gpt-4o-mini EVAL_EXPORT_REVIEW=1 npm run eval:ai:live
   ```

   Packets land under gitignored `docs/agent-quality-review/exports-live/` (question/input, full output, cited sources). Historical packets were removed from the repo; rates remain in [`AGENT_QUALITY_TRACKER.md`](./AGENT_QUALITY_TRACKER.md).

2. Reviewer role (pick one; do not upgrade the label):

   | Role | Who | Counts as Section B close-out? |
   | --- | --- | --- |
   | `attorney` | Admitted lawyer who did **not** write the agent/eval code | **Yes** |
   | `student` / `paralegal` | Legal training, did not write the code | No — record the pass; keep Section B open |
   | `operator` | Builder / founder scoring against SYNTH fixtures they know | **No** — Layer 1 only; never put this name in the attorney field |

   If you have no practicing attorney: run an `operator` pass now (faithfulness to SYNTH sources, planted diffs, dual-sided conflicts, no invented citations). That unblocks engineering. It does **not** let you claim Harvey-level quality. How to get a cheap Layer 2 reviewer is in [`HARVEY_LEVEL_ROADMAP.md`](./HARVEY_LEVEL_ROADMAP.md) §P0.

3. For each item, score **pass / needs-work / fail**:
   1. Would I have caught this myself?
   2. Is anything wrong or missing?
   3. Would I send this to a client with light editing, or does it need a rewrite?

   Treat **fail** and **needs-work** as below “useful without major edit.”

4. Record the table below. Any systematic gap (e.g. contract compare missed 2 of 5 material changes more than once) must be filed as a specific fix and **blocks closing Section A’s bar for that workflow**.

---

## Pass record — Layer 1 operator (2026-08-14)

| Field | Value |
|---|---|
| Reviewer | Cursor Grok 4.6 (coding agent in this repo) scoring against known SYNTH lease / CAM fixtures |
| Reviewer role | **`operator`** — not attorney, not student, not paralegal |
| Date | 2026-08-14 |
| Provider / model | OpenAI `gpt-4o-mini` (pinned via `EVAL_LIVE_MODEL=gpt-4o-mini`; chat alias as of this date — API did not return a dated snapshot id) |
| Budget | In-process cap `EVAL_LIVE_MAX_USD=0.75` / `EVAL_LIVE_MAX_TOKENS=200000`. Actual: 59 requests, 23,289 tokens, **~$0.0068**. OpenAI *account* spend limit is not settable from this repo — confirm a project cap in the OpenAI dashboard separately. |
| Export folder | Removed from repo. Rates in [`AGENT_QUALITY_TRACKER.md`](./AGENT_QUALITY_TRACKER.md). |
| Scoring scale | pass / needs-work / fail |
| Section B close-out? | **No.** This is Layer 1 only. |

Automated live rates (same run; bars not softened):

| Workflow | n | Citation accuracy | Hallucination | False-insufficient | False-confidence | Citation-relevance fail | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Case Q&A | 38 | 58.3% | 41.7% | 18.4% | 0.0% | 0.0% | **no** |
| Contradiction / timeline | 21 | 100.0% | 0.0% | 14.3% | 23.8% | 0.0% | **no** |
| Contract compare | — | not live-model | — | — | — | — | this packet has no live compare *agent* outputs; diffs remain deterministic in `@nyayagrid/intelligence` |

Read the hallucination % with care: many Case Q&A “fails” are **schema-shape** (`answer` as an object, `assumptions` as a string) rather than invented case law. Contradiction parse fails are often `confidence: "High"` or `confidence: 0.9` instead of `"high"` / `"medium"` / `"low"`. Substance is scored separately in the table.

### Per-item scores (operator vs SYNTH truth)

| # | Workflow | Item id | Score | Notes |
|---|---|---|---|---|
| 1 | case_qa | golden-lease-commencement | pass | January 1, 2024; cites `chunk_lease_term`; did not grab rent decoy. |
| 2 | case_qa | golden-indemnity-with-amendment | pass | Tenant negligence / not Landlord sole negligence; cites amendment, not term decoy. |
| 3 | case_qa | golden-cam-date-conflict | pass | Surfaces both Feb 28 and Mar 3; does not pick a winner. |
| 4 | case_qa | golden-cam-date-conflict-incomplete | pass | Only depo in retrieval; did **not** invent March 3. |
| 5 | case_qa | golden-indemnity-missing-amendment | pass | Correct insufficient; no fabricated “sole negligence.” |
| 6 | case_qa | golden-unrelated-capital | pass | Refused; did not say Paris. |
| 7 | case_qa | golden-judge-not-in-record | pass | Refused; no invented judge/docket. |
| 8 | case_qa | golden-adv-near-miss-proposed-commencement | pass | Executed commencement Jan 1; ignored unsigned Jan 15 hold. |
| 9 | case_qa | golden-adv-notice-vs-renewal | pass | Harness PASS; 30-day terminate vs 60-day renew not swapped (eval log). |
| 10 | case_qa | golden-rent-amount | needs-work | Retrieval **contains** $4,000 Base Rent plus a $500 late-fee decoy. Model returned stock insufficient. Over-refuse, not a hallucination. |
| 11 | case_qa | golden-adv-similar-clause-rent-vs-late-fee | needs-work | Same: rent chunk is present; refused. |
| 12 | case_qa | golden-adv-near-miss-term-sheet-rent | needs-work | Executed $4,000 is in retrieval next to unsigned $5,000 term sheet; refused instead of citing Base Rent. |
| 13 | case_qa | golden-adv-near-miss-ninety-day-draft | needs-work | Executed 30-day notice is in retrieval; refused. |
| 14 | case_qa | golden-qa06-intel-no-docs | needs-work | Prompt includes verified intel (Feb 28 send). Model ignored it and insufficient’d. QA-06 wants **partial**, not silence. |
| 15 | case_qa | golden-qa06-graph-no-docs | needs-work | Same pattern on verified graph. |
| 16 | case_qa | golden-qa06-memory-no-docs | needs-work | Same pattern on approved memory. |
| 17 | case_qa | golden-adv-near-miss-commencement | pass | Legally correct: not Jan 15, is Jan 1, cited term chunk. Harness FAILED because the answer *mentioned* the question’s decoy date (faithfulness/forbidden phrase). Do not treat that harness fail as a hallucination of a new date. |
| 18 | case_qa | golden-adv-combine-rent-and-term | needs-work | Facts are right ($4,000 + Jan 1, both chunks cited) but `answer` is a JSON object so the validator never grades it. Client-ready substance; unusable schema. |
| 19 | case_qa | golden-adv-combine-indemnity-and-rent | needs-work | Same: correct combined facts, `answer` is an object. |
| 20 | case_qa | golden-partial-hedge-indemnity | needs-work | Substance is a fair partial hedge on indemnity; `assumptions`/`unresolvedQuestions` are strings not arrays → parse fail. |
| 21 | case_qa | golden-partial-hedge-term | needs-work | Hedges “partially settled” but `evidenceState=grounded` and omits the required “January 1, 2024” phrase. |
| 22 | case_qa | golden-empty-retrieval | needs-work | Right instinct (insufficient, no sources) but `answer: null` fails CitedAnswer parse. |
| 23 | contradiction | cx-cam-dual-sided | pass | Dual-sided Feb 28 vs Mar 3; decoy notice **not** used as a side. Harness FAIL is `"confidence": "High"` (schema wants `"high"`). Do not score as a collapsed contradiction. |
| 24 | contradiction | cx-adv-genuine-still-required | pass | Same genuine conflict, both sides sourced. Harness FAIL is `confidence: 0.9` (number). |
| 25 | contradiction | cx-before-after | pass | Dual-sided completed vs unfinished; decoy notice unused; schema `"high"` accepted. |
| 26 | contradiction | cx-one-sided-generate | pass | Empty candidates; did not invent a second side. |
| 27 | contradiction | cx-false-positive-paraphrase | pass | Empty candidates on invoice paraphrase. |
| 28 | contradiction | cx-false-positive-imprecise-date | fail | Emitted a “conflict” between Feb 28 and “end of February.” That is not inconsistent. False confidence on a one-sided/imprecise trap. |
| 29 | contradiction | cx-reject-synonym-sent | fail | Emitted a conflict between “emailed” and “transmitted.” Paraphrase, not a contradiction. |
| 30 | contradiction | cx-reject-on-or-about-same-date | fail | Same class: on-or-about Feb 28 vs Feb 28 treated as a conflict (plus numeric confidence). |

Schema-only contradiction fixtures (cx-schema-*) are not model outputs and were not operator-scored.

Contract compare: **no live agent outputs in this packet.** Operator did not score planted-change recall or decoy FPR on a model summary.

### Below “useful without major edit”

- Over-refusal when the answering chunk is present beside a decoy (rent vs late fee / term sheet / 90-day draft).
- QA-06: verified intel/graph/memory ignored.
- Contradiction false positives on imprecise date, synonym, and on-or-about (items 28–30).
- Schema-broken answers that are factually right (combine cases, some hedges) — would not ship to a client as-is because they do not parse as `CitedAnswer`.

### Systematic gaps (block treating Section A’s bar as sufficient)

These are engineering gaps from this operator pass. They do **not** close or open Section B by themselves. They **do** block treating the written numeric bar as a quality close-out for the affected workflow until a **second live run** remasures them. The 2026-08-14 live rates stay on the record; do not overwrite them with mock results.

**Filed as code (2026-08-14), not yet live-remeasured:**

1. **CitedAnswer / contradiction JSON shape** — filed: `normalizeCitedAnswerRaw` flattens object `answer`, coerces string lists, maps evidence-state synonyms; `normalizeContradictionRaw` maps `"High"` / `0.9` → `"high"`. Prompts now require a string `answer` and lowercase confidence. Prompt versions: `nyaya-matter-qa-v3`, `contradiction-analysis-v2`.
2. **False-insufficient with decoys in the retrieved set** — filed: system prompt tells the model to cite the answering Source even when a near-miss decoy is also retrieved. Still a live-model behavior risk until remasured.
3. **QA-06 unused** — filed: if verified intel/graph/memory is present, retrieval is empty, and the model returns stock insufficient, `applyQa06VerifiedIntelCap` now sets `partial` and surfaces the verified text (never `grounded` without document cites).
4. **Contradiction over-detection** — filed: contradiction prompt forbids treating paraphrase, rounding, on-or-about, or imprecise restatement as a conflict. Schema still requires both sides.
5. **Question-echo dates** — filed: mentioning a date that appears in the question (to reject a near-miss) is not an invented-date / forbidden-phrase fail when the sourced date is also present. Canary invented dates that are not in the question still fail.
6. **Contract compare live agent path not measured** — unchanged. This run did not call a live model for compare summaries. Do not cite mock/deterministic 100% decoy FPR as live quality.

**Attorney (Layer 2) review is still missing.** Do not use the word Harvey-level on the back of this pass.

---

## Pass record — Layer 1 operator remasure (2026-08-14 evening)

| Field | Value |
|---|---|
| Reviewer | Cursor Grok 4.6 (coding agent in this repo) scoring against known SYNTH lease / CAM fixtures |
| Reviewer role | **`operator`** — not attorney, not student, not paralegal |
| Date | 2026-08-14 (evening remasure after schema/QA-06/prompt/question-echo fixes) |
| Provider / model | OpenAI `gpt-4o-mini` (pinned via `EVAL_LIVE_MODEL=gpt-4o-mini`) |
| Budget | Same in-process cap `EVAL_LIVE_MAX_USD=0.75` / `EVAL_LIVE_MAX_TOKENS=200000`. Actual: 59 requests, 26,538 tokens, **~$0.0068**. |
| Export folder | Removed from repo (was later mock-clobbered). Rates in this section still stand. |
| Scoring scale | pass / needs-work / fail |
| Section B close-out? | **No.** This is still Layer 1 only. |

Automated live-2 rates (bars not softened):

| Workflow | n | Citation accuracy | Hallucination | False-insufficient | False-confidence | Citation-relevance fail | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Case Q&A | 38 | 80.6% | 19.4% | 15.8% | 0.0% | 0.0% | **no** |
| Contradiction / timeline | 21 | 100.0% | 0.0% | 0.0% | 14.3% | 0.0% | **no** |
| Contract compare | — | not live-model | — | — | — | — | still no live compare *agent* outputs |

Vs live 1: Case Q&A cite acc 58.3% → 80.6%; hallu 41.7% → 19.4%; false-insufficient 18.4% → 15.8%. Contradiction false-insufficient 14.3% → 0.0%; false-confidence 23.8% → 14.3%. 25/68 failed → 11/68. **Still misses the bar.**

### Per-item scores (operator vs SYNTH truth, remasure)

Focused on live-1 misses and live-2 remaining fails. Substance that already passed live 1 (Jan 1 commencement, CAM dual dates, refuse Paris/judge, ignore unsigned Jan 15 hold) was spot-checked and did not regress.

| # | Workflow | Item id | Score | Notes |
|---|---|---|---|---|
| R1 | case_qa | golden-qa06-intel-no-docs | pass | `partial`; Feb 28 from verified intel; no document cite. Cap fired as designed (model still tends to stock-refuse; post-process surfaces verified text). |
| R2 | case_qa | golden-qa06-graph-no-docs | pass | Same: Tenant–CAM dispute from verified graph, `partial`. |
| R3 | case_qa | golden-qa06-memory-no-docs | pass | Same: Tenant-negligence indemnity from approved memory, `partial`. |
| R4 | case_qa | golden-adv-near-miss-commencement | pass | “No… January 1, 2024”; cites term chunk. Harness now passes (question-echo fix). |
| R5 | case_qa | golden-adv-similar-clause-rent-vs-late-fee | pass | $4,000 Base Rent; did not cite late-fee decoy. Live 1 over-refused this same pairing. |
| R6 | case_qa | golden-adv-combine-indemnity-and-rent | pass | String answer (not an object); $4,000 + Tenant negligence; both chunks cited. |
| R7 | case_qa | golden-adv-combine-notice-and-term | pass | Dec 31, 2026 + thirty days; both chunks cited. |
| R8 | case_qa | golden-empty-retrieval | pass | Insufficient, no sources. `answer: null` no longer breaks parse. |
| R9 | case_qa | golden-cam-date-conflict | pass | Surfaces Feb 28 and Mar 3; does not pick a winner. |
| R10 | case_qa | golden-adv-near-miss-proposed-commencement | pass | Jan 1 executed commencement; ignored unsigned Jan 15 hold. |
| R11 | contradiction | cx-cam-dual-sided | pass | Dual-sided Feb 28 vs Mar 3; `confidence: "high"` (lowercase) parses. Notice decoy unused as a side. |
| R12 | contradiction | cx-adv-genuine-still-required | pass | Same genuine conflict; `confidence: "high"`. Live 1 failed on `0.9`. |
| R13 | contradiction | cx-reject-synonym-sent | pass | Empty candidates on emailed vs transmitted. Live 1 failed. |
| R14 | contradiction | cx-reject-on-or-about-same-date | pass | Empty candidates. Live 1 failed. |
| R15 | case_qa | golden-rent-amount | needs-work | Same question as R5 (rent + late-fee retrieval) but this run stock-refused. Over-refuse; not a new invented figure. Temp-0 is not fully stable across identical prompts. |
| R16 | case_qa | golden-adv-near-miss-term-sheet-rent | needs-work | Executed $4,000 sits next to unsigned $5,000; refused. |
| R17 | case_qa | golden-adv-near-miss-ninety-day-draft | needs-work | Executed 30-day notice in retrieval; refused. |
| R18 | case_qa | golden-adv-combine-rent-and-term | needs-work | Live 1 had the facts as an object; live 2 stock-refused. Worse this run. |
| R19 | case_qa | golden-adv-notice-vs-renewal | needs-work | Notice + renewal retrieved; refused. Solo notice-period case still answers. |
| R20 | case_qa | golden-indemnity-with-amendment | needs-work | Amendment chunk is in retrieval; refused. Live 1 operator-scored this **pass**. Regression. |
| R21 | case_qa | golden-partial-hedge-indemnity | needs-work | Prose is a fair partial hedge and cites the amendment, but `evidenceState=grounded` (QA-05 wants `partial`). |
| R22 | case_qa | golden-partial-hedge-term | needs-work | Excerpt does contain Jan 1–Dec 31; model called it “fully settled” / `grounded`. Harness wants a hedge → `partial`. |
| R23 | contradiction | cx-false-positive-imprecise-date | fail | Still emits Feb 28 vs “end of February” as a dual-sided conflict. |
| R24 | contradiction | cx-adv-imprecise-phrasing | fail | Same pair, same false positive. |
| R25 | contradiction | cx-reject-imprecise-plus-decoy-notice | fail | Same imprecise-date FP; unrelated notice clause was **not** used as a side. |

### Below “useful without major edit” (remasure)

- Over-refusal when a second near-miss or sibling clause is retrieved remains the main Case Q&A miss. It is **not** fixed; it is **less frequent and non-deterministic** (identical rent+late-fee prompt passed on similar-clause and failed on rent-amount in the same run).
- Imprecise “end of February” vs February 28 is still treated as a contradiction. Synonym and on-or-about traps now pass.
- QA-05: anti-refuse prompting made the model more willing to label `grounded` when the rubric expects a hedge/`partial`.
- QA-06 and JSON-shape (object `answer`, `"High"` / `0.9`) held on this remasure.

### Systematic gaps after remasure (still block treating Section A’s bar as sufficient)

Live 2 measured the filed fixes. Remaining gaps:

1. **Decoy-adjacent over-refusal** — still the Case Q&A false-insufficient driver. Prompt line was not enough. Next fix is likely retrieval ranking / “answer from the matching source” examples, not another synonym in the system prompt. Do not soften the false-insufficient bar.
2. **Imprecise-date contradiction FPs** — “end of February” vs February 28 still emits a candidate. Rounding / synonym / on-or-about now empty. Tighten the detector or add a deterministic imprecise-date reject before showing the candidate.
3. **QA-05 evidenceState** — grounded+complete answers fail a hedge rubric. Decide whether QA-05 should accept grounded when the excerpt actually answers, rather than requiring the model to under-claim.
4. **Contract compare live agent path not measured** — unchanged across both live runs.
5. **Remaining Case Q&A “hallucination” %** — live 2 cite acc + hallu sum to 100% of attempted cites. Treat that as rejected/non-verbatim quotes collapsing to insufficient, not invented reporters, until a raw-payload dump says otherwise.

**Attorney (Layer 2) review is still missing.** Do not use the word Harvey-level on the back of this pass.

---

## Pass record — Layer 1 operator live 3 (2026-08-14 night)

| Field | Value |
|---|---|
| Reviewer | Cursor Grok 4.6 (coding agent in this repo) scoring against known SYNTH lease / CAM / MSA fixtures |
| Reviewer role | **`operator`** — not attorney, not student, not paralegal |
| Date | 2026-08-14 (night; after imprecise-date filter, question-overlap ranking, `EVAL_LIVE_REPEATS=3`) |
| Provider / model | OpenAI `gpt-4o-mini` (pinned via `EVAL_LIVE_MODEL=gpt-4o-mini`) |
| Budget | Same in-process cap. Case Q&A + contradiction: 177 requests, 82,124 tokens, **~$0.0205**. Contract-compare live summaries were a separate 2×3 pass (plus a second 2×3 after the cite-denominator fix so summaries could be exported). Still well under $0.75. |
| Export folder | Removed from repo. Rates in [`AGENT_QUALITY_TRACKER.md`](./AGENT_QUALITY_TRACKER.md). |
| Scoring scale | pass / needs-work / fail |
| Section B close-out? | **No.** This is still Layer 1 only. Contradiction meeting the numeric bar does not close Section B. |

Automated live-3 rates (bars not softened; bar judged on the **mean**; min–max identical on every workflow):

| Workflow | n | repeats | Citation accuracy | Hallucination | False-insufficient | False-confidence | Meets written bar? |
|---|---|---|---|---|---|---|---|
| Case Q&A | 38 | 3 | 55.6% (55.6–55.6) | 44.4% (44.4–44.4) | 28.9% (28.9–28.9) | 0.0% | **no** |
| Contradiction / timeline | 21 | 3 | 100.0% (100–100) | 0.0% | 0.0% | 0.0% | **yes (numeric only)** |
| Contract compare (live summaries) | 2 scenarios | 3 | 50.0% (50.0–50.0) | 50.0% (50.0–50.0) | 50.0% (50.0–50.0) | 0.0% | **no** |

The 13 Case Q&A fails were the **same cases on all three repeats**. That is a stable miss, not a noisy point estimate. Cite-acc / hallu on Case Q&A remain complements of attempted cites; the drop vs live 2 is partly compositional (more stock refusals leave fewer clean grounded cites in the denominator) plus paraphrase-as-fabricated on remaining answers. Do not read 44.4% as invented reporters.

### Per-item scores (operator vs SYNTH truth, live 3)

Focused on the live-2 remaining gaps, the new deterministic filter, ranking, and the first live compare summaries. Spot-checked held cases (Jan 1 commencement, CAM dual dates, refuse Paris/judge, QA-06 `partial`) did not regress.

| # | Workflow | Item id | Score | Notes |
|---|---|---|---|---|
| L3-1 | contradiction | cx-false-positive-imprecise-date | pass (product) | Model still emits Feb 28 vs “end of February.” Filter drops the candidate (`candidates=0` harness pass × 3). User never sees it. Do not claim the model learned dates. |
| L3-2 | contradiction | cx-adv-imprecise-phrasing | pass (product) | Same filter. Genuine CAM (`cx-cam-dual-sided`, `cx-adv-genuine-still-required`) still surfaces Feb 28 vs Mar 3 — filter did not over-drop. |
| L3-3 | contradiction | cx-reject-on-or-about-same-date | pass | Empty candidates × 3. Held from live 2. |
| L3-4 | case_qa | golden-rent-amount | pass | $4,000 Base Rent; late-fee decoy present; cited rent chunk. Live 1/2 over-refused this id. |
| L3-5 | case_qa | golden-adv-similar-clause-rent-vs-late-fee | needs-work | **Same question and same retrieval as L3-4.** Stock refused × 3. Live 2 had the opposite split (this id passed, rent-amount refused). Ranking did not make the pair deterministic across sessions. |
| L3-6 | case_qa | golden-adv-near-miss-ninety-day-draft | pass | 30-day executed notice; ignored unsigned 90-day draft. Live 2 over-refused. |
| L3-7 | case_qa | golden-notice-period | needs-work | **No decoy in retrieval** — only the notice chunk — and still stock-refused × 3. Live 2 answered. Over-refusal is not only “decoy adjacent.” |
| L3-8 | case_qa | golden-indemnity-with-amendment | needs-work | Amendment chunk is in retrieval; refused × 3. Live 1 operator-pass; live 2/3 refuse. Ranking did not recover it. |
| L3-9 | case_qa | golden-adv-near-miss-term-sheet-rent | needs-work | Executed $4,000 next to unsigned $5,000; refused × 3. |
| L3-10 | case_qa | golden-adv-combine-rent-and-term | needs-work | Both answering chunks present; stock refused × 3. All five combine cases refused every repeat. |
| L3-11 | case_qa | golden-adv-notice-vs-renewal | needs-work | Notice + renewal retrieved; refused × 3. |
| L3-12 | case_qa | golden-partial-hedge-indemnity | needs-work | Prose is a fair partial hedge (“only partially settled”) and cites the amendment, but `evidenceState=grounded`. QA-05 wants `partial`. |
| L3-13 | case_qa | golden-partial-hedge-term | needs-work | Same label mismatch × 3. |
| L3-14 | case_qa | golden-qa06-intel-no-docs | pass | `partial` cap held × 3. |
| L3-15 | contract_compare | cc-live-empty-no-invent | pass | Identical texts; did not invent differences × 3. First live compare signal that is actually about the model. |
| L3-16 | contract_compare | cc-live-golden-pair-summary | pass (substance) / fail (harness) | Summary lists the planted MSA changes. Harness flags “The notice period for termination has been extended to 60 days” as unsupported. That change **is planted** (`thirty (30)` → `sixty (60)` days). Scorer does not equate `60` with `sixty (60)`. Do not score as an invented clause. |

### Below “useful without major edit” (live 3)

- Over-refusal is **worse and stable** this run (11/38 false-insufficient every repeat), including a clean single-chunk notice-period miss. Retrieval ranking was the right next experiment; it did not close the gap and did not outperform live 2’s prompt-only anti-refuse on the suite rate.
- Identical rent+late-fee prompts can still land on opposite sides of refuse/answer across sessions; within this session each id was sticky 3/3.
- QA-05 still labels a hedge `grounded`.
- Contract-compare live harness over-flags a planted numeral wording; empty-pair invention did not happen.

### Systematic gaps after live 3 (still block treating Section A’s bar as sufficient)

1. **Over-refusal** — still the Case Q&A driver. Ranking so the answering chunk is first was not enough. Next lever is likely *how* decoys and second facts are presented (or a non-LLM extract-then-cite path for single-fact questions), not another system-prompt synonym. Do not drop decoys from retrieval to make the suite green. Do not soften the false-insufficient bar.
2. **QA-05 evidenceState** — unchanged: grounded+complete answers fail a hedge rubric.
3. **Contract-compare summary scorer** — numeral / words-for-numbers mismatch (`60` vs `sixty (60)`). **Filed and remasured in isolation live 4:** golden-pair + empty-pair 6/6 pass (3 repeats). Still n=2 scenarios. Do not close the workflow.
4. **Contradiction numeric bar** — met on live 3 because of the filter, not because the model stopped emitting imprecise-date FPs. Keep the filter. Section B still required.

**Attorney (Layer 2) review is still missing.** Do not use the word Harvey-level on the back of this pass.

---

## Isolation notes — Layer 1 (2026-08-14 night, after live 3)

Not a new Section B pass. Sampling + rerank isolation only.

| Field | Value |
|---|---|
| Reviewer role | **`operator`** |
| API snapshot | `gpt-4o-mini-2024-07-18` (`model` field) |
| system_fingerprint | `fp_9afcdcbeed` |
| Temperature | `0` (already pinned; now `LIVE_EVAL_TEMPERATURE` and logged) |
| Section B close-out? | **No.** |

`golden-adv-similar-clause-rent-vs-late-fee`: refused 5/5 with eval rerank still on; refused 3/3 after revert. Live 2 operator-scored this id **answered**. Do not call the cross-session flip resolved.

Eval rerank reverted for Case Q&A live 4. Production search/hybrid ranking unchanged this session.

Contract-compare live 4 (after `60`/`sixty` scorer fix): both scenarios aligned, 3/3, no empty-pair invention. **Scorer-bugfix verified on n=2, not a workflow-level rate.**

Live 2 vs live 3 Case Q&A prompt/snapshot: **unknown from git and packets.** See tracker reconstruction. Do not treat live 2 as a config baseline.

Live 5 contract-compare: 16 scenarios × 3 = 48/48 pass (`compare-summary-v1`, `gpt-4o-mini-2024-07-18`, `fp_98f538dc1a`). **citation_relevance fired 0/48.** Isolated decoys are not a mixed material/near-miss test. Summarization/scorer pass, not a decoy-discrimination close-out. Section B still open.

Live 6 (measurement only, 2026-08-14): Case Q&A v5 cite acc 63.1% (56.8–70.3), false-insufficient 7.0% mean (meets &lt;10%), false-confidence 1.8%. QA-05 indemnity `partial` 3/3; QA-05 term model-`grounded` 3/3. Compare decoy-discrimination fired n=36, FPR 55.6%. Bars not softened. No new lever. Section B still open.


