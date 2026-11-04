# WP-04 Final Closure — Security & Document Certification

**Classification:** `NYAYAGRID_WP04_FINAL_SECURITY_DOCUMENT_CERTIFICATION`  
**Branch:** `feat/production-model-routing`  
**Result class:** `WP04_ENGINEERING_COMPLETE_EXTERNAL_GATES_PENDING`

## Engineering complete (local)

| Gate | Engineering | Local live | Staging | Production | Attorney |
| --- | --- | --- | --- | --- | --- |
| PROF-DOC-02 OCR | YES | YES (HTTP harness + pipeline) | NO | NO | n/a |
| SEC-MAL-01 ClamAV | YES | YES (docker clamd + pipeline EICAR) | NO | NO | n/a |
| SEC-AUTH-01 Clerk MFA | YES (server policy) | Unit/integration matrix | NO | NO | n/a |
| SEC-LEGAL-01 Terms/Privacy | YES (drafts + API + audit) | Persistence tests | NO | NO | **NO** |

## Evidence artifacts

- `packages/documents/src/wp04-final-acceptance.test.ts` — ClamAV clean/EICAR/fail-closed, HTTP OCR gold text, load p50/p95, download quarantine, cross-org denial
- `packages/documents/src/malware.test.ts` — `CLAMAV_LIVE=1`
- `packages/auth/src/mfa-acceptance.test.ts`
- `packages/platform/src/legal-acceptance.test.ts`
- `packages/permissions/src/legal-acceptance.integration.test.ts`
- `docs/security/OCR_PRODUCTION_GATE.md`
- `docs/security/WP04_ATTORNEY_REVIEW_PACKAGE.md`
- `docs/operations/WP04_DEPLOYMENT_READINESS_CHECKLIST.md`

## Remaining blockers (external / human)

1. **Managed OCR endpoint** — configure `OCR_PROVIDER=http` + `OCR_ENDPOINT` on staging; load-test; then production.
2. **Managed ClamAV** — deploy clamd; set `MALWARE_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT`; staging upload rehearsal.
3. **Clerk staging MFA** — Dashboard org MFA + live enrollment/challenge with approved staging credentials (`REQUIRE_CLERK_MFA=1`). No production Dashboard changes from engineering automation.
4. **Attorney sign-off** — complete `docs/security/WP04_ATTORNEY_REVIEW_PACKAGE.md` checklist; bump versions after approval.

## Absolute session constraints observed

- Neon role/password changes: **0**
- Neon corpus writes: **0**
- CourtListener: **0**
- Paid AI: **0**
- Production deploy / merge: **NO**
- WP-03E: **deferred**
- WP-05: **not started**
