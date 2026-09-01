# PHASE 6W-R3 — EXTERNAL STAGING INFRASTRUCTURE CLOSEOUT

**Frozen:** 2026-08-27  
**Remediation iterations used:** 0 of 5 (no product AI/auth/RBAC change; `.env.staging.example` documents `STAGING_BASE_URL` + HTTPS placeholder; `scripts/6w-r3-ops.ts` writes R3 inventory without overwriting R2)  
**Stop condition:** **B**  
**FEATURE_AGENTS:** OFF in staging and production defaults  
**Attorney validated:** NO  
**Nationwide support:** NO  
**Automatic production deployment:** NO  
**Technically deployable for a controlled beta:** **NO**

Do not start 6X. Do not create 6W-R4. Do not invite real beta users. Do not enable Agents. Do not claim nationwide support. Do not deploy production.

---

## 1. Executive Summary

6W-R2 froze with **TECHNICALLY DEPLOYABLE = NO** because external staging infrastructure was incomplete. 6W-R3 re-inventoried available config and attempted to configure/prove whatever was actually present.

Nothing required for a truthful staging closeout appeared:

- Clerk staging keys: **MISSING**
- `.env.staging`: **ABSENT**
- `STAGING_BASE_URL` / HTTPS host: **MISSING**
- Inngest Cloud: **BLOCKED** (`INNGEST_DEV` still active; keys local/weak)
- Redis in app env: **MISSING** (Docker Redis is local rehearsal only)
- Malware: app still `development` (Docker ClamAV is rehearsal only)
- Object storage: local MinIO (not provider recovery proof)
- Managed DB / PITR / image rollback / alerting: **EXTERNAL**

No Clerk, Cloud, or HTTPS PASS was fabricated. Localhost development probes remain rehearsal, not staging.

**STOP CONDITION B.** Remaining work is human/provider account and provisioning action. In-repo code cannot complete this gate.

---

## 2. Starting R2 State

AI / quality (frozen, not reopened):

- 6V general quality = 96.7%
- critical safety = 100%
- Research R1 = 0 critical
- Deposition DA1 = 16/16 PASS
- frozen AI safety spot checks = PASS
- FEATURE_AGENTS = OFF

Deployment (R2 freeze):

- TECHNICALLY DEPLOYABLE = **NO**
- Clerk trio missing
- Inngest `INNGEST_DEV` active
- no staging HTTPS host
- no authenticated E2E canary

6W-R2 is frozen. This phase did not reopen 6V, Research R1, Deposition DA1, Draft, Graph, Memory, Timeline, Contract Analysis, Evidence, Compare, or Contradiction product suites.

---

## 3. External Inventory

Presence only. Secret values are not printed.

| Item | Status |
| --- | --- |
| `.env` | AVAILABLE |
| `.env.staging` | ABSENT |
| `.env.production` | ABSENT |
| CLERK_SECRET_KEY | MISSING |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | MISSING |
| CLERK_WEBHOOK_SECRET | MISSING |
| INNGEST_EVENT_KEY | AVAILABLE (local/weak — not Cloud) |
| INNGEST_SIGNING_KEY | AVAILABLE (local/weak — not Cloud) |
| INNGEST_DEV | ACTIVE (Cloud proof blocked) |
| INNGEST_DISABLED | MISSING (good — ingest not disabled) |
| REDIS_URL / REDIS_HOST (app env) | MISSING |
| RATE_LIMIT_PROVIDER (app env) | MISSING (local memory default) |
| Docker Redis | HEALTHY (localhost rehearsal) |
| S3 bucket / endpoint | AVAILABLE (localhost MinIO rehearsal) |
| DATABASE_URL | AVAILABLE (local Postgres :5433) |
| MALWARE_SCANNER | development (not staging proof) |
| Docker ClamAV | HEALTHY (app not wired to it) |
| STAGING_BASE_URL | MISSING |
| HTTPS staging host / DNS / TLS | MISSING |
| FEATURE_AGENTS | UNSET (staging/production default false) |
| SMTP | MISSING (Clerk invites remain the planned path) |
| GitHub secrets (`gh secret list`) | EXTERNAL (`gh` unauthenticated) |

`.env.staging.example` now includes `STAGING_BASE_URL=https://staging.example.com` and an HTTPS `NEXT_PUBLIC_APP_URL` placeholder. Placeholders are not credentials and are not a live host.

---

## 4. Clerk

**BLOCKED — HUMAN EXTERNAL ACTION REQUIRED**

Create a Clerk **staging** application (not production). Supply:

- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_WEBHOOK_SECRET`

into a secret store / `.env.staging` (never commit). Configure Clerk redirect/callback URLs for `https://<staging-host>`.

Staging-only roles required once keys exist: owner/admin, attorney/member, view-only. No real customers.

---

## 5. Clerk Invites

**BLOCKED**

Clerk-managed invitations are the controlled-beta path. In-app SMTP is not implemented locally (`EMAIL_PROVIDER=console`). SMTP is **not** a code blocker if Clerk Dashboard invites are used.

Cannot prove: invite staging user → accept → correct org membership → correct role.

---

## 6. Auth

Real Clerk sign-in / session creation / sign-out / invalid session / expired session: **NOT PROVEN**.

Current local unauthenticated GET `/api/v1/matters` = **401**. That is DevAuth refused (`APP_ENV` source=default) plus `UnavailableAuthProvider` when Clerk keys are missing. It is **not** a Clerk session proof.

Unauthenticated = 401 is observed locally. Unauthorized = 403 is **not** HTTP-proven (requires a real authenticated-but-forbidden Clerk session).

---

## 7. RBAC

**BLOCKED** (no Clerk roles/sessions).

Cannot prove owner/attorney Case create/read, jurisdiction edit, upload, Ask, Research, Draft, Review.

Cannot prove view-only read allowed / mutation denied.

DB/permission unit isolation remains green (see §8). That is not HTTP RBAC proof.

---

## 8. Isolation

HTTP cross-org and cross-matter isolation: **BLOCKED** (requires Clerk Org A / Org B sessions).

Database permission tests run in this phase (not counted as HTTP proof):

- `packages/permissions/src/phase6s.integration.test.ts` — PASS (8)
- `packages/permissions/src/beta-security-audit.integration.test.ts` — PASS (7), including cross-org matter read deny

No HTTP leakage was observed because no authenticated staging HTTP was possible. Absence of a test is not a PASS.

---

## 9. HTTPS / DNS / TLS

**BLOCKED**

Required: `https://<staging-host>` with DNS, valid TLS, intended HSTS, secure cookies, public app URL, Clerk callbacks, Inngest endpoint.

`STAGING_BASE_URL` is unset. Probe base remained `http://localhost:3000`. Localhost is not sufficient.

HSTS was not claimed for local HTTP.

---

## 10. Inngest Cloud

**BLOCKED — HUMAN EXTERNAL ACTION REQUIRED**

`INNGEST_DEV` is still active. Event/signing keys present in `.env` are local/weak and are **not** Cloud proof.

Cannot prove: Cloud app registration, `https://<staging-host>/api/inngest`, signature validation, function discovery, document ingest, intelligence extraction, retries, concurrency.

Code still contains ingest functions. That is not Cloud registration.

---

## 11. Async Ingest

**NOT PROVEN**

Authenticated staging upload → 202 → private object → Inngest Cloud → malware → parse → chunk → embed → READY → intelligence was not run. No fake event dispatch was used.

---

## 12. Retry

Unit retry/cap behavior remains from prior phases. Cloud ingest failure → bounded retry → terminal failure → document not falsely READY → operator inspect: **NOT PROVEN**.

---

## 13. Malware

Docker ClamAV is healthy on localhost:3310. App `MALWARE_SCANNER=development`. Staging upload scanner: **EXTERNAL / BLOCKED**.

Development scanner is not proof. No staging upload of a normal document was performed.

---

## 14. Redis

Docker Redis PONG. App `REDIS_URL` unset. `RATE_LIMIT_PROVIDER` unset (memory default).

Unit Redis limiter tests: `packages/platform/src/redis-rate-limit.test.ts` — PASS (6).

Multi-instance staging Redis limiter (Ask user-scoped, Research/upload org-scoped, 429, Retry-After): **EXTERNAL / NOT PROVEN**.

---

## 15. Object Storage

Local MinIO healthy. Bucket is the compose rehearsal bucket, not a provider private bucket.

Private provider storage (S3 or documented operator-managed remote MinIO), tenant prefixes, signed access, missing-object behavior: **EXTERNAL**.

Local MinIO is not provider recovery proof.

---

## 16. Recovery

Provider versioning/restore (upload → version → delete current → restore → app access): **EXTERNAL**.

Local copy-only / compose volume recovery does not count.

---

## 17. Managed DB

Local Postgres on `:5433` with pgvector (development). Managed staging Postgres TLS, connection limits, staging app connectivity, snapshots: **EXTERNAL**.

---

## 18. PITR

Managed PITR / provider recovery point: **EXTERNAL**.

Local `pg_dump`/`pg_restore` remains a valid **secondary** rehearsal from 6W; it is not claimed as PITR.

---

## 19. Image Deployment

No staging host, no image registry deploy of N then N+1. **NOT PROVEN**.

---

## 20. Rollback

N → N+1 → N with auth / Case / upload / Ask / Research / health / readiness: **NOT PROVEN**. No data-corruption check on a staging host was possible.

---

## 21. Canary Dataset

Not created. Requires Clerk orgs/users and a staging host.

Intended (when operators provision): 1 staging-only org, 3 users, 3 Cases (VALIDATED C2A narrow / LIMITED / UNVALIDATED), synthetic contract + amendment + email notice + missing exhibit. No real client data.

---

## 22. E2E Canary

**NOT PROVEN**

SIGN IN → CREATE CASE → SET JURISDICTION → UPLOAD → WAIT READY → CASE HOME → ASK → RESEARCH → SAVE AUTHORITY → DRAFT → REVIEW → MEMORY → GRAPH → TIMELINE was not executed on staging.

---

## 23. Coverage Canary

**NOT PROVEN** on staging HTTP.

Certification was not widened. C2A frozen state from 6W-R1 is unchanged. VALIDATED / LIMITED / UNVALIDATED labels were not mutated by this phase.

---

## 24. Performance

Ask / Research / Draft / Case load / Review HTTP median and P95: **NOT MEASURED**.

Localhost and benchmark-suite wall times are not used as staging performance proof.

---

## 25. Health / Readiness

| Environment | live | ready |
| --- | --- | --- |
| Current local `next dev` | 200 | 200 (development; not a staging gate) |
| Staging HTTPS host | N/A | N/A — host missing |

Staging `/api/health/ready` = 200 is **BLOCKED**. The readiness gate was not bypassed.

If `APP_ENV=staging` were forced without Clerk/Inngest Cloud/malware/storage/limiter, ready would correctly **503** and list config problems. That 503 is the honest staging result until operators provision the stack.

---

## 26. Security

Observed on current **local** HTTP: CSP, `X-Frame-Options`, `X-Content-Type-Options: nosniff`, Referrer-Policy. HSTS is not claimed for local HTTP.

Staging CSP/HSTS/secure cookies: **NOT PROVEN**.

401 bodies remain generic. No stack traces or secret values printed by ops scripts.

---

## 27. Secrets

No `sk_live_` / long `whsec_` values in R3 baseline artifacts. `.env` is not committed. This report prints presence only.

GitHub secret listing failed (`gh auth login` required) — names were not dumped.

**PASS** for this phase’s generated reports. Critical if later leaked.

---

## 28. Logs

No authenticated canary logs to inspect. Ops scripts do not print document dumps, prompts, tokens, cookies, API keys, `DATABASE_URL`, or signed private URLs.

---

## 29. Monitoring

**EXTERNAL.** No hosting APM, Inngest Cloud dashboard, or Clerk dashboard is wired. 5xx, latency, auth failures, DB/storage health, Inngest failures, AI provider failures, rate-limit spikes: not observable on a staging host.

---

## 30. Alerting

**EXTERNAL.** Readiness-down, sustained 5xx, ingest-failure spike, DB unavailable, storage unavailable: not configured. Do not invent a fake alerting platform.

---

## 31. Audit

Staging canary audit events (Case creation, jurisdiction change, upload, Review action): **NOT PROVEN**.

---

## 32. Privacy

Privacy UI continues to describe **archive**, **deletion request**, and **scheduled** deletion (`apps/web/src/app/privacy/page.tsx`). It does not claim immediate permanent purge.

Attorney-reviewed policy language remains a placeholder. Privacy **wording truthfulness** for deletion mechanics: **PASS**. Attorney validation of the policy: **NO**.

---

## 33. Frozen AI Spot Check

Full harness was **not** re-run (no shared product/AI code change).

Focused units (2026-08-27):

| Check | Result |
| --- | --- |
| Research wrong-state controlling (`packages/research/src/weight.test.ts`) | PASS |
| Research citation-membership (`packages/research/src/synthesize.test.ts`) | PASS (22) |
| Deposition tension/inconsistency (`packages/ai/src/contradiction-semantics.test.ts`) | PASS (19) |
| 6U jurisdiction safety (`packages/jurisdiction/src/jurisdiction.test.ts`) | PASS (24) |
| Cross-org isolation (DB permission tests) | PASS (15) |
| FEATURE_AGENTS staging/production OFF | PASS |
| Auth Clerk-missing (`packages/auth/src/index.test.ts`) | PASS (10) |

Research R1 and DA1 remain the 6W-R1 frozen results (0 critical / 16/16). No genuine staging regression was exposed because staging was not reachable.

---

## 34. Agents

`getFeatureFlags({ APP_ENV: "staging" }).agents === false`  
`getFeatureFlags({ APP_ENV: "production" }).agents === false`  
`FEATURE_AGENTS` unset. Do not enable Agents. Agent beta gate remains separate.

---

## 35. Final Scorecard

| Gate | Label |
| --- | --- |
| Clerk | BLOCKED |
| Auth | BLOCKED |
| RBAC | BLOCKED |
| Isolation | BLOCKED (HTTP); DB units PASS |
| HTTPS | BLOCKED |
| Inngest Cloud | BLOCKED |
| Async ingest | BLOCKED |
| Retry | BLOCKED (unit only) |
| Malware | EXTERNAL |
| Redis | EXTERNAL (docker rehearsal) |
| Storage | NEEDS WORK (MinIO rehearsal) |
| Storage recovery | EXTERNAL |
| Managed DB | EXTERNAL |
| PITR | EXTERNAL |
| Rollback | EXTERNAL |
| E2E canary | BLOCKED |
| Coverage canary | BLOCKED |
| Performance | BLOCKED |
| Readiness | BLOCKED (staging host missing; local 200 is development) |
| Security | PASS local headers; staging HTTPS unproven |
| Secrets | PASS |
| Logs | PASS (no canary dumps) |
| Monitoring | EXTERNAL |
| Alerting | EXTERNAL |
| Audit | BLOCKED |
| Privacy | PASS (wording) |
| Frozen AI Safety | PASS |
| Agents Off | PASS |

---

## 36. Residual Risks

Largest remaining risk: treating local 401 / development ready=200 / Docker Redis-ClamAV-MinIO as staging proof, then shipping a controlled beta without Clerk sessions or Inngest Cloud ingest.

Second: `INNGEST_DEV` still on. Unsetting it without real Cloud keys would break local ingest without proving Cloud.

Third: no monitoring/alerting on a real host — failures would be silent.

---

## 37. Technical Deployment Decision

**TECHNICALLY DEPLOYABLE FOR CONTROLLED BETA = NO**

---

## 38. Attorney Validation

**NO**

---

## 39. Exactly One Next Phase

**PHASE 6X — FINAL CONTROLLED-BETA RELEASE GATE & LEGAL-PROFESSIONAL DOGFOOD**

**Authorization: NO. Do not start 6X now.**

Do **not** create PHASE 6W-R4. 6W-R3 was the further external closeout after R2. Remaining work is 100% human/provider action listed below. When that checklist is complete, 6X is the only remaining product phase.

### Exact manual actions (STOP B)

1. **Clerk account:** create a staging application; issue publishable, secret, and webhook keys; set sign-in/up and callback URLs to `https://<staging-host>`.
2. **Clerk staging users:** create one staging-only org with owner/admin, attorney/member, and view-only users. No real customers. Use Clerk-managed invitations.
3. **DNS / TLS / host:** provision an HTTPS staging hostname; valid certificate; point `STAGING_BASE_URL` and `NEXT_PUBLIC_APP_URL` at it.
4. **Inngest account:** create Cloud app; issue event + signing keys; **unset `INNGEST_DEV`**; register `https://<staging-host>/api/inngest`.
5. **Redis:** provision Redis reachable from staging; set `RATE_LIMIT_PROVIDER=redis` and `REDIS_URL`.
6. **Object storage:** provision private S3 (or document why operator-managed remote MinIO is production-safe); enable versioning.
7. **Malware:** set `MALWARE_SCANNER=clamav` (or provider) against a real scanner, not `development`.
8. **Managed DB:** provision staging Postgres with TLS + pgvector; record snapshot/PITR procedure.
9. **Image rollback:** deploy image tags N and N+1 to the staging host; prove rollback to N.
10. **Alerting:** wire readiness-down, sustained 5xx, ingest failures, DB/storage unavailable (existing provider dashboards acceptable).
11. **Secrets:** place values in the host secret store / `.env.staging`. Do not commit them. `gh auth login` if CI secrets must be listed.
12. **Do not** invite real beta users, enable Agents, deploy production, or claim nationwide support.

---

## Final questions

1. Is Clerk configured? **NO**  
2. Is real staging sign-in proven? **NO**  
3. Is unauthenticated HTTP 401? **YES locally; not Clerk-proven**  
4. Is forbidden HTTP 403? **NOT HTTP-PROVEN**  
5. Is HTTP RBAC proven? **NO**  
6. Any cross-org leakage? **Not HTTP-proven; DB isolation units PASS**  
7. Any cross-matter leakage? **Not HTTP-proven**  
8. Is HTTPS staging live? **NO**  
9. Is TLS valid? **NO staging host**  
10. Is Inngest Cloud registered? **NO**  
11. Is INNGEST_DEV off? **NO**  
12. Did upload return 202? **NO**  
13. Did upload→ingest→intelligence complete? **NO**  
14. Did failure/retry pass? **Unit only; Cloud no**  
15. Is malware scanning real? **NO** (Docker rehearsal; app `development`)  
16. Is Redis rate limiting proven? **NO** (units + local Docker; not staging)  
17. Is storage private? **Local MinIO rehearsal only**  
18. Is provider recovery proven? **NO**  
19. Is managed DB proven? **NO**  
20. Is PITR proven? **NO**  
21. Did N→N+1→N rollback pass? **NO**  
22. Did full E2E canary pass? **NO**  
23. Did VALIDATED remain VALIDATED? **YES (unchanged; not staging-proven)**  
24. Did LIMITED remain LIMITED? **YES (unchanged; not staging-proven)**  
25. Did UNVALIDATED remain UNVALIDATED? **YES (unchanged; not staging-proven)**  
26. What is Ask P95? **NOT MEASURED**  
27. What is Research P95? **NOT MEASURED**  
28. Is readiness 200? **YES on local development; NO for staging**  
29. Any secrets exposed? **NO**  
30. Any sensitive logs? **NO in this phase’s artifacts**  
31. Is monitoring sufficient? **NO**  
32. Is alerting configured? **NO (EXTERNAL)**  
33. Did audit events appear? **NO**  
34. Is privacy wording truthful? **YES** (scheduled requests, not instant purge)  
35. Did frozen AI safety remain clean? **YES** (spot check)  
36. Are Agents OFF? **YES**  
37. Is attorney validation complete? **NO**  
38. Is nationwide support justified? **NO**  
39. Is NyayaGrid technically deployable for controlled beta? **NO**  
40. Is deployment automatically authorized? **NO**  
41. What blockers remain? **Clerk app+users, HTTPS host/DNS/TLS, Inngest Cloud + `INNGEST_DEV` off, Redis limiter, ClamAV wiring, provider storage/recovery, managed DB/PITR, image rollback, alerting, authenticated E2E canary**  
42. What is largest remaining risk? **Shipping without Clerk and Inngest Cloud, or mistaking localhost probes for staging proof**  
43. What is exactly one next phase? **PHASE 6X — FINAL CONTROLLED-BETA RELEASE GATE & LEGAL-PROFESSIONAL DOGFOOD (not authorized until the R3 checklist is complete; do not create 6W-R4)**
