# WP-06D — Final staging execution gate

**Classification:** `NYAYAGRID_WP06D_STAGING_EXECUTION_GATE`  
**Integration HEAD verified:** `2bfdc606fb4e6b286a8c2198ce5fad75175e0f06`  
**Date (UTC):** 2026-11-06  
**FINAL RESULT:** `STAGING_EXECUTION_GATE_BLOCKED`

Operator-approval env flags were **not** set by engineering.

---

## Gate evidence

### 1. Live Neon / Fly identity — PASS

| Field | Expected (operator-attested) | Observed (Fly read-only) |
| --- | --- | --- |
| Project ID | `odd-moon-90379900` | attested (not in URL; env gate required at execute) |
| Branch ID | `br-fancy-king-auaii21k` | attested |
| Endpoint | `ep-lively-lake-auyeia5m` | `ep-lively-lake-auyeia5m-pooler` (base match) |
| Database | `neondb` | `neondb` |
| Runtime role | product | `nyaya_product_runtime_v3` |
| PG | 18 | 18.6 |
| `APP_ENV` | staging | staging |
| Corpus role / `legal_authorities` rows | n/a | no corpus role; catalog table still absent pre-migrate |

### 2. Staging journal baseline — PASS (unchanged)

| Check | Value |
| --- | --- |
| Row count | **19** |
| Max `created_at` | **1788200000000** |
| Rows ≥ `1788300000000` | **0** |
| `1788250000000` / `1789100000000` present | **no** (migrate not yet run) |

Preserved app counts: orgs 9, users 13, clients 13, matters 26, documents 231.

### 3. Backup branch — NOT INDEPENDENTLY VERIFIED

| Check | Status |
| --- | --- |
| Operator-reported name/ID | `wp06-pre-migration-backup` / `br-soft-star-au0por2i` |
| Expiration | 2026-11-13 12:06 (operator) |
| Engineering Neon API access | **NONE** (`NEON_API_KEY` absent) |
| Live SQL against backup endpoint | **NOT PERFORMED** |

**Operator action:** Confirm in Neon Console that backup branch still exists, is unexpired, and still shows journal count 19 / max `1788200000000` plus preserved row counts before execute.

### 4. Isolated recovery rehearsal — BLOCKED

No Neon API / backup-branch connection string available to engineering. Disposable Docker restore drills are **not** a substitute for Neon branch recovery certification.

**Operator action:** Optional read-only connect to `br-soft-star-au0por2i` (or Instant Restore drill to a **new** throwaway branch). Do **not** delete/reset `wp06-pre-migration-backup`. Do **not** overwrite live `wp05-product-staging`.

### 5. Execution environment migrations (0034…0033) — FAIL on live Fly image

| Environment | Evidence |
| --- | --- |
| Integration tip `2bfdc60` | Journal order **PASS**: `0024` → **`0034` (`1788250000000`)** → `0025`…`0033` (`1789100000000`); SQL files present |
| Deployed Fly `nyayagrid-staging` | `gitSha=add3af3` / `wp05-add3af3`; journal last=`0028_prosecution_office_operations`; **`has0034=false`**, **`has0033=false`**; Deepening tags at 0025–0028 |
| Fly secrets | `APP_ENV`, `DATABASE_URL` only — **no** `EXPECTED_MIGRATE_DB_NAME` / Neon project/branch/endpoint / `MIGRATE_ALLOW_NEONDB_PRODUCT` |

**Operator action:** Deploy Integration tip **before or with** migrate so the migrate runner ships 0034–0033. Do **not** run migrate from the current WP-05 image. Set attested migrate env on the migrate job (not committed by engineering).

### 6. Coordinated deploy / schema compatibility — BLOCKED until deploy

| Check | Status |
| --- | --- |
| Ready probe after machine start | **HEALTHY** but on `add3af3` |
| Post-0033 app contract on tip | Proven in disposable WP06C/PR09 matrices on Integration |
| Live schema vs tip | Pre-migrate baseline (missing week3/contacts/memory/graph); tip expects post-0033 |

Migrate from tip against live DB is the intended path; app traffic must not assume post-0033 APIs until migrate+deploy complete.

---

## Concise execution checklist (after blockers cleared)

1. Neon Console: confirm backup `br-soft-star-au0por2i` unexpired; note journal/row spot-check.  
2. Set migrate job env (operator):

```text
APP_ENV=staging
EXPECTED_MIGRATE_DB_NAME=neondb
EXPECTED_NEON_PROJECT_ID=odd-moon-90379900
EXPECTED_NEON_BRANCH_ID=br-fancy-king-auaii21k
EXPECTED_NEON_ENDPOINT_ID=ep-lively-lake-auyeia5m
MIGRATE_ALLOW_NEONDB_PRODUCT=1
DATABASE_URL=<staging product URL>
```

3. Deploy Integration `2bfdc60`+ (image must contain `0034_repair_skipped_week3_through_0023.sql`).  
4. Read-only preflight: journal still 19 / max `1788200000000`.  
5. Explicit human approval recorded (engineering will **not** set `STAGING_MIGRATE_OPERATOR_APPROVAL`).  
6. `npm run db:migrate` (or Fly one-shot using **new** image) — expect apply **0034 → 0025…0033**.  
7. Post-migrate validation (below).  
8. Confirm `/api/health/ready` HEALTHY on new `gitSha`.

## Post-migration validation (SQL / checks)

```sql
-- Journal ceiling
SELECT count(*) AS n, max(created_at) AS mx FROM drizzle.__drizzle_migrations;
-- expect n >= 29 and mx >= 1789100000000; created_at 1788250000000 present

SELECT to_regclass('public.criminal_cases'),
       to_regclass('public.contacts'),
       to_regclass('public.prosecution_case_memories'),
       to_regclass('public.legal_authorities');

SELECT count(*) FROM legal_authorities; -- expect 0 unless corpus later loaded via approved path

SELECT conname FROM pg_constraint
WHERE conname IN (
  'prosecution_graph_nodes_case_org_fk',
  'prosecution_graph_edges_from_case_fk',
  'client_contacts_contact_org_fk',
  'document_folders_matter_org_fk',
  'prosecution_charges_statute_fk'
);

SELECT column_name FROM information_schema.columns
WHERE table_name='time_entries' AND column_name IN ('billable','hourly_rate_cents');

-- Preservation
SELECT count(*) FROM organizations; -- expect 9
SELECT count(*) FROM matters;       -- expect 26
SELECT count(*) FROM documents;     -- expect 231
```

Also: `GET https://staging.nyayagrid.com/api/health/ready` → HEALTHY with new `gitSha`.

## Failure stop conditions

| Symptom | Stop / action |
| --- | --- |
| Identity gate fails (endpoint/db/role) | **Abort**; do not retry with overrides |
| Migrate starts from `add3af3` image / missing 0034 file | **Abort**; deploy tip first |
| Error mid-0034 / mid-0025–0033 | **Abort further DDL**; do not DROP archives; freeze writes; recover from backup branch / PITR |
| Row counts for orgs/matters/documents drop | **Abort**; restore from `wp06-pre-migration-backup` |
| `legal_authorities` suddenly populated unexpectedly | **Stop**; investigate corpus mishook — shell must stay empty unless approved corpus load |
| Ready unhealthy after deploy | Roll forward app fix or restore DB then redeploy known-good |

## Recovery instructions

1. Freeze app writes / scale down writers if needed.  
2. Prefer Neon branch `wp06-pre-migration-backup` (`br-soft-star-au0por2i`) as known pre-migrate snapshot — retarget connection **only** after identity re-attest.  
3. Or Instant Restore on root branch within history window (creates `{branch}_old_*` backup) — never delete the pre-migration branch casually.  
4. Re-run identity + journal checks (expect return to 19 / `1788200000000`).  
5. Fix root cause; only then forward-migrate from Integration tip with gates.  
6. Do **not** use 0031–0034 down files as data rollback.

---

## Remaining operator actions (blockers)

1. Verify backup branch still present/unexpired (Neon Console).  
2. Deploy Integration tip containing 0034 before migrate.  
3. Configure attested migrate env on the execute job.  
4. Record explicit approval (do not rely on engineering-set flags).  
5. Optionally complete Neon-isolated recovery rehearsal for certification.

## FINAL RESULT

`STAGING_EXECUTION_GATE_BLOCKED`
