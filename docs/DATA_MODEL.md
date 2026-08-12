# NyayaGrid Data Model

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

## Phase 1–3 tables

See prior phases for foundation, matter workflow, and matter intelligence tables.

## Phase 4 tables (Nyaya Graph + Nyaya Memory)

### Graph

- `graph_nodes` — matter-scoped nodes with canonical references to existing records
- `graph_edges` — relationships with origin/status/confidence
- `graph_edge_sources` — provenance for AI/document-derived edges
- `graph_materialization_runs` — idempotent materialization tracking

Canonical reference pattern:

- Prefer `canonicalEntityType` + `canonicalEntityId` over duplicating People/Documents.
- Example: `matter_entity` / `timeline_event` / `document` / `task`

### Memory

- `matter_memories` — durable curated matter knowledge (not chat history)
- Statuses: `proposed`, `approved`, `edited_and_approved`, `rejected`, `archived`, `superseded`
- Optional embeddings (`vector(384)`) scoped by organizationId + matterId
- `supersededBy` preserves history without destructive delete

## Phase 5 tables (Nyaya Draft + Professional Analysis + Discovery)

Defined in `packages/database/src/schema/phase5.ts` and re-exported from the package root
(`@nyayagrid/database`) rather than from `schema/index.ts`, to avoid a circular import
(`phase5.ts` imports base tables/enums from `schema/index.ts`).

### Nyaya Draft

- `drafts` — matter-scoped draft header (title, `draftType`, `status`, `currentVersionNumber`, `aiGenerated`, `sourceContext`)
- `draft_versions` — append-only version history; `origin` is `manual` / `ai` / `ai_edited`; `sourceAssertions` is a JSON array of `{text, chunkIds}` grounded to authorized chunks
- Restoring an older version creates a **new** version (never rewrites history)

### Contract analysis

- `document_analyses` — one row per document version analysis run (`analysisType`, idempotency key `contract_analysis:{documentVersionId}`)
- `document_analysis_items` — individual clause/risk findings (`category`, `attention`, `status: proposed|reviewed|dismissed`)
- `document_analysis_sources` — chunk-level provenance per item (unique per item+chunk)
- `redline_suggestions` — proposed clause edits (`status: proposed|accepted|rejected`); accepting a suggestion never mutates the underlying `document_versions` row

### Document comparison

- `document_comparisons` — pairwise version comparison (`documentAId/documentAVersionId` vs `documentBId/documentBVersionId`), idempotency key sorts both version IDs so `(A,B)` and `(B,A)` resolve to the same comparison
- `document_comparison_changes` — deterministic paragraph-level diff entries (`changeType`, `attention`)

### Deposition, contradiction, and other analytical findings

- `analysis_runs` — generic run header shared by `deposition | contradiction | evidence | document_review | discovery | comparison` run types, each with its own idempotency key
- `analysis_findings` — findings with `findingType`, `confidence`, `attention`, `status: proposed|reviewed|dismissed`, `reviewNote`
- `analysis_finding_sources` — chunk provenance; `side` (`A`/`B`) distinguishes the two sides of a contradiction

### Discovery / e-discovery review

- `document_review_states` — one row per document with **human** fields (`relevance`, `privilege`, `responsiveness`, `confidentiality`, `important`, `humanPrivilegeFinal`) kept separate from **AI proposal** fields (`aiRelevance`, `aiPrivilege`, `aiResponsiveness`, `aiProposalNote`)
- `matter_document_tags` / `document_tag_assignments` — matter-scoped free-form tagging
- `document_duplicate_groups` / `document_duplicate_members` — exact (`sha256`) and near (`groupType: exact_hash|near_excerpt`) duplicate grouping; membership is additive and never deletes a document

## Phase 6 tables (Nyaya Research)

Defined in `packages/database/src/schema/phase6.ts` and re-exported from the package root, following
the same pattern as `phase5.ts`.

### Shared legal authority corpus (not matter/org scoped)

- `legal_authorities` — one row per case/statute/regulation/etc. Deliberately has **no**
  `organizationId`/`matterId`: authorities are shared reference material and must never be mixed
  with confidential matter data. Unique on `(sourceProvider, sourceExternalId)` when both are set.
  `ingestionStatus: pending|processing|ready|failed`; only `ready` authorities are searched by
  default. `treatmentStatus: unknown|source_reported` (see `SECURITY.md`).
- `legal_authority_versions` — append-only text per authority (`versionNumber`, `sha256`,
  `validFrom`/`validTo`). Re-importing identical content is a no-op; changed content closes the
  previous version's `validTo` and inserts a new version. Old versions are **never** deleted or
  overwritten, so citation-to-superseded-text remains reconstructable.
- `legal_authority_chunks` — retrieval unit tied to one `authorityVersionId`, with `embedding
vector(384)`, `opinionPart` (`majority|concurrence|dissent`, cases only), `sectionRef`/
  `subsectionRef` (statutes), and page/segment/char provenance. Search only reads chunks whose
  parent version has `validTo IS NULL` by default.
- `legal_authority_citations` — outbound citations parsed from authority text (`rawCitation`
  always kept; `toAuthorityId` stays `null` unless resolution to the corpus was unambiguous).
- `legal_authority_relationships` — cites/interprets/supersedes/amends/related edges between
  authorities; `origin: parsed|reviewed|source_metadata` records how the edge was established.

### Research workspace (organization/matter scoped)

- `research_sessions` — organization-scoped (optionally matter-scoped) container for a line of
  research; carries `jurisdictionFilters`/`authorityTypeFilters` applied to subsequent queries.
- `research_queries` — one row per question asked inside a session (`queryText`, `filters`).
- `research_results` — ranked authority chunk hits per query (`authorityId`, `authorityVersionId`,
  `chunkId`, `score`, `rank`); always points into the authority corpus, never `document_chunks`.
- `research_notes` — attorney or AI notes (`origin: manual|ai`), optionally attached to a session,
  matter, and/or authority/chunk.
- `research_artifacts` — persisted output of a synthesis or memo run (`artifactType:
synthesis|memo|authority_summary|contrary_search`), including `propositions` (see below),
  `supportingAuthorities`, `contraryAuthorities`, `coverageWarnings`, and prompt/provider/model
  metadata for traceability.
- `matter_authorities` — join table linking a matter to a corpus authority (`status:
saved|key_authority|rejected|not_relevant`, unique per `(matterId, authorityId)`). This is the
  **only** place a matter and an authority are associated; the authority row itself never gains a
  `matterId`.

### Provenance classes on `research_artifacts.propositions`

Each `ResearchProposition` carries a `provenanceClass`:

- `LEGAL_AUTHORITY` — `authorityIds`/`chunkIds` point into the shared corpus tables above.
- `FACT_SOURCE` — `matterChunkIds` point into confidential `document_chunks`; `authorityIds` is
  always empty on these entries.

The two are never merged into one entry — see `NYAYA_RESEARCH.md` and `SECURITY.md`.

## Phase 7 tables (Nyaya Agents)

Defined in `packages/database/src/schema/phase7.ts` and re-exported from the package root,
following the same pattern as `phase5.ts`/`phase6.ts`. Every table is organization-scoped
(`matterId` optional, since a pure research run has no matter) and references `agent_runs` with
`onDelete: "cascade"`, so deleting a run deletes its steps, tool calls, artifacts, and approvals.

- `agent_runs` — one row per orchestrated goal. `plan` (`jsonb`) is the persisted, validated step
  list produced by the planner at creation time — never regenerated implicitly. `budgets` defaults
  to `{}`; readers fall back to `DEFAULT_BUDGETS` for any missing field, so an old run created
  before a budget field existed still resolves sane values. `status` enum:
  `planned | awaiting_approval | running | completed | partially_completed | failed | cancelled`.
- `agent_run_steps` — one row per plan step. `stepId` (text) is the plan-stable identifier used for
  `dependencies`; the uuid `id` is the database identity used by `agent_tool_calls`/`agent_artifacts`.
  `requiredTools` is the step's tool allow-list as authored by the plan, intersected at execution
  time with the executing agent's own `allowedTools` (see `NYAYA_AGENTS.md`). `status` enum:
  `pending | running | completed | failed | skipped | awaiting_approval | cancelled`.
  `errorCode`/`errorMessage` distinguish `dependency_unsatisfied` / `budget_exhausted` / `timeout` /
  `tool_not_allowed` / `authorization` / `unknown_agent_type` / `step_error` failure classes.
- `agent_tool_calls` — audit trail of every tool invocation attempt, including denied ones.
  `authorizationScope` records the capability/matter/role that was checked, `resourceIds` records
  which resources were touched — never document bodies, model prompts, or retrieved text.
  `status: pending | running | completed | failed | denied`.
- `agent_artifacts` — one row per step's output. `contentRef` points at the canonical domain record
  (draft id, research artifact id, contract analysis id, etc.) instead of duplicating its body.
  `provenance` (`AgentProvenanceEntry[]`) and `sources` record what the output is grounded in;
  `actionProposals` mirrors any `agent_approvals` rows the step's output produced.
- `agent_approvals` — the human-in-the-loop gate. Every proposed action (`CREATE_TASK`,
  `SAVE_MEMORY`, `SAVE_AUTHORITY`, `CREATE_DRAFT`, `PROPOSE_TIMELINE_EVENT`,
  `ADD_GRAPH_RELATIONSHIP`, `OTHER`) is written `pending`, including low-risk ones — nothing is
  auto-approved by the orchestrator. `status: pending | approved | edited_and_approved | rejected`.

### Provenance classes on agent artifacts

`AgentProvenanceEntry.class` reuses the same enum as Phase 6/7 artifacts:
`MATTER_EVIDENCE | VERIFIED_MATTER_INTELLIGENCE | GRAPH_RELATIONSHIP | MATTER_MEMORY |
LEGAL_AUTHORITY | USER_INSTRUCTION`. A single artifact may carry several entries with different
classes (e.g. an evidence-gathering step's output can cite both `MATTER_EVIDENCE` chunks and
`VERIFIED_MATTER_INTELLIGENCE` timeline facts), but any one entry's `refs` always resolve inside
exactly one of those source tables — see `NYAYA_AGENTS.md` and `SECURITY.md`.

## Phase 8 tables (Nyaya Professor + Nyaya Guide)

Defined in `packages/database/src/schema/phase8.ts` and re-exported from the package root,
following the same pattern as `phase5.ts`/`phase6.ts`/`phase7.ts`. Every table in this file is
scoped by `userId` alone — there is deliberately no `organizationId` and no `matterId` column
anywhere, and no table joins against a Professional matter table or the other workspace's tables.
The shared `legal_authorities*` corpus (Phase 6) is the one deliberate cross-workspace exception,
since it is non-confidential reference material rather than another tenant's data.

### Nyaya Professor (Student Workspace)

- `student_conversations` / `student_messages` — one student's Q&A history. `sources`
  (`StudentSourceRef[]`) tags every citation with a `provenance` of `UPLOADED_CASE`,
  `LEGAL_AUTHORITY`, or `PROFESSOR_EXPLANATION` — never merged onto one entry.
- `student_cases` — an uploaded/pasted judicial opinion. Unique on `(userId, sha256)`; re-uploading
  identical text is a no-op.
- `student_case_versions` — append-only case text; a changed re-upload creates a new version.
- `student_case_chunks` — retrieval/embedding unit, tagged `opinionPart`
  (`majority | concurrence | dissent | null`) only when the source text itself labels a separate
  opinion (`detectOpinionPartHeading`) — never guessed.
- `student_case_briefs` — one persisted brief per case version (unique on `caseVersionId`,
  `onConflictDoUpdate`), with `sectionSources` (`StudentSectionSources`) recording which chunk(s)
  and verbatim quote back each section.
- `student_case_comparisons` — a comparison between two of a student's own cases; `tensions` only
  ever contains differences supported by passages from **both** cases.
- `student_saved_items` — a student's personal library (`explanation | case_brief | authority |
case_comparison`).

### Nyaya Guide (Public Workspace)

- `guide_conversations` / `guide_messages` — one user's Q&A history. `cautionLevel: standard |
elevated` flags a message answered under a deterministically-detected high-stakes situation.
  `sources` (`GuideSourceRef[]`) uses `provenance: user_provided | document_extracted |
legal_authority | guide_explanation`.
- `guide_documents` / `guide_document_versions` / `guide_document_chunks` — an uploaded document
  (`documentKind: lease | employment | court_notice | demand | settlement | other`). Unique on
  `(userId, sha256)`.
- `guide_document_explanations` — a persisted plain-language explanation, including `explicitDates`
  (`GuideExplicitDate[]`) — every entry's `rawText` is a verbatim quote from the document and
  `isoDate` is only ever a re-rendering of that same text, never a computed/inferred date.
- `guide_situations` — an ongoing matter the user describes (jurisdiction, issue category, desired
  outcome).
- `guide_situation_events` — a timeline entry; `sourceLabel` defaults to `user_provided` and every
  write path stamps it that way — Guide never inserts a fabricated event.
- `guide_situation_documents` — links an uploaded document to a situation.
- `guide_consultation_packets` — a persisted packet organizing a situation for a lawyer
  consultation; always carries a limitation that it reaches no legal conclusion.

### Provenance classes

Both workspaces keep their citation provenance in clearly separated classes, mirroring the Phase
6/7 pattern:

- Professor's `StudentSourceRef.provenance`: `UPLOADED_CASE | LEGAL_AUTHORITY |
PROFESSOR_EXPLANATION`.
- Guide's `GuideSourceRef.provenance`: `user_provided | document_extracted | legal_authority |
guide_explanation`.

Neither workspace's answer validation ever merges a citation from the shared authority corpus with
a citation from the user's own uploaded case/document on a single source entry — see
`NYAYA_PROFESSOR.md`, `NYAYA_GUIDE.md`, and `SECURITY.md`.

## Authorization rule

Identity providers authenticate. NyayaGrid PostgreSQL tables authorize.
