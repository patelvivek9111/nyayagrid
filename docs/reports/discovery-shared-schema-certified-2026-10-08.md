# DISCOVERY_SHARED_SCHEMA_CERTIFIED

**Date:** 2026-10-08  
**Branch:** `nyaya/integration-checkpoint`  
**Migration:** `0022_discovery_production_ledger`  
**Local DB:** `localhost:5433/nyayagrid`  
**Production Neon:** unmodified  
**CourtListener:** unused

## Certification result

`DISCOVERY_SHARED_SCHEMA_CERTIFIED`

Migration 0022 applied and certified on local product Postgres only.

## Schema health after apply

| Check | Result |
|---|---|
| Migration 0022 applied | PASS |
| Civil 0020 tables/data readable | PASS (`civil_claims`, `civil_pleadings` intact) |
| Graph 0021 claim/defense enum + rows | PASS (`claim`=8, `defense`=4 graph_nodes) |
| Existing matters/documents/evidence | PASS (counts remained readable; no destructive rewrite) |
| Discovery tables present (13) | PASS |
| Graph enum includes six discovery types | PASS |
| Legacy + claim/defense enum values preserved | PASS |

## Persistence certification

Certified via `packages/intelligence/src/discovery-ledger/discovery.integration.test.ts` (`RUN_DB_TESTS=1`):

- request sets / items
- response history + supplemental responses
- objections
- productions / production items (document + evidence links)
- Bates ranges
- production custodians
- response ↔ production links
- deficiencies
- privilege assertions (review statuses only)
- meet-and-confer issues + deficiency links
- task link on meet-and-confer
- opaque communication id retained without duplicating communications storage

## D4 adapter certification

- `persistDiscoveryLedgerReview` — PASS
- `loadDiscoveryLedgerReview` — PASS
- Reconstructs request sets, response history, objections, productions, Bates, deficiencies, privilege review, meet-and-confer relations

## Security certification

| Control | Result |
|---|---|
| Cross-org denied | PASS |
| Cross-matter denied | PASS |
| Foreign document rejected (`CROSS_ORG`) | PASS |
| Foreign evidence rejected (`CROSS_MATTER`) | PASS |
| Foreign motion rejected (`FOREIGN_MOTION` without in-matter motion document) | PASS |
| Unauthorized mutation denied | PASS |

## Graph certification

New additive values accepted:

- `discovery_request_set`
- `discovery_request_item`
- `discovery_response`
- `discovery_production`
- `discovery_deficiency`
- `privilege_assertion`

Preserved: `claim`, `defense`, and all legacy node types.  
Rejected: invalid types such as `discovery_objection`, `bates_range`.

## Canonical reuse

- Documents / civil evidence / matter entities reused via FKs (no blob/document duplication)
- Tasks linked from meet-and-confer
- Communications / motions linked by opaque ids + motion document isolation check

## Tests run

- discovery schema unit tests — PASS
- discovery DB integration — PASS
- graph-node-type unit — PASS
- civil DB integration (regression) — PASS
- database / intelligence / web typecheck — PASS (pre-existing civil LIABLE TS2367 only)
- production build — see commit-time gate

## Chat A next

1. Persisted Discovery UI
2. Live Ask Nyaya wiring to `loadDiscoveryLedgerReview`
3. Live Graph materialization of the six discovery node types
4. Live DB/security certification after main promotion

## Next action

`DISCOVERY_SCHEMA_READY_FOR_MAIN_PROMOTION`
