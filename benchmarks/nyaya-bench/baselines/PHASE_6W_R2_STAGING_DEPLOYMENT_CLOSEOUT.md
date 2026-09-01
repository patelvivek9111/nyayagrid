# PHASE 6W-R2 — STAGING AUTH, INNGEST CLOUD, E2E CANARY, AND DEPLOYMENT READINESS CLOSEOUT

**Frozen:** 2026-08-27  
**Remediation iterations used:** 0 of 5 (no production AI/auth logic change; `scripts/beta-smoke.ts` and `scripts/6w-r2-ops.ts` wrapped for Windows `tsx` CJS)  
**Stop condition:** **B**  
**FEATURE_AGENTS:** OFF in staging and production defaults  
**Attorney validated:** NO  
**Nationwide support:** NO  
**Automatic production deployment:** NO  
**Technically deployable for a controlled beta:** **NO**

Do not start 6X. Do not invite beta users. Do not enable Agents.

---

## 1. Executive Summary

6W-R1 closed in-repo AI/safety and harness parsing. 6W-R2 was the staging-auth and Cloud-ops gate. Clerk keys are still missing. Inngest remains local `INNGEST_DEV`. There is no staging host, no `.env.staging`, and no Cloud registration.

Every Clerk/Inngest/HTTP canary item is **BLOCKED — HUMAN EXTERNAL ACTION REQUIRED**, not PASS.

Local current-code probes: `/api/health/live` 200; unauthenticated GET `/api/v1/matters` **401**; CSP, `X-Frame-Options`, `X-Content-Type-Options`, and Referrer-Policy present. Local `/api/health/ready` 200 is **development**, not staging. A prior staging-shaped process correctly returned ready **503** with enumerated config problems.

---

## 2. Starting R1 State

6V: 96.7% material, 100% critical safety. Research R1 0 critical. Deposition DA1 16/16. Frozen harness attempt 3: `criticalFailures []`. FEATURE_AGENTS OFF. Technically deployable was already NO for missing Clerk/Inngest Cloud.

---

## 3. Credential Inventory

Presence only. No values printed.

| Item | Status |
| --- | --- |
| `.env` | AVAILABLE |
| `.env.staging` | MISSING |
| CLERK_SECRET_KEY | MISSING |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | MISSING |
| CLERK_WEBHOOK_SECRET | MISSING |
| INNGEST_EVENT_KEY | AVAILABLE (local/weak — not Cloud) |
| INNGEST_SIGNING_KEY | AVAILABLE (local/weak — not Cloud) |
| INNGEST_DEV | ACTIVE (Cloud proof blocked) |
| REDIS_URL / REDIS_HOST (app env) | MISSING |
| Docker Redis | HEALTHY (localhost rehearsal) |
| S3/MinIO local | AVAILABLE rehearsal |
| DATABASE_URL | AVAILABLE local Postgres :5433 |
| MALWARE_SCANNER | development (not staging proof) |
| Docker ClamAV | HEALTHY (app not wired to it) |
| STAGING_BASE_URL | MISSING |
| FEATURE_AGENTS | UNSET (staging/production default false) |
| SMTP | MISSING |

---

## 4. Clerk

**BLOCKED — HUMAN EXTERNAL ACTION REQUIRED**

Create a Clerk staging application, publishable/secret/webhook keys, and staging-only test users (owner, attorney, view-only; guest if needed). No real customers.

---

## 5. Auth

Real Clerk sign-in / session / sign-out: **NOT PROVEN**.

Current local unauthenticated GET `/api/v1/matters` = **401**. That is DevAuth refused (`APP_ENV` source=default, so DevAuth is not allowed), plus `UnavailableAuthProvider` when `AUTH_PROVIDER=clerk` without keys. It is **not** a Clerk session proof.

A stale staging-shaped process had returned **500** for the same route; after restart on current code the status is 401. Error body remains generic `INTERNAL_ERROR` / “An unexpected error occurred” (no stack/secret leak).

---

## 6. HTTP RBAC

**BLOCKED** (no Clerk roles/sessions).

---

## 7. HTTP Isolation

Cross-org and cross-matter HTTP: **BLOCKED**. DB isolation/RBAC tests remain from 6W/6W-R1 frozen harness (PASS). Not counted as HTTP proof.

---

## 8. Inngest

**BLOCKED.** `INNGEST_DEV` is on. Keys are local/weak. No Cloud app registration. Functions in repo: document malware/ingest, intelligence extract, graph materialize, with retries and per-org concurrency. That is code, not Cloud proof.

---

## 9. Async Ingest

**NOT PROVEN.** No authenticated 202 → Cloud event → ready path.

---

## 10. Ingest Failure / Retry

Unit retry cap remains from 6W. Cloud failure/retry: **NOT PROVEN**.

---

## 11. Malware

Docker ClamAV is healthy on localhost:3310. App `MALWARE_SCANNER=development`. Staging upload scanner: **EXTERNAL / BLOCKED**.

---

## 12. Canary Dataset

Not created. Requires Clerk orgs/users.

---

## 13–15. VALIDATED / LIMITED / UNVALIDATED Canaries

**NOT PROVEN.** Coverage was not widened. C2A frozen state from 6W-R1 is unchanged.

---

## 16–19. Performance

Ask / Research / Draft / Case-Review HTTP P95: **NOT MEASURED** (no authenticated staging HTTP).

---

## 20. Rate Limits

Unit 429 + Retry-After still pass. HTTP Ask/Research/Upload with Clerk: **NOT PROVEN**. In-memory limiter is configured locally.

---

## 21. Redis

Docker Redis PONG. App `RATE_LIMIT_PROVIDER=memory`, `REDIS_URL` unset. Multi-instance staging Redis limiter: **EXTERNAL**.

---

## 22–23. Object Storage / Recovery

Local MinIO healthy. Private provider bucket versioning/recovery: **EXTERNAL**.

---

## 24–25. Managed DB / PITR

Local Postgres :5433. Managed TLS/PITR: **EXTERNAL**. 6W pg_dump/pg_restore rehearsal stands; not re-run.

---

## 26–27. Image Deployment / Rollback

No staging host. N→N+1→N: **NOT PROVEN**.

---

## 28. Health / Readiness

| Environment | live | ready |
| --- | --- | --- |
| Current local `next dev` | 200 | 200 (development; not a staging gate) |
| Prior staging-shaped process | 200 | **503** with Clerk, Inngest, malware=development, MinIO, console email, development billing, memory rate limit |

Staging ready=200 remains **BLOCKED**. Gate was not bypassed.

---

## 29. Security

Observed on current local: CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy. HSTS is production-only in config; not claimed for local HTTP.

401/500 bodies inspected: no stack traces, no secret values.

---

## 30. Sessions

Clerk cookies not observable. **NOT PROVEN**.

---

## 31. Secret Hygiene

No `sk_live_` / long `whsec_` hits in baseline artifacts. `.env` not committed. This report prints presence only.

---

## 32. Logging Privacy

No E2E canary logs to inspect. Ops scripts do not print secret values.

---

## 33–34. Monitoring / Alerting

**EXTERNAL.** No hosting/Inngest/Clerk dashboards wired.

---

## 35. Audit Trail

**NOT PROVEN** (no staging canary writes).

---

## 36. Privacy / Deletion

Privacy page: deletion requests are reviewed and **scheduled**, not described as immediately permanently deleted. No “permanently deleted” product copy found.

---

## 37. Invite Path

**Clerk-managed invitations** for controlled beta. In-app SMTP is unimplemented (`EMAIL_PROVIDER=console` locally). SMTP is not a code blocker if Clerk invites are used.

Operator steps when Clerk exists: create staging org → Clerk Dashboard invite → accept at `/invites/accept` if using app tokens, or Clerk hosted invite flow.

---

## 38. Frozen AI Spot Check

Did not re-run the full harness. Units: jurisdiction wrong-state, research weight/synthesize membership, deposition credential-vs-testimony tension, FEATURE_AGENTS staging/production off, Clerk-missing provider → null identity. All PASS.

Research R1 and DA1 remain the 6W-R1 frozen results (0 critical / 16/16).

---

## 39. Feature Flags

`getFeatureFlags({ APP_ENV: "staging" }).agents === false`  
`getFeatureFlags({ APP_ENV: "production" }).agents === false`  
FEATURE_AGENTS unset. No production override.

---

## 40. External Blockers

1. Clerk staging app + keys + test users (owner, attorney, view-only).  
2. Unset `INNGEST_DEV`; real Cloud event/signing keys; register `https://<staging-host>/api/inngest`.  
3. Staging HTTPS host/DNS/TLS.  
4. `RATE_LIMIT_PROVIDER=redis` + `REDIS_URL` on staging.  
5. Production-shaped object storage (or explicit MinIO opt-in with backup).  
6. `MALWARE_SCANNER=clamav` (or provider) against a real scanner.  
7. Managed Postgres snapshot/PITR if using a managed DB.  
8. Image-tag deploy/rollback on staging.  
9. Alerting for 5xx, ready-down, Inngest, DB, storage.  
10. Clerk-managed beta invites.

---

## 41. Final Scorecard

| Gate | Label |
| --- | --- |
| Clerk | BLOCKED |
| HTTP Auth | BLOCKED (local 401 is not Clerk) |
| HTTP RBAC | BLOCKED |
| HTTP Isolation | BLOCKED |
| Inngest Cloud | BLOCKED |
| Async Ingest | BLOCKED |
| Failure Retry | BLOCKED (unit only) |
| Malware | EXTERNAL |
| E2E Canary | BLOCKED |
| Coverage Canary | BLOCKED |
| Ask Performance | BLOCKED |
| Research Performance | BLOCKED |
| Rate Limits | BLOCKED (unit only) |
| Redis | EXTERNAL (docker rehearsal) |
| Storage | NEEDS WORK (MinIO rehearsal) |
| Storage Recovery | EXTERNAL |
| Managed DB | EXTERNAL |
| PITR | EXTERNAL |
| Rollback | EXTERNAL |
| Health live | PASS local; staging host missing |
| Health ready staging | BLOCKED |
| Security headers | PASS local |
| Secrets | PASS |
| Logging | PASS (no canary dumps) |
| Monitoring | EXTERNAL |
| Alerting | EXTERNAL |
| Audit | BLOCKED |
| Privacy truthfulness | PASS |
| Frozen AI Safety | PASS (spot check + R1 freeze) |
| Agents Off | PASS |

---

## 42. Production Changes

None to product AI/auth paths. Script wrappers only so `tsx` on Windows can run canary/ops.

---

## 43. Residual Risks

Largest: shipping without Clerk and Inngest Cloud would leave auth and async ingest unproven. Local 401 must not be mistaken for Clerk. Development ready=200 must not be mistaken for staging ready.

---

## 44. Technical Deployment Decision

**TECHNICALLY DEPLOYABLE FOR CONTROLLED BETA = NO**

---

## 45. Attorney Validation Status

**NO**

---

## 46. Exactly One Next Phase

**PHASE 6W-R3 — EXTERNAL STAGING INFRASTRUCTURE CLOSEOUT**

Not 6X. Agents stay off. Nationwide stays NO.

---

## Final questions

1. Are Clerk staging credentials present? **NO**  
2. Is real Clerk sign-in proven? **NO**  
3. Does unauthenticated HTTP return 401? **YES on current local code; not Clerk-proven**  
4. Does forbidden HTTP return 403? **NOT HTTP-PROVEN**  
5. Is HTTP RBAC proven? **NO**  
6. Any HTTP cross-org leakage? **Not HTTP-proven**  
7. Any HTTP cross-matter leakage? **Not HTTP-proven**  
8. Is Inngest Cloud registered? **NO**  
9. Is INNGEST_DEV off? **NO**  
10. Did authenticated upload return 202? **NO**  
11. Did upload→ingest→intelligence complete? **NO**  
12. Did retry/failure behavior pass? **Unit only; Cloud no**  
13. Is real staging malware scanning proven? **NO**  
14–17. Canaries? **NO**  
18–19. Ask/Research P95? **NOT MEASURED**  
20. HTTP rate limits proven? **NO**  
21. Redis-backed limiting if required? **NO**  
22. Staging storage private? **Local MinIO rehearsal only**  
23. Provider object recovery proven? **NO**  
24. Managed DB PITR proven? **NO**  
25. Image rollback? **NO**  
26. `/health/live` 200? **YES locally; no staging host**  
27. `/health/ready` 200? **YES on local development; NO for staging-shaped config (503 until Clerk/Inngest/etc.)**  
28. Any secrets exposed? **NO**  
29. Any sensitive logging found? **NO in this phase’s artifacts**  
30. Monitoring sufficient? **NO**  
31. Alerting sufficient or explicitly external? **EXTERNAL**  
32. Audit from real staging canary? **NO**  
33. Privacy/deletion wording truthful? **YES** (scheduled requests, not instant purge)  
34. Frozen AI safety remain clean? **YES** (spot check)  
35. Research R1 still 0 critical? **YES** (frozen; not re-run)  
36. Deposition contradiction semantics still clean? **YES** (unit spot check)  
37. Agents OFF? **YES** (staging/production defaults)  
38. Attorney validation complete? **NO**  
39. Nationwide support justified? **NO**  
40. Technically deployable for controlled beta? **NO**  
41. Production deployment automatically authorized? **NO**  
42. Blockers remain? **Clerk, Inngest Cloud, staging HTTPS host, Redis limiter, ClamAV wiring, provider storage/PITR, rollback, alerting**  
43. Largest remaining risk? **Clerk staging credentials plus Inngest Cloud (`INNGEST_DEV` still on)**  
44. Exactly one next phase? **PHASE 6W-R3 — EXTERNAL STAGING INFRASTRUCTURE CLOSEOUT**
