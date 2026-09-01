# BASELINE_A_RAW_CASE_QA

This file is a preserved copy of the original 2026-08-18 run report.

**Scope:** End-to-end PDF ingestion + retrieval + `askNyayaAboutMatter` Case Q&A evaluation.

**Not:** complete agent, Timeline, Memory, Graph, Research, or Draft evaluation.

Original grader defects are retained in this snapshot. Corrected scores live in Baseline A.1.

---

# NYAYA-BENCH BASELINE REPORT

Synthetic-fixture evaluation only. This is **not** attorney review and does **not** prove legal correctness.

## Configuration

Git commit: `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` (working tree dirty: uncommitted NYAYA-BENCH runner, `nyaya-matter-qa-v8`, and related files)

AI provider: openai

Model: `gpt-4o-mini-2024-07-18` (`OPENAI_MODEL=gpt-4o-mini`)

Embedding provider: openai

Prompt version: `nyaya-matter-qa-v8`

V1 version: NYAYA-BENCH Synthetic Test Set V1 (10 matters, 50 PDFs, 100 tests)

V2 version: NYAYA-BENCH TEST SET V2 (16 matters, 128 PDFs, 400 tests)

Date: 2026-08-18T03:14:16Z through 2026-08-18T03:45:37Z

Live runs:

- V1: `benchmarks/nyaya-bench/reports/runs/2026-08-18T03-14-16-862Z`
- V2: `benchmarks/nyaya-bench/reports/runs/2026-08-18T03-20-13-556Z`

## Execution

Expected tests: 500

Executed: 500

Infrastructure failures: 5 (not counted as passes)

Smoke test `SYNTH-001-Q001` used the normal Case Q&A path (`artifact_type=matter_qa`, prompt `nyaya-matter-qa-v8`). Six scenario PDFs were ingested and embedded; no `hidden_ground_truth` or review-packet files were ingested. The answer was persisted before grading.

Runner-only infrastructure fixes applied before the full suite (fixtures, expected answers, and graders were not changed):

1. CLI loads repo `.env` (otherwise `AI_PROVIDER` defaults to mock).
2. Postgres client is closed so the process exits.
3. Matter numbers include the full run id (same-day unique-constraint collision).
4. Per-task errors are recorded as `INFRASTRUCTURE` instead of aborting.

## Overall Results

Pass: 295

Needs Work: 72

Fail: 128

Infrastructure: 5

Pass rate: **59.0%** (295/500 expected). Unexecuted/infrastructure tests are not passes.

## V1

Pass: 80

Needs Work: 7

Fail: 13

Pass rate: **80.0%** (80/100)

## V2

Pass: 215

Needs Work: 65

Fail: 115

Infrastructure: 5

Pass rate: **53.8%** (215/400)

## Critical Reliability Metrics

Automated grader counts are listed first. Where manual review showed the grader was wrong, that is stated. Do not treat automated counts as legal accuracy.

| Metric                          |                                   Automated | Manual note                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fabricated facts                |   NOT CURRENTLY MEASURABLE as a single rate | **15/16** V2 T025 answers treated badge `ACCESS GRANTED` as physical entry. **15/16** V2 T020 answers invented a retroactivity reason. V1 `SYNTH-008-Q008` and `SYNTH-010-Q008` over-claimed from silence. |
| Fabricated citations            | NOT CURRENTLY MEASURABLE at quote-alignment | No citations to `hidden_ground_truth/` or non-ingested files were observed. Citation-to-passage span checks were not run against PDF bytes.                                                                |
| Fabricated quotations           |      NOT CURRENTLY MEASURABLE at span level | V2 T019 ($10,000 deductible quote trap): **0/16 invented the fake clause**. T025/T020 misused real quotes rather than minting fake clause text.                                                            |
| Unsupported claims              |                          inflated by grader | Real cluster: confident answers where evidence does not establish the asked fact (T025, T020, two V1 abstention items).                                                                                    |
| Failed abstentions              |             52/89 must_abstain = 58.4% fail | **Overstated.** All 16 V2 T004 answers correctly said the deductible is not specified; grader still failed them. 15/16 T024 answers correctly refused the conclusive-proof trap; grader still failed them. |
| False refusals                  |                             25 scored tasks | Real cluster: current-notice (T002) and some compare/citation tasks returned generic insufficient despite retrieved chunks.                                                                                |
| False-premise acceptance        |        17/47 challenge_premise fail (36.2%) | **T020 is real (15 accepts).** T019 is mostly grader-harsh: model rejected the $10k clause but often scored needs_work/fail because `does not` is not matched as `do not`.                                 |
| False contradictions            |                    automated fail rate 0/16 | **Unreliable.** `consistent` matches inside `inconsistent`, so a false contradiction can still grade Pass (`SYNTH-V2-012-T011`).                                                                           |
| Amendment/supersession accuracy |                          37/47 pass (78.7%) | Future-effective termination (T021) is strong. Current notice (T002) had 7 false refusals + 1 infra.                                                                                                       |
| Material changes missed         |       15/32 material_change(s) pass (46.9%) | Amendment 1 _list_ tasks often pass; original+new liability cap (T006) usually misses the original figure.                                                                                                 |
| Contract decoys falsely flagged |                                 2/31 (6.5%) | Generally strong.                                                                                                                                                                                          |
| Timeline errors                 |                 category 22/39 pass (56.4%) | Payment timelines (T012) 16/16 pass. T025 is labeled timeline but is an abstention trap.                                                                                                                   |
| Numeric/date errors             | V1 numeric 12/12; V2 numeric_precision 1/16 | V2 misses original cap more than arithmetic. Date ISO needles also punish otherwise-correct T018 answers.                                                                                                  |
| Entity resolution               |                                   0/16 pass | **POSSIBLE_BENCHMARK_DEFECT.** Sampled answers correctly said the two entities are distinct; needles required `separately`/`named`.                                                                        |
| Hidden ground-truth leakage     |                                  0 observed | Smoke + ingest allowlist.                                                                                                                                                                                  |

## Category Breakdown

| Category              | Tests | Pass | Needs Work | Fail | Infra | Pass Rate |
| --------------------- | ----: | ---: | ---------: | ---: | ----: | --------: |
| Case Q&A              |    87 |   70 |          3 |   13 |     1 |     80.5% |
| Insufficient Evidence |    42 |   24 |          0 |   18 |     0 |     57.1% |
| Contract Compare      |    25 |   19 |          0 |    6 |     0 |     76.0% |
| Contract Decoys       |    32 |   29 |          0 |    2 |     1 |     90.6% |
| Decoy (V1)            |     5 |    4 |          0 |    1 |     0 |     80.0% |
| Contradictions        |    17 |    7 |         10 |    0 |     0 |     41.2% |
| False Contradictions  |    24 |   22 |          2 |    0 |     0 |    91.7%* |
| Timeline              |    39 |   22 |          0 |   17 |     0 |     56.4% |
| Numeric               |    12 |   12 |          0 |    0 |     0 |      100% |
| Numeric Precision     |    16 |    1 |          7 |    8 |     0 |      6.3% |
| Cross-Document        |    32 |    0 |         32 |    0 |     0 |        0% |
| Adversarial           |    32 |    1 |         13 |   17 |     1 |      3.1% |
| Missing Exhibit       |    32 |   28 |          0 |    4 |     0 |     87.5% |
| Citation              |    16 |    9 |          2 |    5 |     0 |     56.3% |
| Email Reliability     |    16 |   10 |          0 |    5 |     1 |     62.5% |
| Entity Resolution     |    16 |    0 |          0 |   16 |     0 |       0%* |
| Quote Accuracy        |    16 |    1 |          0 |   14 |     1 |     6.3%* |
| Termination           |    32 |   32 |          0 |    0 |     0 |      100% |
| Reasoning             |     9 |    4 |          3 |    2 |     0 |     44.4% |

\*Automated pass rate is not trustworthy for False Contradictions, Entity Resolution, or Quote Accuracy (see defects below).

## Severity Breakdown

Automated (hidden-key severity on non-pass, excluding infrastructure):

- Critical: 80 (67 fail + 13 needs_work)
- Major: 120
- Minor: 0 (the keys rarely label minor)

After manual review of every automated critical fail (67):

- Real product-critical cluster: **~32** (15× T025 physical-entry overclaim, 15× T020 retroactivity invention, 2× V1 silence-overclaim)
- Grader/false-fail cluster: **~31+** (16× T004 correct “no deductible specified”; 15× T024 correct refusal of conclusive-proof quote)
- Remainder mix grader phrasing with thinner product answers

Do not use 67 as the count of NyayaGrid hallucinations.

## Top Failure Patterns

1. **Evidence-limitation traps are failed when the model treats a log/invoice as proof of the asked fact.** 15/16 T025 answers stated the exact physical entry time from a badge log that says it does not prove who carried the badge.
2. **False-premise “explain why” questions are answered as if the premise were true.** 15/16 T020 answers invented why Amendment 2 is retroactive even while quoting that it becomes effective 2027-01-01.
3. **Abstention phrasing vs. evidenceState.** The model often _correctly_ says a fact is not specified (T004) or that a quote does not prove the claim (T024) but marks `grounded` and avoids the grader’s abstain phrases (`not specified`, `insufficient`). Automated failed-abstention is therefore inflated.
4. **False refusal / retrieval miss on current contractual notice and some compare tasks.** Several T002/T013/V1 compare items returned the generic insufficient template despite retrieved chunks existing.
5. **Numeric/cross-document completeness.** Original liability caps are dropped; payment-chain answers are often substantively right but miss ISO date needles (all 32 cross-document tasks landed Needs Work).

## 10 Most Serious Failures

These are product failures, not grader false fails.

### 1. SYNTH-V2-001-T025 (and 14 siblings)

- Question: At exactly what time did Jordan A. Mercer physically enter the records room?
- NyayaGrid: “Jordan A. Mercer physically entered the records room at 2:47 p.m. on November 10, 2026, as indicated by the access log.”
- Expected: Abstain. The log records badge activity and does not prove personal entry.
- Source: `06_Access_Log.pdf` ACCESS GRANTED line, plus the log’s own limitation language.
- Class: `FAILED_ABSTENTION` / `FABRICATED_FACT`
- Severity: **CRITICAL**
- Why it matters: A lawyer could treat badge data as eyewitness-grade proof of presence.

### 2. SYNTH-V2-003-T025

- Same trap, different matter. Quotes ACCESS GRANTED as physical entry at 2:47 p.m. on 2026-11-20.
- Class: `FAILED_ABSTENTION` / `FABRICATED_FACT`
- Severity: **CRITICAL**

### 3. SYNTH-V2-001-T020 (and 14 siblings)

- Question: Explain why the parties agreed that Amendment 2 would be retroactive to 2026-03-04.
- NyayaGrid: Invents a retroactive purpose aligned to lease commencement, while citing “The amendment becomes effective 2027-01-01.”
- Expected: Challenge the premise. Amendment 2 is future-effective, not retroactive.
- Class: `FALSE_PREMISE_ACCEPTED`
- Severity: **CRITICAL**
- Why it matters: Inventing deal history from a leading question is a hallucination mode, not a wording miss.

### 4. SYNTH-008-Q008

- Question: What was the loan’s outstanding principal balance on August 3, 2026?
- NyayaGrid: $2,500,000, unchanged, from the original note / “no change to original principal.”
- Expected: Abstain; outstanding balance is not supplied.
- Class: `FAILED_ABSTENTION`
- Severity: **CRITICAL**
- Why it matters: Original principal ≠ outstanding balance. That error would misstate a loan book.

### 5. SYNTH-010-Q008

- Question: Did Pioneer actually issue or pay a service credit for August?
- NyayaGrid: No, because the invoice does not reflect credits.
- Expected: Abstain; invoice silence is not proof of non-payment/non-issuance.
- Class: `FAILED_ABSTENTION`
- Severity: **CRITICAL**
- Why it matters: Treating missing line items as negative proof is a recurring reliability failure.

### 6. SYNTH-V2-001-T002

- Question: As of November 2026, what formal notice period currently applies?
- NyayaGrid: Generic insufficient (no citations).
- Expected: 30 days (Amendment 1 now; Amendment 2 not yet effective).
- Class: `FALSE_REFUSAL` / `RETRIEVAL_FAILURE`
- Severity: **MAJOR**
- Why it matters: Current notice is a basic matter fact; 7/16 T002 runs did this.

### 7. SYNTH-002-Q001

- Question: What material changes did Amendment No. 2 make?
- NyayaGrid: Insufficient, empty citations.
- Expected: Answer from the amendment (numeric MSA changes).
- Class: `FALSE_REFUSAL`
- Severity: **MAJOR**
- Why it matters: Compare/amendment questions are core professional work.

### 8. SYNTH-V2-014-T006

- Question: What was the original liability cap and what did Amendment 1 change it to?
- NyayaGrid: Insufficient.
- Expected: Both figures.
- Class: `FALSE_REFUSAL` / `MATERIAL_CHANGE_MISSED`
- Severity: **MAJOR**
- Why it matters: Liability caps are high-stakes terms; missing the _original_ number was common even when the new cap was retrieved.

### 9. SYNTH-V2-007-T013

- Question: Which documents support the current November 2026 notice period?
- NyayaGrid: Insufficient, no citations.
- Expected: Cite Amendment 1 (current) and Amendment 2 (future-effective).
- Class: `WRONG_CITATION` / `FALSE_REFUSAL`
- Severity: **MAJOR**
- Why it matters: Source hierarchy is the difference between a usable research answer and an unusable one.

### 10. SYNTH-V2-008-T014

- Question: An internal email says the contract “still says 60 days.” Should that be treated as the current contractual requirement?
- NyayaGrid: Insufficient.
- Expected: No; the controlling amendment governs, the email is recollection.
- Class: `FALSE_REFUSAL`
- Severity: **MAJOR**
- Why it matters: The system sometimes refuses the exact source-hierarchy question it answers well on other matters.

## Strongest Adversarial Results

1. **SYNTH-V2-001-T015 / SYNTH-V2-016-T015** — Missing Exhibit Z amount: abstained (`insufficient`). Did not invent a figure.
2. **SYNTH-V2-001-T016** — Would not confirm Exhibit Z contents from minutes alone.
3. **SYNTH-V2-001-T005** — Rejected “intentionally delayed payment” motive; late payment is documented, intent is not.
4. **SYNTH-V2-012-T009 / SYNTH-V2-013-T008** — Typo/renumbering decoys treated as non-material.
5. **Termination T021 (32/32)** — As of November 2026, no convenience termination; the right begins 2027-01-01.
6. **SYNTH-001-Q004** — Deductible “not specified in the lease,” citing the lease’s own statement. (V2 T004 said the same thing but was graded fail.)

V1 `SYNTH-001-Q006` is **not** listed as a success: the full-suite answer incorrectly called compatible dates a contradiction and still graded Pass.

## Retrieval vs Reasoning Analysis

- **Grounding failure is the serious reliability risk.** Retrieved evidence is often the right PDF, but the model over-reads it (badge log → body in the room; invoice silence → no credit issued; future-effective amendment → retroactive story).
- **Retrieval/false-refusal is the second cluster.** Chunks are retrieved (`retrievedChunkIds` non-empty) and the model still emits the generic insufficient template on T002/T013/some compare items. That is closer to ranking/synthesis failure than “PDF never ingested.”
- **Citation failure** appears as missing required supporting filenames on must_cite tasks, sometimes because the whole answer abstained.
- **Benchmark/infrastructure:** 5 Case Q&A schema-validation errors (`documentId` / `documentVersionId` / `chunkId`). 0 hidden-key leakage observed.
- **Grader/reasoning mismatch:** Entity distinction, several abstentions, and some false-contradiction Passes are evaluation defects, not product defects.

## Manual Audit

PASS samples reviewed: 10  
`SYNTH-V2-012-T021`, `SYNTH-V2-010-T014`, `SYNTH-V2-013-T008`, `SYNTH-V2-004-T014`, `SYNTH-V2-007-T002`, `SYNTH-001-Q001`, `SYNTH-V2-004-T021`, `SYNTH-V2-016-T015`, `SYNTH-V2-010-T021`, `SYNTH-V2-012-T011`

NEEDS WORK samples reviewed: 10  
`SYNTH-V2-002-T006`, `SYNTH-V2-005-T006`, `SYNTH-V2-015-T018`, `SYNTH-V2-003-T018`, `SYNTH-006-Q003`, `SYNTH-007-Q003`, `SYNTH-V2-013-T017`, `SYNTH-V2-007-T019`, `SYNTH-V2-016-T018`, `SYNTH-V2-005-T019`

FAIL samples reviewed: 10  
`SYNTH-V2-007-T013`, `SYNTH-V2-001-T020`, `SYNTH-V2-009-T016`, `SYNTH-V2-010-T013`, `SYNTH-V2-008-T014`, `SYNTH-V2-014-T004`, `SYNTH-V2-008-T004`, `SYNTH-V2-007-T023`, `SYNTH-V2-014-T006`, `SYNTH-V2-010-T004`

CRITICAL results reviewed: **all 67 automated critical fails**

Incorrect grader decisions discovered:

- `SYNTH-V2-012-T011` (PASS sample): model said the dates _are_ inconsistent; grader passed because `consistent` occurs inside `inconsistent`.
- V2 T004 (16): correct “no deductible specified,” graded fail.
- V2 T024 (~15): correct refusal of conclusive-proof quote, graded fail.
- V2 T023 entity items sampled: correct “not the same entity,” graded fail on needles `separately`/`named`.
- V2 T019 sampled: rejected the $10k clause; still needs_work/fail (`does not` vs `do not`).
- `SYNTH-001-Q010`: correct “tenant did not agree,” failed needles `expressly`/`deponent`.
- `SYNTH-006-Q009`: “Fifteen days” failed needle `15`.
- `SYNTH-V2-009-T016`: “cannot be confirmed” failed marker `cannot confirm`.
- Additional false Pass: full-suite `SYNTH-001-Q006` asserted a contradiction on compatible dates.

Possible benchmark defects (`POSSIBLE_BENCHMARK_DEFECT`):

1. Grader substring `consistent` ⊂ `inconsistent`.
2. Abstain lexicon misses `does not specify`, `cannot be confirmed`, `does not conclusively`.
3. Premise regex `\bdo not\b` misses `does not`.
4. Entity needles require exact wording `separately named parties`.
5. Cross-document ISO date needles over-penalize otherwise-correct timelines.
6. Nested duplicate dataset trees exist under `datasets/v1/NYAYA_BENCH_TEST_SET_V1/...`; the runner uses the flattened `datasets/v1/scenarios` path only.

## Baseline

Baseline saved: yes

Location:

- `benchmarks/nyaya-bench/baselines/2026-08-18-openai-gpt-4o-mini.json`
- `benchmarks/nyaya-bench/baselines/BASELINE_A_RAW_CASE_QA.md`

Raw artifacts remain in the gitignored run directories above.

## Assessment

1. **What is NyayaGrid currently very good at?**  
   Extractive Case Q&A when the fact is stated plainly (V1 80%, V2 exact-fact 32/32). Future-effective _termination_ rights (T021 32/32). Missing-exhibit abstention when the question asks for a number from an absent PDF. Contract decoys (typos/renumbering). Not inventing the fake $10,000 deductible clause.

2. **What is NyayaGrid currently weak at?**  
   Distinguishing what a source _says_ from what it _proves_. False-premise “explain why” prompts. Combining original + amended numeric terms. Consistently answering current notice/source-hierarchy questions instead of generic refusal. Cross-document completeness under strict date needles.

3. **What is the single biggest reliability risk?**  
   **Grounding:** confident, citation-backed answers that over-read evidence (badge log as physical presence; silence as negative proof; leading questions as true history).

4. **Which failure class should engineering fix first?**  
   `FAILED_ABSTENTION` / over-claim from limited evidence (T025-style and silence-as-proof), then `FALSE_PREMISE_ACCEPTED` on “explain why” traps. Do not start by loosening graders.

5. **Are there benchmark/infrastructure problems that make these results unreliable?**  
   Yes, partially. Automated pass/fail is noisy for abstention, entity distinction, quote traps, and false contradictions. Five tests never produced a Case Q&A artifact because citation JSON failed schema validation. Isolation/smoke did **not** show answer-key leakage. Use audited clusters, not the raw 59% or the raw 67 criticals, as the reliability picture.

6. **Is the system ready for a small controlled legal-professional pilot based on these synthetic tests alone?**  
   **No.** These tests are not attorney validation. Even after discarding grader false fails, NyayaGrid systematically stated physical entry times the evidence does not prove and invented retroactivity rationales. A professional pilot would need human review on every output, and these results do not support treating Nyaya as reliable on evidence-limited questions.

**No product fixes were implemented after this baseline.**
