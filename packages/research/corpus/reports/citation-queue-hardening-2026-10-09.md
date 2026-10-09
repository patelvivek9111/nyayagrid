# Citation Queue Hardening — 2026-10-09

**CourtListener calls:** 0  
**Citation mutations:** 0  
**Stop:** QUEUE_HARDENED_DRY_RUN_READY  
**Next gate:** MIXED_CL_BATCH_READY  
**Classification:** CITATION_QUEUE_HARDENED

## Batch 4 miss root cause

scripts/lib/case-citation-extraction.cjs EXTRACT_RES catch-all /\b\d{1,4}\s+[A-Z][a-z]{0,10}\.?\s*(?:2d|3d)?\s+\d{1,4}\b/g matched document pagination headers (e.g. '2026 Page 2') in Indiana appellate opinion text. Edges stored with raw_citation=normalized_citation unchanged. Example citing case: 'Tawk Hre v. State of Indiana' (st-in-app). Pre-Batch4 isLookupSuitableCitation treated vol+word+page as suitable via loose regex; parseVolReporterPage returned null. Idaho miss (163 Idaho 856) is a real official reporter cite found in opinion text quoting Lunneborg; CL returned not_found (coverage), and remains CASE_IDENTITY_LOOKUP_ELIGIBLE. Raw evidence preserved; only resolution lane reclassified.

- no-result: 15
- YYYY Page N: 14
- other: 1 (163 Idaho 856 — eligible, CL coverage miss)
- artifact edges in DB: 305 / targets 41

## Eligibility lanes

| Lane | Targets |
|---|---:|
| CASE_IDENTITY_LOOKUP_ELIGIBLE | 36576 |
| MALFORMED_CASE_REFERENCE | 859 |
| STATUTE_RULE_REGULATION | 1398 |
| UNKNOWN_REVIEW | 5491 |
| NON_CASE_REFERENCE | 1 |
| PIN_CITE_ONLY | 0 |

## Queue

| | Before | After |
|---|---:|---:|
| lookup candidates | 36617 | 36576 |
| >=10 | 17 | 3 |
| 5–9 | 371 | 357 |
| 3–4 | 1441 | 1433 |
| 1–2 | 34788 | 34783 |

## >=5 identity lane

targets: **360** · edges: **2075**  
CA3 60 · EDPA 8 · PA 9 · federal 348 · state 12

## Full-text tiers

A 20 · B 95 · C 1

## Mixed dry-run (NOT executed)

max CL 40 · identity 22 · full-text 14 · headroom 4  
allocation 55/35/10
