# NYAYAGRID P0 SECURITY REMEDIATION

Date: 2026-08-19  
Audit frozen: `docs/security/PHASE_SECURITY_BETA_AUDIT.md` (finding IDs unchanged)

## 1. Executive Summary

P0 blockers from the beta security audit are closed in application code and config gates.

Decision: **READY FOR CONTROLLED BETA** after operators deploy with:

- `APP_ENV=production`
- `AUTH_PROVIDER=clerk`
- real `INNGEST_SIGNING_KEY` (or `INNGEST_DISABLED=1`)
- `MALWARE_SCANNER=clamav` (already a production boot requirement)
- Professor left at the staging/production default (`FEATURE_PROFESSOR` off)

Local development is unchanged when `.env` sets `APP_ENV=development` and `AUTH_PROVIDER=dev`.

## 2. SEC-C1

**Root cause:** `POST /api/v1/research/import` allowed `documents.upload` to write the global `legal_authorities` corpus.

**Change:** HTTP import is off in staging/production unless `ALLOW_AUTHORITY_HTTP_IMPORT=1`. When enabled (or in local/test), the caller must have `organization.manage`. Lawyers, staff, and guests cannot import. Offline/CLI ingest is unchanged.

**Tests:** `isAuthorityHttpImportEnabled` in `packages/platform/src/config.test.ts`; import route requires manage + flag.

**Status:** CLOSED

## 3. SEC-C2

**Root cause:** Org research sessions accepted `matterId` with `matters.view` and no matter membership.

**Change:** All org research session routes require `research.run`. If `matterId` is set (create, list filter, or stored on the session), `requireMatterAccess(..., capability: "research.run")` plus `matter.organizationId === session.organizationId`. Session lists filter matter-linked rows through `filterVisibleResearchSessions` + `listAuthorizedMatterIds`. Owners with `organization.manage` still see all in-tenant matters (existing permission model).

**Tests:** `packages/research/src/sessions.visibility.test.ts`; `packages/permissions/src/beta-security-audit.integration.test.ts` (guest lacks `research.run`; non-member lacks matter access).

**Status:** CLOSED

## 4. SEC-C3

**Root cause:** DevAuth ran whenever `APP_ENV` was not production-like, including the inferred default `development`.

**Change:** DevAuth identity is issued only when `APP_ENV` is **explicitly** `development`, or the process is `test`. Missing `APP_ENV` + `NODE_ENV=development` returns no identity. Staging with `AUTH_PROVIDER=dev` **throws at startup**. Production already refused DevAuth; that remains.

**Tests:** `isExplicitLocalDevAuthAllowed` + `validateConfigForEnv` staging throw; `DevAuthProvider` missing-APP_ENV test.

**Status:** CLOSED

## 5. Invite Security

**Email:** Accept loads the authenticated user’s email from the database and compares it (trim + lowercase) to the invite email. Mismatch → `EMAIL_MISMATCH` (403). Client JSON cannot supply the email.

**Roles:** Inviteable keys are `lawyer`, `staff`, `client_guest` only. `owner` is refused (`ROLE_NOT_INVITEABLE`). Schema `inviteMembershipSchema.roleKey` is the same enum.

**Tests:** `packages/auth/src/invites.test.ts` (mismatch, owner refuse). Integration accept tests updated to matching emails.

**Status:** CLOSED

## 6. Inngest

Production config requires a non-weak `INNGEST_SIGNING_KEY` (`local`, empty, short, placeholder values fail). `INNGEST_DEV` is a production blocker. `INNGEST_DISABLED=1` skips the gate if jobs are unused. Job/orchestrator behavior unchanged.

**Tests:** `collectProductionConfigProblems` Inngest cases in `config.test.ts`.

**Status:** CLOSED

## 7. Upload / archive security

Live professional pipeline loads object bytes and passes `buffer` into `rejectZipBombsOrArchives`. The upload route does the same before `putObject`. ZIP magic on a `.pdf` is rejected. Recognized DOCX (extension or OOXML MIME) is allowed despite ZIP magic. Production still refuses `MALWARE_SCANNER=development` (existing gate + tests).

**Tests:** `packages/documents/src/index.test.ts` (malware.pdf ZIP, DOCX ZIP magic).

**Status:** CLOSED

## 8. Rate limiting

Existing presets wired on:

- research session create/list/query/memo + import → `research`
- agent run POST + ask-or-task when a run may be created → `agent_run`
- intelligence extract, contract/deposition/contradiction/comparison POST → `expensive_ai`

Agent planner/tools/approvals were not modified.

**Tests:** `apps/web/src/lib/rate-limit.test.ts`; `apps/web/src/lib/expensive-route-limits.test.ts`.

**Status:** CLOSED

## 9. Professor deployment posture

Staging/production default remains `FEATURE_PROFESSOR=false`. All Professor API routes now call `requireProfessorUser` (flag + auth). The `/professor` layout shows a disabled message when the flag is off, matching Guide.

**Tests:** `packages/platform/src/features.test.ts` (production/staging off).

**Status:** CLOSED (feature off for professional beta; not a second upload stack)

## 10. Regression results

Passed in this phase:

- platform config + feature flags
- auth DevAuth + invites unit tests
- documents upload-limit tests
- research session visibility
- web rate-limit + route-wiring tests
- agent `tools.test.ts` + `prompt-injection.test.ts`

DB integration tests (`RUN_DB_TESTS=1`) were not run in this session (same as typical local without the flag). Existing phase isolation suites were not rewritten.

## 11. Remaining P1/P2 findings

Unchanged from the audit, including: existence oracles, generic 500 `error.message`, no RLS, CSP nonce, middleware, deletion/MinIO purge, health detail, DB SSL, `allowedDocumentIds` SQL, org-wide time entries, professional prompt delimiters.

## 12. Beta Security Decision

**READY FOR CONTROLLED BETA**

provided the production environment uses Clerk, explicit `APP_ENV=production`, ClamAV, Redis rate limits, and a real Inngest signing key (or jobs disabled). Do not enable `ALLOW_AUTHORITY_HTTP_IMPORT` or `FEATURE_PROFESSOR` on the professional beta cluster.
