# PR #9 — Migration acceptance matrix (schema integrity)

**Classification:** `NYAYAGRID_PR09_0031_SCHEMA_INTEGRITY_REMEDIATION`  
**Command:** `node scripts/migration-safety/pr09-matrix.mjs`  
**Target:** disposable DBs on localhost Docker `localhost:5433` only  
**Evidence:** 2026-11-06 — exit 0, `cleanVsRepaired: parity`

| State                                          | Result   | Assertions                                                                          |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| **A** Fresh schema                             | **PASS** | Full migrate; catalog contract (FKs, CHECKs, indexes, columns)                      |
| **B** Fully migrated retry                     | **PASS** | Second migrate no-op; `journal_count=33`; contract intact                           |
| **C** Journaled stub graph repaired            | **PASS** | Stub while 0026/0030 journaled → 0031/0032 restore; **catalog parity with clean**   |
| **D** Populated legacy graph                   | **PASS** | Archives preserve 4 nodes / 2 edges incl. non-UUID; projections `proposed` only     |
| **E** Partially repaired (constraints dropped) | **PASS** | 0032 restores isolation + CHECK constraints; contract pass                          |
| **F** Cross-case / cross-office rejection      | **PASS** | DB rejects cross-case, cross-office, bad actor, invalid status/origin/kind          |
| **G** Retry + archive rename                   | **PASS** | Prior archive renamed (not overwritten); retry idempotent; no duplicate projections |

Contract helper: `scripts/migration-safety/graph-schema-contract.mjs`  
Static unit: `packages/database/src/prosecution-graph-schema-contract.test.ts`
