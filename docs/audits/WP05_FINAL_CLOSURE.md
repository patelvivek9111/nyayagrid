# WP-05 Final Closure — Ops & Production Readiness

**Result class:** `WP05_ENGINEERING_COMPLETE_EXTERNAL_GATES_PENDING`  
**Branch:** `feat/production-model-routing`

## Engineering completed this session

| Area                  | Evidence                                                       |
| --------------------- | -------------------------------------------------------------- |
| Env boundaries        | `packages/platform/src/env-boundaries.ts` + tests              |
| Ops health / alerts   | `packages/observability/src/ops-health.ts` + tests             |
| Live/ready probes     | build SHA; HEALTHY/DEGRADED/UNAVAILABLE; clamav/ocr/corpus/env |
| Backup rehearsal      | enhanced integrity + sha256 + latest freshness pointer         |
| Freshness check       | `npm run ops:backup-freshness`                                 |
| Deploy preflight      | `npm run ops:deploy-preflight`                                 |
| Staging approval gate | `.github/workflows/deploy-staging.yml` (manual, no prod)       |
| Runbooks              | `docs/operations/WP05_OPS_RUNBOOK.md`, `WP05_ALERTING.md`      |

## Verification classes

| Gate          | Engineering                   | Local tested          | Staging          | Production |
| ------------- | ----------------------------- | --------------------- | ---------------- | ---------- |
| OPS-BACKUP-01 | YES                           | YES (docker rehearse) | NO managed PITR  | NO         |
| OPS-MON-01    | YES (policies + probes)       | YES (unit)            | NO paging vendor | NO         |
| OPS-DEP-01    | YES (preflight + manual gate) | YES                   | NO host deploy   | NO         |

## Provisional RPO / RTO

- Interim (local dumps): RPO **24h**, RTO **4h**
- Target (managed PITR): RPO **≤5m**, RTO **≤1h** — uncertified

## External dependencies (exact)

1. Managed Postgres PITR isolated restore rehearsal (owner: infra)
2. On-call vendor + alert routing rehearsal (owner: ops)
3. Authorized staging host + secrets + container registry push (owner: infra)
4. Separate production approval for any prod deploy (owner: release manager)
5. WP-03E Neon RO credential (deferred) · WP-04 staging OCR/ClamAV/Clerk/attorney (deferred)

## Constraints observed

Neon writes 0 · CourtListener 0 · Paid AI 0 · Prod deploy NO · Merge NO
