# NYAYAGRID PHASE 6B — COMPARE / CONTRADICTION BASELINE

**Date:** 2026-08-18  
**Case Q&A:** Frozen. Prompt v11, evidence assessment, V1/V2 PDFs, hidden GT, and Case Q&A graders were not modified.  
**Production engines:** `compareDocuments` and `detectContradictionCandidates` were not tuned.  
**Official scores:** Baseline B.1 (`BASELINE_B1_COMPARE_CONTRADICTION.md` / `.json`).

This is synthetic-fixture evaluation, not attorney review.

---

## 1. Executive Summary

Phase 6A was right: NYAYA-BENCH was invoking the real Compare and Contradiction engines, then scoring serialized JSON with the Case Q&A chat/needle grader. That is not an independent subsystem evaluation.

Phase 6B built structured graders that score production change rows and findings, then ran the **current** engines unchanged.

**Compare is not beta-safe.** 0/48 pass. Material-change recall is 0. Every decoy task promoted exhibit/typo text as `high_attention` because PDF extract + paragraph split produces page-sized blobs, and attention keywords (`liabil`) mark those blobs high-attention.

**Contradiction is not beta-safe for conflict detection.** Tension accuracy is 0/16. Compatible-date abstention is 16/16. One critical actor-inference finding treated an access log as proof that Mercer accessed the records room.

Do not read the combined 16/80 pass rate. Those 16 passes are all T011 compatible-date tasks.

**Stop condition:** B.1 is recorded. No Compare/Contradiction product changes were implemented.

### Part 1 verification (no discrepancy that blocked this phase)

Confirmed in current code:

| Claim | Status |
| --- | --- |
| Production Compare = `compareDocuments` | Confirmed (`packages/intelligence/src/analysis/compare.ts`) |
| Persists `documentComparisons` + `documentComparisonChanges` | Confirmed |
| Summary alignment = `applyComparisonSummaryAlignmentPolicy` / `scoreComparisonSummaryAgainstDiffs` | Confirmed |
| Production Contradiction = `detectContradictionCandidates` | Confirmed (`packages/intelligence/src/analysis/deposition.ts`) |
| Persists `analysisFindings` (`proposed`) + `analysisFindingSources` | Confirmed |
| Cross-document → production `findingType: "contradiction"`; same-document → `"tension"` | Confirmed (structural, not legal semantics) |
| Dual-sided sources required | Confirmed |
| Imprecise-date filter exists | Confirmed |
| Full-system previously ran real engines | Confirmed |
| Structured outputs were not independently graded before 6B | Confirmed |
| Chat grader was used on serialized JSON | Confirmed (Phase 6A) |
| Hidden GT loads only after `persistAnswer` + `assertAnswerPersisted` | Confirmed; tests retained |

Discrepancies (documented, not silently “fixed” in production):

1. `detectContradictionCandidates` return omits sources. The benchmark adapter calls `listFindings({ includeSources: true })`.
2. Production `findingType` ≠ benchmark contradiction vs tension. A semantic mapping layer lives in the grader.
3. `executionTarget=analysis` previously called `generateDraft`. **Benchmark routing only** now throws instead of inventing a generic analysis score.
4. `eval:ai` Compare/Contradiction graders still exist on golden snippets and are still not this baseline.
5. Proposed findings and unlabeled comparison summaries still enter Ask Nyaya context. Not modified in this phase.

---

## 2. Previous Benchmark Problem

V2 Compare and Contradiction tasks have structured expectations: paired material changes, decoy/non-material changes, evidentiary tension, and compatible dates.

Phase 6A full-system mode called the real engines, serialized the artifact to JSON, then asked the Case Q&A grader whether expected **words** appeared anywhere in that blob.

That method cannot tell:

- whether notice 45→30 and cap $255,000→$510,000 exist as **paired change rows**
- whether a decoy is `high_attention`
- whether a finding is tension vs contradiction vs a different conflict pair
- whether badge activity was treated as physical entry

A page-sized `removed` blob that happens to contain “45 days” would satisfy a needle search and still be a failed Compare engine. Independent subsystem grading has to inspect structured rows and findings.

---

## 3. Structured Grader Architecture

The benchmark **adapts** production output. It does not add benchmark-only production behavior.

### Compare

Canonical record (from persisted `documentComparisons` / `documentComparisonChanges`):

- `taskId`, `comparisonId`, `leftDocumentId`, `rightDocumentId`, filenames
- `changes[]`: `before`, `after`, `changeType`, `materiality` (production `attention`), locations, source references
- `summary`, citations/provenance, production `summaryAlignment`

Grader checks (deterministic):

1. Required material changes found as **same-row** before/after (notice 45→30, cap 255000→510000)
2. Before value correct; after value correct; swapped values are critical
3. Correct document/version pair (`01_Main_Agreement` vs `02_Amendment_1`)
4. Decoy/non-material changes not `high_attention`
5. Provenance present
6. Summary does not contradict structured changes / does not promote a decoy as a substantive amendment

Needles against serialized JSON are not used (`needlesRequired: []`).

### Contradiction

Canonical record (from `listFindings` with sources):

- `taskId`
- `findings[]`: production type, mapped semantic class, `statementA`/`statementB`, `sourceA`/`sourceB`, status, title, explanation

Semantic mapping (grader-only):

| Production | Benchmark class when content matches |
| --- | --- |
| Cross-document `contradiction` | May map to **tension** if badge vs testimony |
| Same-document `tension` | Tension if that is what the claim is |
| Imprecise date vs exact date | **compatible** |
| Dual-sided unsupported pair | **insufficient** |
| Mutually exclusive legal propositions | **contradiction** |

V2 T010 `possible_contradiction` is graded as expected **tension** (Mercer testimony vs badge log). V2 T011 `not_contradiction` is graded as **compatible**.

Matching a T010 finding requires the **asserted claim** (title + explanation) to be about badge vs testimony. Concatenated supporting-text from unrelated PDFs does not count.

---

## 4. Hidden-GT Isolation

Execution order remains:

documents → production engine → persisted production output → benchmark answer artifact → `assertAnswerPersisted` → `loadGroundTruth` → structured grader

Evidence:

- `runner/execute-subsystems.ts` and `runner/adapt-structured.ts` do not import `loadGroundTruth`
- `packages/intelligence/src/analysis/compare.ts` and `deposition.ts` do not import nyaya-bench, hidden GT, or `SYNTH-V2`
- `gradePersistedTask` asserts the answer file, then loads GT
- Tests: `benchmarks/nyaya-bench/tests/order.test.ts`, `isolate.test.ts`

Compare/Contradiction production execution cannot see expected answers.

---

## 5. V2 Ground-Truth Reuse

Reused **all** V2 scenario keys that already encode Compare/Contradiction structure. Hidden GT was not rewritten.

| Task | Expectation | Count | Reused |
| --- | --- | ---: | --- |
| `SYNTH-V2-001` … `016`-T007 | `material_changes` (notice 45→30, cap $255,000→$510,000) | 16 | Yes |
| `…-T008` | `non_material_change` (exhibit A→B administrative renumbering) | 16 | Yes |
| `…-T009` | `non_material_change` (recieve→receive typo) | 16 | Yes |
| `…-T010` | `possible_contradiction` → semantic **tension** (deposition vs access log) | 16 | Yes |
| `…-T011` | `not_contradiction` → semantic **compatible** (mid-November vs 2026-11-10) | 16 | Yes |

**Excluded**

| Set | Why |
| --- | --- |
| All V1 tasks | Chat-shaped GT (`must_answer` / `must_abstain`). No `material_changes` / `possible_contradiction` keys. |
| V2 T001–T006, T012–T025 | Case Q&A / timeline / citation / other categories. Out of scope; Case Q&A frozen. |

No V3 scenarios were created.

---

## 6. Compare Baseline B.1

Live outputs: `2026-08-18T21-42-30-864Z`  
Official grades: `regrade-A1-2026-08-18T21-51-56-436Z`

| Metric | Value |
| --- | ---: |
| Tasks | 48 |
| Pass | **0** |
| Needs work | 0 |
| Fail | 48 |
| Infrastructure | 0 |
| Critical | **32** |
| Material-change recall | **0** (0/16 T007) |
| Material-change precision | **0** (0/16 T007) |
| Decoy false-positive rate | **1.0** (32/32 T008+T009) |
| Provenance failures | 0 |
| Wrong document-pair failures | 0 |
| Summary-vs-structured disagreement (recorded metric) | 0 |

Every Compare run used the correct files. Every run persisted change rows with document IDs. The engine did not emit paired clause-level before/after for notice or cap. Example (`SYNTH-V2-001-T007`): paragraph 1 is the entire original agreement as `removed` / `high_attention`; the amendment page is a separate `added` blob. Summary: “No substantive changes to obligations or agreements,” while 30-day notice and $510,000 cap sit inside the added blob. Production `summaryAlignment` was still `aligned`.

---

## 7. Compare Failure Taxonomy

| Category | Count | Notes |
| --- | ---: | --- |
| retrieval | 0 | Documents were ingested; compare used the named pair |
| wrong version/document pair | 0 | `01_Main_Agreement.pdf` vs `02_Amendment_1.pdf` |
| change extraction | **16** | All T007: no same-row before/after for notice or cap |
| numeric extraction | 0 | Not reached; values are not paired |
| materiality | 0 | Counted under decoy promotion when decoy text is `high_attention` |
| decoy promotion | **32** | All T008 + T009 |
| summary hallucination | 0 | Grader trusted production alignment; see §13 |
| provenance | 0 | |
| persistence | 0 | |
| benchmark/grader defect | 0 scored | Limitations in §13 |
| infrastructure | 0 | |

Root cause is one mechanism, not 48 independent bugs:

1. `concatenateChunkText` joins extracted PDF text.
2. GP-01…GP-53 filler has no blank lines, so `computeParagraphDiffs` (`split(/\n\s*\n+/)`) treats large pages as single paragraphs.
3. LCS therefore emits whole-document remove + whole-amendment add.
4. `classifyAttention` matches `liabil` anywhere in the blob → `high_attention`.
5. Exhibit renumbering and typo decoys ride on those high-attention rows.
6. The summary model often reports administrative/no-substantive change because the diffs look like header/filler churn.

---

## 8. Compare Critical Failures

Critical class (32): **presenting a decoy as a substantive amendment** via `high_attention` on T008 (exhibit renumber) and T009 (typo).

Not scored critical, but blocking for use: all 16 T007 **completeness / change-extraction** failures. The operative values exist in blobs but not as reviewable change rows. A lawyer looking at the structured diff cannot see “45 days → 30 days” as a row. Several summaries state there were no substantive changes while those values are in the added blob. That is the opposite of a usable compare result, even though the grader classed it as major extraction rather than “opposite contractual change.”

No B.1 Compare task compared the wrong documents while presenting the result as correct.

---

## 9. Contradiction Baseline B.1

| Metric | Value |
| --- | ---: |
| Tasks | 32 |
| Pass | **16** (all T011) |
| Needs work | 0 |
| Fail | 16 (all T010) |
| Infrastructure | 0 |
| Critical | **1** |
| Contradiction accuracy | **0** |
| Tension accuracy | **0** (0/16 T010 pass) |
| Compatible / not-contradiction accuracy | **1.0** (16/16 T011) |
| False-positive contradiction rate (grader taxonomy) | 0 |
| Missed-conflict rate | **0.9375** (15/16 T010) |
| Actor-inference overclaim | **1** |
| Source-pair / provenance failures | 0 |

T010 persisted finding titles:

| Title / state | n |
| --- | ---: |
| No findings | 4 |
| Notice Period Discrepancy / Conflict / Contradiction in Notice Period | 11 |
| Access Log vs. Deposition Testimony | 1 (`SYNTH-V2-006-T010`, actor inference) |

`detectContradictionCandidates` reads at most **48** chunks ordered by document id + chunk index. GP filler plus early contract PDFs consume that window; deposition and access log often never enter the candidate set. When they do, the model may still treat badge ACCESS GRANTED as the person entering.

The imprecise-date filter is the working part of this engine on V2.

---

## 10. Contradiction Failure Taxonomy

| Category | Count | Notes |
| --- | ---: | --- |
| retrieval | 4 | T010 with empty findings (48-chunk cap / document order) |
| wrong source pair | 11 | T010 that asserted sequenced Amendment notice 60 vs 30 instead of deposition/log |
| false contradiction | 0 | Grader taxonomy; see metric caveat |
| missed contradiction | **15** | Includes the 4 empty + 11 wrong-pair (no matching tension finding) |
| tension misclassified | 0 | T006 failed earlier on actor inference |
| compatible evidence misclassified | 0 | T011 all passed |
| actor inference | **1** | T006 |
| date precision | 0 | |
| provenance | 0 | |
| benchmark/grader defect | 0 scored | Limitations in §13 |
| infrastructure | 0 | |

The 11 notice-period findings are temporally sequenced amendments (Amendment 1 then Amendment 2), not simultaneous contradictions. They are a real engine error class. They are **not** counted in `falsePositiveContradictionRate` because those tasks are T010 (expected tension) and were scored as missed. Treat the published FP rate as “did not misfire on T011 dates,” not “never emits false contradictions.”

---

## 11. Contradiction Critical Failures

One critical task: **`SYNTH-V2-006-T010`**.

Persisted claim: “The access log shows that Jordan F. Mercer **accessed** the records room…” versus deposition “never entered.” Title: “Access Log vs. Deposition Testimony.” Explanation called it a contradiction.

This is the required critical class: turning system/badge activity into proof of a person’s physical conduct. The log does not prove who carried the badge.

The other 15 T010 failures are completeness / wrong-pair, not this critical overclaim. They still block beta for “detect conflicts in the file.”

No B.1 T011 task claimed compatible dates were impossible.

---

## 12. Infrastructure Failures

**0.** All 80 tasks persisted structured output and were graded.

`executionTarget=analysis` no longer calls `generateDraft`. This mode does not use that target.

---

## 13. Benchmark / Grader Defects Found

Hidden GT was **not** rewritten. Defects below are harness/grader, not fixture edits.

### Fixed before recording official B.1 (regrade of unchanged answers)

1. Summary text such as “no substantive” / “administrative renumbering” was treated as decoy promotion. Negated administrative summaries are no longer automatic fails. After the fix, decoys still fail because structured rows are `high_attention`.
2. Actor inference now includes “accessed the records room” / access-log phrasing. That is how T006 was caught.
3. Tension matching used concatenated supporting-text. `SYNTH-V2-012-T010` had title “Notice Period Discrepancy” but leaked Access Log and deposition chunks into `statementA`, and an earlier regrade **passed** it. Official B.1 requires the asserted claim (title + explanation) to be about badge vs testimony. T012 is a miss, not a pass.

Official B.1 uses `regrade-A1-2026-08-18T21-51-56-436Z`, not the earlier 21-48 regrade (17 combined passes, including the T012 false pass).

### Remaining limitations (not silently repaired)

1. `summaryVsStructuredDisagreement` is 0 because the grader trusted production `summaryAlignment`. Production scored coarse blobs as aligned even when the narrative said “no substantive changes.”
2. `falsePositiveContradictionRate` does not count off-topic T010 findings.
3. Regrade `summary.json` header still prints Case Q&A `graderVersion: a1-2026-08-18`. Per-task grades correctly say `b1-2026-08-18`.
4. `contradictionAccuracy` is defined on T010 (expected tension), so it is 0; it is not a separate “hard contradiction” slice. V2 has no `must_contradict` legal-impossibility tasks.

No GT errata file is required. T010/T011 expectations remain valid.

---

## 14. Analysis → Q&A Trust Boundary

Inspected only. **Case Q&A was not modified.**

`askNyayaAboutMatter` (`packages/search/src/nyaya.ts`) loads `loadProfessionalAnalysisContext` and injects `formatProfessionalAnalysisForPrompt` when `includeProfessionalAnalysis !== false`.

| Artifact | Enters Q&A? | Review state | Label in prompt |
| --- | --- | --- | --- |
| Comparison **summaries** (latest 6 `documentComparisons`) | Yes | No reviewed/proposed split | Unlabeled: `Document comparisons:` + summary text (400 chars) |
| Comparison **change rows** | No | — | Not injected |
| Contradiction / analysis findings `status=reviewed` | Yes | Reviewed | `[REVIEWED]` + title + explanation (300 chars) |
| Findings `status=proposed` | Yes (up to 6) | Proposed | `[PROPOSED/UNREVIEWED]` + type + title **only** (no explanation) |
| Dismissed findings | No | — | — |

B.1 implications:

- An incorrect Compare summary (“no substantive changes”) can enter Ask Nyaya unlabeled as if it were a document comparison fact.
- An incorrect proposed contradiction (notice-period false conflict, or T006 actor inference) can enter as `[PROPOSED/UNREVIEWED]` by title. The model is told not to treat it as verified, but the title still supplies a conflict frame.

Recommended fix (Analysis context boundary, **not implemented**):

1. Inject comparison summaries only after human review, or label them `[UNREVIEWED COMPARISON SUMMARY — not verified]`.
2. Default Ask Nyaya to reviewed findings only; keep proposed findings out of the prompt, or behind an explicit opt-in.
3. Never inject proposed actor-inference or contradiction titles into Case Q&A until reviewed.

Do not change the Case Q&A prompt to compensate.

---

## 15. Recommended Product Changes

**Do not implement in this phase.** Ranked by expected impact. Preference: deterministic logic, then source selection, then structured rules, then retrieval, then prompts, then extra model calls.

1. **Compare: clause/section segmentation (deterministic).** Split on numbered sections / blank lines / headings; do not treat GP filler pages as one paragraph. This is the cause of 48/48 Compare fails.
2. **Compare: materiality on the changed clause only.** Do not run `liabil` / `indemn` on concatenated page blobs. Decoy exhibit/typo must stay informational unless the row is actually those terms.
3. **Compare: refuse “no substantive changes” when notice/cap/term digits differ** in the compared texts (deterministic alignment rule). The current scorer can mark a false summary as aligned against mega-diffs.
4. **Contradiction: document-stratified retrieval instead of first 48 chunks** (source selection). Guarantee deposition + access log (and other document types) can enter the candidate set.
5. **Contradiction: sequential-amendment rule.** Later signed amendment controlling an earlier notice period is not a contradiction.
6. **Contradiction: badge activity ≠ physical actor** in the detector (structured evidence rule), not only in Case Q&A.
7. **Analysis → Q&A boundary** as in §14.

Do not insert SYNTH IDs, expected answers, benchmark phrases, or fixture-specific values into production. Do not add model calls until 1–6 are tried.

---

## 16. Beta Assessment

**Is Compare currently safe enough for beta?** No.

**Is Contradiction currently safe enough for beta?** No, for conflict detection. The compatible-date filter is the only V2 slice that looks safe.

**Failure classes that block beta**

- Compare: page-blob diffs; decoy `high_attention`; summaries that deny substantive notice/cap changes
- Contradiction: missing the deposition/log pair; sequential-amendment false conflicts; actor inference from badge logs
- Trust boundary: unreviewed comparison summaries and proposed finding titles in Ask Nyaya

**What can remain needs-work**

- Production still labeling cross-document pairs `contradiction` while the legal class is tension, **if** the claim preserves the evidentiary limitation
- Completeness of every filler-paragraph diff once clause rows exist
- `eval:ai` snippet graders remaining a separate canary

**Do we need new scenarios yet?** No. V2 T007–T011 already expose the production failures. Do not create V3 until Compare emits clause-level rows and Contradiction can see the log/deposition pair.

---

## 17. Next Step

**Exactly one next action:** implement deterministic Compare paragraph/section splitting (and clause-scoped materiality) in production `computeParagraphDiffs` / `classifyAttention` so change rows are the actual amended clauses, not page-sized GP-filler blobs.

Do not start it in this phase. After that change, run Baseline B.2 on the same 80 persisted-task definitions (new live Compare outputs only). Do not retune Contradiction, Case Q&A, PDFs, or hidden GT in the same step.
