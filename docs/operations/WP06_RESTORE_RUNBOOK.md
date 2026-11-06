# WP-06 — Backup / restore operational readiness

**Classification:** `NYAYAGRID_WP06_STAGING_RELEASE_READINESS`  
**Related:** `docs/BACKUP_RESTORE.md`

## What is certified here

| Layer                                          | Status                                                  | Evidence                                   |
| ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| Local `pg_dump` / restore on disposable Docker | Engineering verified historically (OPS-BACKUP-01 LOCAL) | Register + local drills                    |
| Disposable migration interruption / retry      | **PASS** matrix state G                                 | `scripts/migration-safety/pr09-matrix.mjs` |
| Managed PITR on staging/production             | **NOT CERTIFIED**                                       | Needs operator-authorized restore branch   |
| Production cutover                             | **FORBIDDEN** without separate approval                 | —                                          |

## Disposable restore drill (engineering)

```bash
# 1) Dump disposable DB after migrate
pg_dump --format=custom --file=/tmp/nyaya-disp.dump \
  "postgresql://nyayagrid:nyayagrid@localhost:5433/<disposable>"

# 2) Create empty restore target
createdb -h localhost -p 5433 -U nyayagrid nyaya_restore_probe

# 3) Restore
pg_restore --clean --if-exists -d \
  "postgresql://nyayagrid:nyayagrid@localhost:5433/nyaya_restore_probe" \
  /tmp/nyaya-disp.dump

# 4) Integrity
# - row counts for contacts, folders, invoices, memories, graph nodes/edges
# - assertGraphSchemaContract
```

## Staging / managed PITR (operator)

Staging product DB is expected on **Neon** (not Fly Postgres — no Fly PG clusters). Corpus and product must be attested as **separate** projects/roles before any restore or migrate.

1. Neon Console → open the **attested product** project (not the legal corpus project).
2. Settings → Postgres → confirm **History window ≥ 24h** (Free plan max 6h — upgrade/extend if needed).
3. Branches → create **isolated** restore/child branch or snapshot `pre-0032-<UTC>` — never overwrite live primary for drills.
4. Optional private `pg_dump --format=custom` of product DB only (no URL paste to chat).
5. On incident: Instant Restore only on a **root** branch within history window; Neon auto-creates `{branch}_old_{timestamp}` backup branch.
6. Run schema contract + `/api/health/ready` against restore endpoint / branch connection.
7. Record RPO/RTO evidence; set OPS-BACKUP-01 `MANAGED_PITR_VERIFIED=true`.

**If Neon Admin/branch credentials unavailable:** required operator action = grant access to the attested **product** Neon project (Admin or create-branch). Engineering cannot certify PITR without that grant.

## Escalation

1. Detect corruption / failed migrate → freeze writes.
2. Page on-call (SMTP path proven on schedule run `42150903565` deliveries `smtp:accepted`).
3. Restore owner executes PITR or dump restore.
4. Re-run migrate only after identity checks (`EXPECTED_MIGRATE_DB_NAME`).
5. Post-incident: rotate any exposed credentials; no secret paste to chat.
