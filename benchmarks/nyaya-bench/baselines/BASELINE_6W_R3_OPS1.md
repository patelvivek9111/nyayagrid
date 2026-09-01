# BASELINE 6W-R3 OPS1

External inventory and local probes. No secret values. Localhost is not staging.

Clerk trio: MISSING. `.env.staging`: ABSENT. `STAGING_BASE_URL`: MISSING. Inngest Cloud: BLOCKED (`INNGEST_DEV` active; keys local/weak). GitHub CLI unauthenticated (CI secret names not listed).

Local `npm run dev`: live 200, ready 200 (development, not staging), unauthenticated GET `/api/v1/matters` 401, CSP/frame/MIME/referrer present. Docker Redis PONG, ClamAV healthy, MinIO healthy — rehearsal only.

Staging HTTPS, Clerk sign-in, HTTP RBAC/isolation, Inngest Cloud, upload→ingest, E2E canary, Redis limiter, malware wiring, provider recovery, managed PITR, image rollback, alerting: **NOT PROVEN**.

**TECHNICALLY DEPLOYABLE = NO.** Stop condition B.
