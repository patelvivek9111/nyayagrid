# WP-05B — Exact operator actions (no planning fluff)

Staging host **exists** (`https://staging.nyayagrid.com`) but cannot be certified from this agent session.

## HOSTING snapshot

| Field                     | Value                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| HOSTING_PROVIDER          | Fly.io                                                                                          |
| STAGING_TARGET            | `nyayagrid-staging` / `https://staging.nyayagrid.com`                                           |
| REGISTRY                  | `registry.fly.io` (documented for ClamAV/web images)                                            |
| DEPLOYMENT_METHOD         | `fly deploy --config fly.staging.toml` + GitHub manual `deploy-staging.yml` gate                |
| EXISTING_HOST_RESOURCES   | Live=200; DB ok; storage ok; Redis **error**; ready=503; Clerk/OpenAI/ClamAV configured on host |
| EXACT_MISSING_CREDENTIALS | `FLY_API_TOKEN` / `fly auth`; staging Clerk for E2E; on-call vendor; Neon API for managed PITR  |
| HUMAN_APPROVAL_REQUIRED   | Yes — Fly login + Redis restore + deploy of WP-05 SHA + paging vendor                           |

## Action 1 — Fly authentication (blocks deploy/rollback/PITR ops via CLI)

```bash
fly auth login
fly apps list
# Expect: nyayagrid-staging, nyayagrid-clamav-staging
```

**Acceptance:** `fly status --app nyayagrid-staging` succeeds.

## Action 2 — Restore staging Redis (blocks ready=200)

Current probe: `checks.redis=error` → ready 503.

```bash
# After auth: confirm REDIS_URL secret and Redis host reachability from the app
fly secrets list --app nyayagrid-staging
# Fix REDIS_URL to a reachable staging Redis; restart machines if needed
fly apps restart nyayagrid-staging
curl -sS https://staging.nyayagrid.com/api/health/ready
```

**Acceptance:** HTTP 200 and `"redis":"ok"`.

## Action 3 — Deploy WP-05B-capable image (blocks build SHA + new ready model)

**Prerequisite:** migration safety fix merged — `fly.staging.toml` must **not** auto-run `migrate.cjs`.

```bash
# From approved SHA on feat/production-model-routing after CI green:
fly deploy --config fly.staging.toml --app nyayagrid-staging --ha=false
# Or use GitHub Actions "Deploy staging (manual approval)" then human fly deploy
curl -sS https://staging.nyayagrid.com/api/health/live
# Expect gitSha present matching deploy
```

**Acceptance:** live JSON includes `gitSha`; ready returns `status: HEALTHY|DEGRADED` (WP-05 shape).  
**Non-acceptance:** deploy must not apply schema changes by itself.

## Action 3b — Explicit product DB migration only (when schema change is approved)

```bash
APP_ENV=staging \
ALLOW_DATABASE_MIGRATE=1 \
EXPECTED_MIGRATE_DB_HOST=<product-host> \
EXPECTED_MIGRATE_DB_NAME=<product-db> \
DATABASE_URL=<product-url> \
npm run db:migrate
```

**Forbidden:** `DATABASE_URL` = `CORPUS_DATABASE_URL`; migrating `neondb` corpus; restoring `release_command` migrate without a new approved change.

## Action 4 — On-call destination (blocks OPS-MON-01 live)

Wire `ready-probe-failing` / `malware-scanner-down` to PagerDuty/Opsgenie/email.  
Induce staging ready failure briefly; capture delivered + acknowledged alert.

**Acceptance:** timestamped alert delivery + ack evidence (not a dashboard screenshot alone).

## Action 5 — Managed PITR (blocks OPS-BACKUP-01 managed)

Neon project `nyayagrid-staging` (documented). Create **isolated restore branch** only.  
Never overwrite Neon corpus `production` branch or live app DB.

**Acceptance:** restore duration + row counts + original unchanged.

## Forbidden in this session (already observed)

- No `fly auth login` interactive from agent without operator
- No unapproved cloud spend
- No production deploy
- No WP-03E password changes
- No CourtListener / paid AI for certification
