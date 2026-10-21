# NyayaGrid Data Model

Schema lives in `@nyayagrid/database` (**Drizzle** TypeScript tables + SQL migrations under `packages/database/drizzle/`). Current migration tip includes `0024_citation_target_classification.sql`.

Identity providers authenticate. **NyayaGrid PostgreSQL tables authorize** (app-layer permissions + matter membership — not Postgres RLS).

## Tenancy

- `organizations` is the tenant boundary for professional data.
- Firm and solo lawyers share the same organization architecture (`type = firm | solo`).
- `memberships` bind `users` to organizations through `roles`.
- Capabilities are stored in `permissions` rows attached to roles.

## Matter authorization

- `matter_members` is deny-by-default access to a matter.
- Organization capability `matters.view` is required, and either:
  - `organization.manage`, or
  - an explicit `matter_members` row with sufficient access.

## Foundation and matter workflow

Core tables include: `users`, `organizations`, `memberships`, `roles`, `permissions`, `clients`, `contacts`, `matters`, `matter_members`, `documents`, `document_versions`, `document_chunks`, `notes`, `tasks`, `deadlines`, `timeline_events`, `conversations`, `messages`, `ai_jobs`, `ai_artifacts`, `citations`, `audit_events`, and related matter intelligence tables (facts, entities, deadlines with human review statuses).

## Nyaya Graph + Nyaya Memory

### Graph

- `graph_nodes` — matter-scoped nodes with canonical references to existing records
- `graph_edges` — relationships with origin/status/confidence
- `graph_edge_sources` — provenance for AI/document-derived edges
- `graph_materialization_runs` — idempotent materialization tracking

Prefer `canonicalEntityType` + `canonicalEntityId` over duplicating People/Documents (e.g. `matter_entity` / `timeline_event` / `document` / `task` / `motion` / `communication`).

### Memory

- `matter_memories` — durable curated matter knowledge (not chat history)
- Statuses: `proposed`, `approved`, `edited_and_approved`, `rejected`, `archived`, `superseded`
- Optional embeddings (`vector(384)`) scoped by organizationId + matterId
- `supersededBy` preserves history without destructive delete

## Nyaya Draft + professional analysis + discovery

Defined primarily in `packages/database/src/schema/phase5.ts` (and related) and re-exported from `@nyayagrid/database`.

### Nyaya Draft

- `drafts` — matter-scoped draft header
- `draft_versions` — append-only version history (`origin`: `manual` / `ai` / `ai_edited`); restoring creates a **new** version

### Contract analysis / comparison / findings

- `document_analyses`, `document_analysis_items`, `document_analysis_sources`, `redline_suggestions`
- `document_comparisons`, `document_comparison_changes`
- `analysis_runs`, `analysis_findings`, `analysis_finding_sources` (`runType` includes deposition, contradiction, etc.)

### Discovery review

- `document_review_states` — human fields vs `ai_*` proposal fields kept separate; privilege finals require `humanPrivilegeFinal`
- `matter_document_tags` / `document_tag_assignments`
- `document_duplicate_groups` / `document_duplicate_members`

## Nyaya Research

Shared corpus (not matter/org scoped):

- `legal_authorities`, `legal_authority_versions`, `legal_authority_chunks`, `legal_authority_citations`, `legal_authority_relationships`

Research workspace (organization/matter scoped):

- `research_sessions`, `research_queries`, `research_results`, `research_notes`, `research_artifacts`, `matter_authorities`

`research_artifacts.propositions` use `provenanceClass` `LEGAL_AUTHORITY` vs `FACT_SOURCE` — never merged on one entry. See [`NYAYA_RESEARCH.md`](./NYAYA_RESEARCH.md) and [`SECURITY.md`](./SECURITY.md).

## Nyaya Agents

- `agent_runs`, `agent_run_steps`, `agent_tool_calls`, `agent_artifacts`, `agent_approvals`

Every consequential write goes through approvals (`pending` → approve / edit+approve / reject). See [`NYAYA_AGENTS.md`](./NYAYA_AGENTS.md).

## Motions + communications

Defined in `packages/database/src/schema/phase17.ts`; migration `0023_matter_motions_communications.sql`.

- `matter_motions` — org + matter scoped; typed status/disposition; nullable explicit dates only; `provenance` required
- `matter_motion_documents`, `matter_motion_links`
- `matter_communications`, `matter_communication_links`
- Graph node types include `motion` and `communication`

No automatic jurisdictional deadline inference. No court CMS / e-filing fields. See the durable architecture note under `docs/reports/deepening-pass6-motions-communications-architecture-2026-10-09.md`.

## Nyaya Professor + Nyaya Guide

User-scoped tables only (no `organizationId` / `matterId` on Professor/Guide entities). Shared non-confidential `legal_authorities*` corpus is the deliberate cross-workspace exception.

Professor: `student_*` cases, chunks, briefs, comparisons, conversations.
Guide: `guide_*` documents, situations, consultation packets, conversations.

Provenance classes stay separated (uploaded case/document vs legal authority vs explanation). See [`NYAYA_PROFESSOR.md`](./NYAYA_PROFESSOR.md) and [`NYAYA_GUIDE.md`](./NYAYA_GUIDE.md).

## Legal hold / lifecycle

- `legal_holds` — org / matter / document scope; active hold blocks irreversible deletion
- `data_deletion_requests` — intent only; never silent purge of originals under hold

See [`RETENTION_AND_LEGAL_HOLD.md`](./RETENTION_AND_LEGAL_HOLD.md) and [`USER_LIFECYCLE.md`](./USER_LIFECYCLE.md).
