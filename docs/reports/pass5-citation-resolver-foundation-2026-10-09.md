# Pass 5 Citation Resolution Foundation Integration

**Classification:** `PASS5_CITATION_RESOLVER_FOUNDATION_INTEGRATION`  
**Date:** 2026-10-09  
**Source:** `origin/nyaya/corpus-citation-strengthening-v2` @ `208168c`  
**Base main:** `7879974`

## Diff classification

### A. REUSABLE_PRODUCT_ARCHITECTURE (integrated)

- `packages/research/src/corpus/citation-resolution/*` (engine)
- `packages/research/src/citation-resolution-contract.ts` (product facade)
- `scripts/lib/case-citation-extraction.cjs` + tests (YYYY Page N / eligibility hardening)

### B. CORPUS_PIPELINE_ONLY_BUT_REUSABLE_SERVICE (intentionally excluded from product main)

- `packages/research/src/cli/citation-resolution-phase1.ts`
- `cl-identity-client.ts` **is included** (dry-run default; live requires `enableLive=true`) so product may optionally wire later without a second client
- JSONL ledger helpers included (file-based; no shared schema)

### C. LIVE_BATCH_STATE / REPORT / LEDGER DATA (excluded)

- `packages/research/corpus/reports/**`
- `packages/research/corpus/resolution/checkpoints/**`
- `packages/research/corpus/resolution/ledger/**`
- demand queues / quota probes / run-state JSON

### D. ONE-OFF DIAGNOSTIC (excluded)

- `scripts/tmp-citation-*.cjs`
- `scripts/tmp-corpus-daily-*.cjs`
- unresolved diagnostic scripts/reports

### E. SHOULD_NOT_MERGE

- Live CourtListener batch execution artifacts
- Corpus DB mutation apply scripts
- Daily certified snapshot noise

## Shared resolver contract

### Persisted authority states (do not rename)

- `IDENTITY_UNRESOLVED`
- `AUTHORITY_RESOLVED` — verified identity; **does not** imply opinion text
- `CORPUS_COMPLETE` — full text / ready corpus presence

### Product outcomes (`ProductResolutionOutcome`)

- `RESOLVED_HIGH_CONFIDENCE`
- `AMBIGUOUS`
- `NOT_FOUND`
- `NOT_CASE_CITATION`
- `MALFORMED`
- `DEFERRED`

### Resolution order (local-first)

extract → classify → normalize → local exact → local normalized → alias → parallel → source-ID → eligibility gate → unique-target external queue (optional) → AUTHORITY_RESOLVED → demand-driven full text → CORPUS_COMPLETE

### Ambiguity

`LookupCandidateResult.kind === "ambiguous"` / product outcome `AMBIGUOUS` — never silent best-guess.

### Provenance minimum (already in engine)

raw, normalized, method, confidence, authority id, evidence[], resolverVersion, externalIdentity when used, supersession fields on ledger records.

## Schema gate

**SHARED_SCHEMA_REQUIRED = NO**

Engine persistence uses:

1. existing `legal_authorities` / citation edge `to_authority_id`
2. reversible corpus JSONL ledger (file-based)

Pass 5 productization can proceed on existing persistence. A future audit table is optional, not blocking.

## Chat A public APIs

From `@nyayagrid/research`:

- `resolveCitationForProduct`
- `classifyCaseCitationLookupEligibility`
- `experimentalNormalize` / `targetKey`
- `LocalAuthorityIndex`
- `resolveNewCitationsLocalFirst`
- `authorityCorpusState`
- `RESOLVER_VERSION`
- types: `ProductCitationResolution`, `ProductResolutionOutcome`, `ResolutionState`, `AuthorityIndexRow`

Low-level module: `@nyayagrid/research` → `./corpus/citation-resolution`

Note: legacy `resolveCitationAgainstCorpus` remains for existing Research DB lookups; Pass 5 productization should prefer the citation-resolution engine + product contract (do not invent a third resolver).

## Explicitly not done

- No CourtListener live calls
- No corpus DB mutation
- No schema migration
- No import of live batch state
- Original dirty checkout `C:\Users\patel\Documents\nyayagrid` untouched
