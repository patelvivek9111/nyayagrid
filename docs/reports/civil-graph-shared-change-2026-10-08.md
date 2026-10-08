# GRAPH_SHARED_SCHEMA_CHANGE_REQUIRED — Civil Claim / Defense Nodes

**Classification:** `DEEPENING_PASS3_CIVIL_PRODUCTION`  
**Date:** 2026-10-08  
**Branch:** `nyaya/full-completion-deepening-v2`

## Finding

Claim and defense graph materialization is **blocked** pending a shared database enum migration.

Current `graph_node_type` enum (`packages/database/drizzle/0003_phase4_graph_memory.sql` / `graphNodeTypeEnum` in `packages/database/src/schema/index.ts`) includes only:

- person
- organization
- client
- document
- event
- fact
- deadline
- task
- matter
- other

It does **not** include `claim` or `defense`.

Civil persistence already exists in migration `0020_civil_claims` (`civil_claims`, `civil_defenses`, relations). Canonical evidence/authority records must not be duplicated into parallel stores.

## Minimal proposed shared change

1. Additive Postgres enum values (non-destructive):
   - `ALTER TYPE graph_node_type ADD VALUE IF NOT EXISTS 'claim';`
   - `ALTER TYPE graph_node_type ADD VALUE IF NOT EXISTS 'defense';`
2. Mirror values in `graphNodeTypeEnum` Drizzle definition.
3. Optional later (not required for enum unlock): additive `graph_edge_type` values for `applies_to`, `supports`, `undermines`, `pled_in` if existing edge types cannot express claim/defense traversal safely.

## Intended edges after unlock (no duplicate canonical records)

- claim → party (matter entity)
- claim → element (civil_claim_elements id as node metadata or typed edge target)
- claim → evidence (civil_evidence_items / documents)
- claim → fact (matter_facts)
- claim → legal issue
- claim → authority (legal_authorities)
- claim → pleading
- defense → claim
- defense → evidence
- defense → authority

## Decision

**Not implemented in this Pass 3 production continuation.**  
Shared enum migration requires explicit cross-chat schema approval.

**Status:** `GRAPH_SHARED_SCHEMA_CHANGE_REQUIRED`
