# Backup & Restore — NyayaGrid

**Status: BLOCKER.** No restore has ever been executed end-to-end against a production-shaped
(managed) Postgres instance. Everything below is the intended procedure, not a verified one. Do
not treat this document as evidence that recovery works — treat it as the checklist to work
through and verify before launch, then keep re-verifying on a schedule (see
[Operations](./OPERATIONS.md)).

## What needs to be backed up

| Data                                                                                                                      | Where it lives                               | Criticality                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application data (organizations, matters, documents metadata, timeline, memory, research, agent runs, audit events, etc.) | Postgres (`DATABASE_URL`)                    | Critical — this is the entire product's state.                                                                                                                                         |
| Uploaded documents (originals)                                                                                            | Object storage (S3/MinIO, `S3_BUCKET`)       | Critical — referenced by, but not stored in, Postgres.                                                                                                                                 |
| Vector embeddings                                                                                                         | Postgres (`pgvector` columns, same database) | Critical — regenerable from source text via `EMBEDDING_PROVIDER`, but only if the source text/documents still exist; treat as critical anyway to avoid an expensive re-embedding pass. |
| Configuration / secrets                                                                                                   | Your secret manager, not this app            | Out of scope here — back these up per your platform's own practice.                                                                                                                    |

Postgres and object storage backups must be treated as a **matched pair**: a document row that
references a storage key that no longer exists (or vice versa) is a data-integrity bug. Any backup
strategy must restore both to the same point in time, or reconcile the mismatch afterward.

## Postgres backup

### If using a managed provider (recommended)

Use the provider's built-in continuous backup / point-in-time recovery (PITR) feature (e.g. AWS
RDS automated backups + PITR, Neon's branching/PITR, Supabase's daily backups, etc.). This is
strongly preferred over rolling your own `pg_dump` cron job, because:

- It captures a consistent snapshot without a long-running `pg_dump` against a live database.
- PITR lets you restore to "just before" a bad migration or bad deletion, not only to the last
  nightly dump.

**Action required before launch:** confirm the specific managed provider you choose supports (a)
`pgvector` as an allow-listed extension and (b) PITR/automated backups, and (c) **actually restore
a backup to a scratch instance and verify the app boots against it and `pgvector` still works**
(vector index rebuild after certain restore paths is a known footgun for some providers — verify
directly rather than assuming).

### If self-hosting Postgres

Minimum viable approach until something better is verified:

```bash
# Backup (run on a schedule, e.g. nightly, from a host with network access to the DB)
pg_dump --format=custom --file=nyayagrid-$(date +%Y%m%d-%H%M%S).dump "$DATABASE_URL"

# Restore (to a NEW, empty database — never restore over a live one without a plan)
createdb nyayagrid_restore_test
pg_restore --dbname="postgresql://.../nyayagrid_restore_test" nyayagrid-<timestamp>.dump
```

Store dumps somewhere durable and separate from the database host (a different S3 bucket/region at
minimum). Encrypt dumps at rest — they contain client legal data.

## Object storage backup

- **AWS S3**: enable versioning and (ideally) cross-region replication on the bucket. Versioning
  alone protects against accidental overwrite/delete; replication protects against a regional
  outage.
- **MinIO** (self-hosted, `ALLOW_MINIO_IN_PRODUCTION=1` only): you are responsible for your own
  backup of MinIO's data volume. This is one of the reasons MinIO is a production blocker by
  default — see [Production Readiness](./PRODUCTION_READINESS.md).

## Restore procedure (draft — verify before relying on it)

1. Identify the target point in time (or the specific dump file).
2. Restore Postgres to a **new** instance/database — never restore directly over production.
3. Restore object storage to the same point in time (S3 versioning: restore each object's version
   as of that timestamp; a full-bucket point-in-time restore may require a scripted walk of
   version IDs, since S3 does not offer a single "restore bucket to time T" button).
4. Point a staging deployment (`APP_ENV=staging`, all other production-shaped config) at the
   restored database + bucket.
5. Verify: the app boots (`/api/health/ready` → `ok`), a known matter loads with its documents and
   timeline intact, and a `pgvector` similarity search returns results (confirms vector indexes
   survived the restore).
6. Only after step 5 passes should the restored data be considered viable for a real recovery.
7. Cut over: repoint `DATABASE_URL`/`S3_BUCKET` for the production deployment, or promote the
   restored instance to be the new production instance per your infrastructure's conventions.

## Recovery objectives

Not yet defined. Before launch, the team must agree on and document:

- **RPO (Recovery Point Objective)** — how much data loss is acceptable (drives backup frequency /
  whether continuous PITR is required vs. nightly dumps).
- **RTO (Recovery Time Objective)** — how long a restore is allowed to take (drives whether a
  warm-standby replica is needed vs. restore-from-backup being acceptable).

Until these are defined and the restore procedure above has been rehearsed at least once against a
provider matching your production choice, treat backup/restore as **unverified** regardless of
what backups exist.
