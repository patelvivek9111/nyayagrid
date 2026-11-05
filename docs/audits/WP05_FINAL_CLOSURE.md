# WP-05 Final Operational Certification — Closure Note

**Classification:** `NYAYAGRID_WP05_FINAL_OPERATIONAL_CERTIFICATION`  
**Date:** 2026-11-04 / updated 2026-11-05 (WP-05 final verification register)  
**Branch:** `wp05/prod-ops-preflight` (register); **main** @ `af376941dd90ddd1eb9969d10815eb9e9811dd9d` after PR #3 (`81acba96`, CI `42015520866`; same-document contradiction restored)  
**Prior staging bake commit:** `add3af38a4c00c6cec631b70981a1c855b660f38`

PR #3 (CI/E2E baseline) **merged** to `main`. PR #1 (continuous monitor) HEAD `7a8ea91be8392f8c7d770e3699a403151e01f0ed` (monitor-only 16 files onto new main) — **not** merged; `SAFE_TO_MERGE` pending CI green + operator approval. **PR #2 must NOT be merged.** Monitoring acceptance (genuine scheduled runs / SMTP firing+recovery) **cannot** be claimed until PR #1 merges to default branch. Gates: `PRODUCTION_DEPLOYED=NO`; `NEON_CORPUS_WRITES=0`; `PAID_AI_CALLS=0`; `WP06_STARTED=NO`. WP-05 **not** fully closed.

## Verdict

**FIXABLE_NOW ENGINEERING COMPLETE / STAGING HISTORICALLY CERTIFIED / PRODUCTION NOT VERIFIED** — managed PITR PASS_WITH_EVIDENCE (historical; not re-run); durable staging `gitSha` verified across image rollback/restore; staging SMTP synthetic `ready-probe-failing` firing+resolved delivered and operator-acknowledged in Gmail; product branch isolation complete on staging; GitHub release-protection + recovery/provenance docs + prod-ops preflight shipped; production not deployed.

| Requirement   | ENGINEERING | LOCAL | STAGING                                              | PRODUCTION |
| ------------- | ----------- | ----- | ---------------------------------------------------- | ---------- |
| OPS-BACKUP-01 | YES         | YES   | YES (PITR historical)                                | NO         |
| OPS-MON-01    | YES         | YES   | YES (SMTP + inbox + operator ack + recovery; scoped) | NO         |
| OPS-DEP-01    | YES         | YES   | YES (identity durable; release gates engineered)     | NO         |

## FIXABLE_NOW engineering (this pass)

- GitHub release protection / CI approval workflows (`deploy-staging.yml`, `deploy-production-gate.yml`)
- Fly deployment safety (`ops:deploy-preflight` + `PRODUCTION_DEPLOY_APPROVED` boundary)
- DB target / migration / product-corpus isolation (pre-existing + inventory)
- Neon recovery policy / backup retention docs (no PITR re-run)
- Storage/Redis recovery docs
- Monitoring escalation / incident acknowledgment (docs + historical staging ack)
- Runbooks / audit retention / emergency rollback / secrets rotation / version provenance
- Explicit carry-forward inventory for unresolved external gates
- `npm run ops:prod-ops-preflight` → `WP05_FIXABLE_NOW_ENGINEERING_COMPLETE_PRODUCTION_NOT_VERIFIED`

## OPS-MON-01 staging scope (verified)

- Policy: `ready-probe-failing` only
- Firing: `2026-11-04T16:37:32.025Z`
- Resolved: `2026-11-04T16:37:32.597Z`
- From: `staging@nyayagrid.com` → Gmail `patelvivek9111@gmail.com`
- PASS: SMTP transport, inbox delivery, operator acknowledgment, recovery notification
- Evidence: `packages/research/corpus/reports/wp05-monitoring-human-ack-verified.json`

## Carry forward (unresolved)

1. PR #1 merge after CI green on `7a8ea91` + observe ≥2 scheduled monitor runs + SMTP firing/recovery
2. WP-03E legal research gates
3. WP-04 OCR managed provider + load
4. WP-04 Clerk MFA live verification
5. WP-04 ClamAV production verification
6. Attorney Terms/Privacy approval
7. Critical security findings from prior audits
8. Production deploy authorization (no production Fly app)
9. GitHub Environment required reviewers (human UI)
10. Clerk-authenticated staging E2E identities

## External approvals still needed

- Operator approval to merge PR #1 (`7a8ea91`) after CI green — do **not** merge PR #2
- GitHub Environment required reviewers (UI)
- Clerk staging synthetic identities + interactive MFA demo
- Neon corpus SELECT-only role provisioning (WP-03E)
- Attorney Terms/Privacy sign-off
- Explicit production deploy authorization (staging ≠ production certification)

## Do not claim

- Production on-call escalation
- Automated acknowledgment integration
- Live rehearsal of alert policies other than `ready-probe-failing`
- Continuous monitor scheduled-run acceptance (blocked on PR #1 default-branch merge)
- Full Clerk-authenticated E2E
- Production deployment / production PITR / production certification from staging alone
- WP-06 started
- Neon corpus writes or paid AI calls in this verification pass

## PR #1 CI green (post-update)
- HEAD: `7a8ea91be8392f8c7d770e3699a403151e01f0ed`
- CI: SUCCESS � https://github.com/patelvivek9111/nyayagrid/actions/runs/42039633576
- SAFE_TO_MERGE: YES (operator approval required; not auto-merged)
- Recorded: 2026-11-05T09:15:41Z

