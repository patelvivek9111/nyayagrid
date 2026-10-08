# Graph claim/defense schema integration checkpoint — 2026-10-08

Classification: `GRAPH_SCHEMA_INTEGRATION_AND_MAIN_PROMOTION`

Additive `graph_node_type` values `claim` and `defense` were merged into `nyaya/integration-checkpoint` from the certified temporary schema branch and promoted to main after static certification. Civil graph materialization was not implemented. Production Neon was not modified. CourtListener was not used.

## Source

| Ref | SHA |
| --- | --- |
| Previous `origin/main` | `83d47643da41702ac612aa51ecb322237279b009` |
| Graph schema branch tip `origin/nyaya/tmp-graph-claim-defense-schema` | `3b385877d00159261f55d484bb7dc8dab5d3d558` |
| Integration merge | `c3e6a92f9ef6f6e578297d3f020500388869e4e0` |

## Migration

`0021_graph_claim_defense_node_types`

- Additive `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for `claim` and `defense`
- No destructive graph changes
- Local DB certification inherited from graph schema workstream report: `docs/reports/graph-claim-defense-schema-2026-10-08.md`
- Existing graph rows preserved (3291)
- claim insert/read PASS
- defense insert/read PASS
- invalid type rejected PASS
- Production Neon unmodified

This integration checkpoint did not re-apply 0021 (already certified locally).

## Diff review

Expected paths only:

- `packages/database/src/schema/index.ts`
- `packages/database/drizzle/0021_graph_claim_defense_node_types.sql`
- `packages/database/drizzle/0021_graph_claim_defense_node_types.down.sql`
- `packages/database/drizzle/meta/_journal.json`
- `packages/database/src/graph-node-type.test.ts`
- `packages/intelligence/src/graph/materialize.ts`
- `packages/intelligence/src/graph/graph-node-type.test.ts`
- graph schema certification report

No civil UI, search, corpus/CourtListener, lockfile, secrets, or production config changes.

## Static certification

| Gate | Result |
| --- | --- |
| database graph-node-type tests | PASS 4/4 |
| intelligence graph-node-type + review-queue graph | PASS 4/4 |
| database typecheck | PASS |
| production web build | PASS |
| intelligence full typecheck | Pre-existing civil `LIABLE` compare warning on certified main; not caused by this merge; not fixed here |

## Pending product work

- Chat A V2 civil graph materialization can proceed after this main promotion
- Temporary branch/worktree `nyaya/tmp-graph-claim-defense-schema` / `nyayagrid-graph-schema` remains until separate cleanup
