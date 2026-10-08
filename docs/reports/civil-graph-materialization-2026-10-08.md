# Deepening Pass 3 — Civil Graph Materialization

**Date:** 2026-10-08  
**Branch:** `nyaya/full-completion-deepening-v2`  
**Classification:** `DEEPENING_PASS3_CIVIL_GRAPH_MATERIALIZATION`

## Branch update

| Item | Value |
|------|--------|
| Pre-merge A head | `6623e57` |
| Main integrated | `40bd6c2` |
| Merge result | `158e7a1` Integrate graph claim/defense schema into Deepening V2 |

## Graph schema

- Migration `0021_graph_claim_defense_node_types` present
- `claim` / `defense` valid `graph_node_type` values
- No additional shared migration required

## Materialization

Implemented in `packages/intelligence/src/civil/graph-materialize.ts` and hooked into `materializeVerifiedGraph` (dynamic import).

| Edge / node | Status |
|-------------|--------|
| CLAIM / DEFENSE nodes | YES |
| claim→party / element / evidence / fact / legal issue / authority / pleading | YES |
| defense→claim / evidence / authority / party | YES |
| Canonical parties/facts/documents reused | YES |
| Superseded / withdrawn / current metadata | YES (`currentness`) |
| Liability conclusions | NONE |

## Tests

| Suite | Result |
|-------|--------|
| Civil graph unit plan/traversal | PASS |
| Civil graph DB integration | PASS (local `localhost:5433/nyayagrid`) |
| D3 deepening | PASS (24/24) |
| Civil Ask | PASS |
| Ask suppression | PASS |
| Graph node-type contract | PASS |
| Authority hierarchy unit | PASS |
| Production build | PASS |

## Performance notes

- Civil tables loaded with batched `Promise.all` (no per-relation query loops)
- Edge upserts are dedupe-keyed; rematerialization merges rather than duplicates
- Free-text missing-evidence notes stored on parent metadata (no synthetic UUID nodes)

## Next action

Deepening Pass 4 objective selection / integration checkpoint (product owner).
