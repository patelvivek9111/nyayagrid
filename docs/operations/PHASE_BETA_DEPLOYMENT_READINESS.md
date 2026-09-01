# NYAYAGRID BETA DEPLOYMENT READINESS

This is an operations audit of the **actual** repo stack. There is no Kubernetes, Terraform, or multi-region layer in-tree. Production is: one Next.js web process, managed Postgres+pgvector, Redis, S3/MinIO, ClamAV, Clerk, OpenAI, and Inngest Cloud calling `/api/inngest`.

Draft and frozen AI subsystems were not modified.

---

## 1. Executive Summary

Security P0 and Performance P0 (async ingest) are already encoded in boot gates. Remaining ops gaps that would still hurt a first beta:

- In-app **SMTP invite send is unimplemented** (console is forbidden; `EMAIL_PROVIDER=smtp` throws at send). Use Clerk to add users for now.
- Managed **Postgres/object-storage restore has not been proven** on the production-shaped provider (local docker rehearsal exists).
- **Dockerfile.worker is Inngest Dev CLI only** — production must use Inngest Cloud against the web `/api/inngest` URL, not that image.

This phase added: stricter production fail-closed (Inngest required; Professor/Agents/HTTP import rejected; compose MinIO creds rejected), Agents API feature-flag, Redis/config on readiness, `npm run beta:check` / `beta:stuck-documents` / `beta:smoke`, seed/bench refuse `APP_ENV=production`, `.env.beta.example`.

**Decision: READY AFTER P0 OPS FIXES** — specifically: (1) Inngest Cloud registered against the deployed app before any real upload, (2) Clerk-based user provisioning because SMTP cannot send, (3) operator-owned backups with a restore you have actually run.

---

## 2. Production Architecture

| Component | Process | Port (local compose) | Secrets / env | Health | Failure |
| --- | --- | --- | --- | --- | --- |
| Web (`apps/web`) | `node apps/web/server.js` (Docker) or `next start` | 3000 | See §3 | `/api/health/live`, `/api/health/ready` | Production boot **throws** on unsafe config (`instrumentation.ts`) |
| Postgres + pgvector | compose `pgvector/pgvector:pg16` or managed | 5433→5432 | `DATABASE_URL` | `pg_isready`; app `select 1` | Ready 503 |
| Redis | compose `redis:7-alpine` | 6379 | `REDIS_URL` | `PING`; app ping | Rate limits **fail closed** (deny); ready 503 |
| MinIO / S3 | compose MinIO 9000/9001 or AWS S3 | 9000 | `S3_*` | `ensureBucket` | Ready 503 in staging/production |
| ClamAV | compose `clamav/clamav` | 3310 | `CLAMAV_HOST` | compose PING; `npm run ops:verify-clamav` | Upload scan fails; file not indexed |
| Inngest | **HTTP into web** `/api/inngest` | same as web | `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | Inngest dashboard + ready `ingest=configured` | Upload enqueue **503**; docs can stay `uploaded` |
| Clerk | SaaS | n/a | publishable + secret + webhook | Clerk dashboard | Auth 401 |
| OpenAI | SaaS | n/a | `OPENAI_API_KEY` | **not** on ready | Jobs retry 429; Ask fails |
| SMTP | config only | 587 | `SMTP_*` | none | **Invite send throws** until transport exists |
| Worker image | `Dockerfile.worker` = `inngest-cli dev` | n/a | `INNGEST_DEV=1` | **Do not use in production** | Would violate signing gate |

Startup order: Postgres extensions → Redis → storage → ClamAV → **migrations** → web → register Inngest Cloud URL → ready/smoke.

`docker-compose.yml` is **local/dev only** (default `nyayagrid` / `nyayagridsecret`). Production must not reuse those credentials.

---

## 3. Required Environment

Authoritative placeholders: `.env.beta.example`.

Must:

`APP_ENV=production`, `AUTH_PROVIDER=clerk` + Clerk trio, `DATABASE_URL`, `RATE_LIMIT_PROVIDER=redis` + `REDIS_URL`, `STORAGE_PROVIDER=s3` (or MinIO + `ALLOW_MINIO_IN_PRODUCTION=1` **without** compose defaults), `S3_BUCKET`, `MALWARE_SCANNER=clamav` + `CLAMAV_HOST`, `AI_PROVIDER=openai`, `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `EMAIL_PROVIDER=smtp` + SMTP host/port/from, `BILLING_PROVIDER=database`, `OCR_PROVIDER=none`, `NEXT_PUBLIC_APP_URL`.

Must **not**:

`AUTH_PROVIDER=dev`, `AI_PROVIDER=mock`, `RATE_LIMIT_PROVIDER=memory`, `MALWARE_SCANNER=development`, `CLAMAV_FIXTURE=1`, `INNGEST_DEV=1`, `INNGEST_DISABLED=1`, `FEATURE_PROFESSOR=1`, `FEATURE_AGENTS=1`, `ALLOW_AUTHORITY_HTTP_IMPORT=1`, compose MinIO keys.

Optional: `MODEL_*`, `FEATURE_RESEARCH=1`, `FEATURE_GUIDE=0`.

Do not put real secrets in git.

---

## 4. Config Validation

`packages/platform/src/config.ts` → `validateConfigForEnv` at Node boot.

This phase additionally fails production on: disabled Inngest, weak event key, enabled Professor/Agents/HTTP import, localhost/compose MinIO under the MinIO opt-in, missing `NEXT_PUBLIC_APP_URL`.

Staging still boots with warnings except **AUTH_PROVIDER=dev** which already throws.

---

## 5. Async Ingest / Inngest

Upload: 202 after `inngest.send`. Failed send: document `failed`, HTTP **503**.

Job path: `document.malware_scan` → pipeline → `matter.extract_intelligence`.

If Inngest Cloud is down after a successful send: document remains `uploaded` / mid-state. Recovery: `npm run beta:stuck-documents`, then replay the event from Inngest or re-upload (new document). Signing: production refuses weak/`local` keys.

**P0 ops:** the deployed `https://<host>/api/inngest` URL must be registered in Inngest Cloud **before** lawyers upload. The compose worker image is not that.

---

## 6. Health / Readiness

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health/live` | Process up. No deps. Docker HEALTHCHECK. |
| `GET /api/health/ready` | DB, storage (hard in staging/prod), Redis if required, ingest not disabled, production config problems → **503** |
| `GET /api/v1/health` | Config summary; **does** instantiate AI provider by name, not a live completion |

OpenAI is not pinged on ready.

---

## 7. Migrations

- Generate: `npm run db:generate` (drizzle-kit).
- Apply: `DATABASE_URL=… npm run db:migrate` (`packages/database/src/migrate.ts`).
- **App boot does not auto-migrate** (Dockerfile comment + DEPLOYMENT.md).
- Extensions: `vector`, `pgcrypto` (`docker/postgres/init.sql`). Managed DBs must allow-list them.
- Files: `0000`–`0011` in `packages/database/drizzle/`.
- Destructive: treat as **forward-only**. There is **no automated down migration**. Rollback = restore snapshot from before migrate.
- Live traffic: apply during a short window; additive phases have been the pattern — still snapshot first.
- Check (no mutate): `npm run beta:check` (DB, extensions, drizzle table present).

---

## 8. Deployment Procedure

1. Provision Postgres (pgvector), Redis, private bucket, ClamAV, Clerk prod app, Inngest Cloud app, OpenAI project — **separate from staging**.
2. Load secrets from a secret manager using `.env.beta.example` as the checklist.
3. Snapshot Postgres + confirm bucket versioning/backup.
4. `npm run db:migrate` against that `DATABASE_URL`.
5. Confirm Redis/ClamAV/storage reachable.
6. Deploy **web** image (`Dockerfile`). `APP_ENV=production`.
7. Point Inngest Cloud at `https://<host>/api/inngest`. Confirm functions listed (ingest + intelligence).
8. `GET /api/health/ready` → 200. `npm run beta:check` from a jump host with env.
9. `npm run beta:canary` then `beta:smoke` with a **synthetic** matter.
10. Open 3–8 firms.

---

## 9. Rollback

| Failure | Action |
| --- | --- |
| Bad web image | Redeploy previous image tag. Config gate is in the image; keep env compatible. |
| Bad migration | **No down SQL.** Restore Postgres snapshot taken before migrate; restore matched object storage if keys changed. |
| Broken Inngest function | Pause/un-register in Inngest Cloud; roll web; uploads 503 if send fails. Stuck docs: stuck-documents script. |
| Bad model env | Restore prior `OPENAI_MODEL` / `MODEL_*`. No code rollback required. |

---

## 10. Backup / Restore

Local matched rehearsal: `npm run ops:backup-rehearse` → `nyayagrid_restore_test` (not overwrite live). **Not** evidence of managed PITR.

Operator must enable provider backups (RDS/Neon/etc.) **and** S3 versioning. Restore ownership: whoever holds the cloud account. Do not claim production restore until that rehearsal is done on the real provider.

Retention: product **archive** is not cryptographic erase. Do not tell beta users “permanently deleted.”

---

## 11. Storage

Objects have **no public ACL**; access via presigned GET (default **300s**). Keys: `org/{organizationId}/documents/...`. Production `STORAGE_PROVIDER=s3` enables SSE-AES256 and refuses compose/localhost defaults. TLS: use `https` S3 endpoints in prod. Compose MinIO is for laptops.

---

## 12. Redis / Rate Limits

Production requires Redis. Outage: limiter **denies** (fail closed, 429), not fail-open. Ready also 503 if Redis ping fails. **Do not change preset numbers.**

---

## 13. Malware Scanning

Production requires ClamAV + host, rejects fixture mode. Scan timeout 30s; blocked files never chunk/embed. If ClamAV is down, processing fails closed (not `ready`). Compose image needs a long start_period for signatures.

---

## 14. Auth / Clerk

Production/staging cannot use DevAuth. Clerk secret, publishable key, webhook secret required. Align Clerk instance with `NEXT_PUBLIC_APP_URL`. Webhook: `/api/webhooks/clerk`.

---

## 15. OpenAI

`AI_PROVIDER=openai` + key required; mock refused. Embeddings must not be mock. Timeouts: chat ~30s; embeddings still unbounded at adapter (performance P1). Ready does not call OpenAI.

---

## 16. Observability

Structured logs (`createLogger`) redact token/prompt/content-like keys. Ingest logs ids, attempt, stage, elapsed — not document text.

Minimum signals: HTTP 5xx, upload 202 vs 503, ingest started/finished, intel finished, OpenAI 429 in error messages (not bodies), Redis/DB errors, rate-limit 429s.

---

## 17. Alerts

No in-repo pager vendor. Operators should alert on: ready 503, ingest `disabled`, stuck-document count > 0 for 15m, ClamAV down, Redis down, OpenAI 429 burst, web 5xx.

---

## 18. Smoke Tests

`npm run beta:canary` — live, ready, ingest configured, unauthenticated `/api/v1/matters` denied.

`npm run beta:smoke` — plus synthetic TXT upload 202 → poll ready → Ask Nyaya. Needs `SMOKE_MATTER_ID` + `SMOKE_AUTH_HEADER`. Synthetic only. Contract Analysis: invoke on a ready SYNTH contract after ingest if exercising analysis (same auth); not hard-wired so Draft/Analysis code stays untouched.

---

## 19. Feature Flags

| Flag | Professional beta |
| --- | --- |
| (core professional) | On (not a flag) |
| `FEATURE_RESEARCH` | On if using local corpus; HTTP import **off** |
| `FEATURE_GUIDE` | Off |
| `FEATURE_PROFESSOR` | **Off** (boot fail if on) |
| `FEATURE_AGENTS` | **Off** (boot fail if on; API now `assertFeatureEnabled`) |
| `FEATURE_OCR` | Off |
| `FEATURE_LIVE_AI` | Off (OpenAI still via `AI_PROVIDER`) |

---

## 20. Agent Deployment Posture

Nine agents exist in code. Reliability is not done. Production boot rejects `FEATURE_AGENTS=1`. Agent HTTP routes now throw `FEATURE_DISABLED` when the flag is off. Do not enable for this beta.

---

## 21. Data Environment Isolation

Use **different** Clerk apps, `DATABASE_URL`, buckets, Redis, Inngest apps, OpenAI projects for local / staging / production.

`seed:golden-matter` and `npm run bench` **refuse `APP_ENV=production`** unless `ALLOW_PRODUCTION_SYNTHETIC_WRITE=1`.

---

## 22. Production Check Command

```
npm run beta:check
```

Validates env gate, flags, DB reachability, pgvector/pgcrypto, drizzle migrations table, Redis ping. Prints provider names only.

Also: `npm run beta:stuck-documents`.

---

## 23. P0 / P1 / P2 Findings

### P0 — blocks opening the beta door

1. **Inngest Cloud must be live** against the deployed `/api/inngest` (async ingest). `INNGEST_DISABLED` is now a production boot failure.
2. **Do not use `Dockerfile.worker` in production.**
3. **In-app email invites cannot be delivered** (`SmtpEmailProvider.send` throws). Provision users in Clerk until SMTP transport exists.
4. **Backup/restore on the real provider is unproven.** Snapshot before first client data.

### P1 — before wider beta

- SMTP transport implementation
- Managed PITR + object versioning restore rehearsal
- Embedding HTTP timeout / 429 backoff (performance P1)
- Serial chunk inserts
- Ready-probe ClamAV TCP (today upload-path only)
- `FEATURE_RESEARCH` not enforced on all research routes

### P2

- Metrics vendor, SIEM, multi-region, K8s
- Full erasure vs archive honesty in product copy (ops doc only here)

---

## 24. Controlled Beta Runbook

**BEFORE DEPLOY** — secrets from `.env.beta.example`; snapshot DB+bucket; `beta:check` against staging twin; Inngest app created; Clerk production instance; ClamAV up.

**DEPLOY** — migrate → start web → register Inngest → ready 200.

**POST-DEPLOY** — `beta:canary`; synthetic smoke upload; confirm Inngest run succeeded; Ask Nyaya on that matter.

**DAILY** — ready 200; `beta:stuck-documents`; Inngest failed runs; OpenAI 429s; Redis/ClamAV.

**IF UPLOADS STUCK** — stuck-documents (ids/state/age only); Inngest replay; do not log file text.

**IF OPENAI 429 STORM** — pause new analysis/extract; ingest will retry jobs; do not disable rate limits.

**IF INGEST FAILS** — check Inngest signing, `/api/inngest`, ClamAV, storage; 503 on enqueue means send failed (document marked failed).

**IF DB ISSUE** — ready 503; do not auto-migrate from the app; restore snapshot if corrupt.

**ROLLBACK** — previous web tag; migration rollback = restore snapshot.

---

## 25. Beta Decision

**READY AFTER P0 OPS FIXES**

Code and config gates can host a 3–8 firm beta **after** Inngest Cloud is wired, Clerk is used for identity/invites, and backups exist on the real provider. It is not “operations ready” while SMTP cannot send and restore is unproven.

---

## 26. Exactly One Next Recommendation

**Register the production web `/api/inngest` endpoint in Inngest Cloud, run one synthetic upload smoke, and confirm the ingest + intelligence functions complete before any client matter is uploaded.**

Do not implement a new SMTP stack or DR platform in this phase; that was not this recommendation.
