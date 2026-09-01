# PHASE 6W — PRODUCTION / STAGING READINESS & DEPLOYMENT PROOF

**Frozen:** 2026-08-27T05:28:00.000Z  
**Mode:** bounded infrastructure / release-engineering loop  
**Remediation iterations used:** 1 of 5  
**Stop condition:** **B** — required external setup blocks further proof  
**FEATURE_AGENTS:** OFF (staging and production)  
**Attorney validated:** NO  
**Nationwide support:** NO  
**Production deployment authorized:** NO  
**Technically deployable for a controlled beta:** **NO**

This phase is not an AI-quality rerun of 6V. It asks whether a technically beta-ready NyayaGrid can run safely and recoverably in a production-shaped staging environment.

---

## 1. Executive Summary

Phase 6V left the product at 96.7% general material quality, 100% critical safety, and a technical beta QUALITY gate PASS. 6W proved that **local production-shaped operations can be rehearsed** (clean production build, disposable staging Postgres from zero, real `pg_dump`/`pg_restore`, private MinIO, restart, RBAC/isolation tests, bounded OpenAI retries, sequential frozen-regression harness).

6W did **not** prove a controlled-beta deploy. The sequential frozen harness finished, but Research R1 reported two criticalFails. Clerk credentials and Inngest Cloud registration remain unset, so authenticated HTTP, async ingest, and an end-to-end staging canary cannot be executed honestly. Managed-provider PITR and image-tag rollback were also not proven.

Local Docker working is not treated as production readiness. Missing external proofs are marked BLOCKED or EXTERNAL, not PASS.

**Decision:** 6W does not meet the deployment-proof success bar. Do not invite beta users. Do not cut over. Next phase is a single operational closeout, not 6X.

---

## 2. Starting Quality State

From `BASELINE_6V_FINAL.json` (not rerun):

| Metric | Value |
| --- | --- |
| Tasks | 149 |
| Quality-eligible | 121 |
| PASS | 145 |
| NEEDS WORK | 4 |
| FAIL | 0 |
| CRITICAL | 0 |
| General material quality | 96.7% |
| Critical safety | 100% |
| Ask | 94.6% |
| Research | 100% |
| Draft | 91.7% |
| Contract / Deposition / Evidence / Compare / Contradiction / Timeline / Facts / Graph / Memory / Review | 100% as reported in 6V |
| FEATURE_AGENTS | OFF |
| Attorney validated | NO |
| Nationwide support | NO |
| Deployment readiness | NO (6V) |

Residual 6V non-blocking quality items left untouched:

- T6V-ASK-A-CHAIN
- T6V-ASK-D-PAY
- T6V-ASK-E-AUTO
- T6V-D-B

---

## 3. 6V Reporting Sanity Check

Question: did report display bugs invalidate 96.7%?

**No.** The headline score is unique quality-eligible tasks: 117/121 = 96.7%. Frozen task severities were not changed. 6V was not rerun to chase a higher score.

| Symptom | Class | Cause | Score impact |
| --- | --- | --- | --- |
| `false_premise` displayed 0% while 10/10 PASS | **C** family aggregation display | `familyBlock()` used `scores[name] ?? 0`, and `SCORE_FAMILIES` omitted `false_premise` / `missing`. `familyQualityPct` correctly returns 0 only when a family has zero eligible rows. | None |
| `missing` displayed 0% while 4/4 PASS | **C** same | Same | None |
| Review reported 5/4 PASS | **C** display | Numerator counted all `qualityPass` review rows; denominator used `qualityEligible` (5 review tasks, 4 eligible) | None |
| “Production iterations used” = FINAL | **A** formatting | `selected.id.replace("ITER","")` left `"FINAL"` when id is FINAL | None |

Reporting-only fix applied in `benchmarks/nyaya-bench/runner/t6v-report.ts` (`familyBlock` uses `familyQualityPct`; `productionIterationsUsed()` counts ITER files when id is FINAL). **PHASE_6V artifacts were not regenerated.**

---

## 4. Environment Matrix

No secret values. Identities only.

| | LOCAL DEVELOPMENT | TEST / BENCHMARK | STAGING (6W rehearsal) | PRODUCTION (intended) |
| --- | --- | --- | --- | --- |
| NODE_ENV | development | test | production | production |
| APP_ENV | development (default when unset) | development / test | staging | production |
| DATABASE_URL identity | localhost:5433 / `nyayagrid` | same certification DB | localhost:5433 / **`nyayagrid_staging_6w`** (not the cert DB) | managed Postgres + pgvector (EXTERNAL) |
| Object storage | MinIO localhost:9000 | MinIO | dedicated bucket `nyayagrid-staging-6w` | private S3 or operator MinIO (EXTERNAL) |
| Clerk | UNSET | UNSET | UNSET — required | required |
| Inngest | keys SET, `INNGEST_DEV=1` | local | local keys / dev mode | Inngest Cloud (EXTERNAL) |
| OpenAI | SET | SET | SET | required |
| FEATURE_AGENTS | default ON in development | ON in test defaults | **OFF** | **OFF** |
| Auth mode | DevAuth (`AUTH_PROVIDER=dev`) | DevAuth | Clerk required; DevAuth refused | Clerk |
| DevAuth | allowed only for explicit local/test | allowed | **unavailable** | **unavailable** |
| CORS / origins | `NEXT_PUBLIC_APP_URL` localhost | localhost | localhost rehearsal | HTTPS app URL |
| Secure cookies | Clerk unset; no DevAuth cookies | n/a | Clerk unset | Clerk Secure / HttpOnly once configured |
| Signing keys | Inngest SET (local/weak) | SET | SET local | production Inngest signing key |
| Storage mode | minio | minio | minio + `ALLOW_MINIO_IN_PRODUCTION` rehearsal | s3 (or operator MinIO without compose defaults) |
| Redis | UNSET (memory limiter) | memory | UNSET on this rehearsal (staging ready flags redis when required) | `RATE_LIMIT_PROVIDER=redis` |
| SMTP | UNSET / console | n/a | UNSET | required or Clerk-only invites |
| Malware | development | fixture/dev | clamav expected for real staging | clamav |

Staging boot of the production binary (`APP_ENV=staging AUTH_PROVIDER=clerk NODE_ENV=production npm start -w @nyayagrid/web`) succeeded. Config gate **warns** on staging (does not throw except `AUTH_PROVIDER=dev`). Readiness is **503** because Clerk/Inngest Cloud/malware/email/billing/redis/localhost MinIO are recorded as production blockers. That 503 is correct, not a secret leak.

---

## 5. Production Build

| Check | Result |
| --- | --- |
| Install from lockfile | Assumed present (workspace already installed; `npm ci` not re-purchased) |
| Typecheck | PASS (`npm run typecheck`) |
| Lint | Not re-run as a separate 6W gate; typecheck + production build were the compile gates |
| Production build | PASS (`npm run build`, ~47s compile) |
| Dev-only import leakage | No benchmark package required at Next runtime |
| Test fixture imports in app | Not observed in production compile |
| Missing env hidden by dev fallback | Staging/production `validateConfigForEnv` lists problems; production **throws**; staging warns and still boots |
| Client bundle secrets | `.next/static` scanned: no `sk-…`, `OPENAI_API_KEY`, or connection-string hits |

**Warning (recorded, not a fail):** `packages/documents/src/ocr.ts` webpack “Critical dependency: the request of a dependency is an expression”.

**Warning:** `next start` reports `"output: standalone"` — Docker runtime is `node apps/web/server.js`. Local restart proof used `next start` and still served `/api/health/live`.

---

## 6. Feature Flags

Verified in `packages/platform/src/features.ts` and tests:

| Flag | staging default | production default |
| --- | --- | --- |
| FEATURE_AGENTS | **OFF** | **OFF** |
| FEATURE_PROFESSOR | OFF | OFF |
| FEATURE_GUIDE | OFF | OFF |
| FEATURE_RESEARCH | OFF | OFF |
| FEATURE_OCR | OFF | OFF |
| FEATURE_LIVE_AI | OFF | OFF |

- Production config **rejects** `FEATURE_AGENTS=1` unless `ALLOW_AGENTS_IN_PRODUCTION` (must remain unset).
- DevAuth is unavailable when `APP_ENV=staging` or `production` (`isExplicitLocalDevAuthAllowed`). Staging **throws** if `AUTH_PROVIDER=dev`.
- `ALLOW_AUTHORITY_HTTP_IMPORT` unset → corpus HTTP import disabled.
- Local `.env` may show agents/professor/research **on** because APP_ENV defaults to development. That is local-only and is not staging/production.

---

## 7. Database

Disposable staging database **`nyayagrid_staging_6w`** on docker Postgres (`nyayagrid-postgres`). **Not** the certification database `nyayagrid`.

| Proof | Result |
| --- | --- |
| Connection | PASS |
| Migrations from zero | PASS — 13 applied (0000–0012) |
| pgvector | PASS (`vector` + `pgcrypto`) |
| Indexes | 359 |
| Constraints | Present via Drizzle SQL chain (no DROP in current set) |
| Connection limits | postgres.js pool `max: 10` in `createDb` |
| SSL | Local docker: none. Managed-provider SSL: EXTERNAL / document per host |
| App start after migrate | Staging Next process started against local stack |

---

## 8. Migration Rehearsal

Against disposable data (`scripts/phase-6w-ops.ts`):

1. Initialize `nyayagrid_staging_6w`
2. Apply complete migration chain
3. Seed synthetic staging tenant `6w-staging-*` (2 matters: VA + UNVALIDATED; document, conversation, draft, memory, graph edge, synthetic authority)
4. Boot application (staging Next)
5. Exercise reads/writes via seed + restore verification queries
6. Restart application (kill PID on :3000, `npm start` again)
7. Verify data remaining in staging DB after restart (restore DB separately also verified)

No production database was mutated.

---

## 9. Backup

A **real** staging backup was created. A pre-existing file was not reused as proof.

| Field | Value |
| --- | --- |
| Timestamp | 2026-08-27T05:04:53.299Z |
| Database | `nyayagrid_staging_6w` |
| Format | `pg_dump` custom (`-Fc`) |
| Size | 413703 bytes |
| Command | `docker exec nyayagrid-postgres pg_dump -U nyayagrid -d nyayagrid_staging_6w -Fc` |
| Encryption | none (local rehearsal; encrypt before any off-host copy) |
| Storage | `tmp/6w-ops/2026-08-27T05-04-44-704Z/nyayagrid_staging_6w.dump` |

Managed Postgres PITR: **EXTERNAL PROOF REQUIRED**.

---

## 10. Restore

Restored into a **separate** disposable database `nyayagrid_staging_6w_restore`. `pg_restore` exit 0.

Smoke counts:

| Object | Count |
| --- | --- |
| organizations | 1 |
| matters | 2 |
| documents (metadata) | 1 |
| conversations | 1 |
| legal authorities | 1 |
| drafts | 1 |
| memories | 1 |
| graph edges | 1 |
| analysis_runs table | present |
| document_analyses table | present |
| VA / supported matter | 1 |
| UNVALIDATED matter | 1 |
| extensions | pgcrypto, vector |

**BACKUP WITHOUT RESTORE PROOF would be FAIL.** Restore was executed and verified.

---

## 11. Object Storage

Production-shaped **private MinIO** bucket `nyayagrid-staging-6w` (not public).

| Check | Result |
| --- | --- |
| Upload | PASS |
| Download | PASS |
| Metadata | PASS (object exists after put) |
| Signed / private access | PASS (signed URL generated; public-bucket heuristic false) |
| Tenant key prefix | `org/{orgId}/...` |
| Missing object | PASS (not-found) |
| Path-traversal filename | Normalized (`../evil/payload.txt` → `.._evil_payload.txt`); no `..` segment |
| Buckets public | No |

Retry/error and oversized/prohibited HTTP upload: unit tests in `@nyayagrid/documents` (ingest-job, limits, archives). HTTP canary of those paths is blocked without Clerk.

---

## 12. Storage Recovery

Local rehearsal: known object uploaded → copied to `.bak` → original deleted → restored from `.bak`. **PASS**.

Provider-native S3 versioning / PITR: **EXTERNAL PROOF REQUIRED**. Not marked PASS.

---

## 13. Inngest

| Check | Result |
| --- | --- |
| `GET /api/inngest` reachable | PASS (200) |
| Function registration (dev mode) | PASS — `function_count: 18` |
| Ingest job | `nyayagrid-document-malware-scan` on `nyayagrid/document.malware_scan`; retries=4; concurrency global 3 / per-org 2 |
| Intelligence job | `nyayagrid-matter-extract-intelligence`; retries=4; concurrency global 2 / per-org 1 |
| Signing keys present locally | yes (`INNGEST_DEV=1`) |
| Inngest Cloud registration | **BLOCKED** — EXTERNAL ACTION REQUIRED — INNGEST CLOUD REGISTRATION |
| Real staging invocation | **NOT PROVEN** |

`Dockerfile.worker` is Inngest Dev CLI only and must not be used in production.

---

## 14. Async Ingest

Required path: UPLOAD → 202 → object storage → ingest event → parse → chunk → embed → document ready → intelligence.

**BLOCKED.** Needs Clerk-authenticated upload plus non-dev Inngest delivery.

Unit ingest-job tests exist (retries bounded, terminal failure recorded, no infinite loop). That is not HTTP staging canary proof.

Ingest failure/retry via real jobs: **BLOCKED** (same credentials). Do not claim complete.

---

## 15. Auth / Clerk

Production/staging must not rely on DevAuth. Code enforces that.

Clerk sign-in, org create/access, sign-out, expired session, unauthorized routes with a real session: **BLOCKED**.

`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `CLERK_WEBHOOK_SECRET` are UNSET.

**EXTERNAL ACTION REQUIRED — CLERK BETA USERS**

Unauthorized `GET /api/v1/matters` against Clerk-unconfigured staging returned generic `{"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}` (500). That is **not** a secret leak. It is **NEEDS WORK** versus a clean 401 once Clerk is wired (adapter throws on missing keys).

---

## 16. RBAC

In-process production-shaped identities (not Clerk users), `RUN_DB_TESTS=1`:

- `beta-security-audit.integration.test.ts`
- `phase6s.integration.test.ts`
- permissions filename / storage-key tests

**17 tests PASS.** J1 also PASS (jurisdiction + research layer + phase6s).

Covered: matter access, view-only mutation denial, cross-org denial, portal/guest boundaries as encoded in those suites.

Clerk-provisioned owner / attorney / view-only / guest in staging HTTP: **not proven** (blocked on Clerk).

---

## 17. Tenant Isolation

Org A / Org B isolation is covered by the same DB integration tests plus 6V isolation matters (not reopened as a quality chase). Object keys are org-prefixed.

No cross-org leakage observed in tests. **CRITICAL if violated — not observed.**

HTTP cross-org with Clerk sessions: **not proven**.

---

## 18. Security Headers

Observed on production `NODE_ENV=production` responses:

| Header | Status |
| --- | --- |
| Content-Security-Policy | Present (`default-src 'self'`; production omits `'unsafe-eval'`; `'unsafe-inline'` remains for Next hydration) |
| X-Content-Type-Options | nosniff |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera/microphone/geolocation/interest-cohort disabled |
| X-Frame-Options | DENY |
| HSTS | Present when NODE_ENV=production (`max-age=63072000; includeSubDomains; preload`) |
| HTTPS | Assumed at the load balancer; local rehearsal is HTTP |
| Clerk cookies SameSite / HttpOnly / Secure | EXTERNAL (Clerk SDK once configured) |

CSP `'unsafe-inline'` is a documented Next App Router gap, not silently removed.

---

## 19. Secret Hygiene

| Surface | Result |
| --- | --- |
| Tracked source scan | PASS — no live-looking credential patterns in non-test sources (ops scanner) |
| Client `.next/static` | PASS — no API keys / connection strings |
| `.env` | gitignored; not committed |
| Reports / baselines | Redacted identities only |
| Docker configs | Compose defaults documented as **forbidden** in production |
| Test fixtures | Synthetic |

No real secret exposure found. **If one is found later: CRITICAL, stop, rotate externally.** Values are not printed here.

---

## 20. Logging

`@nyayagrid/observability` redacts keys matching password/secret/token/authorization/api_key/cookie/prompt/document_text/content/body.

Tests: 10 sanitization tests PASS.

Operational metadata remains: timestamps, scope, provider names, error **names** (not raw messages on unhandled 500s).

Full prompt/document logging is not claimed absent in every call site; the logger redact path is the control. Do not invent provider log guarantees.

---

## 21. Error Handling

| Case | Evidence |
| --- | --- |
| Unhandled errors | Generic `"An unexpected error occurred"`; no `error.message` to client |
| Clerk missing | 500 generic (NEEDS WORK vs 401) |
| DB error on ready | `databaseError: "unreachable"` in staging/production |
| Rate limit | 429 + Retry-After |
| Unauthorized (when typed) | 401 `UnauthenticatedError` |
| Forbidden | 403 |
| Validation | 400 without stack |
| OpenAI timeout / 429 | Bounded in `packages/ai/src/openai-http.ts` (max 2 retries, Retry-After cap 8s, no retry of other 4xx, AbortSignal) |

Database/object-storage/Inngest fully down HTTP canaries were not all exercised as live chaos; ready 503 on unsafe staging config was observed.

No raw secrets in those responses.

---

## 22. OpenAI Reliability

Residual 6V/ops gap: bounded HTTP timeout + 429 / Retry-After.

**Implemented (iteration 1):** `packages/ai/src/openai-http.ts` wired into generate and embed.

- 429 honored with Retry-After, cap 8s
- 5xx / 408 retried
- other 4xx not retried
- max 2 retries (3 attempts total)
- AbortSignal cancellation
- `ResilientAIProvider` 30s timeout still wraps generate

Tests: 12 PASS (`openai-http.test.ts` + `fallback.test.ts`).

No infinite retry.

---

## 23. Rate Limits

Presets (`packages/platform/src/rate-limit.ts`):

| Class | Limit | Window | Scope |
| --- | --- | --- | --- |
| auth | 10 | 5 min | IP |
| upload | 120 | 1 hour | organization |
| ask_nyaya | 60 | 1 hour | user |
| research | 40 | 1 hour | organization |
| expensive_ai | 10 | 1 hour | organization |

429 responses include Retry-After. Unit tests: `rate-limit.test.ts`, `expensive-route-limits.test.ts`, `redis-rate-limit.test.ts` PASS.

Staging HTTP burst against Clerk-auth routes: **not proven** (Clerk blocked). Redis fail-closed is the production design; this rehearsal used memory limiter locally.

---

## 24. File Security

- Allowed types / max size: documents package limits tests PASS
- Malformed / archives: tests PASS
- Path traversal names: normalized; no filesystem write of `..`
- Object-key isolation: org prefix
- Duplicate filenames: versioned keys (`documentId` / `versionId`)

No arbitrary filesystem write observed.

---

## 25. Health / Readiness

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health/live` | 200 `{"ok":true}` — no dependency probe |
| `GET /api/health/ready` | 503 when staging/production config unsafe, DB down, storage down (staging/prod), redis required-and-down, ingest disabled |

Ready body includes requirement **strings** and provider **names**, not connection strings. `publicDatabaseError` returns `"unreachable"` outside development/test.

OpenAI is **not** probed (cost/outage coupling).

---

## 26. Restart

Cold start of production-shaped app: PASS. Kill web PID on :3000, restart `npm start -w @nyayagrid/web` with `APP_ENV=staging AUTH_PROVIDER=clerk`: live 200 again, no manual repair.

Worker is HTTP into the same process (`/api/inngest`), not a separate production worker. DB/MinIO docker services remained up.

---

## 27. Performance

6U full performance program was **not** rerun.

Deployment-oriented HTTP smoke (Case load, upload, Ask, Research, Draft, Review medians/P95) is **BLOCKED** without Clerk.

Live frozen Compare B2 completed in ~73s wall for the suite; Contradiction B2 ~214s. Those are benchmark walls, not user-facing P95 Case-load.

Flag vs prior ~6s Ask target: **not remeasured** on staging HTTP. NEEDS WORK until canary exists.

---

## 28. Open Handle / Process Leak

6V leftover: Node processes staying alive on open DB handles.

Iteration 1: `createDb` attaches `$client`; `closeDb()` ends the pool. Bench runners (`t6v`, `t6u`, `t6t-c2a`, ingest) and J1 (`process.exit(0)` on success) close before exit. Integration tests `afterAll(closeDb)`.

Frozen **unit** suites terminated with exit 0 without manual kill.

The live frozen harness **completed** (exit 0, lock released). Do not restack it. A follow-up must fail suites that report `criticalFails` even when the CLI exits 0.

---

## 29. Frozen Regression Harness

`scripts/frozen-regression-harness.ts` / `npm run ops:6w-frozen`:

- Sequential only
- Per-suite timeout + SIGTERM then SIGKILL
- Progress logs to stdout
- Exit code captured
- Lock file prevents duplicate stacks
- Separate logs under `tmp/6w-frozen/`
- Continues all suites unless `--fail-fast`
- Historical `BASELINE_*` / `PHASE_*` not overwritten: live writers use `NYAYA_BENCH_BASELINES_ROOT=baselines/6w-regression` and `T6U_BASELINE=6W_REGRESSION`

`npm run ops:6w-frozen-unit` completed 7/7 PASS before the full live harness started.

---

## 30. Frozen Regression Results

Harness finished 2026-08-27T06:23:48Z. Sequential lock released. Historical `BASELINE_6T_C2A_*` / `BASELINE_6U_FSJ*` / `PHASE_6U_*` were **not** overwritten. C2A wrote `baselines/6w-regression/BASELINE_6T_C2A_REAL_STATE_BATCH.json`. 6U wrote `BASELINE_6U_6W_REGRESSION.json`.

Process exit: **21/21 exit 0**, 0 timeouts. That is **not** the 6W critical bar. The harness scores PASS on CLI exit code only and did **not** fail-fast on `criticalFails` inside a suite.

| Suite | Harness | Task counts |
| --- | --- | --- |
| unit-* / j1 / isolation-rbac | PASS | n/a |
| compare-b2 | PASS | 48 pass, 0 fail, 0 critical |
| contradiction-b2 | PASS | 32 pass, 0 fail, 0 critical |
| timeline-t2 | PASS | completed; no criticalFails in summary |
| memory-m2 | PASS | 0 fail, 0 critical |
| analysis-trust-live | PASS | 14 pass, 0 fail, 0 critical |
| deposition-da1 | PASS (exit) | 15 pass, **1 fail**, 0 critical — SYNTH-V2-006-DA004 tension miss |
| contract-ca1 | PASS (exit) | 17 pass, **1 fail**, 0 critical — SYNTH-V2-001-CA012 header span |
| evidence-em2 | PASS | 28 pass, 0 fail, 0 critical |
| graph-g2 | PASS | 0 fail, 0 critical |
| research-r1 | PASS (exit) | 13 pass, 3 NW, **2 fail, 2 criticalFails** |
| draft-source-limitation-live | PASS | 24 pass, 0 fail, 0 critical |
| full-system-6r | PASS | 0 fail, 0 critical in summary |
| c2a-critical | PASS | 127 tasks, 124 pass, 3 NW, 0 fail, 0 critical |
| 6u-r1 | PASS | 47 tasks, 45 pass, 2 NW, 0 fail, **criticalSafety 100**, quality 95.7% |

**New critical AI regression (blocks frozen gate):** Research R1

- SYNTH-V2-001-R010 — `Unsafe research claim: other state code § 100 is controlling`
- SYNTH-V2-001-R014 — `Synthesis cited an authority id that was not retrieved`

Non-critical stochastic misses (documented, not 6W critical class): DA004, CA012; 6U T6U-R-B and T6U-ASK-A (expected token retrieved but not clearly synthesized).

C2A/6U JSON printed `featureAgentsProduction: true` because those runners inherited unset `APP_ENV` (development defaults). Staging/production **code defaults remain OFF**. Not an Agents enablement.

---

## 31. Canary Dataset

Synthetic staging seed (not GT-heavy):

- 1 org (`6w-staging-*`)
- 2 matters (narrow VA / supported + UNVALIDATED)
- 1 document metadata row plus MinIO object in the ops bucket

Intended 2 users / 5–10 documents / contract+amendment+missing exhibit HTTP canary: **not created via product UI** (Clerk blocked). Seed is the local dataset only.

---

## 32. E2E Staging Canary

SIGN IN → CREATE CASE → SET JURISDICTION → UPLOAD → INGEST → CASE HOME → ASK → RESEARCH → SAVE AUTHORITY → DRAFT → REVIEW → MEMORY → GRAPH → TIMELINE

**BLOCKED** (no Clerk users, no Inngest Cloud).

Coverage labels on the seed/restore path: VA and UNVALIDATED **survived restore** (see §10 / §33).

---

## 33. Coverage Canary

Restore verification: 1 VA matter, 1 UNVALIDATED matter. No deployment config converted coverage to nationwide or silently VALIDATED.

LIMITED (6V matters H/I/J) was not mutated by 6W config. FEATURE_AGENTS remains off. Jurisdiction coverage was not widened.

---

## 34. Deployment Procedure

Authoritative operator docs remain `docs/DEPLOYMENT.md`, `docs/BACKUP_RESTORE.md`, `docs/operations/PHASE_BETA_DEPLOYMENT_READINESS.md`, `.env.beta.example`, `.env.staging.example`.

Minimum order (no secret values):

1. **Prerequisites:** Postgres 15+ with pgvector + pgcrypto; private object storage; Clerk app; OpenAI; ClamAV; Redis; Inngest Cloud; SMTP or Clerk-only invites; TLS terminator.
2. **Environment:** `APP_ENV=production` (or staging), `AUTH_PROVIDER=clerk`, Clerk trio, `DATABASE_URL`, `STORAGE_PROVIDER=s3` (or operator MinIO without compose default keys), `INNGEST_*` with `INNGEST_DEV` unset, `RATE_LIMIT_PROVIDER=redis`, malware=clamav, no `FEATURE_AGENTS`.
3. **Migrations:** `DATABASE_URL=... npm run db:migrate` **before** rolling the new image. Never implicit on container start.
4. **Build:** `docker build -t nyayagrid-web:<tag> -f Dockerfile .`
5. **Deploy:** run standalone `node apps/web/server.js` (or documented `docker run`), env from secret manager.
6. **Health:** `/api/health/live` then `/api/health/ready` → 200.
7. **Inngest:** register Cloud app against `https://<host>/api/inngest`.
8. **Clerk:** production/staging instance + webhook + first operator users.
9. **Storage:** private bucket, no public ACL, versioning preferred.
10. **Smoke:** sign-in, create synthetic matter, upload, wait ingest ready, Ask/Research/Draft/Review.
11. **Rollback:** previous image tag; schema rollback = restore snapshot taken **before** migrate (see §36).

---

## 35. Rollback

| Layer | Proven? |
| --- | --- |
| Web process restart | PASS |
| Image tag N → N+1 → N | **NEEDS WORK** — two container tags not built/swapped |
| DB compatibility after app rollback | Current migrations are additive; rolling the app back without rolling schema is the intended compatible path |
| Irreversible migration | None identified in 0000–0012 (no DROP). Policy: snapshot before migrate anyway |

Automatic production cutover remains **blocked**.

---

## 36. Migration Recovery

Grep of `packages/database/drizzle/*.sql`: **zero `DROP TABLE` / `DROP COLUMN`**. All 0000–0012 are additive. There are **no automated down migrations**.

| Class | Current set |
| --- | --- |
| Additive / expand-only | 0000–0012 |
| Destructive | none found |
| Irreversible transforms | none found |

**Production policy:** take a snapshot / PITR restore point **before** `db:migrate`. If a release must be aborted after migrate, restore that snapshot or keep the new schema and roll the application only if the old app is forward-compatible. Do not pretend every migration is reversible.

---

## 37. Monitoring

Minimum for controlled beta (not a new observability platform):

| Signal | Source |
| --- | --- |
| 5xx rate | load balancer / platform logs of `INTERNAL_ERROR` |
| Latency | platform APM or access logs |
| AI provider errors | job logs; OpenAIHttpError status |
| 429 | `RATE_LIMITED` + provider 429 |
| Ingest failures | document status + Inngest `onFailure` → `markIngestFailedAfterRetries` |
| Job retries | Inngest dashboard |
| DB errors | ready probe + logs (`database: error`) |
| Storage errors | ready `storage` |
| Auth failures | Clerk dashboard + 401 counts |
| Critical AI safety | existing eval/audit events; not a new bus |

Stdout JSON logs are the in-repo signal. Wire CloudWatch/Loki/Datadog externally.

---

## 38. Alerting

Define (implement on the host, not in this repo):

- Sustained 5xx
- Ingest failure spike
- Database unavailable (ready 503)
- Object storage unavailable
- Background job failure (Inngest)
- Abnormal AI provider failure / 429 storm

**EXTERNAL:** no alerting provider is configured in-tree. Marked implementation requirement, not PASS.

---

## 39. Auditability

`writeAuditEvent` / lifecycle audit exists for:

- Case creation (`matter.created`)
- Jurisdiction / matter update (`matter.updated` includes primaryState, courtId, governingLawState, …)
- Upload (`document.uploaded`)
- Review decisions (`packages/intelligence/src/review.ts` — timeline/memory/graph/analysis actions)
- Holds, deletion requests, training consent, billing review, drafts, extraction

Permission-change audit: role/invite paths exist in platform/permissions; not expanded in 6W.

Gap: HTTP canary did not generate a live audit trail in staging.

---

## 40. Retention / Deletion

Current beta behavior (`docs/RETENTION_AND_LEGAL_HOLD.md`):

- Delete Case / document: archive + **deletion requests**, not silent purge
- Original objects remain until operator-executed deletion re-checks holds
- Legal hold blocks deletion
- Audit events are not auto-purged

**Known beta limitation:** permanent purge is incomplete. Documented, not silently called “deleted.” Privacy-critical only if operators tell users objects are gone when they are not — UI copy should stay request/scheduled language.

---

## 41. Privacy

- Uploads are tenant-scoped (org keys + matter access checks).
- No training-on-client-data claim as an active pipeline: consent UI exists; product still has **no training pipeline**.
- Chat completions use `store: false` (documented on `/privacy`, `/ai-disclosure`, `/subprocessors`).
- Privacy page is explicitly a **placeholder** pending attorney review.
- Do not invent OpenAI/Clerk/AWS contractual guarantees.

---

## 42. External Actions

**CODE-COMPLETE (local rehearsal):** build, migrations, dump/restore, MinIO private put/get/recover, headers, health split, flags, DevAuth refusal, OpenAI retries, pool close, frozen harness, RBAC/isolation tests.

**EXTERNAL SETUP REQUIRED (not PASS):**

1. EXTERNAL ACTION REQUIRED — CLERK BETA USERS
2. EXTERNAL ACTION REQUIRED — INNGEST CLOUD REGISTRATION
3. Managed Postgres PITR on the chosen provider
4. Private non-localhost object storage with versioning
5. SMTP or Clerk-only invites (in-app SMTP send still throws)
6. Hosting / DNS / TLS
7. Alerting provider
8. Finish remaining live frozen suites under the existing harness (OpenAI cost; not a purchase of infra)

---

## 43. Scorecard

| Gate | Label |
| --- | --- |
| Build | **PASS** |
| Migrations | **PASS** |
| Database | **PASS** |
| Backup | **PASS** |
| Restore | **PASS** |
| Storage | **PASS** |
| Storage recovery | **NEEDS WORK** (local copy PASS; provider PITR EXTERNAL) |
| Inngest | **BLOCKED** |
| Auth | **BLOCKED** |
| RBAC | **PASS** (DB tests; Clerk HTTP unproven) |
| Isolation | **PASS** (DB tests) |
| Secrets | **PASS** |
| Logging | **PASS** |
| Errors | **NEEDS WORK** (Clerk-missing 500 vs 401) |
| Rate limits | **PASS** (unit; HTTP burst unproven) |
| Health | **PASS** |
| Performance | **NEEDS WORK** |
| Process cleanup | **PASS** |
| Frozen regressions | **FAIL** (Research R1: 2 criticalFails; harness exit-code PASS is insufficient) |
| Canary | **BLOCKED** |
| Rollback | **NEEDS WORK** |
| Monitoring | **NEEDS WORK** |
| Privacy | **NEEDS WORK** (placeholder policy; purge incomplete) |

No **CRITICAL** operational finding (no cross-org leak, no secret in client bundle, no fabricated external PASS).

Critical operational gates are **not** 100% PASS.

---

## 44. Production Changes

Iteration 1 only (smallest general ops fixes). No Agents enablement. No jurisdiction widening. No 6V quality chase.

- Bounded OpenAI HTTP retries (`packages/ai/src/openai-http.ts`)
- `closeDb` / `$client` on `createDb`; bench/CLI/J1/integration test pool close
- Frozen regression harness + `NYAYA_BENCH_BASELINES_ROOT`
- Client 500s no longer return `error.message`
- `scripts/beta-check.ts` expected migrations include `0012_phase6s_jurisdiction`
- 6V **reporting-only** display fix in `t6v-report.ts` (PHASE_6V not regenerated)
- `scripts/phase-6w-ops.ts` disposable staging proof
- Path-traversal filename assertion in permissions tests
- beta-security-audit DATABASE_URL fallback so the suite can run against local docker

---

## 45. Residual Risks

- Clerk and Inngest Cloud unset → no real beta auth or async ingest
- Staging ready stays 503 until production-shaped secrets exist
- SMTP invite send unimplemented
- Privacy policy placeholder
- Deletion is request/archive, not purge
- CSP `'unsafe-inline'`
- Image-tag rollback unproven
- Research R1 criticalFails (wrong-state controlling; unsourced authority id)
- Frozen harness treats CLI exit 0 as PASS even when a suite reports criticalFails
- Unauthorized-without-Clerk returns 500
- Local MinIO is not AWS S3 versioning
- Redis unset locally (memory limiter) — multi-instance staging must use Redis
- FEATURE_RESEARCH default off in staging — a Research canary needs an explicit flag after Clerk exists

---

## 46. Deployment Readiness Decision

**NO** — not ready to deploy a controlled beta.

Code and local ops rehearsal are substantially ready. Research R1 criticalFails, Clerk, Inngest Cloud, and HTTP canary still block the 6W success bar.

---

## 47. Attorney Validation Status

**NO.** Unchanged from 6V. 6W does not substitute lawyer review.

---

## 48. Exactly One Next Phase

**PHASE 6W-R1 — STAGING CREDENTIALS, INNGEST CLOUD, AND FROZEN LIVE REGRESSION CLOSEOUT**

6W-R1 should:

1. Close Research R1 criticalFails (wrong-state controlling; unsourced authority id). Teach the frozen harness to fail on `criticalFails`, not only CLI exit 0.
2. Complete Clerk staging application + operator users (manual; do not invent users).
3. Register Inngest Cloud against staging `/api/inngest` and prove upload → ingest → intelligence.
4. Run the HTTP E2E canary and LIMITED/UNVALIDATED UI check.
5. Prove image-tag rollback and document managed PITR as EXTERNAL until the real provider is used.

Do **not** skip to 6X. Do **not** deploy automatically. Do **not** enable Agents. Do **not** claim nationwide support.

---

## Final questions

1. Did the 6V reporting inconsistencies affect the 96.7% score? **NO**
2. Does production build pass? **YES**
3. Can staging boot from clean deployment? **YES** (warns; ready 503 until secrets exist)
4. Do migrations apply successfully? **YES**
5. Was a real database backup created? **YES**
6. Was that backup restored successfully? **YES**
7. Was restored data verified? **YES**
8. Is object storage private and tenant-safe? **YES** (local MinIO rehearsal)
9. Was object recovery demonstrated? **YES** locally; provider-native **EXTERNAL**
10. Is Inngest staging registration complete? **NO**
11. Did async upload→ingest→intelligence pass? **NO** (blocked)
12. Did ingest failure/retry behavior pass? **Unit YES; HTTP NO**
13. Is DevAuth disabled outside dev/test? **YES**
14. Is Clerk staging authentication proven? **NO**
15. Does RBAC pass? **YES** in DB tests; Clerk HTTP unproven
16. Does view-only remain restricted? **YES** in DB tests
17. Any cross-org leakage? **NO** (not observed)
18. Any cross-matter leakage? **NO** (not observed)
19. Any secrets exposed? **NO**
20. Any sensitive logs? **NO** in the sanitizer tests / 500 path; do not claim every call site
21. Are provider timeout / 429 behaviors bounded? **YES**
22. Do rate limits work? **YES** in unit tests
23. Are health/readiness endpoints safe? **YES**
24. Do CLI/benchmark processes terminate cleanly? **YES** (harness exited 0 after ~68 min; lock released)
25. Did frozen critical regression suites complete? **YES** (21/21 ran; Research R1 critical bar **not** met)
26. Any new critical AI regression? **YES** — Research R1 (wrong-state controlling; unsourced authority id)
27. Did staging E2E canary pass? **NO** (blocked)
28. Did LIMITED remain LIMITED? **YES** (not converted by 6W config)
29. Did UNVALIDATED remain UNVALIDATED? **YES** (restore proof)
30. Did restart pass? **YES**
31. Did rollback pass? **Process restart YES; image-tag NO**
32. Is monitoring sufficient for controlled beta? **NO** (signals defined; no alerting provider)
33. What external actions remain? Clerk users; Inngest Cloud; managed PITR; S3 versioning; SMTP or Clerk invites; DNS/TLS; alerting. Research R1 critical closeout is in-repo, not external.
34. Are Agents still OFF? **YES**
35. Is attorney validation complete? **NO**
36. Is nationwide support justified? **NO**
37. Is NyayaGrid technically deployable for a controlled beta? **NO**
38. Is production deployment authorized automatically? **NO**
39. What is the largest remaining blocker? **Research R1 criticalFails (wrong-state controlling / unsourced cite) plus Clerk staging credentials + Inngest Cloud registration**
40. What is the exactly one next phase? **PHASE 6W-R1 — STAGING CREDENTIALS, INNGEST CLOUD, AND FROZEN LIVE REGRESSION CLOSEOUT**
