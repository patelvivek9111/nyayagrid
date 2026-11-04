# WP-05 — Production release checklist (gate only)

**PRODUCTION_DEPLOYED:** NO  
Do not create a production Fly application from this checklist without a separate explicit approval.

## Must be PASS before production deploy is even proposed

- [ ] WP-03E corpus credential/integration deferred items closed or explicitly waived
- [ ] WP-04 managed OCR decision recorded
- [ ] WP-04 live Clerk MFA verified
- [ ] WP-04 attorney Terms/Privacy approval recorded
- [ ] WP-04 production ClamAV verification complete
- [x] OPS-BACKUP-01 managed PITR `PASS_WITH_EVIDENCE`
- [x] Product database physically separate from legal corpus (staging product branch)
- [x] OPS-MON-01 staging SMTP `ready-probe-failing` delivery + human Gmail acknowledgment verified (production on-call still open)
- [x] OPS-MON-01 continuous monitor scheduler + evaluator shipped (Actions cron; observe scheduled runs; SMTP notify optional)
- [x] OPS-DEP-01 staging durable `gitSha` after rollback PASS
- [x] Incident/recovery runbooks published (`docs/operations/WP05_INCIDENT_RUNBOOKS.md`)
- [ ] Staging Clerk-authenticated E2E (Professional + Prosecution) PASS — blocked on test identity provisioning
- [ ] Staging automated E2E (Professional + Prosecution) PASS with synthetic fixtures
- [ ] GitHub Environment `production` reviewers configured
- [ ] Secrets inventoried; no staging secrets reused casually
- [x] Rollback image + DB restore runbooks signed (staging-verified; production ungated)

## Explicitly forbidden without new approval

- Production Fly app create/deploy
- Production database migrations
- Production secrets rotation
- Neon production branch overwrite/restore
- Enabling `FEATURE_NEON_CORPUS_RESEARCH` in production
