# PASS6_SHARED_SCHEMA_COORDINATION_REQUIRED — Motions + Communications

**Classification:** `DEEPENING_PASS6_MOTIONS_COMMUNICATIONS_ARCHITECTURE`  
**Date:** 2026-10-09  
**Branch:** `nyaya/full-completion-deepening-v2`  
**Certified tip at audit:** `b1d7ce373c7b7b97bbb9dbb82a7c259c17a8d8b4`  
**Stop reason:** L4 motion/communication workflows cannot persist without additive shared tables. Chat A does **not** create this migration.

## Why existing schema is insufficient

| Existing structure | Why it cannot replace Pass 6 |
|---|---|
| `discovery_deficiencies.motion_id` / `communication_id` | Opaque UUIDs; **no FK target**. Service requires `motionDocumentId` only as isolation proxy. |
| `discovery_meet_and_confer_issues.communication_id` | Opaque UUID; MAC issue is discovery-scoped, not a general correspondence record. |
| Derived `DiscoveryMotionLink` (adapter) | In-memory projection from deficiencies + document labels; not a first-class motion. |
| Graph motion materialization | Uses `document` nodes with `metadata.motionId`; no `motion` / `communication` node types. |
| `prosecution_motions` | Criminal-case scoped (`criminal_case_id`); not professional Matter workflow. |
| `inbound_emails` | Org inbox paste/file-to-matter; not typed matter correspondence with discovery/motion links. |
| `documents` / `civil_evidence_items` / `tasks` / `timeline_events` / `deadline_candidates` | Reusable targets — **not** motion/communication identity. |
| JSON blob on documents/tasks | Rejected: breaks joins, Ask provenance, tenant isolation, deficiency→motion integrity. |

`phase16.ts` explicitly documents the gap:

> `communication_id` / `motion_id` are opaque matter-scoped UUID refs until general communications/motions tables exist

## Reuse — do not recreate

- `documents`, `document_versions`
- `civil_evidence_items` (+ existing evidence junctions)
- `matter_entities` (parties / people)
- `civil_claims`, `civil_defenses`, claim/defense elements, `legal_issues`
- Discovery Pass 4 tables (`0022`): request sets/items, responses, productions, deficiencies, privilege assertions, meet-and-confer + deficiency links
- `tasks`, `timeline_events`, `deadline_candidates` (+ sources)
- `RecordProvenance` pattern from phase14/16
- Composite `(id, matter_id)` / `(id, organization_id)` isolation pattern from civil + discovery

## Minimal additive schema (Integration)

Suggested migration id (**not created here**): `0023_matter_motions_communications`

### Enums (text + check, or pgEnum — match discovery style)

`matter_motion_type` (extensible text preferred):

- `MOTION_TO_COMPEL` | `PROTECTIVE_ORDER` | `SANCTIONS` | `MOTION_TO_DISMISS` | `SUMMARY_JUDGMENT` | `MOTION_IN_LIMINE` | `MOTION_TO_EXCLUDE` | `MOTION_TO_STRIKE` | `RECONSIDERATION` | `DISCOVERY` | `PROCEDURAL` | `OTHER`

`matter_motion_status` (lifecycle labels; not a forced jurisdiction sequence):

- `DRAFT` | `PLANNED` | `FILED` | `SERVED` | `OPPOSITION_DUE` | `OPPOSITION_FILED` | `REPLY_DUE` | `REPLY_FILED` | `HEARING_SCHEDULED` | `SUBMITTED` | `GRANTED` | `DENIED` | `GRANTED_IN_PART` | `WITHDRAWN` | `MOOT` | `OTHER` | `UNKNOWN`

`matter_motion_disposition` (nullable; only when source-backed):

- `GRANTED` | `DENIED` | `GRANTED_IN_PART` | `DENIED_IN_PART` | `WITHDRAWN` | `MOOT` | `OTHER` | `UNKNOWN`

`matter_communication_type`:

- `MEET_AND_CONFER` | `DEMAND` | `RESPONSE` | `FOLLOW_UP` | `DEFICIENCY_NOTICE` | `EXTENSION_REQUEST` | `STIPULATION_DISCUSSION` | `PRIVILEGE` | `OTHER_CORRESPONDENCE`

`matter_communication_direction`:

- `OUTBOUND` | `INBOUND` | `INTERNAL` | `UNKNOWN`

`matter_communication_status`:

- `DRAFT` | `SENT` | `RECEIVED` | `AWAITING_RESPONSE` | `CLOSED` | `UNKNOWN`

`matter_motion_document_role`:

- `MOTION` | `BRIEF` | `OPPOSITION` | `REPLY` | `DECLARATION` | `EXHIBIT` | `ORDER` | `TRANSCRIPT` | `OTHER`

### Tables

All rows: `organization_id`, `matter_id`, `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`, `provenance` (jsonb `RecordProvenance`).

#### 1. `matter_motions`

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `organization_id` | FK → organizations CASCADE |
| `matter_id` | FK → matters CASCADE |
| `motion_type` text NOT NULL | see enum list |
| `title` text NOT NULL | |
| `summary` text | |
| `status` text NOT NULL DEFAULT `DRAFT` | |
| `moving_party_entity_id` uuid NULL | FK → matter_entities SET NULL |
| `opposing_party_entity_id` uuid NULL | FK → matter_entities SET NULL |
| `filed_at` timestamptz NULL | no invented dates |
| `served_at` timestamptz NULL | |
| `opposition_due_at` timestamptz NULL | explicit only |
| `opposition_filed_at` timestamptz NULL | |
| `reply_due_at` timestamptz NULL | |
| `reply_filed_at` timestamptz NULL | |
| `hearing_at` timestamptz NULL | |
| `ruling_at` timestamptz NULL | |
| `disposition` text NULL | source-backed only |
| `ruling_summary` text NULL | factual summary; not predictive |
| `court_name` / `judge_name` text NULL | optional; prefer matter court metadata when present |
| `primary_document_id` uuid NULL | FK → documents SET NULL (motion paper) |
| `order_document_id` uuid NULL | FK → documents SET NULL |
| provenance + audit user cols + timestamps | |

Indexes / isolation:

- `UNIQUE (id, matter_id)`, `UNIQUE (id, organization_id)`
- `INDEX (organization_id, matter_id)`, `INDEX (matter_id, status)`, `INDEX (matter_id, motion_type)`, `INDEX (matter_id, hearing_at)`

#### 2. `matter_motion_documents`

Junction — reuse documents; do not duplicate blobs.

| Column | Notes |
|---|---|
| `id` | |
| `organization_id`, `matter_id` | |
| `motion_id` | FK → matter_motions CASCADE |
| `document_id` | FK → documents SET NULL/RESTRICT |
| `role` text NOT NULL | `matter_motion_document_role` |
| `sort_order` int DEFAULT 0 | |
| created_at | |

Unique: `(motion_id, document_id, role)`  
Composite isolation FKs for motion + document matter match (service-enforced if document.matter_id nullable).

#### 3. `matter_motion_links`

Typed links to civil/discovery/evidence without implying whole-claim disposition.

| Column | Notes |
|---|---|
| `id` | |
| `organization_id`, `matter_id` | |
| `motion_id` | FK → matter_motions |
| `link_type` text NOT NULL | `CLAIM` \| `DEFENSE` \| `CLAIM_ELEMENT` \| `DEFENSE_ELEMENT` \| `LEGAL_ISSUE` \| `DISCOVERY_REQUEST_ITEM` \| `DISCOVERY_DEFICIENCY` \| `PRIVILEGE_ASSERTION` \| `EVIDENCE` \| `COMMUNICATION` \| `TASK` \| `DEADLINE_CANDIDATE` |
| `target_id` uuid NOT NULL | target entity id |
| `note` text NULL | optional human note; not a conclusion |
| provenance + timestamps | |

Unique: `(motion_id, link_type, target_id)`  
Indexes: `(matter_id, link_type)`, `(target_id, link_type)`

Service validates target exists in same org/matter (pattern from discovery postgres services). Prefer composite FKs where tables expose `(id, matter_id)` unique indexes (claims, defenses, deficiencies, request items).

#### 4. `matter_communications`

| Column | Notes |
|---|---|
| `id` | |
| `organization_id`, `matter_id` | |
| `communication_type` text NOT NULL | |
| `direction` text NOT NULL DEFAULT `UNKNOWN` | |
| `status` text NOT NULL DEFAULT `DRAFT` | |
| `occurred_at` timestamptz NULL | |
| `subject` text NOT NULL | |
| `summary` text NULL | factual; no intent/credibility conclusions |
| `sender_entity_id` uuid NULL | FK → matter_entities |
| `recipient_entity_id` uuid NULL | FK → matter_entities |
| `primary_document_id` uuid NULL | FK → documents (letter/email PDF) |
| `inbound_email_id` uuid NULL | optional FK → inbound_emails SET NULL |
| `follow_up_needed` boolean NOT NULL DEFAULT false | |
| `follow_up_due_at` timestamptz NULL | explicit only |
| `follow_up_task_id` uuid NULL | FK → tasks SET NULL |
| provenance + audit + timestamps | |

Indexes: `(organization_id, matter_id)`, `(matter_id, occurred_at DESC)`, `(matter_id, communication_type)`, `(matter_id, follow_up_needed)`  
Unique: `(id, matter_id)`, `(id, organization_id)`

#### 5. `matter_communication_links`

| Column | Notes |
|---|---|
| `id` | |
| `organization_id`, `matter_id` | |
| `communication_id` | FK → matter_communications |
| `link_type` text NOT NULL | `DISCOVERY_REQUEST_ITEM` \| `DISCOVERY_RESPONSE` \| `DISCOVERY_DEFICIENCY` \| `MEET_AND_CONFER` \| `MOTION` \| `PRIVILEGE_ASSERTION` \| `CLAIM` \| `DEFENSE` \| `EVIDENCE` \| `DOCUMENT` \| `TASK` |
| `target_id` uuid NOT NULL | |
| `note` text NULL | |
| provenance + created_at | |

Unique: `(communication_id, link_type, target_id)`

#### 6. Discovery FK hardening (additive alters)

After parent tables exist:

- `discovery_deficiencies.motion_id` → FK `(motion_id, matter_id)` REFERENCES `matter_motions (id, matter_id)` ON DELETE SET NULL  
- `discovery_deficiencies.communication_id` → FK `(communication_id, matter_id)` REFERENCES `matter_communications (id, matter_id)` ON DELETE SET NULL  
- `discovery_meet_and_confer_issues.communication_id` → same communications FK  

Retain `motion_document_id` as convenience/primary paper pointer; canonical motion identity is `matter_motions.id`.

### Graph enum additions (same migration or paired `0023b`)

Add to `graph_node_type`:

- `motion`
- `communication`

(Optional later, not required for L4 MVP: `meet_and_confer` — can remain discovery issue node via deficiency/MAC edges.)

Edge relationship types remain free-text on `graph_edges.relationship_type` (no enum change required). Intended values after unlock:

- `relates_to_claim` / `relates_to_defense`
- `relates_to_discovery_request`
- `relates_to_deficiency`
- `supported_by_evidence`
- `has_document`
- `precedes_motion`
- `order_resolves_motion`
- `communication_relates_to_deficiency`

### Integrity / security rules

- All reads/writes: `organization_id` + `matter_id` + `requireMatterAccess`
- Deny cross-matter document/evidence/entity/claim/deficiency links
- `client_guest`: view if `matters.view` + matter membership; mutate only with existing edit/research capabilities (default: no)
- Never expose matter communications to Guide / Professor / unrelated workspaces
- Do not store “stonewalling”, outcome predictions, or judge-favor inferences
- Deadlines: persist only when explicit (user/court order/source); do not invent jurisdictional calculations

### Migration risk

| Risk | Level | Mitigation |
|---|---|---|
| Additive tables | Low–Medium | No destructive drops |
| FK backfill on opaque discovery UUIDs | Medium | NULLify orphan opaque ids that do not match new rows; fixture remaps in Chat A after unlock |
| `graph_node_type` enum extension | Medium | Coordinate like `0021`/`0022`; update `GRAPH_NODE_TYPES` + tests |
| Overlap with `prosecution_motions` | Low | Keep separate; do not merge criminal into matter_motions in this pass |

## Out of scope for this migration

- Full court CMS / e-filing
- Exhaustive 50-state motion ontology
- Autonomous deadline computation
- Email provider sync (inbound_emails remains optional link)
- Public Guide / Professor motion workspaces

## Chat A after Integration unlock

1. Domain services + isolation tests  
2. Wire discovery deficiency/MAC FKs to real entities  
3. Ask / Graph / Timeline / Tasks integration  
4. UI: Motions + Communications lists/detail  
5. D6 fixture + benchmarks + live cert under runtime lock  
