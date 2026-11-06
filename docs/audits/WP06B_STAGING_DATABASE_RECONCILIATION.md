# WP-06B — Staging database identity & migration reconciliation

**Classification:** `NYAYAGRID_WP06B_STAGING_DATABASE_RECONCILIATION`  
**Branch:** `nyaya/integration-checkpoint`  
**Status:** PARTIAL (engineering complete; shared staging still blocked on operator attestation)

## 1. Database identity (non-SQL)

| Field                 | Evidence                                                    |
| --------------------- | ----------------------------------------------------------- |
| Neon project ID       | **UNVERIFIED** (Console attestation required)               |
| Neon branch ID        | **UNVERIFIED**                                              |
| Database name         | `neondb` (from URL pathname fingerprint)                    |
| Role                  | `nyaya_product_runtime_v3` (product-shaped; not `*corpus*`) |
| Endpoint              | `ep-lively-lake-auyeia5m-pooler` (hash `7d7cc2a736de`)      |
| Region hint           | `us-east-1`                                                 |
| `CORPUS_DATABASE_URL` | absent on Fly staging                                       |
| SQL inventory         | **not executed** (identity incomplete)                      |

**Verdict:** `STAGING_PRODUCT_DB_IDENTITY_UNVERIFIED`

Role + endpoint fingerprint lean product, but project/branch IDs are mandatory before any SQL or migrate.

## 2. Migration collision

See `docs/audits/WP06B_MIGRATION_COLLISION_MAP.md`.

## 3. Reconciliation implementation

- Additive migration **`0033_deepening_main_reconciliation`** (`when=1789100000000`)
- Fail-closed unless main contacts/folders/billing/memory/reviewable graph + isolation FKs present
- Allows Deepening additive markers to coexist
- Does not rewrite historical when/SQL

## 4. Migrate identity gates

`packages/database/src/migrate-identity.ts` + `migrate.ts`:

- `APP_ENV` required
- Staging/production: `EXPECTED_MIGRATE_DB_NAME`, Neon project/branch/endpoint binding, TLS, corpus role refusal, product≠corpus target, `MIGRATE_ALLOW_NEONDB_PRODUCT=1` for `neondb`
- Live `current_database()` must match expected name
- Unit tests: incorrect URL, missing identity, mismatched endpoint, wrong env

## 5. Disposable matrix

`node scripts/migration-safety/wp06b-matrix.mjs` — states A–E + fail-closed stub.

## 6. Preflight gates

`scripts/migration-safety/staging-product-db-preflight.mjs` requires all five:

1. `DATABASE_IDENTITY_VERIFIED`
2. `MIGRATION_HISTORY_RECONCILED`
3. `SCHEMA_COMPATIBLE`
4. `BACKUP_RESTORE_VERIFIED`
5. `STAGING_MIGRATION_AUTHORIZED` (requires `STAGING_MIGRATE_OPERATOR_APPROVAL=1`)

Preflight ≠ authorization to execute.

## 7. Backup

`docs/operations/WP06B_NEON_PITR_OPERATOR_CHECKLIST.md`

## 8. Remaining operator actions

1. Attest Neon project/branch/endpoint for product DB; set env gates on migrate job
2. Confirm product≠corpus isolation in Neon Console
3. Complete PITR history window + isolated restore drill; set `BACKUP_RESTORE_OPERATOR_VERIFIED=1`
4. After attested read-only inventory proving 0029–0033 path: set `MIGRATION_HISTORY_RECONCILED=1`
5. Sign WP06 migration runbook §0; set `STAGING_MIGRATE_OPERATOR_APPROVAL=1`
6. Coordinated deploy of Integration/main tip with migrate — not from disposable matrix alone

## FINAL RESULT

`STAGING_MIGRATION_PREFLIGHT_BLOCKED`
