# Deployment — NyayaGrid

This describes how to build and run NyayaGrid's web application as a container in a real
environment. Read [Production Readiness](./PRODUCTION_READINESS.md) first — this document assumes
you are configuring, not deciding whether you're ready.

Local development (`npm run dev`) never requires Docker; this document only applies to
staging/production deployment.

## Overview

NyayaGrid's web app (`apps/web`, a Next.js app) is the only thing that needs to be deployed as a
long-running service. There is no separate application-tier "worker" process in production —
background jobs (Inngest) are HTTP-invoked functions served from `/api/inngest` inside the same
Next.js app (`apps/web/src/app/api/inngest/route.ts`). See [Background jobs](#background-jobs-inngest)
below.

## 1. Build the container image

```bash
docker build -t nyayagrid-web:<tag> -f Dockerfile .
```

This is a multi-stage build (`node:20-alpine`, non-root `nyayagrid` user, Next.js
`output: "standalone"` for a minimal runtime image — see `apps/web/next.config.ts`). It has been
verified locally to build successfully and to serve `GET /api/health/live` → `200` immediately
after `docker run`. It does **not** run database migrations or require `DATABASE_URL` at build
time — `next build` only needs source code, not a live database.

Push it to your registry as you would any other image:

```bash
docker tag nyayagrid-web:<tag> <registry>/nyayagrid-web:<tag>
docker push <registry>/nyayagrid-web:<tag>
```

## 2. Provision infrastructure

Before starting the container, provision (see [Production Readiness](./PRODUCTION_READINESS.md)
for which of these are CONFIG REQUIRED vs. BLOCKER today):

- **Postgres 15+ with the `pgvector` and `pgcrypto` extensions**, e.g. `pgvector/pgvector:pg16` if
  self-hosting, or a managed provider that supports installing `pgvector` (e.g. AWS RDS for
  Postgres ≥ 15 with the extension allow-listed, Neon, Supabase, Timescale, etc.).
- **AWS S3** bucket (or S3-compatible storage you operate — see `ALLOW_MINIO_IN_PRODUCTION` in
  `.env.example` if that's MinIO you run yourself).
- **Clerk** production application (auth).
- **OpenAI** API key (AI + embeddings).
- **ClamAV** (`clamd`) reachable from the app, or a SaaS malware-scanning equivalent behind the
  same `MalwareScanner` interface. Local docker-compose includes `clamav` on port 3310
  (`npm run ops:verify-clamav`).
- **SMTP** relay for transactional email (invites).
- A **shared rate-limit store**: `RATE_LIMIT_PROVIDER=redis` with `REDIS_URL` (docker-compose
  includes Redis on port 6379). Do not run more than one web instance on `memory`.
- **Inngest Cloud** (or compatible) app pointed at your deployed `/api/inngest` URL.

## 3. Run database migrations

Migrations are a separate, explicit step — never run implicitly by the container starting up, so a
deploy can never accidentally apply a schema change against the wrong database.

```bash
DATABASE_URL=<production connection string> npm run db:migrate
```

Run this from a machine/CI job with network access to the production database, using
`packages/database`'s Drizzle migrations (`npm run db:generate` was used at development time to
produce them; `db:migrate` applies them). Run it once, before rolling out the new image version,
whenever a release includes schema changes.

## 4. Configure environment variables

Set (do not commit — use your platform's secret manager):

```
APP_ENV=production
DATABASE_URL=...
AUTH_PROVIDER=clerk
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_WEBHOOK_SECRET=...
AI_PROVIDER=openai
OPENAI_API_KEY=...
EMBEDDING_PROVIDER=openai
STORAGE_PROVIDER=s3
S3_BUCKET=...
S3_REGION=...
# S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY only if not using an IAM role
MALWARE_SCANNER=clamav
CLAMAV_HOST=...
EMAIL_PROVIDER=smtp
SMTP_HOST=...
SMTP_PORT=587
EMAIL_FROM=...
BILLING_PROVIDER=database
RATE_LIMIT_PROVIDER=redis
REDIS_URL=redis://...
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...
NEXT_PUBLIC_APP_URL=https://<your-domain>
LOG_LEVEL=info
```

The app validates this at startup (`apps/web/src/instrumentation.ts` →
`validateConfigForEnv()`) and **refuses to start** if any production requirement above is unmet —
check container logs for a `ConfigurationError` listing every unmet item if a rollout fails to
become healthy.

## 5. Run the container

```bash
docker run -d \
  --name nyayagrid-web \
  -p 3000:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  <registry>/nyayagrid-web:<tag>
```

Point your load balancer / ingress at container port `3000`, with:

- **Liveness probe**: `GET /api/health/live` (process is up).
- **Readiness probe**: `GET /api/health/ready` (returns `503` if the database check fails; storage
  and config are advisory and do not fail readiness — see
  `apps/web/src/app/api/health/ready/route.ts`).

The image also declares a Docker `HEALTHCHECK` against `/api/health/live` for platforms that use
it directly (e.g. `docker run`, ECS, plain Compose).

## 6. Background jobs (Inngest)

`apps/worker` is a **local-only** convenience — it wraps the Inngest dev server CLI so job
execution can be observed without a real Inngest account while developing (`Dockerfile.worker`
packages this for docker-compose-based local/staging parity only; read the comment at the top of
that file before using it for anything else). In production:

1. Create an Inngest Cloud app (or another Inngest-compatible event platform).
2. Point it at `https://<your-domain>/api/inngest`.
3. Set `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` to the real values it issues.

There is no separate "worker" container to deploy in production — the same `nyayagrid-web`
container serves both user traffic and Inngest-invoked job functions.

## 7. Rollout strategy

- Run migrations (step 3) **before** deploying a new image version that depends on the new schema.
- Prefer rolling/blue-green deploys behind the readiness probe above so traffic never reaches an
  instance before its database connection is confirmed live.
- `RATE_LIMIT_PROVIDER=redis` shares the count across instances. `RATE_LIMIT_PROVIDER=memory`
  means each instance counts independently — do not scale out on memory (see
  [Production Readiness](./PRODUCTION_READINESS.md)).
- Roll back by redeploying the previous image tag; only roll back a migration if you have verified
  it is safely reversible (see [Backup & Restore](./BACKUP_RESTORE.md)).

## 8. Post-deploy verification

1. `curl https://<your-domain>/api/health/ready` → `{"ok": true, ...}`.
2. Confirm boot logs show `"Configuration validated"` with the expected production provider names
   (`authProvider: "clerk"`, `aiProvider: "openai"`, etc.) and no `ConfigurationError`.
3. Run the Playwright suite against the deployed URL as a smoke test if desired:
   `PLAYWRIGHT_BASE_URL=https://<your-domain> npx playwright test e2e/security.spec.ts` (the
   security spec only exercises API-level rejection and does not require a dev-auth-only UI flow).
