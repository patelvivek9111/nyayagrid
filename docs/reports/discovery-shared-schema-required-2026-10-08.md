# DISCOVERY_SHARED_SCHEMA_REQUIRED — Discovery / Production Ledger

**Classification:** `DEEPENING_PASS4_DISCOVERY_PRODUCTION`  
**Date:** 2026-10-08  
**Branch:** `nyaya/full-completion-deepening-v2`  
**Stop reason:** Production-grade discovery ledger cannot reach L4 without shared persistence.

## Phase 0 audit (current maturity)

| Capability | Maturity | Notes |
|---|---|---|
| Document review / discovery queue (`document_review_states`, Phase 5) | L3 | Document-centric classification & review; not a request/response ledger |
| Week 4 prosecution discovery-ops dashboard | L2 | Counts / disclosure candidates; no civil RFP/rog/Bates ledger |
| Bates numbers in DB | L0 | No `bates*` columns/tables found |
| Request sets / items / responses / objections | L0 | Absent as first-class persistence |
| Production ledger | L0 | Absent |
| Deficiency / privilege-review tracking | L0 | Absent as structured discovery entities |
| Tasks / deadlines / communications / motions | L3–L4 | Reuse for links; do not duplicate |
| Documents / evidence / parties | L4 | Canonical reuse targets |
| Ask Nyaya discovery ledger answers | L1 | Prototype only (this pass) |
| Graph discovery entities | L0 | No discovery node types |

**Overall discovery/production ledger today:** L0–L1 (Phase 5 doc review is adjacent L3, not a substitute).

## Decision

Existing schema **cannot** safely support L4 discovery/production without additive shared tables. Encoding request items, Bates ranges, deficiencies, and privilege assertions into JSON blobs on documents would break:

- matter-scoped joins
- Ask Nyaya provenance
- production completeness queries
- cross-link integrity (motion / communication / evidence)
- tenant isolation checks

**Chat A did not implement a migration.** Application-layer prototype only.

## Exact minimal schema proposal (additive)

Reuse — do **not** recreate:

- `documents`, `document_versions`
- evidence tables already used by civil/prosecution
- matter entities / parties
- `tasks`, deadline/calendar tables
- communications
- motion records (link by id)

### New enums (or check constraints)

- `discovery_request_type`: INTERROGATORY | REQUEST_FOR_PRODUCTION | REQUEST_FOR_ADMISSION | SUBPOENA | DEPOSITION_DISCOVERY | THIRD_PARTY_REQUEST | OTHER
- `discovery_item_status`: NOT_DUE | OPEN | RESPONDED | PARTIALLY_RESPONDED | OBJECTED | PRODUCED | SUPPLEMENT_REQUIRED | DEFICIENT | RESOLVED | UNKNOWN
- `discovery_deficiency_kind`: NO_RESPONSE | PARTIAL_RESPONSE | OBJECTION_ONLY | MISSING_PRODUCTION | INCOMPLETE_PRODUCTION | UNREADABLE_DOCUMENT | MISSING_ATTACHMENT | BATES_GAP | UNIDENTIFIED_CUSTODIAN | PRIVILEGE_LOG_MISSING | SUPPLEMENT_EXPECTED | OTHER
- `discovery_deficiency_status`: OPEN | MEET_AND_CONFER | MOTION_PENDING | RESOLVED | WITHDRAWN | UNKNOWN
- `privilege_review_status`: ASSERTED | UNDER_REVIEW | CHALLENGED | WITHDRAWN | RESOLVED | UNKNOWN

### New tables (all with `organization_id`, `matter_id`, provenance columns)

1. `discovery_request_sets` — set label, type, requesting/responding party entity ids, served/due dates, source document id, current/superseded flags  
2. `discovery_request_items` — set_id, request_number, title, request_text, status, parties, dates, source span  
3. `discovery_responses` — item_id, responded_at, is_supplemental, supplements_response_id, substantive_text, source document id  
4. `discovery_objections` — response_id, item_id, basis, text, provenance  
5. `discovery_productions` — producing/receiving parties, produced_at, label, transmittal document id, is_supplemental, supplements_production_id, notes  
6. `discovery_production_items` — production_id ↔ document_id / evidence_id / request_item_id (junction; matter+org composite FKs)  
7. `discovery_bates_ranges` — production_id, prefix, start, end, raw_text, provenance (nullable when no Bates)  
8. `discovery_custodians` — optional dedicated table **or** reuse matter entities with role; prefer entity link + `discovery_production_custodians` junction  
9. `discovery_deficiencies` — kind, status, item_id, production_id, description, opened_at, responsible party, communication_id, meet_and_confer_id, motion_id, is_review_signal  
10. `discovery_privilege_assertions` — status, basis, asserting party, document/evidence/production links, privilege_log_document_id, court_ruling_referenced boolean, review notes  
11. `discovery_meet_and_confer_issues` — label, occurred_at, communication_id, outcome notes; junction to deficiencies  

### Integrity rules

- Composite FKs: every child row `(id, matter_id)` / `(id, organization_id)` pattern matching civil claims  
- Deny linking a production document whose `matter_id` differs  
- Deny linking a motion/communication from another matter  
- Do **not** store autonomous sanctions or “is privileged” legal conclusions as derived booleans

### Migration risk

| Risk | Level | Mitigation |
|---|---|---|
| Additive tables/enums only | Low–Medium | No destructive alters |
| Enum extension on shared DB | Medium | Coordinate like `0020` / `0021`; Chat A stops |
| Graph enum expansion (separate) | Medium | See `DISCOVERY_GRAPH_SHARED_SCHEMA_REQUIRED` below |
| Backfill of existing Phase 5 review rows | Low | Leave Phase 5 as-is; link documents later |

**Suggested migration id (not created):** `0022_discovery_production_ledger`

## DISCOVERY_GRAPH_SHARED_SCHEMA_REQUIRED

Current `graph_node_type` (after `0021`) includes claim/defense but **not** discovery entities.

Minimal additive enum values:

- `discovery_request_set`
- `discovery_request_item`
- `discovery_response`
- `discovery_production`
- `discovery_deficiency`
- `privilege_assertion` (or reuse `other` only if product accepts weaker traversal — **not** recommended for L4)

Intended edges (after unlock; no duplicate canonical documents/parties):

- request_item → party  
- request_item → response  
- request_item → document / evidence  
- request_item → claim (optional later)  
- response → objection (edge metadata or child node)  
- response → production  
- production → document / custodian  
- deficiency → request_item / communication / motion  

**Not implemented in Chat A.**

## Prototype delivered (application layer)

- `packages/intelligence/src/discovery-ledger/*`  
- Deterministic fixture with RFP + ROGs, objections, partial + supplemental production, Bates overlap/gap signals, missing attachment, privilege assertion, meet-and-confer, motion-to-compel  
- Ask Nyaya discovery answer formatter (non-deciding)  
- D4 deepening assignments (10)

## Status

**DISCOVERY_SHARED_SCHEMA_REQUIRED**  
**DISCOVERY_GRAPH_SHARED_SCHEMA_REQUIRED**

Wait for coordinated shared schema approval before persistence, UI wiring to live DB, or graph materialization.
