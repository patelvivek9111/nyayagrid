# WP-06B — Neon PITR operator checklist (product DB only)

**Classification:** `NYAYAGRID_WP06B_STAGING_DATABASE_RECONCILIATION`  
**Do not** create live Neon branches/snapshots from engineering automation without approval.  
**Do not** point tools at the legal corpus project.

## Prerequisites

- [ ] Neon project ID attested: `EXPECTED_NEON_PROJECT_ID=…`
- [ ] Neon branch ID attested: `EXPECTED_NEON_BRANCH_ID=…`
- [ ] Neon endpoint ID matches Fly `DATABASE_URL` host: `EXPECTED_NEON_ENDPOINT_ID=ep-…`
- [ ] Database name attested: `EXPECTED_MIGRATE_DB_NAME=…`
- [ ] If name is `neondb`: `MIGRATE_ALLOW_NEONDB_PRODUCT=1` after written product-vs-corpus attestation
- [ ] Role is product runtime (not `*corpus*`)
- [ ] Rollback owner named: ________________

## History window

1. Neon Console → attested **product** project → Settings → Postgres → History window.
2. Require **≥ 24 hours** retention before migrate (Free plan max 6h — upgrade/extend if needed).
3. Record plan + window hours: ________________

## Isolated restore target (drill)

1. Create child/restore branch labeled `pre-0033-<UTC>` from the attested product branch (**approval required**).
2. Do not overwrite the live primary during drills.
3. Run integrity checks against the isolated branch connection only:
   - contacts / folders / memories / billing columns / graph `node_kind`
   - graph isolation FKs
   - row-count spot checks for critical tables
4. Optional: migrate replay on isolated branch only after identity gates pass.
5. Set `BACKUP_RESTORE_OPERATOR_VERIFIED=1` in the operator-controlled preflight env when complete.

## Incident rollback

1. Freeze writes / page on-call.
2. Instant Restore on **root** branch within history window (Neon creates `{branch}_old_{timestamp}` backup).
3. Re-attest identity gates before any migrate retry.
4. Never use 0031–0033 downs to undo data (documented no-ops / unsafe).

## Evidence to record

| Field                | Value |
| -------------------- | ----- |
| Project ID           |       |
| Branch ID            |       |
| Endpoint ID          |       |
| History window hours |       |
| Isolated branch name |       |
| Rollback owner       |       |
| Date/time (UTC)      |       |
