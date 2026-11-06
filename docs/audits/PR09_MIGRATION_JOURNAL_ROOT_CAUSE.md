# PR #9 — Migration journal / schema mismatch root cause

**Classification:** `NYAYAGRID_PR09_RELEASE_BLOCKER_REMEDIATION`  
**Evidence date:** 2026-11-06  
**Drizzle version in tree:** `drizzle-orm` pg-core migrator

## Mechanism (code evidence)

`node_modules/drizzle-orm/pg-core/dialect.js` `migrate()`:

1. Reads **only the latest** `__drizzle_migrations` row (`order by created_at desc limit 1`).
2. Applies a journal entry iff `last.created_at < migration.folderMillis` (`journal.when`).
3. Inserts `(hash, created_at=folderMillis)` after executing SQL split on `--> statement-breakpoint`.
4. **Never compares stored `hash` to the current SQL file** on later runs.

`node_modules/drizzle-orm/migrator.js` `readMigrationFiles()`:

- Splits SQL **only** on `--> statement-breakpoint`. Without breakpoints, the entire file is one `sql.raw` batch.

## How a DB can be “migrated” without expected objects

Observed on local Docker (`nyayagrid`) during POST_PR08:

| Symptom | Explanation |
|---------|-------------|
| Journal contains `when` for 0025/0027/0028/0026 but tables/columns missing or stub-shaped | SQL was edited/fixed **after** that `when` was first recorded. Re-running `migrate` skips those tags because `created_at < when` is false (equality). |
| 0026 stub (`node_type`/`ref_id`) remains while journal shows 0026 | Earlier 0026 used `CREATE IF NOT EXISTS` (no-op on stubs). Later DROP+CREATE rewrite kept the **same `when`**, so Drizzle never re-applied. |
| Multi-statement file without breakpoints | Driver may execute as a single simple query; combined with the when-gate, failed/partial first applications are not retried after file fixes. |

**Acceptance proof (disposable):** `scripts/migration-safety/pr09-matrix.mjs` state **C** — drop objects after migrate, re-migrate leaves them missing; applying `0029_repair_journaled_schema.sql` restores them.

## Mitigations in this PR

| Migration | Role |
|-----------|------|
| **0028** | Billing columns (`billable`, rates, totals) with statement-breakpoints |
| **0029** | Idempotent recreate of missing 0025/0027/0028 objects (`IF NOT EXISTS`) |
| **0030** | Re-run 0026 upgrade path (skip if `node_kind` present) |
| **0031** | Fail-closed column assertions; stub graph upgrade that **renames** prior archives instead of silent `DROP` overwrite; backfill legacy rows as **`proposed`** only |

## Deploy prerequisites

1. Run migrate through **0031** on every environment that may have journaled 0025–0030 without matching schema.
2. Do **not** assume re-running migrate alone repairs edited historical SQL for already-journaled `when` values.
3. After migrate, verify: `contacts`, `document_folders`, `prosecution_case_memories`, `time_entries.billable`, `prosecution_graph_nodes.node_kind`.
4. Rollback of 0026/0030/0031 is **not** data-safe for live reviewable graph/billing/contacts — documented as no-op downs.

## Shared / staging / production

Do not mutate shared databases from engineering workstations. Apply via controlled migrate job after PR merge approval.
