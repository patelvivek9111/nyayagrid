# Design-partner private beta — operator runbook

Status: **READY-FOR-EXTERNAL-DESIGN-PARTNER** is a release decision, not a default. Human legal review remains **READY-FOR-HUMAN-REVIEW**. Do not claim attorney validation or DOGFOOD PASS.

This is a **1–3 firm** invite-only preview on the existing staging host. Not a public launch. Not GA. Not CJIS / prosecutor-ready. `FEATURE_AGENTS=0`.

Partner-facing URL: `https://staging.nyayagrid.com`  
Fly app: `nyayagrid-staging`  
Auth: Clerk (`AUTH_PROVIDER=clerk`). DevAuth must not be exposed (`ALLOW_STAGING_DEV_AUTH` unset).

Git tag for this preview: `design-partner-beta-1` (annotate after the beta commit). Rollback Fly image if a new deploy fails: `nyayagrid-staging:deployment-01M2GY75WNPTSXXWQ2F5WS0VNM` (v49). Older pre-cutover image: `deployment-01M288AYQQMVAQTGW45B21DNJS` (v47). Keep `AUTH_PROVIDER=clerk`, `FEATURE_AGENTS=0`, and `ALLOW_STAGING_DEV_AUTH` unset on rollback.

Cutover order on Fly: set `AUTH_PROVIDER=clerk` **first**, then unset `ALLOW_STAGING_DEV_AUTH`. Unsetting the allow flag while `AUTH_PROVIDER` is still `dev` refuses boot.

Do not print Clerk secrets, SMTP passwords, invite tokens, or document text in tickets or chat.

## Design-partner roster

The organizations table has no metadata JSON. Do **not** add `betaProgram` via schema.

Record pilots in `docs/operations/design-partners.csv` (`program=design_partner`). Audit logs already carry `organizationId`. Match that id to the roster when reading ops logs.

| Field | Use |
| --- | --- |
| `organization_id` | Database id (logs, Inngest, audits) |
| `slug` | Human handle |
| `program` | Always `design_partner` for this cohort |
| `status` | `invited` / `active` / `paused` / `ended` |

## Clerk dashboard (required for invite-only)

**Access mode:** Invite-only (`restricted`) on the production Clerk instance for `staging.nyayagrid.com`. Do not switch back to Open / `public`.

New invited people who do not yet have a Clerk account create one through a **Clerk application invitation ticket**, issued only after NyayaGrid validates a live organization invite token. Public `/sign-up` in the product stays invitation-only copy and does not link hosted registration. Direct Account Portal sign-up without a ticket must remain blocked.

Do not remap NyayaGrid users by email. `users.authSubject` is the Clerk user id. Do not import local DevAuth identities.

## Create a design-partner organization

1. Create the firm owner in Clerk (email/password or SSO you control). Do not reuse DevAuth.
2. Owner signs in at `https://staging.nyayagrid.com/sign-in` (Continue → Clerk hosted sign-in).
3. Complete in-app onboarding: create the firm (name + slug). The creator becomes organization owner.
4. Record `organization_id`, slug, and status=`invited` then `active` in `design-partners.csv`.
5. Confirm Settings → Members shows the owner.

Do not attach partners to the historical DevAuth staging identity. That user and its cases stay isolated.

## Invite users

Inviteable roles: **lawyer**, **staff**, **client_guest**. Organization owner cannot be invited; the first user creates the firm.

1. Owner (or a member with `members.invite`) opens Settings → Invite member.
2. Enter the intended email and role.
3. The API stores only a SHA-256 of the token. The plaintext token is returned **once**.
4. If SMTP accepted the message, the recipient should use the email link.
5. If SMTP did not deliver, the operator uses the **one-time accept URL** shown in the dialog:
   - Send only to the invited address over a private channel (the product dialog, or an out-of-band operator channel you already trust).
   - Do **not** paste the link in Slack, SMS, email to a group, tickets, or logs.
   - If the link is lost or leaked: Revoke, then create a new invite. The old token cannot be recovered from the database.

Accept path: the recipient opens the email link (`/invites/accept?token=…`) while logged out. Middleware sends them to `/sign-in` with `returnTo` preserved (handshake tokens stripped). If they already have a Clerk account they Continue (sign in). If they do not, **Create account** issues a Clerk application invitation whose `redirect_url` is the Account Portal sign-up URL (not the app accept URL). NyayaGrid stores invite return intent in an httpOnly cookie and sends Clerk `sign_up_force_redirect_url` / `sign_in_force_redirect_url` to `/invites/resume` (Account Portal `after_sign_up` is the site origin, which previously dropped the session handshake). `/` is handshake-only: signed-out visitors still see the public page; a signed-in invite cookie resumes `/invites/accept`. They should not need to open `/app` first or paste the token. Email mismatch fails safely. Expired, revoked, or already-accepted tokens fail safely and cannot be reused. Do not paste tokens into tickets.

## Failed invite email

1. Confirm Settings still shows a **Pending** invite for that address.
2. Use the one-time fallback URL from the create-invite dialog if it is still on screen.
3. If the dialog was closed: **Revoke** the pending invite and create a new one. Do not search logs for the token (tokens are not logged on SMTP).
4. Diagnose SMTP from staging without printing secrets: `EMAIL_PROVIDER`, `SMTP_HOST` class, `SMTP_PORT`, `EMAIL_FROM` domain, username/password **set vs unset**. Handshake/auth failures appear as `SMTP send failed` with a `kind` only.

## Revoke / remove users

- **Unused invite:** Settings → Invitations → Revoke. The token stops working immediately.
- **Accepted member:** there is no in-app membership-disable control in this preview. To stop a person:
  1. Lock or delete the Clerk user in the Clerk dashboard (they cannot authenticate).
  2. Revoke any remaining pending invites for that email.
  3. Set roster `status=paused` (person) / keep the org row.
- **Stop a partner firm:** lock all Clerk users for that firm; revoke pending invites; set roster `status=paused` or `ended`. Do not set `FEATURE_AGENTS` or take the whole staging app down unless the incident is host-wide.

Membership rows may remain `active` after a Clerk lock; authorization still requires a live Clerk session.

## Verify organization membership

Settings → Members & access lists email + role.  
`GET /api/v1/organizations/:organizationId/members` (authenticated, `organization.manage`).  
Client guests only see assigned cases (Settings → Case access).

## Readiness / monitoring

- `GET https://staging.nyayagrid.com/api/health/ready` — 200; `featureAgents` is `"0"`; `providers.authProvider` is `"clerk"`; no Staging DevAuth warning.
- Inngest failed runs; `npm run beta:stuck-documents`
- ClamAV TCP `1/1` — `docs/operations/CLAMAV_STAGING.md`
- Provider timeouts / 429s in structured logs (**ids only**)
- 401/403 and 5xx spikes

No new observability platform. Confirm agents stay off on every ready probe. Do not set `FEATURE_AGENTS=1`.

## Escalate CRITICAL issues

**CRITICAL** — fabricated authority or exhibit; material unsupported fact presented as established; cross-org or cross-matter leakage; unauthorized send/file/sign; dangerous false certainty.

1. Stop the affected path if needed (lock Clerk users / pause the partner / take staging private).
2. Reproduce with ids only (org, matter, document, conversation). Do not paste file text.
3. Fix narrowly, verify, tell the internal owner immediately. Do not wait for a batch release.

**MAJOR** — materially wrong synthesis; important omission; misleading contradiction; incorrect controlling provision; materially wrong research framing. Reproduce, prioritize, targeted repair.

**MINOR** — wording, navigation, non-material presentation. Collect and batch.

## Partner onboarding checklist (session)

Prefer synthetic, public, or non-sensitive evaluation files.

1. Clerk sign-in (not DevAuth).
2. Enter the assigned organization.
3. Explain private preview: `/terms` is **COUNSEL_PENDING** (draft, not a binding production agreement); `/ai-disclosure` is the operational disclosure. Not attorney-validated.
4. Upload a non-sensitive pilot matter (dogfood DF-01 packet is the default walkthrough).
5. Wait until documents show **Ready** and malware scan **clean**.
6. Ask Nyaya a payment/term question with a visible source. Open **View source**.
7. Show Timeline / Evidence where applicable. Research is corpus-limited, not Westlaw/Lexis.
8. Confirm chats persist after reload. Agents off (`featureAgents=0`).
9. Capture feedback (below).

## Record partner feedback

**Every meaningful session** — one row in `benchmarks/nyaya-bench/dogfood/forms/beta-sessions.csv`.

Usefulness: `useful` / `partially_useful` / `not_useful`.  
Would-use: `YES` / `WITH_CHANGES` / `NO`.

## Record attorney review when one occurs

Legally qualified reviewers complete `forms/reviews.csv` + `forms/issues.csv` using [RUBRIC.md](../../benchmarks/nyaya-bench/dogfood/RUBRIC.md). Drop completed files in `dogfood/completed/` and run `npm run dogfood:aggregate -w @nyayagrid/nyaya-bench`.

Never average away CRITICAL. Operator-only rows cannot close DOGFOOD PASS. Do not manufacture PASS.

## Security / data boundaries

| Control | Status |
| --- | --- |
| Auth | Clerk on the partner-facing host; DevAuth must be unset |
| Organization isolation | Capability + tenant scoping; do not share the historical DevAuth org with partners |
| Matter isolation | Documents/Ask/chats are matter-scoped |
| Role boundaries | Capability checks; client guest assignment |
| Invites | Hashed tokens, 7-day expiry, single-use, email match, revoke |
| Private object storage | Staging S3; signed/authenticated downloads |
| Malware scan | ClamAV; fail-closed |
| Secrets / file text in logs | Redacted; invite tokens must not be logged |
| Backup/restore | `docs/BACKUP_RESTORE.md`; Neon staging PITR bound 6h on Free |

Do not claim SOC 2, CJIS, or prosecutor certification.

## Rollout limits

- 1–3 design-partner firms
- Limited users per firm, controlled invitations
- Direct communication channel
- No public self-service signup
- `FEATURE_AGENTS=0`
- Synthetic or non-sensitive first matter
- `/terms` remains a counsel-pending draft
