# WP-05 Alerting Contract

Engineering-defined alert policies live in `@nyayagrid/observability` (`DEFAULT_ALERT_POLICIES`).

**On-call routing destination:** NOT CONFIGURED in-repo.  
A dashboard without paging does **not** certify OPS-MON-01 for production.

## Page (SEV1/SEV2 candidates)

| ID                   | Signal                    | Threshold                             |
| -------------------- | ------------------------- | ------------------------------------- |
| ready-probe-failing  | `http.health.ready`       | 2 consecutive failures / 2m           |
| api-5xx-elevated     | `http.server.5xx_rate`    | >2% / 5m                              |
| malware-scanner-down | `deps.clamav.available`   | fail 3m while clamav required         |
| database-unreachable | `deps.database.available` | any ready failure                     |
| redis-unreachable    | `deps.redis.available`    | any ready failure when redis required |
| deploy-failed        | `ci.deploy.conclusion`    | failure on protected env              |

## Ticket

| ID                          | Signal                                |
| --------------------------- | ------------------------------------- |
| storage-degraded            | `deps.storage.status`                 |
| ocr-unavailable             | `deps.ocr.available`                  |
| ai-provider-errors          | `ai.provider.error_count`             |
| research-corpus-unavailable | `research.corpus.available`           |
| backup-stale                | `ops.backup.freshness` (>24h interim) |

## Privacy

Logs must not contain API keys, DB passwords, tokens, document/evidence bodies, or unredacted prompts.  
Use `@nyayagrid/observability` `createLogger` / `redactLogText`.

## Operator wiring (human)

1. Point log drain at your aggregator.
2. Scrape or synthetic-check `/api/health/ready`.
3. Map page policies to PagerDuty/Opsgenie/email.
4. Rehearse one failure alert in staging (ClamAV stop or ready-fail inject) — record evidence.
5. Only then mark `OPS-MON-01` staging/production verified.
