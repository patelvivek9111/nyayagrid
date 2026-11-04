# WP-05 Incident & Recovery Runbooks (Staging-certified / Production-gated)

**Classification:** `NYAYAGRID_WP05_PRODUCTION_OPERATIONS`  
**Audience:** on-call engineer / SRE  
**Production deploy:** NOT authorized by this document alone.

Privacy: never paste `DATABASE_URL`, SMTP passwords, Clerk secrets, or document contents into tickets/chat.

## Roles

| Role             | Responsibility                                              |
| ---------------- | ----------------------------------------------------------- |
| Staging operator | Investigate staging.nyayagrid.com / Fly `nyayagrid-staging` |
| Release approver | Explicit production deploy approval (separate)              |
| Security         | Credential compromise, cross-tenant suspicion (SEV1)        |

---

## 1. Application outage

**Signals:** `application-unreachable`, `ready-probe-failing`, Fly checks failing, users cannot load UI.

**Steps**

1. `curl -sS -o /tmp/ready.json -w "%{http_code}" https://staging.nyayagrid.com/api/health/ready`
2. `fly status -a nyayagrid-staging`
3. `fly logs -a nyayagrid-staging` (redact secrets)
4. If machine stopped: `fly machine start <id> -a nyayagrid-staging` or `fly apps restart nyayagrid-staging`
5. Confirm ready returns `HEALTHY` and continuous monitor cycle reports `PROBE_HEALTHY`
6. If deploy-related: follow **Failed deployment** / **Rollback**

**Escalate when:** >15m unrecovered, suspected data loss, or cross-tenant symptoms.

---

## 2. PostgreSQL (product DB) recovery

**Signals:** ready `database=fail`, app errors on queries.

**Safety**

- Product branch only: `br-fancy-king-auaii21k` (`wp05-product-staging`)
- **Never** point staging `DATABASE_URL` at corpus branch `br-delicate-cloud-au0md4t9`
- **Never** run migrations against corpus
- Runtime role: `nyaya_product_runtime_v3`

**Steps**

1. Confirm which Neon branch the app uses (Fly secret host digest / prior evidence) without printing passwords
2. Neon console: branch compute status; restart compute if suspended
3. If corruption suspected: create recovery branch from PITR timestamp (see `WP05_MANAGED_PITR_OPERATOR_ACTION.md`); verify counts RO
4. Do not overwrite production/corpus branch

**Verified evidence:** managed PITR PASS_WITH_EVIDENCE; product isolation PASS.  
**Production recovery:** NOT VERIFIED against a production Fly app (none deployed).

---

## 3. Redis failure

**Signals:** ready `redis=fail`, rate-limit errors.

**Steps**

1. Confirm `RATE_LIMIT_PROVIDER=redis` and Upstash status for staging
2. If provider outage: temporary degrade may keep app DEGRADED — do not silently switch to in-memory in staging without recording incident
3. After restore: confirm ready `redis=ok`; note cache warm required (historical keys not certified)

---

## 4. Object storage failure

**Signals:** ready `storage=fail|degraded`, upload failures.

**Steps**

1. Verify S3/MinIO endpoint reachability from staging (no secret echo)
2. Confirm bucket exists; restore IAM if access denied
3. Re-test document upload with **synthetic** fixture only

**Production storage DR:** documented, not production-verified.

---

## 5. Malware scanning (ClamAV) failure

**Signals:** `malware-scanner-down`, ready `clamav=fail`.

**Steps**

1. `fly status -a nyayagrid-clamav-staging`
2. Restart ClamAV app if unhealthy
3. Confirm staging `CLAMAV_HOST` still points at ClamAV private network
4. Re-check ready `clamav=ok` / `clamavMode=live`

**Production ClamAV certification:** BLOCKED (WP-04).

---

## 6. Monitoring failure

**Signals:** missing GitHub Actions `Staging continuous monitor` runs; `monitoring-worker-stale`.

**Steps**

1. Open Actions → `Staging continuous monitor` → latest run
2. Confirm schedule enabled; re-run `workflow_dispatch` with notify=`off`
3. Inspect artifact `wp05-continuous-monitor-last-cycle.json`
4. If SMTP path needed for a single validation: notify=`smtp` only when repository SMTP secrets exist — do not spam

---

## 7. Failed deployment

**Signals:** `deploy-failed`, Fly release unhealthy, ready broken after deploy.

**Steps**

1. Do **not** migrate as part of rollback
2. Identify last known good image tag (e.g. prior `deployment-01…`)
3. `fly deploy --image registry.fly.io/nyayagrid-staging:<good-tag> -a nyayagrid-staging --strategy immediate`
4. Confirm baked `gitSha` on `/api/health/ready`
5. File incident with deploy SHA and recovery image

---

## 8. Rollback

See §7. Prefer same-image secret cutovers when only config changed. Identity bake: always pass `--build-arg GIT_SHA` on rebuilds (`fly.staging.toml`).

**Verified:** staging image rollback/restore identity PASS.  
**Production rollback:** NOT VERIFIED (no production app).

---

## 9. Incident escalation

| Severity | Condition                                                        | Action                                                        |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| SEV1     | Cross-tenant/case bleed suspicion, credential leak, corpus write | Page owner; freeze deploys; preserve logs; rotate credentials |
| SEV2     | Staging outage >30m, data unavailable                            | Email ops; continuous monitor firing                          |
| SEV3     | Degraded dependency                                              | Ticket; track in register                                     |

On-call vendor (PagerDuty/Opsgenie): **NOT CONFIGURED** — staging SMTP to `patelvivek9111@gmail.com` only.

---

## 10. Backup verification procedure

1. Confirm latest PITR/isolation evidence files under `packages/research/corpus/reports/wp05-pitr-*` and `wp05-product-branch-isolation.json`
2. Optional: RO count check on corpus branch (authorities 35863)
3. Evaluate `backup-stale` against 24h interim local RPO policy (`evaluateBackupFreshness`)
4. Record date of last successful verification

---

## 11. Credential compromise / rotation

1. Identify exposed secret class (DB role, SMTP, Clerk, AI)
2. Staging DB: prefer new least-privilege role → cut over Fly `DATABASE_URL` via `fly secrets import --stage` + same-image deploy → delete old role (see WP-05 rotation evidence)
3. Never print passwords; wipe temp secret files
4. Redact logs in place; do not destroy audit narrative
5. Production secrets: require separate approval

---

## 12. Production release checklist

Use `docs/operations/WP05_PRODUCTION_RELEASE_CHECKLIST.md`.  
**PRODUCTION_DEPLOYED must remain NO** until explicit new approval after WP-03E/WP-04 gates close.
