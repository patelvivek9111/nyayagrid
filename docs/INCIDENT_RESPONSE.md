# Incident Response — NyayaGrid

**Status: documented, not rehearsed.** These runbooks have not been exercised as a tabletop/game-day
exercise. Treat them as a first draft to walk through and correct, not a proven process. Because
NyayaGrid handles legal matters (client-privileged and personally sensitive data), a security
incident here can carry professional-responsibility and regulatory consequences beyond the usual
"outage" cost — treat any suspected data exposure as high severity by default.

## Severity levels

| Level | Definition                                                                | Examples                                                                                                | Initial response time               |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| SEV1  | Active data breach, cross-tenant data exposure, or full outage            | A user reports seeing another organization's matter; the app is down for all users                      | Immediate — page on-call, all hands |
| SEV2  | Partial outage or degraded core functionality, no confirmed data exposure | Nyaya Ask returning errors for all users; database at capacity; malware scanner down (blocking uploads) | Within 30 minutes                   |
| SEV3  | Degraded non-core functionality, workaround exists                        | Research corpus import job stuck; one background job type failing                                       | Within business day                 |
| SEV4  | Cosmetic/minor                                                            | UI glitch, non-blocking log noise                                                                       | Next sprint                         |

**Any suspicion of cross-tenant data exposure or unauthorized access to client documents is
automatically at least SEV1**, regardless of how small the scope initially appears — legal
matters carry confidentiality obligations that make "wait and confirm scope first" the wrong
default.

## General response process

1. **Detect** — via health check failure, error-rate alert (once configured — see
   [Operations](./OPERATIONS.md)), or a user/support report.
2. **Triage** — assign a severity (above), assign an incident lead, open a shared channel/doc.
3. **Contain** — stop the bleeding before finding root cause if the two are in tension. For a
   suspected data exposure, this may mean revoking sessions, disabling a feature flag
   (`packages/platform/src/features.ts`), or taking the affected endpoint offline entirely.
4. **Communicate** — internal stakeholders first, then affected customers/users once scope is
   understood, per your organization's disclosure obligations (this varies by jurisdiction and by
   what data was exposed — involve legal/compliance immediately for any SEV1 with a data
   component).
5. **Resolve** — fix, verify, and reopen the affected path.
6. **Postmortem** — blameless write-up within 5 business days for SEV1/SEV2: timeline, root cause,
   what worked, what didn't, and concrete follow-up actions with owners.

## Specific runbooks

### Suspected cross-tenant data exposure

1. Immediately treat as SEV1.
2. Identify the request path involved (which API route, which capability check, if any).
3. Check `auditEvents` for the affected organization(s)/matter(s) to reconstruct what was actually
   accessed and by whom, and over what time window.
4. If a specific authorization check is confirmed broken, disable the affected route/feature (flag
   or infra-level block) rather than leaving it live while you fix and redeploy.
5. Once confirmed contained, assess whether any exposed data requires breach notification (legal
   review required — do not decide this unilaterally as engineering).
6. Add a regression test in `packages/permissions/src/*.integration.test.ts` and/or
   `e2e/security.spec.ts` reproducing the exact failure before closing the incident.

### Database unreachable / `GET /api/health/ready` returning 503

1. Check the database check's reported error message in the health response
   (`checks.databaseError` — never contains secrets, see `apps/web/src/app/api/health/ready/route.ts`).
2. Confirm from the database host/provider side: is it up, is it out of connections, is it out of
   disk?
3. If it's a managed provider outage, this is generally outside engineering's direct control —
   monitor the provider's status page and communicate an ETA to users if the outage is prolonged.
4. If self-hosted, restart/scale per your infrastructure's runbook; escalate to
   [Backup & Restore](./BACKUP_RESTORE.md) only if data corruption/loss is suspected, not for a
   simple restart.

### AI provider (OpenAI) outage or rate-limited

1. `AI_PROVIDER=openai` calls will start failing; user-facing symptom is Nyaya Ask/Professor/Guide/
   Research/Draft/Agents returning errors.
2. Confirm via OpenAI's status page whether it's a provider-side outage vs. your own rate/quota
   limit being hit.
3. There is currently no automatic fallback provider wired into production config (mock is
   development-only and must never serve real answers) — communicate a temporary outage to users
   rather than silently degrading to mock output.
4. If it's a quota/rate issue on your account, this is a capacity-planning problem — see
   [Operations](./OPERATIONS.md) for the per-endpoint-class rate limit presets already in place on
   _your_ side.

### Malware scanner (ClamAV) down

1. Document uploads should **fail closed** (rejected) rather than being accepted unscanned when
   the scanner is unreachable — verify this is still true for the specific failure mode observed
   (a `ClamAvMalwareScanner` with no fixture mode and no reachable host throws at
   construction/scan time; confirm the calling code treats that as upload-rejected, not
   upload-allowed).
2. This is a SEV2 (blocks a core workflow, no data exposure) unless investigation reveals uploads
   were incorrectly accepted while the scanner was down, which escalates it to SEV1.
3. Restore ClamAV connectivity; once restored, consider re-scanning any documents uploaded during
   the outage window if there's any chance the fail-closed behavior didn't hold.

### Rate limiter behaving unexpectedly after scaling out

Expected, not a bug (yet): `RATE_LIMIT_PROVIDER=memory` counts per process. Adding instances
effectively raises the real-world limit (each instance has its own counter) and a rolling
deploy/restart resets counters to zero. This is tracked as a BLOCKER for horizontal scaling in
[Production Readiness](./PRODUCTION_READINESS.md) — the fix is implementing a shared-store rate
limiter, not an incident response action.

## Contacts

Fill in before launch: on-call rotation, escalation path to legal/compliance for data-exposure
incidents, and the managed Postgres/S3/Clerk/OpenAI support channels for your specific vendor
plans.
