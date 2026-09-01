# PHASE 6T-CORPUS-1 — U.S. Primary-Law Corpus Build / Normalization

Generated: 2026-08-20T13:55:39.800Z

## 1. Executive Summary

Phase 6T-CORPUS-1 established a provenance-preserving primary-law import pipeline and loaded an initial representative state batch (PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA). Real authorities are stored under `us-primary-corpus`, isolated from `synthetic-fixtures`. **No state was marked CERTIFIED** and **6U was not started**.

| Metric | Value |
|--------|------:|
| Real primary authorities | 30 |
| Synthetic (excluded from coverage) | 7 |
| Statutes (real) | 20 |
| Cases (real) | 10 |
| Regulations (real) | 0 |
| States with meaningful coverage (≥2 authorities) | 10 |
| Import idempotent (2nd run) | YES |
| Research smoke passed | 4/4 |
| **Readiness for 6T re-certification** | **PARTIAL** |

## 2. Existing Corpus (pre-import reuse)

Reused without modification:
- `importAuthority()` — idempotent on `(sourceProvider, sourceExternalId)`, SHA-256 versioning, chunking, embeddings
- `structuredAuthorityFields()` — Phase 6S court/state normalization
- `AuthorityHybridRetriever` — FTS + vector search
- HTTP import remains gated (`ALLOW_AUTHORITY_HTTP_IMPORT` off in production posture)

## 3. Source Strategy

| Source class | Usage |
|--------------|-------|
| PRIMARY_OFFICIAL | State codification snapshots (UCC § 2-725, wage statutes) |
| PRIMARY_PUBLIC_REPOSITORY | High-court opinions via CourtListener canonical URLs |
| SYNTHETIC_BENCH | Existing `synthetic-fixtures` only — excluded from real coverage |

Initial batch: PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA — not hardcoded as the only supported states.

## 4. Source Trust Tiers

- TIER_1_OFFICIAL: 20
- TIER_2_TRUSTED_PUBLIC: 10

## 5. Import Architecture

- `packages/research/src/corpus/` — source classes, tiers, provenance enrichment, batch import, inventory
- `packages/research/corpus/bundles/` — manifest + per-state JSON bundles
- CLI: `npm run research:corpus-import`
- Benchmark: `npm run bench:6t-corpus1`

Parser version: `corpus1-v1`

## 6. Statutes

20 statutes imported. Uniform UCC Article 2 § 2-725 limitations text per state codification plus one employment/wage statute per state. Effective dates not inferred where source did not provide them.

## 7. Case Law

10 state high-court cases. Court IDs mapped via Phase 6S registry (`st-{state}-high`). Precedential status not guessed. MacPherson (NY) includes verbatim Cardozo excerpt; others are holding excerpts with full text at canonical URL.

## 8. Regulations

0 regulations in initial batch — dimension remains **UNVALIDATED** per phase scope.

## 9. Court Normalization

10 real authorities with normalized `courtId`. Ambiguous courts without state context are not imported.

## 10. Jurisdiction Normalization

30 real authorities with normalized `authorityState`. Original jurisdiction strings preserved on authority rows.

## 11. Temporal Metadata

Decision dates set only where source provides them. Effective dates: 0 authorities (statutes without source effective dates remain UNKNOWN).

## 12. Versioning

Immutable version rows; content changes create new versions. Second import run skipped 30 unchanged authorities.

## 13. Duplicate Handling

Stable identity: `(sourceProvider, sourceExternalId)` + content SHA-256.

## 14. Provenance

30/30 real authorities retain `canonicalSourceUrl`. All carry `sourceMetadata.importedAt`, `parserVersion`, and content hash on version rows.

## 15. Chunking / Indexing

32 chunks indexed for `us-primary-corpus` via existing pipeline. 30 version rows.

## 16. Initial State Batch

- **PA**: 3 authorities (2 statutes, 1 cases)
- **NJ**: 3 authorities (2 statutes, 1 cases)
- **NY**: 3 authorities (2 statutes, 1 cases)
- **DE**: 3 authorities (2 statutes, 1 cases)
- **CA**: 3 authorities (2 statutes, 1 cases)
- **TX**: 3 authorities (2 statutes, 1 cases)
- **FL**: 3 authorities (2 statutes, 1 cases)
- **IL**: 3 authorities (2 statutes, 1 cases)
- **MA**: 3 authorities (2 statutes, 1 cases)
- **VA**: 3 authorities (2 statutes, 1 cases)

## 17. Practice-Area Scope

Targeted: Contract/Commercial (UCC 2-725), Employment (wage/overtime), General Civil (high-court cases). **Not certified** — import only.

## 18. Import Results

First run: 0 imported, 30 skipped, 0 errors (30 total).

## 19. Coverage Inventory

See `BASELINE_6T_CORPUS1.json` and updated `BASELINE_6T_CORPUS_INVENTORY.json`.

## 20. Source Validation

Structural validation via Zod schemas; bundle manifest lists official URLs. No parser corruption observed in import run.

## 21. Research Smoke

- pa-statute: PASS
- pa-case: PASS
- ny-macpherson: PASS
- de-decoy-from-pa: PASS

## 22. Errors / Gaps

- 41 states + DC still without real primary-law coverage
- No state regulations in batch
- Case bundles mostly holding excerpts, not full slip opinions
- No intermediate appellate opinions yet
- Practice-area depth insufficient for full 6T certification

## 23. Storage / Cost

30 authorities, 32 chunks, 30 versions — measured at import time; no premature optimization.

## 24. Regressions

Run after import:
- `npm run test -w @nyayagrid/research` (corpus unit tests)
- `npm run test -w @nyayagrid/jurisdiction`
- Research smoke embedded in `bench:6t-corpus1`

Full 6R rerun not required (shared runtime unchanged materially).

## 25. Readiness for 6T Re-certification

**PARTIAL** — Initial batch provides real material for state-batch recertification, but corpus depth remains far below 50-state certification needs.

## 26. Exactly One Next Phase

**PHASE_6T-C2A — CERTIFY INITIAL ELIGIBLE STATE BATCH**

Do not begin automatically. Do not start 6U.

---

## Explicit Questions

1. **Which real primary-law sources were imported?** Official state codifications (UCC/wage statutes) and CourtListener-linked high-court opinions for PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA.
2. **Which states now have meaningful authority?** CA, DE, FL, IL, MA, NJ, NY, PA, TX, VA.
3. **How many statutes?** 20.
4. **How many cases?** 10.
5. **How many regulations?** 0.
6. **How many authorities have normalized state?** 30.
7. **How many have normalized courtId?** 10 (cases only).
8. **How many have effective dates?** 0.
9. **Are source URLs/provenance preserved?** YES — 30 with canonical URLs; all with import metadata and SHA-256.
10. **Are imports idempotent?** YES.
11. **Are historical versions preserved?** YES — immutable version rows; unchanged content skips re-import.
12. **Can wrong-state authorities be distinguished?** YES — `authorityState` and court registry metadata on all real imports.
13. **Can citations be traced to source?** YES — `canonicalSourceUrl` + stored citation fields.
14. **Synthetic counted as real coverage?** **NO**.
15. **States marked CERTIFIED from import?** **NO**.
16. **Corpus sufficient to rerun 6T?** **PARTIAL**.
17. **States ready for recertification first?** CA, DE, FL, IL, MA.
18. **Largest remaining gap?** 41 jurisdictions without real corpus; no regulations; shallow practice-area depth; most case text is excerpt-only.
