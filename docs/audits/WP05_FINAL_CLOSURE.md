# WP-05 Final Operational Certification — Closure Note

**Classification:** `NYAYAGRID_WP05_FINAL_OPERATIONAL_CERTIFICATION`  
**Date:** 2026-11-04  
**Final commit (staging bake):** `add3af38a4c00c6cec631b70981a1c855b660f38`

## Verdict

**STAGING CERTIFIED / PRODUCTION GATE PENDING** — managed PITR PASS_WITH_EVIDENCE; durable staging `gitSha` verified across image rollback/restore; staging SMTP synthetic `ready-probe-failing` firing+resolved delivered and operator-acknowledged in Gmail; product branch isolation complete on staging; production not deployed.

| Requirement   | ENGINEERING | LOCAL | STAGING                                              | PRODUCTION |
| ------------- | ----------- | ----- | ---------------------------------------------------- | ---------- |
| OPS-BACKUP-01 | YES         | YES   | YES (PITR)                                           | NO         |
| OPS-MON-01    | YES         | YES   | YES (SMTP + inbox + operator ack + recovery; scoped) | NO         |
| OPS-DEP-01    | YES         | YES   | YES (identity durable)                               | NO         |

## OPS-MON-01 staging scope (verified)

- Policy: `ready-probe-failing` only
- Firing: `2026-11-04T16:37:32.025Z`
- Resolved: `2026-11-04T16:37:32.597Z`
- From: `staging@nyayagrid.com` → Gmail `patelvivek9111@gmail.com`
- PASS: SMTP transport, inbox delivery, operator acknowledgment, recovery notification
- Evidence: `packages/research/corpus/reports/wp05-monitoring-human-ack-verified.json`

## Remaining human actions

1. Provide Clerk E2E credentials for full automated staging E2E
2. Separate explicit approval before any production Fly app
3. Production on-call escalation / other alert policies remain untested (not claimed by OPS-MON-01 staging PASS)

## Do not claim

- Production on-call escalation
- Automated acknowledgment integration
- Live rehearsal of alert policies other than `ready-probe-failing`
- Full Clerk E2E
- Production deployment
