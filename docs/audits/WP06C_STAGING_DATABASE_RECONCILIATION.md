# WP-06C — Live staging database reconciliation

**STATUS:** PARTIAL (engineering path proven; execute awaits operator approval)  
**CLASSIFICATION:** `NYAYAGRID_WP06C_STAGING_DATABASE_RECONCILIATION`  
**Branch:** `nyaya/integration-checkpoint`

## Verified staging identity

| Field              | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Neon project       | `nyayagrid-staging` / `odd-moon-90379900`                                  |
| Live branch        | `wp05-product-staging` / `br-fancy-king-auaii21k`                          |
| Fly endpoint       | `ep-lively-lake-auyeia5m` (pooler suffix on runtime URL)                   |
| Database           | `neondb`                                                                   |
| Runtime role (Fly) | `nyaya_product_runtime_v3`                                                 |
| PG                 | 18.6                                                                       |
| Corpus markers     | `legal_authorities` **absent** on product DB                               |
| Backup branch      | `wp06-pre-migration-backup` / `br-soft-star-au0por2i` (expires 2026-11-13) |

Autonomous Fly read-only inventory matched operator journal counts (19 / max `1788200000000` / 0 rows ≥ `1788300000000`).

## Actual migration baseline

Journal = **0000–0017 + 0024** (hashes match current SQL files).  
**Missing when:** `1787600000000`–`1788100000000` (**0018–0023 never applied**).  
**Not present:** Deepening/main collision millis `1788300000000`–`1788600000000`.

Public tables: **102**. Present: orgs/users/clients/matters/documents/invoices/time_entries/student/guide.  
**Missing:** `criminal_cases`, contacts/folders, prosecution memory/graph, discovery items.

Billing columns `billable` / invoice totals **absent** (need 0028/0029).

## Why naive migrate fails

`last.created_at = 1788200000000` ⇒ Drizzle skips 0018–0024, attempts **0025** → FK to missing `criminal_cases` → fail-closed.

## Migration sequence (forward-only)

1. **`0034_repair_skipped_week3_through_0023`** (`when=1788250000000`, journal slot **between 0024 and 0025**) — idempotent replay of 0018–0023
2. **0025–0028** — memories, graph upgrade, contacts/folders, billing
3. **0029–0032** — repairs + integrity
4. **0033** — Deepening↔main coexistence assert (no-op on this baseline; still required)

Do **not** rewrite historical when/SQL for 0018–0024.

## Disposable evidence

| Suite                          | Result                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `wp06c-matrix.mjs` A/B/C       | **PASS** — staging-shaped 19-row baseline → 0034→0033; retry; without 0034 fails |
| Seed preservation              | orgs/clients/matters preserved across migrate                                    |
| `pr09-matrix` / `wp06b-matrix` | re-run required on Integration tip after 0034                                    |

## Backup / recovery

- Backup branch exists (operator-created); identical journal snapshot reported.
- Creation ≠ certified restore drill.
- Rollback: freeze writes → connect/app point to `br-soft-star-au0por2i` or Neon Instant Restore within 24h window → integrity checks → re-attest identity → forward migrate only after gates.
- **Do not** delete/reset backup branch; **do not** reset live from parent casually.

## Staging execute env (operator)

```text
APP_ENV=staging
EXPECTED_MIGRATE_DB_NAME=neondb
EXPECTED_NEON_PROJECT_ID=odd-moon-90379900
EXPECTED_NEON_BRANCH_ID=br-fancy-king-auaii21k
EXPECTED_NEON_ENDPOINT_ID=ep-lively-lake-auyeia5m
MIGRATE_ALLOW_NEONDB_PRODUCT=1
```

## Remaining operator actions

1. Sign runbook §0 + set `STAGING_MIGRATE_OPERATOR_APPROVAL=1`
2. Confirm backup branch still present; optionally read-only validate backup endpoint
3. Set `BACKUP_RESTORE_OPERATOR_VERIFIED=1` after accepting recovery procedure
4. Deploy Integration tip **with** migrate job (coordinated)
5. Post-migrate: schema contract + `/api/health/ready`
6. Do not merge Integration wholesale into main — cherry-pick 0034+gates if promoting

## FINAL RESULT

`STAGING_MIGRATION_READY_FOR_OPERATOR_APPROVAL`
