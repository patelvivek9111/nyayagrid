# Motions + Communications Architecture

Durable architecture reference for professional Matter motions and communications.

Implementation: `packages/database/src/schema/phase17.ts`, migration `0023_matter_motions_communications.sql`. Related tests: `pass6-motions-communications-*.test.ts`, `motions-communications.integration.test.ts`.

## Purpose

Provide first-class, matter-scoped **motions** and **communications** so discovery and litigation workflows no longer rely on opaque UUID placeholders for `motion_id` / `communication_id`.

## Domain model

### Motion (`matter_motions`)

- Required: `organization_id`, `matter_id`, `motion_type`, `title`, `status`, `provenance`
- Optional parties: `moving_party_entity_id`, `opposing_party_entity_id` (`matter_entities`)
- Optional documents: `primary_document_id`, `order_document_id`
- Optional explicit timestamps only: filed/served/opposition/reply/hearing/ruling — **never** auto-computed jurisdictional deadlines
- Optional `disposition` / `ruling_summary` when source-backed
- Link tables: `matter_motion_documents` (role: motion/brief/opposition/reply/exhibit/order/…), `matter_motion_links` (discovery issues, claims, tasks, communications, etc.)

### Communication (`matter_communications`)

- Required: org + matter scope, type, `provenance`
- Chronology via `occurred_at` when known
- Optional follow-up flags and document/entity links
- Link table: `matter_communication_links`

### Graph

`graph_node_type` includes `motion` and `communication`. Edges may relate motions/communications to documents, claims, deficiencies, tasks, and each other. Edge provenance rules match the rest of Nyaya Graph.

## Security and scoping

| Control | Requirement |
| --- | --- |
| Org scope | Required on every row |
| Matter scope | Required on every row |
| RBAC | `requireMatterAccess` + capability gates |
| Client guest | Read with membership + `matters.view`; no default mutate |
| Cross-workspace | Never expose professional matter communications to Guide / Professor / other tenants |

## Ask / Timeline / Tasks behavior

- Pending motions, status, and disposition only from persisted fields
- Chains such as deficiency → meet-and-confer → motion only when linked in data
- Communication chronology from persisted communications
- Deadlines/hearings only when explicit/source-backed
- Abstain on invented rulings, deadlines, or communications

## Lawyer workflow (illustrative)

```
Claim / defense / discovery issue
→ deficiency
→ meet-and-confer communication(s)
→ motion (e.g. compel) + supporting documents
→ opposition / reply (explicit dates only)
→ hearing / order (if source-backed)
→ follow-up task/deadline (explicit only)
→ Ask / Graph / Timeline
```

Status labels are extensible; jurisdictions are not forced into one sequence.

## Non-goals

- Court CMS / e-filing integration
- Automatic deadline calculation from rules of court
- Outcome prediction
- Treating opaque discovery UUIDs as durable identity (hardened FKs target these tables)

## Related

- [`docs/DATA_MODEL.md`](../DATA_MODEL.md)
- [`docs/DISCOVERY_REVIEW.md`](../DISCOVERY_REVIEW.md)
- [`docs/NYAYA_GRAPH.md`](../NYAYA_GRAPH.md)
