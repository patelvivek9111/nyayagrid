# BASELINE 6W OPS1

**Generated:** 2026-08-27T05:05:02.744Z  
**Database:** disposable `nyayagrid_staging_6w` / restore `nyayagrid_staging_6w_restore` (not the certification DB `nyayagrid`)  
**Backup:** pg_dump custom, 413703 bytes, 2026-08-27T05:04:53.299Z  

## Result

Local production-shaped ops proof: **PASS** for migrations, backup, restore, private MinIO object storage, and local object recovery.  
**BLOCKED:** Clerk beta users, Inngest Cloud registration, managed-provider PITR, non-localhost object-storage versioning.

FEATURE_AGENTS staging/production = **OFF**. DevAuth unavailable for APP_ENV=staging.

See `BASELINE_6W_OPS1.json` for the redacted environment matrix and check list.
