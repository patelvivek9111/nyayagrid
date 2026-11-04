# WP-05 Operations Runbook

**Classification:** `NYAYAGRID_WP05_OPERATIONS_AND_PRODUCTION_READINESS`  
**Production deploy:** NO (manual approval required; not automated in this repo)  
**Neon corpus writes:** 0 · **WP-03E:** deferred · **FEATURE_NEON_CORPUS_RESEARCH:** keep OFF

## Environments

| Env        | Intent              | Product DB            | Corpus DB                          | Notes                        |
| ---------- | ------------------- | --------------------- | ---------------------------------- | ---------------------------- |
| LOCAL      | Dev / certification | docker `DATABASE_URL` | optional `CORPUS_DATABASE_URL`     | Never point at prod          |
| STAGING    | Pre-prod            | managed staging       | separate RO URL if enabled         | Deploy only with approval    |
| PRODUCTION | Live                | managed prod          | separate RO; flag OFF until WP-03E | No deploy from this workflow |

## Health

- `GET /api/health/live` — process up + optional `gitSha` / `buildId`
- `GET /api/health/ready` — DB, storage, redis, clamav (when configured), config, env boundaries  
  Status: `HEALTHY` \| `DEGRADED` \| `UNAVAILABLE`

## Deploy (staging)

1. CI green on immutable SHA.
2. `npm run ops:deploy-preflight` against **staging** env vars (from secret manager; never commit).
3. GitHub Actions → **Deploy staging (manual approval)** workflow (`workflow_dispatch`).
4. Confirm input `NO_PRODUCTION`.
5. Environment `staging` reviewers approve.
6. **Human** runs container deploy on the authorized host (no auto push configured here).
7. Verify `/api/health/ready` → `ok: true`.

**Commands requiring approval:** any `db:migrate` against staging/prod; any Neon role change; production image promote.

## Rollback

| Failure          | Action                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Bad app release  | Redeploy previous image SHA; do **not** auto-restore DB                                      |
| Bad env config   | Fix secrets; restart; ready probe must pass                                                  |
| DB unreachable   | Provider status; restart pool; restore only if corruption confirmed                          |
| ClamAV down      | Uploads fail closed; restore clamd; do not set `MALWARE_SCANNER=development` in staging/prod |
| OCR down         | Documents may park at `requires_ocr`; disable `FEATURE_OCR` if needed                        |
| AI outage        | Communicate; never fall back to mock in staging/prod                                         |
| Corpus read fail | Keep `FEATURE_NEON_CORPUS_RESEARCH=0` or fail closed                                         |

Schema rollback is **not** routine application rollback — require a migration plan.

## Backup / restore

```bash
# Local docker matched rehearsal (never over live):
npm run ops:backup-rehearse
npm run ops:backup-freshness
```

Interim RPO **24h** / RTO **4h** (local dumps). Target managed PITR RPO ≤5m / RTO ≤1h — **not certified** until isolated provider rehearsal.

Managed restore: see `docs/BACKUP_RESTORE.md`. Never restore over Neon production branch.

## Monitoring

Alert policy catalog: `docs/operations/WP05_ALERTING.md`  
On-call destination: **EXTERNAL — not wired** (engineering definitions only).

## Incidents

Follow `docs/INCIDENT_RESPONSE.md`. SEV1 for any cross-tenant or case/matter bleed suspicion.
