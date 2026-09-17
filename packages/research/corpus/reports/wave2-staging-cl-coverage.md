# NyayaGrid legal corpus coverage — Wave 2 staging (CourtListener deepen)

Generated: 2026-09-18T03:10:00.000Z
Phase: Queue #2 Wave 2 — staging CL live deepen (PARTIAL)
Git: 756b85c / lean ingest 7e5895c

## Staging inventory (exact)
- total authorities: **311**
- seed (`us-primary-corpus`): **186**
- CourtListener live: **125**
- cases / statutes / regulations / rules: **170 / 118 / 15 / 7**

## CourtListener by court (exact)
| court_id | n | level |
|---|---:|---|
| us-scotus | 18 | scotus |
| us-ca-1 | 11 | circuit |
| us-ca-2 | 10 | circuit |
| us-ca-3 | 11 | circuit |
| us-ca-4 | 12 | circuit |
| us-ca-5 | 10 | circuit |
| us-ca-6 | 12 | circuit |
| us-ca-7 | 5 | circuit |
| us-ca-8 | 15 | circuit |
| us-ca-9 | 15 | circuit |
| us-ca-10 | 6 | circuit |

Missing CL deepen this wave: ca11, cadc, cafc, all Wave-1 state high/appellate (CL 429 + Fly machine stops).

## Citation / treatment / embeddings
- citation edges: **2104** (normalized **2104**, resolved to existing authority **16**)
- CL chunks with embeddings: **3274 / 3274**
- treatment-signal metadata present on **125** CL authorities (bounded lexical signals; not Shepard’s-depth)

## Court mapping
- mapped CL→Nyaya courts validated for ingested set: **11 / 33** planned Wave-2 courts
- unmapped during ingest: **0** (unmapped courts quarantined by design)

## Retrieval / staging
- seed citation retrieval: PASS (28 USC 1331, 29 CFR 541.100, 42 Pa.C.S. 5525)
- CL court retrieval smoke: SCOTUS hits≥3, CA9 hits≥3; Wave-1 high courts hits=0 (not ingested)
- health ready: **200**, `featureAgents: "0"`
- Legal Research: corpus-only / no general Web (unchanged)

## Depth claim (do not overclaim)
Bounded recent-opinion sample from CourtListener — **not** full SCOTUS/circuit reporters, **not** national case-law coverage, **not** Wave-1 state appellate depth.
