# Graph claim/defense node-type schema certification — 2026-10-08

Classification: `GRAPH_SCHEMA_CERTIFIED_READY_FOR_INTEGRATION`

Additive shared schema change only. No civil graph materialization. No Chat A product code. No production Neon apply. No CourtListener.

## Source

| Ref | SHA |
| --- | --- |
| Base `origin/main` | `83d47643da41702ac612aa51ecb322237279b009` |
| Schema commit | `743b31db5e566d95f9d5987fac340f1434a73e46` |
| Branch | `nyaya/tmp-graph-claim-defense-schema` |
| Worktree | `C:\Users\patel\Documents\nyayagrid-graph-schema` |

## Migration

Name: `0021_graph_claim_defense_node_types`

SQL:

```sql
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'claim';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'defense';
```

Additive only. No table recreate. No data rewrite.

Rollback limitation: PostgreSQL cannot safely drop enum values; down file documents coordinated recreate if ever required before claim/defense rows exist.

Local apply target: `postgresql://nyayagrid:***@localhost:5433/nyayagrid` only.

Local apply result: PASS

Production Neon modified: NO

## Shared contracts Chat A can use

Canonical TypeScript source:

- `GRAPH_NODE_TYPES`
- `GraphNodeType`
- `isGraphNodeType(value)`
- `graphNodeTypeEnum`

Location: `packages/database/src/schema/index.ts` (exported via `@nyayagrid/database`)

Graph upsert contract:

- `CanonicalRef.nodeType: GraphNodeType` in `packages/intelligence/src/graph/materialize.ts`
- `upsertGraphNode(...)` accepts `nodeType: "claim" | "defense"` among existing values

Accepted enum labels after migration:

`person`, `organization`, `client`, `document`, `event`, `fact`, `deadline`, `task`, `matter`, `other`, `claim`, `defense`

Civil graph materialization can proceed without another node-type schema change.

## Local DB certification

| Check | Result |
| --- | --- |
| Enum contains claim/defense | PASS |
| Legacy enum values preserved | PASS |
| Existing graph rows readable | PASS (3291 rows before/after) |
| claim insert/read | PASS |
| defense insert/read | PASS |
| invalid type `liability` rejected | PASS |
| Certification rows cleaned up; count restored | PASS |

## Static gates

| Gate | Result |
| --- | --- |
| database graph-node-type unit tests | PASS |
| intelligence graph-node-type unit tests | PASS |
| review-queue graph contract tests | PASS |
| case-intelligence UX filter tests | PASS (unchanged product mapping; claim/defense fall through to `other`) |
| database typecheck | PASS |
| production web build | PASS |
| intelligence typecheck | Pre-existing civil `LIABLE` compare error on certified main; unrelated to this change |

## Exhaustive mapping audit

- `graphNodeFilterType` / `nodeFill`: non-exhaustive string maps; claim/defense safely fall through to neutral defaults. No Chat A UI change required for schema readiness.
- Prosecution graph uses separate `text` node_type column; untouched.

## P1 follow-ups

- Integrate this branch to main / integration checkpoint
- Chat A civil graph materialization after integration
- Optional dedicated UI filter buckets for claim/defense later
