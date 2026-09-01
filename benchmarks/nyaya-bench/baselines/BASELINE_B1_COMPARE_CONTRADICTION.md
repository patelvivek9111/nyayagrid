# NYAYA COMPARE / CONTRADICTION BENCHMARK — Baseline B.1

Synthetic-fixture evaluation only. This is **not** attorney review and does **not** prove legal correctness.

**Label:** Baseline B.1 — Unchanged production Compare and Contradiction engines, independently graded on structured output.

Case Q&A remains frozen (`nyaya-matter-qa-v11`). Production Compare and Contradiction were **not** tuned for this baseline. Hidden ground truth was **not** rewritten. V1/V2 PDFs were not modified.

Do **not** combine Compare and Contradiction into one score.

---

## Configuration

| Field | Value |
| --- | --- |
| Live production-output run | `benchmarks/nyaya-bench/reports/runs/2026-08-18T21-42-30-864Z` |
| Official regrade | `benchmarks/nyaya-bench/reports/runs/regrade-A1-2026-08-18T21-51-56-436Z` |
| Mode | `compare-contradiction` |
| Dataset | V2 only (16 scenarios × T007–T011 = 80 tasks) |
| Structured grader | `b1-2026-08-18` |
| Model | openai `gpt-4o-mini` |
| Embeddings | openai |
| Git | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` |
| Production engines | `compareDocuments`, `detectContradictionCandidates` (unchanged) |

V1 was excluded: its hidden GT is chat-shaped (`must_answer` / `must_abstain`), not `material_changes` / `non_material_change` / `possible_contradiction` / `not_contradiction`.

---

## Compare (48 tasks)

| Metric | B.1 |
| --- | ---: |
| Tasks | 48 |
| Pass | 0 |
| Needs work | 0 |
| Fail | 48 |
| Infrastructure | 0 |
| Critical | 32 |
| Material-change recall (T007, n=16) | 0 |
| Material-change precision (T007, n=16) | 0 |
| Decoy false-positive rate (T008/T009, n=32) | 1.0 |
| Provenance failures | 0 |
| Wrong document-pair failures | 0 |
| Summary-vs-structured disagreement (grader metric) | 0 |

The document pair was correct on every Compare task (`01_Main_Agreement.pdf` vs `02_Amendment_1.pdf`). Provenance rows existed. Structured **change rows** were page-sized add/remove blobs, not paired before/after clause diffs. Decoy exhibit/typo text therefore sat on `high_attention` rows.

---

## Contradiction (32 tasks)

| Metric | B.1 |
| --- | ---: |
| Tasks | 32 |
| Pass | 16 |
| Needs work | 0 |
| Fail | 16 |
| Infrastructure | 0 |
| Critical | 1 |
| Contradiction accuracy (T010 semantic class) | 0 |
| Tension accuracy (T010 pass) | 0 |
| Compatible / not-contradiction accuracy (T011) | 1.0 |
| False-positive contradiction rate (grader taxonomy) | 0 |
| Missed-conflict rate (T010) | 0.9375 |
| Actor-inference overclaim | 1 |
| Source-pair / provenance failures | 0 |

All 16 T011 tasks passed: the engine did not treat “near the middle of November” vs `2026-11-10` as a contradiction.

All 16 T010 tasks failed. One (`SYNTH-V2-006-T010`) found the deposition/log pair and treated badge activity as proof that Mercer accessed/entered the room (critical). The other 15 missed the expected pair. Of those 15, 4 persisted no findings and 11 persisted a notice-period “contradiction” between sequenced amendments.

---

## Do not overwrite

Do not overwrite this baseline after later product changes. Later Compare/Contradiction scores must use a new label (B.2+).
