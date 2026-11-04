# WP-05 — Product / Legal Corpus Database Isolation

**Status:** OPEN production release blocker  
**Neon project:** `nyayagrid-staging` (`odd-moon-90379900`)  
**Observed shared target:** branch `production` / DB `neondb` (pooler `ep-jolly-brook-auhdpay3-pooler…`)

## Finding

Staging product `DATABASE_URL` and the legal corpus currently resolve to the **same Neon project, branch, and database**. Separate env var names (`DATABASE_URL` vs `CORPUS_DATABASE_URL`) do **not** provide physical isolation when both point at `neondb`.

## Ownership

| Domain | Tables (representative) | Migrator | Runtime write |
| ------ | ----------------------- | -------- | ------------- |
| Product | `organizations`, `matters`, `documents`, `criminal_cases`, `audit_events`, … | `npm run db:migrate` with `ALLOW_DATABASE_MIGRATE` + expected host/name | App roles |
| Legal corpus | `legal_authorities`, `legal_authority_chunks`, `legal_authority_versions`, `legal_authority_citations` | **Forbidden** via product migrator (`MIGRATE_TARGET_IS_CORPUS` / `MIGRATE_LEGAL_CORPUS`) | Import/workers only; research must be SELECT-only |

## Engineering already in place

- Fail-closed migrate authorization (`packages/database/src/migrate-authorization.ts`)
- Isolation evaluator (`packages/database/src/product-corpus-isolation.ts`)
- Deploy preflight collision checks
- No automatic Fly `release_command` migrations

## Safe separation plan (requires explicit operator approval)

1. **Inventory** (read-only): schemas, table owners, privileges, FK edges between product ↔ corpus, connection pool endpoints, worker jobs.
2. **Backup**: independently verified Neon PITR / branch snapshot of `production` before any cutover.
3. **Provision** product-only database **within existing authorized Neon project** (new branch or database) — **do not** create a new paid Neon project without approval.
4. **Copy product tables only** into the new database (logical dump/restore). Leave corpus tables on the existing branch untouched.
5. **Point** Fly `DATABASE_URL` at the product database only after dual-read verification.
6. **Set** `CORPUS_DATABASE_URL` to the corpus branch/database with a **SELECT-only** role.
7. **Keep** `FEATURE_NEON_CORPUS_RESEARCH=0` until WP-03E credentials approved.
8. **Rollback**: retain previous `DATABASE_URL` secret version; do not drop corpus data.

## Explicit non-actions

- Do not silently redirect the app to an empty database.
- Do not run product schema migrations against the shared corpus database as a “fix”.
- Do not alter Neon privileges on the live corpus without authorization.
- Do not delete or rewrite `legal_*` rows.

## Local disposable proof

```bash
# Unit evaluator (no Neon):
npm test -w @nyayagrid/database -- product-corpus-isolation
```

Privilege SQL helpers for disposable Postgres only: `buildLocalIsolationPrivilegeSql()`.

## Production impact while OPEN

`OPS-BACKUP-01` / production readiness remain **blocked** for physical isolation even if application staging health is `HEALTHY`.
