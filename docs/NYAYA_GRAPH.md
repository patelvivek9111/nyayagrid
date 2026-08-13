# Nyaya Graph

Nyaya Graph is the matter-scoped legal knowledge graph. It represents relationships between canonical NyayaGrid records.

## Node lifecycle

1. Verified Phase 3 entities/events/facts/deadlines (and documents/tasks) are materialized into `graph_nodes`.
2. Nodes reference existing records via `canonicalEntityType` + `canonicalEntityId`.
3. Deduplication is primarily by canonical reference within a matter.

## Edge lifecycle

1. Deterministic edges (for example event/fact/deadline `supported_by` document) are created as approved with provenance.
2. Optional AI relationship extraction creates `proposed` edges with validated chunk sources.
3. Humans approve, edit+approve, or reject proposed edges.
4. Manual edges may be created without document provenance but are labeled `origin=manual`.

## Provenance

AI/document-derived edges require validated matter-scoped chunk sources. Hallucinated IDs are rejected. Provenance is merged when duplicate edges are collapsed.

## UI

`/app/matters/[matterId]/graph` provides node search/filter, neighborhood exploration, evidence inspection, manual edges, and a relationship list fallback.
