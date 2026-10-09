# Unresolved Citation Resolution Diagnostic

**Date:** 2026-10-09  
**Branch:** `nyaya/corpus-citation-strengthening-v2`  
**Classification:** `UNRESOLVED_CITATION_RESOLUTION_DIAGNOSTIC`  
**CourtListener calls:** **0**  
**Corpus mutations:** **0**  

## STATUS

Diagnostic complete (read-only). Recommendation: **BUILD_RESOLUTION_ENGINE**.

## CURRENT CORPUS

| Metric | Value |
|---|---|
| cases | 5136 |
| authorities | 6491 |
| extracted edges | 66945 |
| resolved edges | 10221 |
| unresolved edges | **56724** |
| unique raw citations | **46196** |
| unique normalized citations | **44974** |
| unique target keys (experimental normalize) | **44502** |
| median edges / unique target | 1 |
| p95 edges / unique target | 3 |

## CORE FINDING

Unresolved edges ≈ **56724**, but unique resolution problems ≈ **44502** target keys  
(~**1.27** edges per unique target on average; p95 = 3).

Top 100 unique targets cover **1386** edges (2.4% of unresolved).  
Top 500 cover **3881** edges (6.8%).

## CLASSIFICATION (edges / unique targets)

| Kind | Edges | Unique targets |
|---|---:|---:|
| FULL_CASE_CITATION | 45091 | 36158 |
| SHORT_FORM_CASE_CITATION | 0 | 0 |
| ID_CITATION | 0 | 0 |
| SUPRA_CITATION | 0 | 0 |
| PARALLEL_CITATION_CANDIDATE | 6149 | 4213 |
| MALFORMED_CASE_CITATION | 3 | 3 |
| STATUTE_OR_CODE | 2075 | 1168 |
| REGULATION | 181 | 162 |
| RULE | 326 | 100 |
| SECONDARY_SOURCE | 0 | 0 |
| UNKNOWN | 2899 | 2698 |

## LOCAL RESOLUTION POTENTIAL (HIGH confidence, simulation only)

| Bucket | Unique targets |
|---|---:|
| ALREADY_PRESENT_EXACT | 44 |
| ALREADY_PRESENT_ALIAS | 0 |
| ALREADY_PRESENT_PARALLEL | 0 |
| ALREADY_PRESENT_AMBIGUOUS (NO_AUTO_RESOLVE) | 1 |
| NO_LOCAL_MATCH | 44457 |
| normalization-recoverable (subset signal) | 44 |
| **HIGH-confidence unique targets** | **44** |
| **HIGH-confidence edges** | **172** |

## AMBIGUITY / SAFETY

| Item | Count |
|---|---:|
| normalization collisions (conflicting VRP) | 0 |
| short-cite ambiguity (sampled) | 0 |
| NO_AUTO_RESOLVE targets | 2 |

**MUST:** ambiguous citations are **not** auto-resolved in this design.  
**MUST:** authority-resolved ≠ corpus-complete.  
**MUST:** original citation text preserved.

## HIGH-LEVERAGE TARGETS

| Rank window | Edges covered |
|---|---:|
| top 1 | 37 |
| top 25 | 534 |
| top 100 | 1386 |
| top 500 | 3881 |

### Top 25 (by unresolved edges)

1. `42 U.S.C. § 1983` — 37 edges — ALREADY_PRESENT_EXACT — STATUTE_OR_CODE
2. `Fed. R. App. P. 34` — 33 edges — NO_LOCAL_MATCH — RULE
3. `18 U.S.C. § 922(g)(1` — 32 edges — NO_LOCAL_MATCH — STATUTE_OR_CODE
4. `28 U.S.C. § 2254` — 31 edges — NO_LOCAL_MATCH — STATUTE_OR_CODE
5. `18 U.S.C. § 924` — 25 edges — NO_LOCAL_MATCH — STATUTE_OR_CODE
6. `106 S. Ct. 2505` — 23 edges — NO_LOCAL_MATCH — PARALLEL_CITATION_CANDIDATE
7. `28 U.S.C. § 1257` — 23 edges — NO_LOCAL_MATCH — STATUTE_OR_CODE
8. `128 S. Ct. 2783` — 23 edges — NO_LOCAL_MATCH — PARALLEL_CITATION_CANDIDATE
9. `28 U.S.C. § 1343` — 23 edges — NO_LOCAL_MATCH — STATUTE_OR_CODE
10. `21 U.S.C. § 841` — 22 edges — NO_LOCAL_MATCH — STATUTE_OR_CODE
11. `1 Cranch 137` — 21 edges — NO_LOCAL_MATCH — FULL_CASE_CITATION
12. `106 S. Ct. 2548` — 21 edges — NO_LOCAL_MATCH — PARALLEL_CITATION_CANDIDATE
13. `130 S. Ct. 3020` — 19 edges — NO_LOCAL_MATCH — PARALLEL_CITATION_CANDIDATE
14. `421 U.S. 240` — 18 edges — NO_LOCAL_MATCH — FULL_CASE_CITATION
15. `451 U.S. 204` — 18 edges — NO_LOCAL_MATCH — FULL_CASE_CITATION
16. `103 S. Ct. 1933` — 17 edges — NO_LOCAL_MATCH — PARALLEL_CITATION_CANDIDATE
17. `17 Stat. 13` — 17 edges — NO_LOCAL_MATCH — FULL_CASE_CITATION
18. `106 S. Ct. 1348` — 17 edges — NO_LOCAL_MATCH — PARALLEL_CITATION_CANDIDATE
19. `95 S. Ct. 1612` — 17 edges — NO_LOCAL_MATCH — PARALLEL_CITATION_CANDIDATE
20. `18 U.S.C. § 3231` — 17 edges — NO_LOCAL_MATCH — STATUTE_OR_CODE
21. `63 L. Ed. 2d 639` — 16 edges — NO_LOCAL_MATCH — PARALLEL_CITATION_CANDIDATE
22. `390 U.S. 400` — 16 edges — NO_LOCAL_MATCH — FULL_CASE_CITATION
23. `163 Idaho 856` — 16 edges — NO_LOCAL_MATCH — FULL_CASE_CITATION
24. `100 S. Ct. 1371` — 16 edges — NO_LOCAL_MATCH — PARALLEL_CITATION_CANDIDATE
25. `21 U.S.C. § 846` — 16 edges — NO_LOCAL_MATCH — STATUTE_OR_CODE

## PARALLEL CITATION ANALYSIS

| Metric | Value |
|---|---:|
| parallel groups found (local metadata) | 27 |
| edges potentially resolvable | 102 |
| unique targets collapsible | 27 |
| authorities with parallel/alias metadata | 168 |

Defensible identity only via existing local citation/alias/parallel metadata + VRP keys. No merge on name similarity alone.

## SHORT-CITE / CONTEXTUAL (diagnostic sample)

Unresolved edges matching bare `Id.` / `ibid.` / `supra` / `at N`: **0**.  
(Extractor likely omits or expands short forms before storage; contextual lane still required for future ingestion.)

| Class | Count (sampled edges=0) |
|---|---:|
| CONTEXTUALLY_DETERMINISTIC | 0 |
| CONTEXTUALLY_LIKELY | 0 |
| AMBIGUOUS | 0 |
| NOT_RESOLVABLE_LOCALLY | 0 |

## EXTERNAL LOOKUP FEASIBILITY (NO LIVE CALLS)

Existing tooling already posts to CourtListener `citation-lookup` per target inside `tmp-queue2-cite-demand-multi-ingest.cjs`.  
Missing: a dedicated **unique-target identity batch lane** that stops at AUTHORITY_RESOLVED without opinion fetch.

| Estimate | Value |
|---|---:|
| unique targets suitable for external identity lookup | 40365 |
| estimated batches @75 targets | 539 |
| if looked up per unresolved edge | 56724 |
| if looked up per unique target | 40365 |
| calls avoided vs per-edge | 16359 |
| calls avoided vs full acquisition (~3 CL/target) | 121095 |

## FULL OPINION ACQUISITION

Unique targets that **appear** to still need demand-driven full-text acquisition after identity work: **1331**  
(high-demand missing federal/US reporter targets with no local match)

## PROJECTION

| Scenario | Unresolved edges |
|---|---:|
| current | **56724** |
| after HIGH-confidence local resolution only | **56552** (Δ −172) |
| after local + external identity lookup (low 45%) | ~**33497** |
| after local + external identity lookup (high 70%) | ~**20688** |
| full opinion acquisitions for HIGH-local projection | **0** |

Remaining hard/ambiguous mass includes malformed, unknown, short-cite ambiguity, and NO_AUTO_RESOLVE collisions.

## RESOLUTION ENGINE DESIGN (not deployed)

### States
- `IDENTITY_UNRESOLVED`
- `AUTHORITY_RESOLVED` (identity known; text may be absent)
- `CORPUS_COMPLETE` (full opinion text + embeddings present)

### Methods
`LOCAL_EXACT` · `LOCAL_NORMALIZED` · `LOCAL_ALIAS` · `LOCAL_PARALLEL` · `CONTEXTUAL_SHORT_CITE` · `COURTLISTENER_CITATION_LOOKUP` · `COURTLISTENER_CLUSTER` · `MANUAL`

### Permanent ingestion pipeline

```
CASE INGESTION
  → CITATION EXTRACTION
  → CANONICAL NORMALIZATION
  → LOCAL AUTHORITY RESOLUTION
  → ALIAS / PARALLEL RESOLUTION
  → CONTEXTUAL SHORT-CITE (deterministic only)
  → UNRESOLVED UNIQUE-TARGET QUEUE (deduped)
  → BATCH EXTERNAL IDENTITY LOOKUP
  → AUTHORITY_RESOLVED
  → DEMAND-DRIVEN FULL-TEXT ACQUISITION
  → CORPUS_COMPLETE
  → GLOBAL BACKFILL of matching old + new edges
```

### Local authority index (recommended)
canonical authority ID, canonical citation, normalized keys, parallels, aliases, CL cluster/opinion IDs, court, jurisdiction, date, name, reporter/volume/page, provenance, confidence, corpus-complete flag.

### Unresolved target queue
Track normalized key, edge count, unique citing cases, first/last seen, jurisdictions, reporter/year, local/external/full-text status, priority score.  
**Dedup before external lookup. Never look up per-edge.**

### Global backfill
On new identity: register aliases → scan entire unresolved set for deterministic matches → resolve compatible edges → keep raw text → leave ambiguous alone.

### Reversibility
Every mapping stores method, confidence, evidence, timestamp/version; soft-delete / supersede rather than hard-delete; never overwrite raw extracted citation.

### AUTHORITY_RESOLVED vs CORPUS_COMPLETE
Separate columns/flags. Acquisition jobs only promote CORPUS_COMPLETE after text+embed pipeline succeeds.

## PERMANENT INGESTION ANSWERS

1. Can resolver sit permanently in ingestion? **YES**
2. Prevent backlog recreation? **YES**, if unique-target queue + local-first + backfill are mandatory stages
3. Mature local resolution rate for NEW edges? **~79%** estimate (rises with index)
4. Dedup before external lookup? **YES — by normalized target key**
5. Backfill historical? **YES — global scan on each new identity**
6. Schema eventually? citation_resolution / authority_aliases / unresolved_targets tables (or metadata v1)
7. Without schema change? **YES** — resolver service + JSON artifacts + optional metadata.aliases growth
8. Production migration? Additive only when promoting aliases/queue to first-class tables
9. Guarantee resolved ≠ complete? Separate status enum; acquisition gated on demand
10. Reversibility? Versioned mapping rows with supersession

## ANTI-REGRESSION METRICS

Track: local resolution rate, identity-unresolved rate, unique unresolved targets / 1k cases, external lookups / 1k cases, full-text / 1k cases, old edges backfilled, alias reuse rate.  
If identity-unresolved grows faster than corpus → **resolver regression**.

## SAFETY GATES

- High-confidence / deterministic only for auto-apply  
- No competing target  
- Provenance retained  
- Reversible  
- No destructive deletion  
- Original citation text preserved  
- Ambiguous stays unresolved  
- Authority-resolved never implies full text  

## P0 BLOCKERS

None for building the engine offline.  
Live apply of HIGH-confidence local mappings requires a separate authorized write pass.

## RECOMMENDATION

**BUILD_RESOLUTION_ENGINE**

## FINAL CLASSIFICATION

**DIAGNOSTIC_STRONG_RESOLUTION_OPPORTUNITY**

### Interpretation
- Local HIGH-confidence backfill alone is small (present-authority defect is not the main backlog).
- The dominant opportunity is **unique-target identity resolution** (local-first, then batch external lookup) **without** full-opinion acquisition, plus a permanent ingestion-stage resolver so new cases do not recreate edge-level unresolved growth.
