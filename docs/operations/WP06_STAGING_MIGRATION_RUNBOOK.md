# WP-06 — Staging product DB migration runbook (0028–0032)

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

## 1. Preflight (read-only)

```bash
# Identity — expect product DB name, NOT corpus
EXPECTED_MIGRATE_DB_NAME=<staging-product-db-name> \
DATABASE_URL=<staging-product-url> \
APP_ENV=staging \
npx tsx packages/database/src/migrate.ts --dry-identity-check
# Or: SELECT current_database(), current_user, inet_server_addr();
```

Verify:

1. `current_database()` matches product DB (not `neondb` / corpus).
2. `DATABASE_URL` ≠ `CORPUS_DATABASE_URL`.
3. Journal: `SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;`
4. Graph: `node_kind` present OR stub (`node_type`) documented.
5. Contacts / folders / invoices / memories exist or are explicitly absent for first apply.
6. Constraints: `prosecution_graph_edges_from_case_fk`, `prosecution_graph_nodes_case_org_fk` after 0032.

## 2. Backup verification

- Confirm managed backup / PITR retention covers ≥ 24h before migrate.
- Optional: `pg_dump --format=custom --file=staging-product-pre-0032-$(date +%Y%m%d%H%M).dump "$DATABASE_URL"` to an approved private store (no chat paste of paths with secrets).

## 3. Disposable rehearsal (engineering — already required)

```bash
# Local Docker only — never staging URL
node scripts/migration-safety/pr09-matrix.mjs
```

Acceptance: states **A–G PASS**, clean↔repaired catalog parity.

## 4. Migration execution (staging — operator-approved only)

```bash
APP_ENV=staging \
EXPECTED_MIGRATE_DB_NAME=<staging-product-db-name> \
DATABASE_URL=<staging-product-url> \
npm run db:migrate
```

Expected journal ceiling: **0032** (`when` ≥ `1789000000000`).

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
| Migrate fails mid-0031/0032; archives present | **Do not** DROP archives. Fix SQL / data, re-run migrate (idempotent).                    |
| Journal ahead of schema                       | Apply forward repair migrations / 0029–0032; never rewrite historical `when`.             |
| Data loss suspected                           | Restore from pre-migrate dump / PITR; **do not** use 0031/0032 downs (documented no-ops). |
| Corpus URL used by mistake                    | Abort; rotate credentials; restore product from backup.                                   |

## 8. Safety

- No production migrate from this runbook.
- No Neon corpus writes.
- No credential paste into tickets/chat.
