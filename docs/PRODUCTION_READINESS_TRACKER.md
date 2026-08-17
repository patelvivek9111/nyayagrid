# Production Readiness — Task Tracker

**Goal:** Take NyayaGrid from “the app refuses to boot unsafely” to an operator-verified production posture: real Clerk auth, real malware scanning, durable S3, rehearsed backup/restore, external monitoring, and attorney-reviewed Terms / Privacy. NyayaGrid is **not go-live** today. This track is mostly ops and verification, not more Case tabs.

**Status (2026-08-17):** In-repo / local staging-shaped track is complete. Live Clerk apps, AWS S3, managed-Postgres PITR, monitoring/paging, and counsel sign-off remain **BLOCKER**. Do not treat this file as a go-live sign-off.

Source of truth: [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) (statuses: READY / CONFIG REQUIRED / BLOCKER / OPTIONAL).  
Related: [`DEPLOYMENT.md`](./DEPLOYMENT.md) · [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) · [`OPERATIONS.md`](./OPERATIONS.md) · [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) · [`PRODUCTION_SECURITY_REVIEW.md`](./PRODUCTION_SECURITY_REVIEW.md) · [`SECURITY.md`](./SECURITY.md)

Gate code: `packages/platform/src/config.ts` (`collectProductionConfigProblems` / `validateConfigForEnv`) · boot: `apps/web/src/instrumentation.ts` · probe: `GET /api/health/ready`

Mark items `[x]` as they ship or are verified. Update [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) in the same change when a row’s status actually changes.

---

## Scope

**In scope**

- Provision and verify production-shaped providers (Clerk, OpenAI, ClamAV, AWS S3, SMTP, Inngest Cloud, managed Postgres + pgvector)
- Shared-store rate limiting before more than one web instance
- Backup + restore rehearsal against the target providers, with documented RPO/RTO
- External monitoring, alerting, log aggregation, on-call
- Attorney review of Terms of Service and Privacy Policy
- Staging rehearsal (`APP_ENV=staging`) that surfaces every remaining config gap without being unbootable
- Incident-response tabletop against the existing runbooks
- Honest updates to production docs after each verification

**Out of scope** (do not pull in unless asked)

- More Case tabs, Case Experience §7, or Case dogfood (that is [`CASE_DOGFOOD_TRACKER.md`](./CASE_DOGFOOD_TRACKER.md))
- Firm ops product work: email/calendar *sync product*, time tracking, billing UX, client portal, notifications (Phase 8)
- Nyaya Professor / Nyaya Guide hardening (that is [`NYAYA_PROFESSOR_TRACKER.md`](./NYAYA_PROFESSOR_TRACKER.md))
- A proprietary foundation model, autonomous filing, or replacing Westlaw/Lexis
- Treating [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) as a sign-off — engineering + legal still review before any production deployment

**Still listed as BLOCKER in the source doc, but not “ops” in the same sense** — keep visible, do not pretend they vanish:

- OCR adapter (`OCR_PROVIDER` is only `none`) — do not advertise OCR; image-only PDFs staying `requires_ocr` is the safe behavior
- Licensed, jurisdiction-verified legal authority corpus — Nyaya Research still uses the Phase 6 **synthetic fixture corpus**; do not present it as covering real law

Those two are product/legal decisions. Log them in §8; do not block Clerk/S3/ClamAV work on building OCR or buying a reporter license in the same slice.

---

## 1. Staging first, production intent explicit

The app will not start as `APP_ENV=production` with unsafe defaults. Staging logs the same problems as warnings and still boots. Use that.

- [x] Choose the target cloud (compute, secrets manager, log driver) and write it here: **local Docker Compose** (Postgres 16 + pgvector, MinIO, Redis, ClamAV) until a paid cloud is selected. Suggested paid target: one AWS region, RDS Postgres with `pgvector` + `pgcrypto`, S3, Clerk, Inngest Cloud, CloudWatch.
- [x] Staging-shaped env documented (`APP_ENV=staging`, `.env.staging.example`) — a cloud staging deploy is still operator work
- [x] `GET /api/health/live` → 200
- [x] `GET /api/health/ready` returns provider **names and booleans only** — never secrets — and lists remaining config warnings (`checks.databaseError` is `unreachable` outside development)
- [x] Confirm `NODE_ENV=production` alone is **not** treated as a safe intent declaration (missing `APP_ENV` still fails closed in production)
- [x] Feature flags: in staging/production, `FEATURE_*` default **off** until explicitly enabled (`packages/platform/src/features.ts`). Turn on only the workspaces you mean to serve
- [x] `AUTH_PROVIDER=dev` cannot authenticate on staging/production (`DevAuthProvider` returns no identity; production boot still refuses `AUTH_PROVIDER=dev`)

---

## 2. Clerk (auth) — CONFIG REQUIRED / BLOCKER until live-verified

Adapter exists (`ClerkAuthProvider` in `@nyayagrid/auth`) and is wired from `apps/web` (`resolveClerkSession` + `POST /api/webhooks/clerk`). Production wiring has **not** been verified against a live Clerk production instance.

Code: `packages/auth/src/index.ts` · env: `AUTH_PROVIDER=clerk`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

- [ ] Create Clerk **production** (and staging) applications; never reuse the dev instance’s keys in production
- [x] Wire Clerk session resolution in `apps/web` so `ClerkAuthProvider.getIdentity` receives a real `userId` (not the package-level throw) — `apps/web/src/lib/clerk-session.ts` via `@clerk/backend`
- [ ] Sign-in / sign-up / redirect URLs and session cookie domain / CORS verified on the real deployed origin
- [x] Webhook signature verification for user/org lifecycle events (create, update, delete) — identity only; authorization stays in `@nyayagrid/permissions` (`POST /api/webhooks/clerk`)
- [x] Organization membership sync does not grant capabilities from IdP metadata alone (those events are ignored)
- [x] Email on the identity is the Clerk email, not `${userId}@clerk.local` (missing email → unauthenticated)
- [ ] MFA enabled on the Clerk production instance (enterprise-ready auth requirement)
- [x] `DevAuthProvider` / `x-nyayagrid-dev-user` cannot authenticate on staging/production
- [ ] End-to-end: new user signs in → `ensureUserFromIdentity` creates the NyayaGrid user → onboarding / org membership works
- [ ] Forged session or missing cookie is 401 on matter APIs (`e2e/security.spec.ts` equivalent against staging)
- [ ] Flip [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) item 2 from BLOCKER to READY only after the live verification above

---

## 3. ClamAV (malware scan) — BLOCKER

`DevelopmentMalwareScanner` never scans. `ClamAvMalwareScanner` exists (`packages/documents/src/malware.ts`) with TCP INSTREAM + `fixtureMode` for tests. **No real clamd has been provisioned or load-tested.** Do not accept client uploads until this is live.

- [x] Provision `clamd` reachable from the app (`CLAMAV_HOST`, default port 3310) **or** a SaaS scanner behind the same `MalwareScanner` interface — docker-compose `clamav` service (production host still operator work)
- [x] `MALWARE_SCANNER=clamav` in staging-shaped env (`.env.staging.example`); `fixtureMode` off / forbidden in staging/production
- [x] EICAR test file is **blocked** on the live **local docker** scanner (`npm run ops:verify-clamav`, 2026-08-17: `Eicar-Test-Signature FOUND`, clean payload `OK`). Production/SaaS clamd still operator work.
- [ ] A clean SYNTH upload reaches `ready`; an infected sample is `blocked` and the original is not treated as a live Case document
- [x] Scanner-down behavior matches [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) (uploads must not silently skip scanning — `malware_scan_failed`, not `ready`)
- [ ] Load-test: concurrent uploads do not time out the default 30s window without a documented back-pressure plan
- [ ] Flip production-readiness item 5 to READY only after live EICAR + clean-file verification

---

## 4. Object storage (S3) — CONFIG REQUIRED / BLOCKER until provisioned

MinIO is allowed in production only with `ALLOW_MINIO_IN_PRODUCTION=1` and only if you self-host and back it up. Real AWS S3 credentials, bucket policy, encryption-at-rest, and versioning have **not** been provisioned.

- [ ] Create production and staging buckets (`S3_BUCKET`); `STORAGE_PROVIDER=s3`
- [ ] IAM role (preferred) or keys in the secret manager — never bake credentials into the image
- [ ] Encryption at rest (SSE-S3 or SSE-KMS) enabled
- [ ] Bucket versioning enabled (pairs with backup/restore)
- [ ] Bucket policy: app role can Get/Put/Delete only on the intended prefix; public access blocked
- [x] Confirm originals are stored under tenant-scoped keys (`storageKeyForOrganization`) and are not listable anonymously
- [ ] Optional but recommended: cross-region replication
- [ ] App can `ensureBucket`, upload, download, and process a SYNTH document end-to-end on staging
- [ ] Flip items 6 and 12 in [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) after that verification
- [x] If remaining on MinIO: document why, set `ALLOW_MINIO_IN_PRODUCTION=1`, and own volume backup explicitly — still a durability exception, not “READY” (local/staging uses MinIO; production S3 still required unless this exception is accepted)

---

## 5. Managed Postgres + pgvector

- [ ] Choose a managed provider that allow-lists `pgvector` **and** `pgcrypto`
- [ ] `DATABASE_URL` points at that instance for staging, then production
- [x] Extensions installed on local docker Postgres; `npm run db:migrate` run as an **explicit** step (never on container start — see [`DEPLOYMENT.md`](./DEPLOYMENT.md))
- [x] Connection pooling plan if more than one web replica (PgBouncer / provider pooler); watch connection count — documented in [`OPERATIONS.md`](./OPERATIONS.md)
- [x] Tenant isolation remains app-layer (`organizationId` / `matterId` + capabilities). RLS is OPTIONAL defense-in-depth — do not adopt it as a surprise in this track
- [x] `/api/health/ready` database check fails closed (503) when Postgres is unreachable

---

## 6. Backup and restore — BLOCKER

No restore has ever been executed end-to-end against the target managed Postgres. Treat [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) as a checklist to **execute**, not evidence that recovery works.

Postgres and object storage are a **matched pair**. A document row without a storage object (or the reverse) is a data-integrity bug.

- [x] Agree RPO and RTO; write them into [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) (interim 24h / 4h for dumps; target ≤5 min / ≤1 h once managed PITR exists)
- [ ] Enable provider PITR / automated backups on staging and production Postgres
- [ ] S3 versioning (and replication if chosen) covering the same window as Postgres PITR
- [x] **Rehearse locally:** restore Postgres to a **new** database (`npm run ops:backup-rehearse` → `nyayagrid_restore_test`) — never over live
- [x] Archive object storage (MinIO volume tarball) to the **same rehearsal directory**
- [ ] Point a staging app (`APP_ENV=staging`) at a restored **managed** DB + bucket
- [ ] Verify on the managed restore: `/api/health/ready` ok; a known SYNTH matter loads with documents and timeline; a `pgvector` similarity search returns results (indexes survived)
- [x] Document the local commands (`npm run ops:backup-rehearse`); correct [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) where the draft procedure was wrong
- [x] Schedule: restore rehearsal at least quarterly ([`OPERATIONS.md`](./OPERATIONS.md)) until automated
- [ ] Flip the Backup & Restore row from BLOCKER to READY only after one successful matched restore on the **target managed provider**

---

## 7. Monitoring, alerting, on-call — BLOCKER

Structured JSON logs exist (`@nyayagrid/observability`). Health endpoints exist. There is **no** external monitoring, alerting, uptime paging, or log aggregation.

- [ ] Ship container stdout/stderr to a log aggregator (CloudWatch / Loki / Datadog / equivalent)
- [ ] Confirm logs never contain document text, prompts, privileged material, access tokens, or personal data
- [ ] Uptime checks: `/api/health/live` (process) and `/api/health/ready` (load balancer — 503 on DB failure)
- [ ] Alert: ready failing, elevated 5xx, malware scanner down, AI provider error rate, disk/connection saturation
- [ ] On-call rotation and paging destination documented in [`OPERATIONS.md`](./OPERATIONS.md)
- [ ] AI usage / cost: `aiUsageEvents` reviewed on the cadence in Operations (weekly at early launch)
- [ ] Audit-event review cadence for anomalous access (weekly at early launch)
- [ ] Flip Monitoring row from BLOCKER to READY when paging actually fires on a staged failure (not only “dashboards exist”)

---

## 8. Attorney-reviewed Terms and Privacy — BLOCKER

Pages exist: `apps/web/src/app/terms/page.tsx`, `apps/web/src/app/privacy/page.tsx`. Content is a **structural draft** with a “Draft — pending attorney review” badge. Do not launch to real users until reviewed.

Must be covered in the reviewed text (placeholders already name the sections):

- [ ] No attorney-client relationship formed by using Nyaya / Professor / Guide
- [ ] AI output is draft work product; humans remain responsible for advice, filings, and signatures
- [ ] Confidentiality / professional-conduct obligations for firm workspaces
- [ ] Student and public workspaces are isolated; no privilege claim for Guide
- [ ] Customer data is not used for model training without explicit, separately recorded consent
- [ ] Retention, legal holds, export, and deletion
- [ ] Jurisdiction and “not a substitute for a lawyer” for Guide; “not a course substitute” for Professor
- [ ] Counsel signs off; draft badge removed only then
- [ ] Flip Terms / Privacy row from BLOCKER to READY after sign-off is recorded (who, date)

---

## 9. Other config-gate providers

These are in `collectProductionConfigProblems`. Do them as ops slices; do not skip because they were not in the one-line summary.

### 9.1 OpenAI (AI + embeddings) — CONFIG REQUIRED

- [ ] `AI_PROVIDER=openai` + `OPENAI_API_KEY`; `EMBEDDING_PROVIDER=openai`
- [ ] `MockAIProvider` / hash embeddings cannot serve in production (gate already refuses)
- [ ] Pin models used in production; budget caps / `expensive_ai` rate-limit class understood
- [ ] Provider outage behavior: communicate outage — **never** silently fall back to mock ([`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md))

### 9.2 SMTP — CONFIG REQUIRED

- [ ] `EMAIL_PROVIDER=smtp` with `SMTP_HOST` / `SMTP_PORT` / `EMAIL_FROM`
- [ ] `ConsoleEmailProvider` must not run in production (invite links would leak into logs)
- [ ] Send a real invite on staging; link works; logs do not contain the raw token if that can be avoided

### 9.3 Inngest Cloud — CONFIG REQUIRED

- [ ] Production has no separate worker process; point Inngest Cloud at `/api/inngest` with `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`
- [ ] Document processing / agent jobs actually run on staging via Inngest, not only via the local `apps/worker` dev CLI
- [ ] Signing key rejects unsigned deliveries

### 9.4 Billing provider — CONFIG REQUIRED

- [ ] `BILLING_PROVIDER=database` (or the real adapter when you have one)
- [ ] `DevelopmentBillingProvider` (every entitlement free) cannot front paying customers
- [ ] Do **not** build a full billing product in this track — only stop the “everything is free” development stand-in

### 9.5 Shared rate-limit store — BLOCKER before horizontal scale

- [x] Implement a Redis (or equivalent) `RateLimitProvider` behind the existing interface (`packages/platform/src/redis-rate-limit.ts`)
- [x] `RATE_LIMIT_PROVIDER` backed by that store is the staging-shaped default (`.env.staging.example`); production must set `REDIS_URL`
- [x] Prove limits hold across two limiter instances (unit test against a fake Redis; two app processes still need a live Redis)
- [x] Until a live Redis is in the deployment: **one web instance only**, or accept multiplied limits — documented in [`DEPLOYMENT.md`](./DEPLOYMENT.md) / [`OPERATIONS.md`](./OPERATIONS.md)
- [x] Presets remain starting points (`auth`, `upload`, `ask_nyaya`, `research`, `agent_run`, `professor`, `guide`, `expensive_ai`)

---

## 10. Incident response rehearsal — CONFIG REQUIRED (documented, unrehearsed)

Runbooks: [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md). They have not been walked as a game day.

- [ ] Tabletop SEV1: suspected cross-tenant exposure (audit events, feature-flag disable, notification to legal)
- [ ] Tabletop: `/api/health/ready` 503 (database)
- [ ] Tabletop: OpenAI outage (no mock fallback)
- [ ] Tabletop: ClamAV down (uploads fail closed)
- [ ] Correct the runbooks where the tabletop showed they were wrong
- [ ] Postmortem template and 5-business-day rule for SEV1/SEV2 remain in the doc

---

## 11. Dependencies, CI, and container

Already READY for local/CI; still operator work before go-live.

- [ ] Re-run `npm audit --omit=dev`; update [`PRODUCTION_SECURITY_REVIEW.md`](./PRODUCTION_SECURITY_REVIEW.md)
- [ ] Tracked highs: `drizzle-orm` identifier SQL injection (needs a dedicated bump + declare phantom deps in `apps/web` and `packages/intelligence`); `next` major for transitive `postcss`/`sharp` — **do not** `--force` mid-ops without a regression pass
- [ ] CI (`.github/workflows/ci.yml`) still green on the release commit: format, lint, typecheck, unit+integration (pgvector service), build, mock AI eval, E2E
- [ ] Staging image from `Dockerfile` (multi-stage, non-root, Next.js standalone) smoke: live + ready
- [ ] Secrets only from the platform secret manager at runtime; image contains none
- [ ] Optional: `npm run eval:ai:live` remains manual/nightly with pin + budget — not a go-live blocker ([`AI_EVAL_LIVE.md`](./AI_EVAL_LIVE.md))

---

## 12. Product/legal blockers that are not this ops slice

Do not “complete” production readiness by ignoring these. Do not build them as Case tabs either.

| Item | Status today | Rule for this track |
| --- | --- | --- |
| OCR | BLOCKER — adapter is `none` | Do not advertise OCR. Image-only PDFs stay `requires_ocr`. Schedule a named OCR adapter later. |
| Licensed authority corpus | BLOCKER — SYNTH fixtures only | Nyaya Research must not be presented as covering real law. Sourcing a license is a legal/product decision, not a Case-tab task. |
| Postgres RLS | OPTIONAL | App-layer isolation is the load-bearing control. RLS is future defense-in-depth. |

- [ ] Launch checklist / marketing / in-app copy does **not** claim OCR or real-reporter coverage
- [ ] If go-live is attempted without a licensed corpus, Research stays behind a warning or flag — recorded in [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md)

---

## 13. Go-live gate (do not check until 1–11 are actually done)

NyayaGrid is not production-ready until a human (engineering + legal) reviews this list.

- [ ] Every CONFIG REQUIRED / BLOCKER row in [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) is READY or an explicit, written exception with owner and expiry
- [ ] Staging dogfood of sign-in, upload, ask, and invite against real providers (SYNTH data only)
- [ ] Engineering sign-off: _name, date_
- [ ] Legal sign-off (terms + privilege / training-consent language): _name, date_
- [ ] Production `APP_ENV=production` boot succeeds against the real config and still refuses unsafe stand-ins

---

## How to use

1. Pick the next unchecked **section** (order above is preferred: staging → Clerk → ClamAV → S3 → Postgres → backup → monitoring → terms, then the remaining providers).
2. Implement or verify + test.
3. Check boxes in **this file** and update [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) in the same PR / session when a status actually changes.
4. Move a whole section to done only when all of its boxes are `[x]`.
5. Do not start Case dogfood or Nyaya Professor in the same session as this track.

---

## Close-out (2026-08-17)

In-repo / local staging-shaped P2 is done. Go-live (Clerk MFA on a live app, AWS S3, managed PITR, monitoring/paging, counsel) is **not**.

- `npm run seed:golden-matter` — `SYNTH-GOLDEN-LEASE-V1` (`3ad4246b-853d-4e18-97c0-f622781293ce`); depo + PM email `ready` (all six docs `ready`).
- Evidence Detect `{ force: true }` → 201, **Conflicting CAM send dates**, Suggested/proposed.
- Local backup rehearsal: `npm run ops:backup-rehearse` restored `nyayagrid_restore_test` with `vector` + `pgcrypto`.
- Local ClamAV: `npm run ops:verify-clamav` — EICAR FOUND, clean OK.
- Health: `/api/health/live` 200; `/api/health/ready` 200 with provider names/booleans only.
