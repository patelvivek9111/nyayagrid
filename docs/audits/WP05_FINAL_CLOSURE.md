# WP-05 Final Operational Certification — Closure Note

**Classification:** `NYAYAGRID_WP05_FINAL_OPERATIONAL_CERTIFICATION`  
**Date:** 2026-11-04  
**Branch work:** `wp05/final-ops-cert` → push target `feat/production-model-routing`  
**Base HEAD before:** `da36d0b67c452f34fb3596a3bd10b8ba0086c45c`

## Verdict

**PARTIAL / EXTERNAL APPROVAL REQUIRED** — staging product health and rollback image switching are verified; durable release identity is engineered but not yet redeployed; managed PITR lacks independently verified historical checkpoint; product/corpus share `neondb` (production blocker); SMTP synthetic alerts accepted pending human ack; production not deployed.

| Requirement   | ENGINEERING | LOCAL        | STAGING                                   | PRODUCTION |
| ------------- | ----------- | ------------ | ----------------------------------------- | ---------- |
| OPS-BACKUP-01 | YES         | YES (docker) | PARTIAL inventory                         | NO         |
| OPS-MON-01    | YES         | YES          | SMTP accepted / ack pending               | NO         |
| OPS-DEP-01    | YES         | YES          | Host live; identity bake pending redeploy | NO         |

## Do not claim

- Full managed PITR certification
- Physical product/corpus isolation
- Durable `gitSha` on live staging after rollback (still null until bake redeploy)
- Production deployment
- Full automated Clerk E2E

## Next operator actions (exact)

1. Neon: export PITR timestamp/LSN + recovery-branch URL → `npm run ops:pitr-verify`
2. Approve staging `fly deploy --build-arg GIT_SHA=... --skip-release-command`
3. Confirm SMTP alert inbox ack
4. Approve product DB separation plan (`WP05_PRODUCT_CORPUS_ISOLATION.md`) before production
