# NYAYA TIMELINE BENCHMARK — Baseline T2

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline T2 — Timeline Reliability after Phase 6F

T1 remains frozen. This run measures production Timeline after date-precision, multi-event extraction, provenance, actor/title grounding, rejection memory, and verified-context formatting fixes. Case Q&A, Compare, and Contradiction remain frozen.

---

## Configuration

| Field | Value |
| --- | --- |
| Official run | `benchmarks/nyaya-bench/reports/runs/2026-08-19T02-15-53-117Z` |
| Mode | `timeline` |
| Dataset | V2, 16 scenarios × 2 tagged timeline tasks = 32 |
| Scored | **16 T012** dated payment chains |
| Not applicable | **16 T025** badge/actor Q&A traps |
| Structured grader | `t1-2026-08-19` (unchanged) |
| Model | openai `gpt-4o-mini` |
| Prompt | `matter-intelligence-extract-v3` |
| Production engine | `extractMatterIntelligenceForReadyDocuments` → `listTimelineEvents(proposed+approved+edited)` |

---

## Pipeline (actual)

```text
source PDFs
↓
ingest + extractMatterIntelligenceForDocument (per ready document)
↓
model parse (v3) + deterministic dated-proposition split
↓
datePrecision normalize + actor/title grounding + rejection memory
↓
quote/overlap supporting span (no all-chunk, no header prefix)
↓
persist proposed timeline events
↓
adapt production rows → canonical Timeline artifact
↓
persist answer JSON
↓
THEN load hidden GT
↓
structured Timeline grade (not chat needles)
```

---

## Headline

| Metric | T1 | T2 |
| --- | ---: | ---: |
| Scored tasks | 16 | 16 |
| Pass | **0/16** | **16/16** |
| Needs work | **16/16** | **0/16** |
| Fail | 0 | 0 |
| Infrastructure | 0 | 0 |
| Critical (automated) | **0** | **0** |
| Events expected | 64 | 64 |
| Events produced | 256 | 445 |
| Events matched | 48 | **64** |
| Event-level recall | **48/64 = 75%** | **64/64 = 100%** |
| Task-complete recall | **0/16** | **16/16** |
| Mean event precision | 0.86 | 0.45 |
| DatePrecision accuracy | **0** | **1.0** |
| Actor overclaim (automated) | 0 | 0 |
| Provenance failures (missing chunk) | 0 | 0 |
| Unsupported matched events | 0 | 0 |
| All events `proposed` | **yes** | **yes** |
| Invoice issuance miss | **16/16** | **0/16** |
| Synth-header supportingText | 203/256 | **0/445** |
| All-chunk source fallback | (T1 parser) | **0/445** |
| Title/description contradictions | 4 scenarios (manual) | **0** |

Every scored T012 task recovered invoice issued, due date, remittance, and receipt/late-payment notice. Matched events used `datePrecision=exact`. No auto-approval.

---

## T012 event chain

Expected per scenario (amounts vary):

1. `YYYY-10-01` invoice issued
2. `YYYY-10-31` due date
3. `YYYY-11-03` remittance transmitted
4. `YYYY-11-05` receipt / late-payment email

Recovered in 16/16 scenarios: all four events.

---

## Do not confuse overall `counts.pass`

The run summary `counts.pass = 32` includes **16 T025 not_applicable**. Scored T012 pass is **16/16**.

---

## Remaining production notes

- Event precision fell because deterministic split plus the model often persist two events on the same GT day (for example `invoice_issued` and `invoice`). The grader counts extra same-day rows against precision. Dedupe was left conservative on purpose.
- Ingest logged one OpenAI timeout on SYNTH-V2-015; the timeline task extract still recovered 4/4.
- Rejection memory is unit-tested; T2 did not execute a live reject → re-extract workflow.
- T1 files `BASELINE_T1_TIMELINE.md` / `.json` were not overwritten.
