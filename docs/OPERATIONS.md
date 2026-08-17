# Operations — NyayaGrid

Day-2 operational reference: what to watch, how to run routine tasks, and how the system behaves
under normal and abnormal conditions. Pairs with [Incident Response](./INCIDENT_RESPONSE.md) for
when something is actually wrong.

## Health checks

- `GET /api/health/live` — process liveness only. Always `200` if the Node.js process is serving
  requests at all.
- `GET /api/health/ready` — readiness. `503` if the database check fails (this is load-bearing —
  point your load balancer's health check here, not at `/live`, so a DB-less instance is pulled
  from rotation). Storage and configuration checks are advisory (`checks.storage: "degraded"`,
  `checks.config: "warnings"`) and never cause a `503` on their own, since a MinIO blip or a
  missing optional variable shouldn't take an otherwise-healthy instance out of rotation.

Response bodies never include secret values — only provider names, booleans, and non-sensitive
error messages (verify this holds if you extend the health checks).

## Logging

`@nyayagrid/observability`'s `createLogger(scope)` emits structured JSON lines
(`{"ts", "level", "scope", "message", ...fields}`) to stdout/stderr. There is no external log
aggregation configured yet — wire your platform's log driver (e.g. CloudWatch Logs, Loki, Datadog)
to collect container stdout/stderr. `LOG_LEVEL` (`.env.example`) controls verbosity.

Boot-time config validation (`packages/platform/src/config.ts`) always logs one line summarizing
the resolved provider configuration (`"Configuration validated"`, with `authProvider`,
`aiProvider`, etc.) — this is the fastest way to confirm what a given running instance is actually
configured to do without SSHing in.

## Feature flags

`packages/platform/src/features.ts` — `FEATURE_AGENTS`, `FEATURE_PROFESSOR`, `FEATURE_GUIDE`,
`FEATURE_RESEARCH`, `FEATURE_OCR` (always off; no OCR adapter exists), `FEATURE_LIVE_AI` (always
requires explicit opt-in). Flags default to **on** in development/test and **off** in
staging/production until explicitly set — a fresh production deployment with no `FEATURE_*`
variables set will have agents/professor/guide/research all disabled until you turn them on. A
flag is never an authorization decision by itself (see the file's own doc comment) — it only gates
whether the code path exists in this deployment at all; capability and entitlement checks still
apply underneath it.

Per-organization overrides exist via the `feature_flag_overrides` table
(`applyFlagOverrides()`) if you need to stage a rollout to specific organizations.

## Rate limits

See `packages/platform/src/rate-limit.ts` for the current presets (requests/window/scope) per
endpoint class. These are starting points, not tuned numbers — adjust `RATE_LIMIT_PRESETS` if real
usage patterns show they're too tight or too loose. `RATE_LIMIT_PROVIDER=redis` holds the limit
across instances. `RATE_LIMIT_PROVIDER=memory` is per-process and is a production blocker for
horizontal scale.

## On-call and paging

Not configured. There is no paging destination, rotation, or uptime vendor in this repository.
Until an operator fills this in, treat monitoring as **BLOCKER**. Suggested contract once a vendor
exists: page on `/api/health/ready` 503, elevated 5xx, malware scanner down, and AI provider error
rate. Destination: _TBD_.

## Running database migrations

```bash
DATABASE_URL=<target> npm run db:migrate
```

Always run this as an explicit, separate step before rolling out a version that depends on schema
changes — never automatically on container start (see [Deployment](./DEPLOYMENT.md)). Use
`npm run db:studio` (Drizzle Studio) to inspect the schema/data interactively against a given
`DATABASE_URL` (use a read replica or staging database for this in production, not the primary).

## Legal authority corpus (Nyaya Research)

```bash
npm run research:import -w @nyayagrid/research -- --fixtures
```

This imports the **synthetic fixture corpus** — fictional case law used to validate retrieval and
citation. It is explicitly not real law and must never be presented to users as authoritative. See
[Production Readiness](./PRODUCTION_READINESS.md) — sourcing a real, licensed, jurisdiction-scoped
corpus is an open BLOCKER, not an operational task with an existing script.

## AI usage accounting

`packages/platform/src/ai-usage.ts`'s `recordAiUsageEvent()` records every AI call (provider,
model, capability, token counts, cost estimate) to the `aiUsageEvents` table, scoped to the calling
organization/user. Use this table for cost monitoring and per-organization usage dashboards, and to
investigate cost spikes (pair with the `expensive_ai`/`agent_run` rate-limit classes above, which
are the primary technical control against runaway spend).

## Routine checks (recommended cadence — not yet automated)

| Task                                                                                            | Suggested cadence                                         |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Review `npm audit --omit=dev` output and this repo's dependency advisories                      | Monthly, or on every high/critical CVE alert              |
| Verify a Postgres backup can actually be restored (see [Backup & Restore](./BACKUP_RESTORE.md)) | Quarterly at minimum, until automated                     |
| Review AI usage/cost by organization                                                            | Weekly during early launch, monthly once stable           |
| Review audit events for anomalous access patterns                                               | Weekly during early launch                                |
| Rotate secrets (API keys, SMTP credentials, S3 keys if not using IAM roles)                     | Per your security policy; at minimum on staff offboarding |
| Re-run the Playwright E2E suite against staging before a production release                     | Every release                                             |

## Scaling notes

- The web app itself is stateless per-request (no in-process session state beyond the in-memory
  rate limiter, when that provider is selected) and can run multiple replicas behind a load
  balancer when `RATE_LIMIT_PROVIDER=redis` points at a shared Redis. `RATE_LIMIT_PROVIDER=memory`
  means rate limits are enforced per-instance, not globally.
- Inngest-invoked job functions (`/api/inngest`) run inside the same web app process/replica set —
  there is no separate worker tier to scale independently today.
- Postgres connection pooling is handled by `postgres.js` inside `@nyayagrid/database` — if you run
  many replicas, watch total connection count against your Postgres provider's connection limit
  and consider a connection pooler (e.g. PgBouncer) if you approach it.
