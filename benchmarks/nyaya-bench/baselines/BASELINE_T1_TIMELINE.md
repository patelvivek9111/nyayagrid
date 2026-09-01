# NYAYA TIMELINE BENCHMARK — Baseline T1

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline T1 — Timeline Reliability (unchanged production extraction)

This is the first independent structured Timeline score. Production Timeline was **not** tuned. Case Q&A, Compare, and Contradiction remain frozen.

---

## Configuration

| Field | Value |
| --- | --- |
| Official run | `benchmarks/nyaya-bench/reports/runs/2026-08-19T01-26-13-290Z` |
| Mode | `timeline` |
| Dataset | V2, 16 scenarios × 2 tagged timeline tasks = 32 |
| Scored | **16 T012** dated payment chains |
| Not applicable | **16 T025** badge/actor Q&A traps |
| Structured grader | `t1-2026-08-19` |
| Model | openai `gpt-4o-mini` |
| Prompt | `matter-intelligence-extract-v2` (unchanged) |
| Production engine | `extractMatterIntelligenceForReadyDocuments` → `listTimelineEvents(proposed+approved+edited)` |

---

## Pipeline (actual)

```text
source PDFs
↓
ingest + extractMatterIntelligenceForDocument (per ready document)
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

| Metric | T1 |
| --- | ---: |
| Scored tasks | 16 |
| Pass | **0/16** |
| Needs work | **16/16** |
| Fail | 0 |
| Infrastructure | 0 |
| Critical (automated) | **0** |
| Events expected | 64 (4 × 16) |
| Events produced | 256 |
| Events matched | 48 |
| Event-level recall | **48/64 = 0.75** |
| Task-complete recall | **0/16** |
| Mean event precision | 0.86 |
| DatePrecision accuracy | **0** (256/256 `unknown`) |
| Actor overclaim (automated) | 0 |
| Provenance failures (missing chunk) | 0 |
| Unsupported matched events | 0 |
| All events `proposed` | **yes** |

Every scored miss is the same: **invoice issuance on 2026-10-01 was not extracted as its own event**, even though that date is in the invoice chunk that sourced the due-date event.

---

## T012 event chain

Expected per scenario (amounts vary):

1. `YYYY-10-01` invoice issued
2. `YYYY-10-31` due date
3. `YYYY-11-03` remittance transmitted
4. `YYYY-11-05` receipt / late-payment email

Recovered in 16/16 scenarios: due, remittance, receipt. Missed in 16/16: invoice issuance.

---

## Do not confuse overall `counts.pass`

The run summary `counts.pass = 16` is **T025 not_applicable**. Scored T012 pass is **0**.

---

## Production not changed

No extraction, formatter, dedupe, rejection-memory, or `normalizeSourceChunkIds` change was made before this baseline.
