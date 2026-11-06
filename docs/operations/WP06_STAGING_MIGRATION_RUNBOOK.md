# WP-06 — Staging product DB migration runbook (0028–0033)

**Classification:** `NYAYAGRID_WP06_STAGING_RELEASE_READINESS`  
**Scope:** NyayaGrid **product** database only. Never point migrate at Neon legal corpus (`CORPUS_DATABASE_URL` / `neondb`).  
**Authority:** Do **not** execute against shared staging until an operator records explicit approval in this checklist.

## 0. Operator authorization checkpoint (required)

- [ ] Approver name / date: ________________
- [ ] Target: staging product DB only (identity verified below)
- [ ] Backup / PITR window verified
- [ ] Maintenance window communicated
- [ ] Rollback owner assigned

**STOP** if any box is unchecked.

## 0b. WP-06B gates (required)

See `docs/audits/WP06B_STAGING_DATABASE_RECONCILIATION.md` and `docs/audits/WP06B_MIGRATION_COLLISION_MAP.md`.

Staging/production migrate env (fail-closed in `migrate.ts`):

- `APP_ENV=staging|production`
- `EXPECTED_MIGRATE_DB_NAME`
- `EXPECTED_NEON_PROJECT_ID` / `EXPECTED_NEON_BRANCH_ID` / `EXPECTED_NEON_ENDPOINT_ID` (Neon targets)
- `MIGRATE_ALLOW_NEONDB_PRODUCT=1` only after written product-vs-corpus attestation when db name is `neondb`
- Preflight five gates; `STAGING_MIGRATE_OPERATOR_APPROVAL=1` is approval, not auto-execute

History: deployed `add3af3` Deepening `0025`–`0028` collide on `when` with main tags — reconcile via **0029–0033** (never rewrite historical `when`). Disposable matrices are not staging proof.

## 1. Preflight (read-only)

```bash
# Prefer the WP-06B read-only preflight (never prints URLs)
APP_ENV=staging \
EXPECTED_MIGRATE_DB_NAME=<staging-product-db-name> \
EXPECTED_NEON_PROJECT_ID=<attested> \
EXPECTED_NEON_BRANCH_ID=<attested> \
EXPECTED_NEON_ENDPOINT_ID=<ep-... matching URL host> \
MIGRATE_ALLOW_NEONDB_PRODUCT=1 \
ALLOW_NEON_PRODUCT_DB_PREFLIGHT=1 \
BACKUP_RESTORE_OPERATOR_VERIFIED=1 \
MIGRATION_HISTORY_RECONCILED=1 \
DATABASE_URL=<staging-product-url> \
node scripts/migration-safety/staging-product-db-preflight.mjs
```

Verify:

1. `DATABASE_IDENTITY_VERIFIED` (project/branch/endpoint + db name; role not corpus).
2. `DATABASE_URL` ≠ `CORPUS_DATABASE_URL` when corpus is configured.
3. Journal: confirm Deepening vs main hashes for `1788300000000`–`1788600000000`.
4. Graph: `node_kind` present; stub-only is fail-closed after 0033.
5. Contacts / folders / invoices / memories present after reconcile.
6. Constraints including `prosecution_graph_edges_from_case_fk`, `prosecution_graph_nodes_case_org_fk`.

## 2. Backup verification

Follow `docs/operations/WP06B_NEON_PITR_OPERATOR_CHECKLIST.md`.

- Confirm managed backup / PITR retention covers ≥ 24h before migrate.
- Optional: `pg_dump --format=custom` of product DB only to an approved private store (no chat paste of secrets).

## 3. Disposable rehearsal (engineering — already required)

```bash
# Local Docker only — never staging URL
node scripts/migration-safety/pr09-matrix.mjs
node scripts/migration-safety/wp06b-matrix.mjs
```

Acceptance: PR09 **A–G PASS**; WP06B **A–E + fail-closed PASS**.

## 4. Migration execution (staging — operator-approved only)

```bash
APP_ENV=staging \
EXPECTED_MIGRATE_DB_NAME=<staging-product-db-name> \
EXPECTED_NEON_PROJECT_ID=<attested> \
EXPECTED_NEON_BRANCH_ID=<attested> \
EXPECTED_NEON_ENDPOINT_ID=<ep-...> \
MIGRATE_ALLOW_NEONDB_PRODUCT=1 \
DATABASE_URL=<staging-product-url> \
npm run db:migrate
```

Expected journal ceiling: **0033** (`when` ≥ `1789100000000`).

## 5. Schema contract checks (post-migrate)

```sql
-- Fail if any missing
SELECT conname FROM pg_constraint
WHERE conname IN (
  'prosecution_graph_nodes_case_org_fk',
  'prosecution_graph_edges_from_case_fk',
  'prosecution_graph_edges_to_case_fk',
  'prosecution_graph_edges_from_org_fk',
  'prosecution_graph_edges_to_org_fk',
  'client_contacts_contact_org_fk',
  'document_folders_matter_org_fk'
);

SELECT column_name FROM information_schema.columns
WHERE table_name='time_entries' AND column_name IN ('billable','hourly_rate_cents');
```

Or: point a disposable copy of the staging dump at `assertGraphSchemaContract` via `scripts/migration-safety/graph-schema-contract.mjs`.

## 6. Application smoke (staging)

1. `GET https://staging.nyayagrid.com/api/health/ready` → `HEALTHY`
2. DevAuth/local smokes are **not** Clerk certification.
3. After Clerk identities exist: professional client→invoice path; prosecution memory/graph review path.

## 7. Rollback / forward-repair decision tree

| Symptom                                       | Action                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Migrate fails mid-0031/0033; archives present | **Do not** DROP archives. Fix SQL / data, re-run migrate (idempotent).                    |
| Journal ahead of schema                       | Apply forward repair migrations / 0029–0033; never rewrite historical `when`.             |
| Data loss suspected                           | Restore from pre-migrate dump / PITR; **do not** use 0031–0033 downs (documented no-ops). |
| Corpus URL used by mistake                    | Abort; rotate credentials; restore product from backup.                                   |

## 8. Safety

- No production migrate from this runbook.
- No Neon corpus writes.
- No credential paste into tickets/chat.
