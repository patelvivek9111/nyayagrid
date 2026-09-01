# BASELINE 6W-R2 OPS1

Credential inventory and local probes. No secret values.

Clerk trio: MISSING. Inngest Cloud: BLOCKED (`INNGEST_DEV` active; keys local/weak). No `.env.staging`. No staging host.

Local `npm run dev` (current code): live 200, ready 200 (development, not staging), unauthenticated GET `/api/v1/matters` 401, CSP/frame/MIME/referrer present. Docker Redis PONG, ClamAV healthy, MinIO healthy — rehearsal only.

A prior staging-shaped process on :3000 had ready 503 with Clerk/Inngest/malware/MinIO/email/billing/memory-limiter problems listed. That process returned 500 for unauthenticated matters (stale). After restart on current code, unauthenticated is 401.

Staging `/api/health/ready` = 200 is **not** proven. Do not bypass.
