# WP-05 — Object storage & Redis recovery

**Staging:** historically HEALTHY on ready probe (`storage=ok`, `redis=ok`).  
**Production DR:** documented only — **NOT VERIFIED** (no production app).

## Object storage

| Item            | Staging expectation                                      | Production gap                          |
| --------------- | -------------------------------------------------------- | --------------------------------------- |
| Backend         | S3-compatible (Fly Tigris / configured bucket)           | Separate prod bucket required           |
| Versioning      | Enable before treating as durable                        | Required for accidental delete recovery |
| Matched restore | Restore Postgres + object keys to same PIT               | Not rehearsed on prod                   |
| Malware originals | Preserve originals; never execute macros               | Same                                    |

### Recovery steps

1. Confirm ready `storage` signal and provider status page.
2. Verify IAM/key still valid (rotate via secrets runbook if compromised — never log secret values).
3. For accidental deletes: restore object versions to the incident PIT; reconcile DB document rows.
4. Re-test with **synthetic** fixtures only.
5. Record incident; do not claim production DR from staging success.

See also: `docs/BACKUP_RESTORE.md`, incident runbook §4.

## Redis / rate-limit store

| Item              | Staging expectation                                      | Production gap                |
| ----------------- | -------------------------------------------------------- | ----------------------------- |
| Provider          | Upstash (`nyayagrid-staging-v2` after prior deletion)    | Separate prod instance        |
| Data criticality  | Ephemeral (rate limits / cache) — not system of record   | Same                          |
| After outage      | Connectivity restore ≠ historical key integrity          | Document downtime; re-warm    |

### Recovery steps

1. Confirm `RATE_LIMIT_PROVIDER` and Upstash status.
2. Do not silently fall back to in-memory in staging/production without an incident note.
3. After restore: ready `redis=ok`; accept cold cache.
4. If the Redis instance was destroyed: provision replacement, update Fly secrets, restart app, verify ready.

See also: incident runbook §3.
