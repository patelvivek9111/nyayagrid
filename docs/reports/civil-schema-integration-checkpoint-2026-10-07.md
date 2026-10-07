# Civil claims schema integration checkpoint — 2026-10-07

Classification: `CIVIL_SCHEMA_INTEGRATION_CERTIFIED`

Main promotion: `READY_FOR_MAIN_PROMOTION`

Additive civil claims / defenses / counterclaims persistence was merged into `nyaya/integration-checkpoint`, validated on local Postgres only, and certified. Production Neon was not modified. CourtListener was not used. `main` was not pushed.

## Source state

| Ref | SHA |
| --- | --- |
| `origin/main` (pre-promotion baseline) | `f28e94953e576731fb59bd51f1ae1f89e61202c9` |
| Schema branch `origin/nyaya/civil-claims-schema` | `d6f3aaeaf55c899b4d6066df0ab9d1b9f62c61a0` |
| Integration merge | `eb95c10e5cd498a4e50e30ee49962d246fa94fee` |
| Week 7 RC `rc-week7-2026-10-06` | `49a8026fa4161635f269339622c045a3936ba28c` |
| Deepening Pass 2 RC `rc-deepening-pass2-2026-10-06` | `f28e94953e576731fb59bd51f1ae1f89e61202c9` |

Original dirty checkout `C:\Users\patel\Documents\nyayagrid` was not modified (remained on local `main` @ `8c823dc` with 393 dirty entries).

## Merge

Non-fast-forward merge message: `Integrate civil claims persistence schema`

Conflicts: none

Changed paths (19): expected civil-schema work only.

- `packages/database/drizzle/0020_civil_claims.sql`
- `packages/database/drizzle/0020_civil_claims.down.sql`
- `packages/database/drizzle/meta/_journal.json`
- `packages/database/src/schema/phase15.ts`
- `packages/database/src/index.ts`
- `packages/intelligence/src/civil/**`
- `packages/intelligence/src/index.ts`
- `benchmarks/nyaya-bench/datasets/deepening/catalog.ts`
- `benchmarks/nyaya-bench/runner/deepening.ts`
- `benchmarks/nyaya-bench/tests/deepening.test.ts`

Unexpected files: none

No CourtListener key, Neon credentials, lockfile drift, product UI expansion, or corpus modifications.

## Migration 0020

File: `packages/database/drizzle/0020_civil_claims.sql`

Additive review: PASS

- New `civil_*` tables for pleadings, claims, parties, defenses, elements, evidence, and relation tables
- Supporting unique indexes on `matters`, `matter_entities`, and `matter_facts` for composite FKs
- Isolation indexes on organization/matter and current-row filters
- CHECK constraint blocks liability statuses (`WIN` / `LOSE` / `LIABLE` / `NOT_LIABLE` / `LIKELY_WIN`)
- Down migration drops only `civil_*` tables
- No destructive rewrite of prosecution or existing law-firm tables

Local apply target: `postgresql://nyayagrid:***@localhost:5433/nyayagrid` only

`npm run db:migrate` result: PASS (migrations applied; TLS off for localhost)

Post-apply existing data remained accessible:

| Table / metric | Count after migrate |
| --- | --- |
| organizations | 508 |
| matters | 1538 |
| criminal_cases | 27 |
| civil tables present | 13 |

Production Neon modified?: NO

## Shared runtime validation

```
SHARED_RUNTIME_LOCK_HELD
workstream: CIVIL SCHEMA INTEGRATION
operation: apply/test migration 0020 and run civil DB integration tests
services: local Postgres localhost:5433/nyayagrid
courtListener: none
neonWrites: none
result: PASS
```

Chat A V2 and Chat B V2 confirmed stopped before mutable DB work.

## Security / isolation (RUN_DB_TESTS=1)

`packages/intelligence/src/civil/civil.integration.test.ts` — 7/7 PASS

| Gate | Result |
| --- | --- |
| Civil tables and isolation indexes | PASS |
| Cross-org denial | PASS |
| Cross-matter denial | PASS |
| client_guest mutation denial | PASS |
| Claim-party / multi-party scope | PASS |
| Evidence relation matter isolation | PASS |
| Fact / legal-issue / authority relation isolation | PASS |
| Liability status rejection at DB | PASS |

## Civil functional validation

From database-backed records:

| Capability | Result |
| --- | --- |
| Claim persistence | PASS |
| Counterclaim persistence | PASS |
| Defense persistence | PASS |
| Elements | PASS |
| Multi-party roles | PASS |
| Shared and claim-specific evidence | PASS |
| Fact / legal-issue / authority links | PASS |
| Pleading supersession | PASS |
| Claim supersession | PASS |
| Current-only query behavior | PASS |
| Liability / win-loss conclusion field | MUST = NO (null / CHECK-blocked) |

## Deterministic regressions

| Gate | Result |
| --- | --- |
| D3 civil benchmark | PASS 7/7 |
| Deepening Pass 1 | PASS |
| Deepening Pass 2 | PASS |
| Full deepening bench | PASS 19/19 |
| Civil unit (`claims-model`, `civil-schema`, `certification`) | PASS |
| Week 5 | PASS (`WEEK5_PASS_OPEN_WEEK6`, critical 0, high 0) |
| Week 7 | PASS (`WEEK7_PASS_READY_FOR_FINAL_CERTIFICATION`) |
| Prosecution unit | PASS |
| Law-firm / D1-LF | PASS |
| Production web build | PASS |

Expected answers were not edited to pass.

## Known P1 / next items

- Claims / Claim Matrix UI
- Ask Nyaya civil wiring in product surfaces
- Graph claim/defense nodes
- Production migration deployment of 0020 later (not part of this checkpoint)
- Live Neon corpus health remains a separate corpus concern

## Tag and push

Suggested tag: `rc-civil-schema-2026-10-07`

Do not move `rc-week7-2026-10-06` or `rc-deepening-pass2-2026-10-06`.

Push only `nyaya/integration-checkpoint` and the new tag. Do not push `main`.

After main promotion, update Chat A V2 / Chat B V2 from the new main before civil product UI work continues.
