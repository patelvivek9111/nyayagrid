# PR #9 — Migration acceptance matrix

**Classification:** `NYAYAGRID_PR09_RELEASE_BLOCKER_REMEDIATION`  
**Command:** `node scripts/migration-safety/pr09-matrix.mjs`  
**Target:** disposable DBs on localhost Docker `localhost:5433` only  
**Evidence time:** 2026-11-06T02:28:58Z (exit 0)

| State                                                      | Result   | Assertions                                                                             |
| ---------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| **A** Fresh schema                                         | **PASS** | Full migrate creates billing/contacts/graph/memory shapes                              |
| **B** Fully migrated retry                                 | **PASS** | Second migrate no-op; `journal_count=32`                                               |
| **C** Journaled 0025/0027/0028 with missing objects        | **PASS** | Re-migrate leaves objects missing (Drizzle when-gate); `0029` SQL restore succeeds     |
| **D** Partial schema (missing required column)             | **PASS** | Fail-closed: assertion raises when required billing column missing                     |
| **E** Populated contacts/documents/folders/invoices/Memory | **PASS** | Data preserved (`contacts=1`, invoice id retained, `memory=1`, folder id retained)     |
| **G** Stub graph → reviewable upgrade                      | **PASS** | Archive preserved; projected legacy edge/node as `proposed` (`archive_ok projected=1`) |

Empty-DB smoke alone is **not** treated as data-preservation proof. State **E** and **G** cover populated fixtures.

Rollback of 0026/0030/0031 downs remain documented no-ops (not data-safe reverse).
