# Discovery / Production Shared Schema — Chat A Handoff

**Classification:** `DISCOVERY_SHARED_SCHEMA_COORDINATION`  
**Integration branch:** `nyaya/integration-checkpoint`  
**Migration:** `0022_discovery_production_ledger`  
**Contract source:** `origin/nyaya/full-completion-deepening-v2` (`docs/reports/discovery-shared-schema-required-2026-10-08.md`)

## Migration

- File: `packages/database/drizzle/0022_discovery_production_ledger.sql`
- Down: `packages/database/drizzle/0022_discovery_production_ledger.down.sql` (tables droppable; **graph enum values cannot be safely removed**)
- Additive only. Production Neon not applied by Integration in this pass.

## Tables

| Table | Purpose |
|---|---|
| `discovery_request_sets` | Set label, type, parties, served/due, source document, current/superseded |
| `discovery_request_items` | Numbered requests with status + text |
| `discovery_responses` | Append-only response history (initial + supplemental) |
| `discovery_objections` | Objections linked to response + item |
| `discovery_productions` | Production ledger header |
| `discovery_production_items` | Junction to canonical `documents` / `civil_evidence_items` / request items |
| `discovery_bates_ranges` | Raw Bates + optional prefix/start/end (nullable for unknown/no Bates) |
| `discovery_production_custodians` | Custodian entity links |
| `discovery_response_productions` | Response ↔ production links |
| `discovery_deficiencies` | Structured review issues (not sanctions) |
| `discovery_meet_and_confer_issues` | Meet-and-confer tracking |
| `discovery_meet_and_confer_deficiency_links` | MAC ↔ deficiency junction |
| `discovery_privilege_assertions` | Privilege **review** tracking only |

## Status / type enums (CHECK constraints)

- Request types: INTERROGATORY, REQUEST_FOR_PRODUCTION, REQUEST_FOR_ADMISSION, SUBPOENA, DEPOSITION_DISCOVERY, THIRD_PARTY_REQUEST, OTHER
- Item statuses: NOT_DUE, OPEN, RESPONDED, PARTIALLY_RESPONDED, OBJECTED, PRODUCED, SUPPLEMENT_REQUIRED, DEFICIENT, RESOLVED, UNKNOWN
- Deficiency kinds: NO_RESPONSE … SUPPLEMENT_EXPECTED, OTHER (no SANCTIONS)
- Deficiency statuses: OPEN, MEET_AND_CONFER, MOTION_PENDING, RESOLVED, WITHDRAWN, UNKNOWN
- Privilege review statuses: ASSERTED, UNDER_REVIEW, CHALLENGED, WITHDRAWN, RESOLVED, UNKNOWN

## Graph node types (additive)

- `discovery_request_set`
- `discovery_request_item`
- `discovery_response`
- `discovery_production`
- `discovery_deficiency`
- `privilege_assertion`

Preserved: `claim`, `defense`, and all legacy node types.  
Not added (relationships/metadata suffice): objections, Bates ranges, custodians.

## Service APIs (`@nyayagrid/intelligence` → `discovery-ledger`)

- `createDiscoveryRequestSet` / `listDiscoveryRequestSets` / `getDiscoveryRequestSet`
- `createDiscoveryRequestItem` / `listDiscoveryRequestItems` / `getDiscoveryRequestItem`
- `createDiscoveryResponse` / `listDiscoveryResponsesForItem`
- `createDiscoveryObjection`
- `createDiscoveryProduction` / `listDiscoveryProductions`
- `linkDiscoveryProductionItem` / `linkDiscoveryProductionCustodian` / `linkDiscoveryResponseProduction`
- `createDiscoveryBatesRange`
- `createDiscoveryDeficiency` / `listDiscoveryDeficiencies`
- `createDiscoveryPrivilegeAssertion` / `listDiscoveryPrivilegeAssertions`
- `createDiscoveryMeetAndConferIssue`

All mutations enforce org/matter isolation + document/evidence/party matter checks.

## Adapter APIs

- `loadDiscoveryLedgerReview(db, { userId, organizationId, matterId })` → D4 `DiscoveryLedgerReview`
- `persistDiscoveryLedgerReview(db, { userId, organizationId, matterId, review })` → reconstructable ledger

## Canonical reuse

- Documents / evidence / parties / tasks linked by FK (no blob duplication)
- `communication_id` / `motion_id` are opaque UUIDs; motion writes require `motionDocumentId` in-matter for isolation until a motions table exists

## Isolation strategy

Composite FKs `(id, matter_id)` / `(matter_id, organization_id)` matching civil claims. Service-layer rejection for foreign documents (documents.matter_id nullable → no composite FK).

## What Chat A should implement next

1. Persisted Discovery UI on live matter-scoped data
2. Live Ask Nyaya wiring to `loadDiscoveryLedgerReview`
3. Live Graph materialization using the six discovery node types
4. Live DB/security certification after Integration promotes schema

## Constraints

- No sanctions / privilege legal-conclusion columns
- Bates overlap/gap detection remains application review logic
- Do not merge Chat A prototype feature commits into Integration; consume schema + services only
