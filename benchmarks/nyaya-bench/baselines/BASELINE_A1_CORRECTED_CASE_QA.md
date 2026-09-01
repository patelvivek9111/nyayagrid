# NYAYA CASE Q&A BENCHMARK — Baseline A.1

Synthetic-fixture evaluation only. This is **not** attorney review and does **not** prove legal correctness.

**Label:** Baseline A.1 — Corrected Nyaya Case Q&A Baseline

**What it measures**

- PDF ingestion
- chunking
- embeddings
- retrieval
- Case Q&A reasoning (`askNyayaAboutMatter`)
- answer grounding
- Case Q&A citation behavior

**What it does not measure**

It does **not** by itself measure Timeline, Graph, Memory, Research, Draft, Analysis, or agent-orchestrator reliability. Those systems have production pathways documented in `SUBSYSTEM_ROUTING.md`. Full-system routing exists; this baseline re-grades the original Case Q&A answers only.

Same 500 saved NyayaGrid answers as Baseline A. No new OpenAI calls.

---

## Configuration (unchanged from Baseline A)

| Field                        | Value                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- |
| Original V1 run              | `benchmarks/nyaya-bench/reports/runs/2026-08-18T03-14-16-862Z`            |
| Original V2 run              | `benchmarks/nyaya-bench/reports/runs/2026-08-18T03-20-13-556Z`            |
| A.1 regrade run              | `benchmarks/nyaya-bench/reports/runs/regrade-A1-2026-08-18T10-52-14-395Z` |
| Grader version               | `a1-2026-08-18`                                                           |
| Model (saved answers)        | openai `gpt-4o-mini-2024-07-18`                                           |
| Prompt (saved answers)       | `nyaya-matter-qa-v8`                                                      |
| Git at original live run     | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62`                                |
| Original artifacts unchanged | **yes** (SHA-256 of all 500 answer files matches the originals)           |

Preserve `BASELINE_A_RAW_CASE_QA` and the two original run directories. Do not overwrite them.

---

## Original grader vs corrected grader

| Metric                                                |              Original grader |             Corrected grader |                     Delta |
| ----------------------------------------------------- | ---------------------------: | ---------------------------: | ------------------------: |
| Pass                                                  |                          295 |                          350 |                       +55 |
| Needs Work                                            |                           72 |                           66 |                        −6 |
| Fail                                                  |                          128 |                           79 |                       −49 |
| Infrastructure                                        |                            5 |                            5 |                         0 |
| Pass rate (500 expected)                              |                        59.0% |                    **70.0%** |                  +11.0 pp |
| Critical fails (automated, excl. infra)               |                           67 |                       **32** |                       −35 |
| Failed abstention (`must_abstain` fail)               |                      52 / 89 |                      18 / 90 |                       −34 |
| False-premise acceptance (`challenge_premise` fail)   |                      17 / 47 |                      14 / 48 |                        −3 |
| False contradiction (`not_contradiction` fail)        |                       0 / 16 |                   **5 / 16** |  +5 (substring bug fixed) |
| Entity resolution pass                                |                       0 / 16 |                  **16 / 16** |                       +16 |
| Quote traps pass                                      |                       1 / 16 |            15 / 16 (1 infra) |                       +14 |
| Numeric + numeric_precision pass                      |                      13 / 28 |                      13 / 28 |                         0 |
| Date / cross-document completeness                    | 0 / 32 pass (all needs_work) | 0 / 32 pass (all needs_work) |                         0 |
| Contract compare + decoy pass                         |                      52 / 62 |                      52 / 62 |                         0 |
| Amendment / termination pass                          |                      32 / 32 |                      32 / 32 |                         0 |
| False refusal (V2 T002 current notice, excl. 1 infra) |                      ~7 fail |              7 fail / 8 pass | unchanged product cluster |

V1: 80 → **81** pass / 7 needs_work / 13 → **12** fail.

V2: 215 → **269** pass / 65 → **59** needs_work / 115 → **67** fail / 5 infra.

---

## Grader false failures corrected

Original **fail → pass: 54**.

Original **needs_work → pass: 13**.

Largest recoveries (sampled clusters, not product fixes):

| Cluster                        | Original                        | A.1                                                       |
| ------------------------------ | ------------------------------- | --------------------------------------------------------- |
| V2 T004 deductible abstention  | 0 pass / 16 fail                | **16 pass**                                               |
| V2 T023 entity distinction     | 0 pass / 16 fail                | **16 pass**                                               |
| V2 T024 quote-does-not-prove   | 1 pass / 14 fail / 1 infra      | **15 pass** / 1 infra                                     |
| V2 T019 $10k quote trap        | 1 pass / 12 needs_work / 3 fail | **16 pass**                                               |
| V1/V2 `must_abstain` overall   | 37 pass / 52 fail               | **71 pass** / 18 fail / 1 infra                           |
| Missing-exhibit category       | 28 pass / 4 fail                | **32 pass**                                               |
| Insufficient-evidence category | 24 pass / 18 fail               | **40 pass** / **2 fail** (the two silence-as-proof items) |

These answers were already correct or close; the original graders required brittle phrases (`not specified`, `separately named parties`, `do not` but not `does not`).

---

## Grader false passes corrected

Original **pass → fail: 5**. All are V2 T011 false-contradiction tasks where the model asserted inconsistency, and the original grader treated `consistent` as a substring of `inconsistent`:

- `SYNTH-V2-005-T011`
- `SYNTH-V2-008-T011`
- `SYNTH-V2-012-T011`
- `SYNTH-V2-014-T011`
- `SYNTH-V2-016-T011`

Original **pass → needs_work: 7**. All are V2 T010 possible-contradiction items that identify badge/testimony tension but do not state the evidence-limitation (log does not prove who carried the badge). That is a stricter limitation check, not the substring bug.

---

## Real remaining product failure clusters

These remain after grader correction. Do not treat them as evaluator defects.

### Badge-log overclaim (V2 T025)

**15 / 16** answers turn `ACCESS GRANTED` at 14:47 into personal physical entry (`Jordan … physically entered the records room at 2:47 p.m.`).

`SYNTH-V2-002-T025` does not make that overclaim (it reports a discrepancy and that the witness said he did not enter) but still fails abstention: it asserts a determination instead of “the log alone does not establish personal entry.”

### Retroactivity false premise (V2 T020)

**14 / 16** still accept “Amendment 2 is retroactive” and invent a reason. 1 pass (`SYNTH-V2-012-T020`). 1 infrastructure (`SYNTH-V2-009-T020`).

### Silence as proof (V1)

- `SYNTH-008-Q008` — original principal treated as outstanding balance.
- `SYNTH-010-Q008` — invoice silence treated as proof no service credits were issued or paid.

Insufficient-evidence category remaining fails are exactly these two.

### False refusal / current notice (V2 T002)

About half of T002 answers still return generic insufficient / miss the current 30-day notice (Amendment 2 not yet effective). Chunks were often retrieved. This is Case Q&A ranking/synthesis, not a grader phrase miss.

### Cross-document / numeric completeness

Numeric V1 is 12/12. V2 numeric_precision remains 1 pass / 7 needs_work / 8 fail — typically the **original** liability cap is dropped while the amended cap is stated.

All 32 cross-document tasks remain needs_work (partial payment-chain facts; not an ISO-format-only miss after date normalization).

### Contract compare (still Case Q&A-graded here)

Compare/decoy scores are unchanged vs Baseline A because this regrade still scores the Case Q&A answer, not `compareDocuments` structured output.

### False contradiction remaining product fails

5 T011 items genuinely asserted that “near the middle of November” is inconsistent with an early-November meeting date. That is a real Case Q&A error, previously hidden by the substring bug.

`SYNTH-001-Q006` is category `false_contradiction` but hidden GT `must_answer` (needle path). **POSSIBLE_BENCHMARK_DEFECT** in the mapping layer; fixtures were not edited.

---

## Category breakdown (A.1)

| Category              | Tests | Pass | Needs Work | Fail | Infra | Pass rate |
| --------------------- | ----: | ---: | ---------: | ---: | ----: | --------: |
| Case Q&A              |    87 |   71 |          3 |   12 |     1 |     81.6% |
| Insufficient evidence |    42 |   40 |          0 |    2 |     0 |     95.2% |
| Contract compare      |    25 |   19 |          0 |    6 |     0 |     76.0% |
| Contract decoys       |    32 |   29 |          0 |    2 |     1 |     90.6% |
| Decoy (V1)            |     5 |    4 |          0 |    1 |     0 |     80.0% |
| Contradictions        |    17 |    0 |         17 |    0 |     0 |       0%* |
| False contradictions  |    24 |   17 |          2 |    5 |     0 |     70.8% |
| Timeline              |    39 |   22 |          0 |   17 |     0 |     56.4% |
| Numeric               |    12 |   12 |          0 |    0 |     0 |      100% |
| Numeric precision     |    16 |    1 |          7 |    8 |     0 |      6.3% |
| Cross-document        |    32 |    0 |         32 |    0 |     0 |        0% |
| Adversarial           |    32 |   17 |          0 |   14 |     1 |     53.1% |
| Missing exhibit       |    32 |   32 |          0 |    0 |     0 |      100% |
| Citation              |    16 |    9 |          2 |    5 |     0 |     56.3% |
| Email reliability     |    16 |   10 |          0 |    5 |     1 |     62.5% |
| Entity resolution     |    16 |   16 |          0 |    0 |     0 |      100% |
| Quote accuracy        |    16 |   15 |          0 |    0 |     1 |     93.8% |
| Termination           |    32 |   32 |          0 |    0 |     0 |      100% |
| Reasoning             |     9 |    4 |          3 |    2 |     0 |     44.4% |

\*Contradiction tasks now score needs_work when tension is identified without the evidence-limitation sentence. That is Case Q&A text, not `detectContradictionCandidates`.

---

## Per-system (this baseline)

| System           | Executed | Pass | Needs Work | Fail | Infra |
| ---------------- | -------: | ---: | ---------: | ---: | ----: |
| Case Q&A         |      500 |  350 |         66 |   79 |     5 |
| Contract Compare |        0 |    — |          — |    — |     — |
| Contradiction    |        0 |    — |          — |    — |     — |
| Timeline         |        0 |    — |          — |    — |     — |
| Graph            |        0 |    — |          — |    — |     — |
| Memory           |        0 |    — |          — |    — |     — |
| Research         |        0 |    — |          — |    — |     — |
| Draft            |        0 |    — |          — |    — |     — |
| Agents           |        0 |    — |          — |    — |     — |

Subsystem scores for Compare/Contradiction/Timeline/Graph/Memory/Research/Draft/Agents are **not applicable** to Baseline A.1.

Agent metrics (`agent_run_success_rate`, planner/tool/approval/budget rates, artifact grounding): **NOT CURRENTLY MEASURABLE** on this baseline.

---

## Infrastructure (unchanged)

Same five citation-schema failures as Baseline A. Counted as infrastructure, not AI pass:

`SYNTH-V2-005-T002`, `SYNTH-V2-008-T008`, `SYNTH-V2-009-T020`, `SYNTH-V2-014-T014`, `SYNTH-V2-016-T024`.
