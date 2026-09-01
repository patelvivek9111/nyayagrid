# NYAYAGRID BETA SECURITY & PRIVACY AUDIT

**Date:** 2026-08-19  
**Scope:** repository-backed security and privacy review for a controlled legal beta.  
**Mode:** audit only. No production security fixes. Contract Analysis, analysis engines, agents, frozen reliability baselines, and related AI subsystems were not modified.

**Method:** inspected authentication, permissions, API routes, storage, retrieval, research import, agents, logging, config gates, uploads, and existing tests. Added non-invasive audit tests only.

---

## 1. Executive Summary

NyayaGrid already has a serious authorization core: per-route `requireUser`, capability checks, default-deny matter membership, org+matter hybrid retrieval with post-hit asserts, private MinIO/S3, OpenAI chat `store: false`, log redaction, agent tool re-auth, and production boot gates against `AUTH_PROVIDER=dev`. That is stronger than a typical early legal-AI prototype.

It is **not** yet safe to expose to a multi-firm legal beta with confidential client files, because two application-layer paths can move confidential matter intelligence or text outside the matter (and, for the authority corpus, outside the tenant).

| Severity | Count |
|----------|------:|
| Critical | 3 |
| High | 8 |
| Medium | 12 |
| Low | 8 |

**Beta blockers**

- **SEC-C1** — Any org member with `documents.upload` can write text into the **global** legal-authority corpus, which other tenants, students, and Guide users can retrieve.
- **SEC-C2** — Org-level research sessions accept `matterId` with only `matters.view` (including `client_guest`). No matter membership check. Verified memory/facts/graph for that matter can enter research prompts.
- **SEC-C3** — `AUTH_PROVIDER=dev` plus `APP_ENV=development` (or unset, non-staging) on a reachable host is full identity spoofing, including a default seeded owner identity with no header.

**Beta security decision:** **READY AFTER P0 FIXES**

A single-firm internal dogfood with Clerk, `APP_ENV=production`, import/research membership locked down, and ClamAV on professional uploads can be a controlled beta. Shipping the current research-import and org-research-session behavior to multiple law firms handling real client documents is not acceptable.

This is not a SOC 2 / HIPAA finding. It is about actual confidentiality bugs and misconfiguration footguns in this repo.

---

## 2. Threat Model

### Assets (from code)

| Asset | Where it lives |
|-------|----------------|
| Original uploads | MinIO/S3 keys `org/{organizationId}/documents/...`; Professor `students/{userId}/cases/...`; Guide text in Postgres only |
| Extracted text / chunks / embeddings | `document_chunks` (+ pgvector), student/guide chunk tables, `legal_authority_chunks` |
| Matter metadata | `matters`, `clients`, members |
| AI prompts / outputs | Sent to OpenAI when live; persisted in conversations, `ai_artifacts`, research artifacts, drafts |
| Memory / timeline / graph / analysis / drafts / agents | Matter-scoped Postgres tables |
| Shared research corpus | `legal_authorities*` — **no tenant column** |
| User/session | Clerk JWT or DevAuth header; `users.authSubject` |

### Actors

Authenticated professional (owner/lawyer/staff/client_guest), other-org user, malicious member, student, public/Guide user, compromised account, external attacker, OpenAI (embeddings + chat), Inngest workers, OCR HTTP provider if configured.

### Trust boundaries (actual)

| Boundary | Enforcement |
|----------|-------------|
| Browser → API | Per-route `requireUser` / `requireGuideUser`. **No `middleware.ts`.** Pages are not edge-protected. |
| API → Postgres | Application filters. **No RLS.** Single pooled role (`createDb`). |
| API → MinIO/S3 | Server `putObject` / presigned GET. Bucket not given public ACL in compose. |
| App → OpenAI | Full prompt + chunk text; chat `store: false`. Embeddings send raw strings. |
| App → Inngest | `/api/inngest` uses Inngest signing, not user sessions. Production config does **not** require Inngest keys. |
| Professional ↔ Student ↔ Public | Separate tables + ownership helpers. `workspace_type` enum is unused. Shared authority corpus is the join point. |
| Org / matter | `requireCapability` + `requireMatterAccess` + query `organizationId`/`matterId`. Exceptions documented below. |

---

## 3. Authentication

**Providers:** `AUTH_PROVIDER=dev` (default) or `clerk` (`packages/auth/src/index.ts`, `apps/web/src/lib/auth.ts`, `clerk-session.ts`).

**Dev:** If `APP_ENV` is production/staging, identity is always null. Otherwise: optional `x-nyayagrid-dev-user` (any subject), else default `DEV_AUTH_USER_ID`. No cookie, no secret.

**Clerk:** `__session` cookie or `Authorization: Bearer`; `verifyToken`; Clerk user must have a real email. Users upserted on `authSubject`.

**Production gate:** `APP_ENV=production` refuses `AUTH_PROVIDER=dev` (`packages/platform/src/config.ts`). `NODE_ENV=production` alone is **not** treated as production.

**Coverage:** No Next.js middleware. Business APIs surveyed call `requireUser` except health, Inngest, Clerk webhook (Svix HMAC + skew + `timingSafeEqual`). No server actions. No websockets found.

**Background jobs:** Event payloads carry ids; handlers must re-check auth. `domainHandlers` currently little beyond ping; still a trust boundary once wired.

---

## 4. Authorization / RBAC

Capabilities live on org roles (`packages/database/src/system-roles.ts`): owner, lawyer, staff, `client_guest`.

`requireMatterAccess` (`packages/permissions/src/index.ts`): load matter by **id only** → org membership + capability → `matter_members` unless `organization.manage`.

**Enforcement layers:** route → permission helper → often domain query with org+matter. Domain functions are **not** an authz layer by design (`docs/SECURITY.md`). A missed route check is a leak.

There is **no** `canReview` capability. Review uses `minAccess: "edit"` plus `timeline.manage` / `matters.edit` / `documents.edit`.

---

## 5. Multi-Tenant Isolation

**Good:** list matters via `listAuthorizedMatterIds`; most matter-child routes use `requireMatterAccess` then `matter.organizationId`; hybrid retrieval requires org+matter; `getResearchSession` / `getAgentRun` / `getApproval` filter id **and** organizationId; storage keys prefixed `org/{id}/`.

**No Postgres RLS.** Isolation is application-only.

**Breaks:**

- Shared `legal_authorities` has no `organizationId` (intentional for public corpus) **but is writable** from the professional API (SEC-C1).
- Org research sessions do not re-check matter membership (SEC-C2).
- `loadResearchMatterContext` scopes intelligence by `organizationId` **and** `matterId`, so a cross-org `matterId` on an Org A session should return empty context. **Intra-org** unaffiliated `matterId` is the real leak.

---

## 6. Matter Membership

| Action | Typical gate |
|--------|----------------|
| Create matter | `matters.create` |
| Invite to org | `members.invite` (owner only today) + free-string `roleKey` |
| Read matter | membership `read` + `matters.view`, or owner |
| Upload | `edit` + `documents.upload` |
| AI ask / extract | matter access + relevant cap; ask is rate-limited |
| Approve memory/timeline | `edit` + `timeline.manage` |
| Agents | `edit` + `matters.edit`; tools re-check live membership |

**Gap:** org research POST only needs `research.run` **or** `matters.view`. Guests have `matters.view`.

**Gap:** matter member POST can grant `manage` to a `client_guest` (no cap by assignee role). Guest still lacks write capabilities unless also given those caps; they still get the full read surface of `manage`/`edit` where the capability is only `matters.view`.

---

## 7. MinIO / Object Storage

- Default bucket `nyayagrid-documents`, private (no public policy in `docker-compose.yml`).
- Professional keys: `org/{organizationId}/documents/{documentId}/versions/{versionId}/{sanitizedFilename}`.
- GET presign only; default 300s, max 3600s (`packages/documents/src/storage.ts`, `download.ts`).
- SSE-S3 only when `STORAGE_PROVIDER=s3` **and** `APP_ENV=production`. MinIO path has no app-level SSE.
- **No `DeleteObject` in `StorageProvider`.**
- Anyone with a live signed URL can download without Clerk until expiry (standard S3 pattern).
- HTML/SVG/XML forced to `attachment`.
- `assertStorageKeyBelongsToOrganization` is unused outside tests; download trusts DB `storageKey`.
- Compose publishes MinIO `9000`/`9001` with `nyayagrid` / `nyayagridsecret`.

---

## 8. Upload Security

**Professional** (`documents/route.ts`): matter `edit` + `documents.upload`; 15 MiB; MIME **or** extension allowlist; 120/hour/org; ClamAV or development scanner; production forbids development-clean.

**Archive helper** supports zip magic via `buffer`, but `processDocumentPipeline` calls `rejectZipBombsOrArchives` **without** `buffer` (`pipeline.ts`). A ZIP named `x.pdf` with `Content-Type: application/pdf` is not caught by magic. Audit unit test documents this call shape.

**Professor:** `requireUser` only; **no** size/MIME/archive/malware in the route; bytes still go to MinIO.

**Guide:** JSON/text ingest; no MinIO originals.

PDF extraction is text-layer (`pdf-parse`); embedded files are not stripped. Originals remain downloadable.

---

## 9. Retrieval / Vector Isolation

`PostgresHybridRetriever` (`packages/search/src/hybrid.ts`):

- Requires `organizationId` and `matterId`.
- SQL `WHERE organization_id = $org AND matter_id = $matter`.
- `assertHitsWithinScope` after merge.
- Parameterized `sql` template (not string-concatenated user SQL).
- `allowedDocumentIds` is on `RetrievalScope` but **not** in SQL. Agent `retrieveMatterChunks` post-filters; `searchMatterDocuments` does not.
- No current-version filter (uploads today always create version 1).

Memory ranking filters org+matter in SQL first.

**Deleted chunks:** FK cascade from `documents` / versions. There is **no** document DELETE API; archive matter does not delete chunks. Test G verifies cascade **if** the row is hard-deleted.

---

## 10. Prompt-Injection Exposure

Untrusted document text is inserted into **user** messages as `Sources:` / `quote=|...|` for professional Nyaya QA and analysis (`packages/ai/src/index.ts`, `professional.ts`). System prompt says use only Sources. **No** `<untrusted_content>` wrapper on that path.

Agents wrap retrieved text (`packages/agents/src/prompt-injection.ts`), scan instruction-like patterns, and freeze tool allow-lists before reading content. Professor wraps; Guide states untrusted in system rules but does not delimiter-wrap chunks.

**Impact:** integrity of answers/drafts **inside** the same matter, not SQL cross-matter retrieval. Do not treat as a substitute for SEC-C1/C2.

---

## 11. AI Provider Data Flow

Repo adapters: **OpenAI** and **mock** only (`packages/ai/src/index.ts`). Chat completions include full messages (system + retrieved quotes + matter context). `store: false` is set on chat bodies. Embeddings POST raw chunk/memory strings (no `store` analogue on that API in-repo).

Training-consent UI/table exists; product copy should not be confused with OpenAI account retention, which is **not** verified here beyond `store: false`.

---

## 12. Logs / Telemetry

`packages/observability`: redacts keys matching password/secret/token/authorization/api_key/cookie/prompt/document_text/matter_text/content/body.

Usage events drop prompt/chunk/quote-like metadata (`packages/platform/src/usage.ts`).

Matter-scoped DB still stores questions, answers, and citation quotes (product requirement).

`EMAIL_PROVIDER=console` logs invite **tokens** (production blocker in config). Health endpoints expose provider names and config problems, not secret values.

500 handler returns `error.message` (`apps/web/src/lib/http.ts`).

---

## 13. Secrets

- `.env` gitignored; `.env.example` uses local placeholders (`nyayagrid` / `nyayagridsecret`, `INNGEST_*_KEY=local`).
- No committed production API keys found in this audit pass.
- Docker Compose Postgres/MinIO defaults are well-known. Unsafe if those ports are on a public interface.
- Production boot requires Clerk keys when `AUTH_PROVIDER=clerk`; does **not** require Inngest signing keys.

**Do not rotate in this phase.** Rotate Compose defaults before any internet-facing deploy.

---

## 14. Database

`createDb` uses `postgres(connectionString, { max: 10 })` with **no** explicit `ssl` option. TLS depends entirely on `DATABASE_URL` / provider. No in-repo enforcement of `sslmode=require`.

Migrations: Drizzle; app uses a single role. Privilege minimization not evident.

Hybrid/search `sql` templates bind org/matter and user text as parameters. `sql.raw` appears in Professor search for **fixed** column/FROM allowlists, not user identifiers.

Admin/debug: unauthenticated health/ready (config inventory). No SQL admin UI found.

---

## 15. API Validation / Mass Assignment

Zod on most bodies. Actor ids come from `requireUser`, not JSON.

**Client-controlled:** `organizationId` on list/create (gated by capability); matter `status` on create/update; invite `roleKey` any string; research `matterId` without membership; task `assignedToUserId` any UUID.

Intelligence `status=approved` is not generally client-set on create; review endpoints require edit + capability. Agent proposals always insert `pending`.

---

## 16. Human Review Authorization

| Review | Gate |
|--------|------|
| Memory / timeline / graph / facts | `edit` + `timeline.manage` |
| Analysis findings / deposition | `edit` + `documents.edit` |
| Agent approvals | `edit` + `matters.edit`; `reviewApproval` re-checks; org-scoped get; reject does not execute |
| Invoice issue/void | `organization.manage` |

`client_guest` lacks `timeline.manage` / `matters.edit`. A read-only guest **cannot** approve Memory/Timeline via those routes (audit test E). A lawyer with matter `edit` **can**. There is no supervising-lawyer-only reviewer role.

---

## 17. Agent Permission Model

**Invariant AGENT PERMISSIONS ≤ USER PERMISSIONS:** tools declare `capability` + `minAccess`; `ToolRegistry.invoke` calls `requireMatterAccess` / `requireCapability` on **live** `ctx.userId` every call (`packages/agents/src/tools/registry.ts`). Matter tools use `ctx.matterId`, not a client-supplied matter id in the search payload.

Prohibited tools (`sendEmail`, `fileCourt`, `makePayment`, `deleteEvidence`, `approvePrivilege`, `contactExternal`) cannot register/invoke.

Plan `requiredTools` ∩ agent `allowedTools`. High-risk writes go through `createActionProposal` (`status: pending`) and human `reviewApproval`. Reject path does not insert tasks. Stale: already-reviewed approvals throw `Approval already {status}`. Cross-org approval lookup returns null.

**No agent privilege-escalation path found** for unauthorized matters, given `ctx` is the human caller. Do not modify agents in this phase.

Rate limits: `agent_run` preset exists (20/hour/org) but **agent HTTP routes do not call `enforceRateLimit`** (only ask/upload/guide/professor ask were found).

---

## 18. Workspace Isolation

Professor/Guide tables are user-scoped with no `organizationId`. Isolation asserts forbid professional table names in those SQL templates. Phase 8 integration tests cover ask-path non-leakage.

A professional user can still call Professor/Guide APIs (same Clerk user); data stays in those tables. Public Guide cannot query `document_chunks`. The shared authority corpus **can** be read from research/Professor/Guide — that is why SEC-C1 is cross-workspace as well as cross-tenant.

---

## 19. Research Corpus Isolation

**Read path:** `AuthorityHybridRetriever` queries `legal_authority_chunks` only, with asserts that hits are not matter-scoped.

**Write path:** `POST /api/v1/research/import` — authenticated + `documents.upload` **or** `organization.manage`. Inserts into the global corpus. Actor org is audit metadata (`import/route.ts`).

This contradicts the threat model for confidential beta: “public corpus” must not be a dump of client contracts.

---

## 20. Benchmark / GT Isolation

`benchmarks/nyaya-bench/runner/isolate.ts` allowlists `scenarios/<id>/documents/*` and refuses `hidden_ground_truth`, `review_packets`, etc. Tests exist (`isolate.test.ts`). Web app does not depend on `nyaya-bench`. Runtime Docker image is standalone Next — GT should not ship in the runner.

Gaps: repo `COPY . .` / `.dockerignore` may still put benchmarks in **build** context; seed/bench CLIs have no `APP_ENV=production` refuse. Hidden GT is not the ingest path for live app retrieval unless an operator runs those CLIs against prod.

---

## 21. Web Security

`apps/web/next.config.ts`: CSP `default-src 'self'`; `script-src` `'unsafe-inline'` (and `'unsafe-eval'` off production); `frame-ancestors 'none'`; `X-Frame-Options: DENY`; nosniff; HSTS in `NODE_ENV=production` only; `connect-src 'self'`.

No `dangerouslySetInnerHTML` / react-markdown found in this pass. AI answers appear as text in React, not HTML. Filename `Content-Disposition` is sanitized.

CSRF: cookie Clerk session + `Authorization` Bearer. Same-site cookies matter; APIs are JSON. No custom CSRF token. `connect-src 'self'` reduces some XSS data-exfil.

Redirects are static `/app/matters` → `/app/cases` (no open redirect).

---

## 22. SSRF

No user-controlled URL fetch found for import/crawl.

`HttpOcrProvider` POSTs to **operator** `OCR_ENDPOINT`. Misconfigured internal URL is operator SSRF, not tenant SSRF. OpenAI `baseUrl` is config. Default OCR is `none`.

---

## 23. Rate Limits / Abuse

Presets (`packages/platform/src/rate-limit.ts`): auth 10/5min/IP; upload 120/hour/org; ask 60/hour/user; research 40/hour/org; agent 20/hour/org; professor 60; guide 30; expensive_ai 10/hour/org.

Production refuses `RATE_LIMIT_PROVIDER=memory`. Redis implementation exists.

**Wired on:** professional ask, document upload, Guide ask, Professor ask.

**Not wired on:** research query/import, agent runs, analysis/extract, Professor file upload. A member can still generate large model bills and ingestion load on those routes.

Auth limiter trusts `x-forwarded-for` first hop (`apps/web/src/lib/rate-limit.ts`) — spoofable if the app is not behind a trusted proxy that overwrites the header.

---

## 24. Delete / Retention

No matter hard-delete API. `archiveMatter` sets status only. `requestDataDeletion` records intent; **no executor** (`docs/RETENTION_AND_LEGAL_HOLD.md`). Legal holds block requests.

If rows are hard-deleted, Postgres FKs cascade chunks/embeddings/children. **MinIO objects remain.** Account/org wipe not implemented. Clerk `user.deleted` audits only.

For legal beta: say clearly that **erasure is not implemented**; archive ≠ delete.

---

## 25. Backup / Recovery

Local rehearsal script exists (`docs/BACKUP_RESTORE.md`). **Not evident:** scheduled production Postgres+object backup, PITR, or matched restore on the target cloud. Treat as **absent for managed production**.

---

## 26. Errors

`handleRouteError`: 401/403/404 mapped; Zod flatten; generic `Error` → **500 with `error.message`**. Dev vs prod is not split. Can leak SQL/storage internals if thrown as `Error`. Authorization messages differ for missing vs other-tenant matter (oracle).

Health ready may attach a sanitized DB error via `publicDatabaseError`.

---

## 27. Dependency Security

Prior in-repo review (`docs/PRODUCTION_SECURITY_REVIEW.md`, 2026-08-11) reported high issues in drizzle-orm identifier escaping, Next-bundled postcss, and sharp/libvips, with a drizzle bump attempted and partially reverted due to breakage.

This audit **did not mass-upgrade** lockfiles. Re-run `npm audit --omit=dev` at remediation time. Do not treat historical GHSA rows as confirmed current without a fresh audit. Reachability: drizzle is on the query path; postcss/sharp are build/image pipeline more than tenant-data IDOR.

---

## 28. Security Tests Added

| ID | Test | Location |
|----|------|----------|
| A | Cross-org matter read denied | `packages/permissions/src/beta-security-audit.integration.test.ts` (`RUN_DB_TESTS=1`) |
| C | Matter B query cannot return Matter A secret phrase | `packages/search/src/hybrid.test.ts` (in-memory retriever + SQL filters remain in hybrid.ts) |
| D | Same-org non-member denied | beta-security-audit integration |
| E | Guest cannot satisfy Memory/Timeline review gate | beta-security-audit integration |
| F | Agent `searchMatterDocuments` denied for outsider | beta-security-audit integration |
| G | Hard-delete document cascades chunks | beta-security-audit integration |
| H | Hidden GT / review packets refused | existing `benchmarks/nyaya-bench/tests/isolate.test.ts` |
| — | Zip magic not applied without `buffer` | `packages/documents/src/index.test.ts` |
| — | Existence oracle documented | beta-security-audit (SEC-H4 messages) |

**Already present (not duplicated):** `e2e/security.spec.ts` unauthenticated 401; phase 4–8 integration isolation; agent approval reject; Professor/Guide SQL isolation.

**Not added as failing production tests:** SEC-C1/C2 (would require production changes). **J** presigned URLs: sign-after-auth is covered by download helpers + e2e auth; full MinIO GET-without-session is by design (document, don’t “fail”).

---

## 29. Finding Table

### SEC-C1 — Shared authority corpus writable by ordinary upload capability

- **Severity:** CRITICAL  
- **Subsystem:** Research import  
- **File/function:** `apps/web/src/app/api/v1/research/import/route.ts` `POST`; `legal_authorities` schema (`packages/database/src/schema/phase6.ts`)  
- **Description:** Import requires `documents.upload` or `organization.manage`, then writes **global** authority rows/chunks.  
- **Exploit:** Firm A (or staff with upload) imports a confidential contract labeled as a statute. Firm B / Professor / Guide retrieve it via authority search.  
- **Impact:** Cross-tenant and cross-workspace confidential disclosure into AI context.  
- **Evidence:** import route capabilities; corpus has no `organizationId`; `AuthorityHybridRetriever` reads that corpus.  
- **Recommended fix:** Disable HTTP import in production; restrict to a break-glass admin; or tenant-private corpus. Never allow matter document bytes into the shared store.  
- **Beta blocker:** yes

### SEC-C2 — Org research sessions bypass matter membership

- **Severity:** CRITICAL  
- **Subsystem:** Research  
- **File/function:** `apps/web/src/app/api/v1/research/sessions/route.ts`; `sessions/[sessionId]/query/route.ts`; `createResearchSession`; `loadResearchMatterContext`  
- **Description:** Session create/list/query authorized with `research.run` **or** `matters.view`. `matterId` is stored without `requireMatterAccess`. Query loads verified matter intelligence when `includeMatterContext` is not false.  
- **Exploit:** `client_guest` or unassigned staff POSTs a session with another matter’s UUID, then runs a query.  
- **Impact:** Intra-org confidential intelligence in model context and session lists (titles/matterIds org-wide). Cross-org attach is limited by intelligence queries requiring matching `organizationId`.  
- **Evidence:** `RESEARCH_CAPABILITIES`; `createResearchSession` insert; synthesize.ts `includeMatterContext !== false`.  
- **Recommended fix:** Require `research.run` + if `matterId` set, `requireMatterAccess(..., capability: "research.run")` and `matter.organizationId === organizationId`. Filter session list like calendar.  
- **Beta blocker:** yes

### SEC-C3 — Dev auth on non-production-like APP_ENV

- **Severity:** CRITICAL (operational; code is explicit)  
- **Subsystem:** Auth  
- **File/function:** `DevAuthProvider.getIdentity` `packages/auth/src/index.ts`  
- **Description:** Header spoof or default `DEV_AUTH_USER_ID` whenever `APP_ENV` is not `production`/`staging`.  
- **Exploit:** Public host with `APP_ENV=development` and a real database.  
- **Impact:** Full account impersonation / default owner.  
- **Evidence:** `isProductionLike()` gate; production boot only when `APP_ENV=production`.  
- **Recommended fix:** Refuse to bind `0.0.0.0` with DevAuth; treat any non-loopback + DevAuth as fatal; never deploy that combo.  
- **Beta blocker:** yes (until Clerk + `APP_ENV=production` is the only internet path)

### SEC-H1 — Invite `roleKey` is an unconstrained string (including `owner`)

- **Severity:** HIGH  
- **Subsystem:** Invites  
- **File/function:** `inviteMembershipSchema`; `inviteMemberByRoleKey`  
- **Description:** Any existing role key in the org can be invited. Invite accept does not bind invite email to the authenticated user’s email.  
- **Exploit:** Token leak + attacker account; or owner mints peer owners without extra step; future `members.invite` on non-owners becomes org takeover.  
- **Impact:** Privilege escalation / org join.  
- **Evidence:** `z.string().min(1)`; `acceptOrganizationInvite` never compares emails.  
- **Recommended fix:** Allowlist inviteable roles; bind email; hash tokens remain.  
- **Beta blocker:** yes (email bind + owner invite policy)

### SEC-H2 — Archive magic bytes not passed in live pipeline

- **Severity:** HIGH  
- **Subsystem:** Uploads  
- **File/function:** `packages/documents/src/pipeline.ts` vs `rejectZipBombsOrArchives`  
- **Description:** Magic-byte ZIP detection exists but pipeline omits `buffer`. MIME **or** extension on the route.  
- **Exploit:** `malware.pdf` + `application/pdf` that is a ZIP. Stored in MinIO; extract may fail; still occupies storage / download path depending on scan state.  
- **Recommended fix:** Pass buffer; special-case OOXML `.docx`.  
- **Beta blocker:** no if ClamAV is on and download of failed scans is blocked; yes if beta uses development scanner

### SEC-H3 — Professor uploads lack professional upload controls

- **Severity:** HIGH  
- **Subsystem:** Nyaya Professor  
- **File/function:** `apps/web/src/app/api/v1/professor/cases/route.ts`  
- **Description:** No MAX size / MIME / archive / malware in the multipart path; objects still stored.  
- **Exploit:** Huge/malicious files in the shared bucket.  
- **Recommended fix:** Reuse professional validators or disable binary store.  
- **Beta blocker:** yes if `FEATURE_PROFESSOR=1` in the same deployment as client files; else P1

### SEC-H4 — Cross-tenant existence oracle

- **Severity:** HIGH  
- **Subsystem:** AuthZ  
- **File/function:** `requireMatterAccess`; id-first client/invoice/time-entry/inbox routes  
- **Description:** Missing UUID → “Matter not found”; other tenant → “Not a member of organization”.  
- **Exploit:** Probe UUIDs. Does not return the other tenant’s payload.  
- **Recommended fix:** Uniform 404.  
- **Beta blocker:** no

### SEC-H5 — Incomplete deletion / no object purge

- **Severity:** HIGH  
- **Subsystem:** Retention / storage  
- **File/function:** `StorageProvider` (`storage.ts`); `requestDataDeletion`  
- **Description:** No DeleteObject; deletion requests do not execute; archive is status-only.  
- **Impact:** Confidential originals remain; “delete” UX would be false.  
- **Recommended fix:** Honest product copy for beta; later transactional purge + hold checks.  
- **Beta blocker:** no for “archive-only beta” if disclosed; yes if erasure is promised

### SEC-H6 — Inngest endpoint not production-gated

- **Severity:** HIGH  
- **Subsystem:** Jobs  
- **File/function:** `apps/web/src/app/api/inngest/route.ts`; `collectProductionConfigProblems`  
- **Description:** Unauthenticated at app layer; signing key can be `local`.  
- **Exploit:** Weak signing drives job functions once handlers do real work.  
- **Recommended fix:** Require strong `INNGEST_SIGNING_KEY` in production config.  
- **Beta blocker:** yes once jobs mutate matters; today handlers are thin but the door is open

### SEC-H7 — 500 responses include `Error.message`

- **Severity:** HIGH  
- **Subsystem:** HTTP  
- **File/function:** `apps/web/src/lib/http.ts` `handleRouteError`  
- **Description:** Internal errors returned to the client.  
- **Exploit:** Trigger failures to read paths/SQL.  
- **Recommended fix:** Generic 500 in production; log server-side.  
- **Beta blocker:** no

### SEC-H8 — Research/agent/analysis routes missing `enforceRateLimit`

- **Severity:** HIGH (cost/abuse)  
- **Subsystem:** Rate limit  
- **File/function:** presets in `rate-limit.ts`; grep of `enforceRateLimit` under `api/v1`  
- **Description:** Expensive AI paths unlimited except ask/upload/guide/professor-ask.  
- **Exploit:** Loop research/import/agents → bill shock / worker exhaustion.  
- **Recommended fix:** Wire existing presets.  
- **Beta blocker:** no for a tiny closed beta with trusted users; P0 if public sign-up

### SEC-M1 — No edge middleware

- **Severity:** MEDIUM  
- **File:** no `middleware.ts`  
- **Description:** New API route without `requireUser` is immediately live. HTML shells unauthenticated.  
- **Beta blocker:** no

### SEC-M2 — Health/config disclosure

- **Severity:** MEDIUM  
- **File:** `api/health/ready`, `api/v1/health`  
- **Description:** `appEnv`, provider names, config problems (e.g. still `dev`).  
- **Beta blocker:** no

### SEC-M3 — Org-wide time entries / invoices without matter membership

- **Severity:** MEDIUM  
- **File:** `time-entries/route.ts`, `invoices/route.ts`  
- **Description:** `matters.edit` lists all org rows.  
- **Beta blocker:** no

### SEC-M4 — `allowedDocumentIds` unused in hybrid SQL

- **Severity:** MEDIUM  
- **File:** `packages/search/src/hybrid.ts`  
- **Description:** Document-scoped retrieval still searches the whole matter.  
- **Beta blocker:** no

### SEC-M5 — Professional prompts lack untrusted delimiters

- **Severity:** MEDIUM  
- **File:** `packages/ai/src/index.ts`, `professional.ts`  
- **Description:** Prompt injection inside a matter.  
- **Beta blocker:** no (do not redesign prompts in this phase)

### SEC-M6 — MIME/extension OR on professional upload

- **Severity:** MEDIUM  
- **File:** `documents/route.ts`  
- **Beta blocker:** no

### SEC-M7 — Org export includes `storageKey`

- **Severity:** MEDIUM  
- **File:** lifecycle export; `compliance.manage`  
- **Beta blocker:** no

### SEC-M8 — DATABASE_URL SSL not enforced in code

- **Severity:** MEDIUM  
- **File:** `packages/database/src/index.ts`  
- **Beta blocker:** no if the managed DB URL already requires TLS

### SEC-M9 — CSP `'unsafe-inline'`

- **Severity:** MEDIUM  
- **File:** `next.config.ts`  
- **Beta blocker:** no

### SEC-M10 — Invite tokens in console email provider

- **Severity:** MEDIUM  
- **File:** `.env.example` `EMAIL_PROVIDER=console`; production config rejects console  
- **Beta blocker:** no if production SMTP is required (already gated)

### SEC-M11 — Seed/bench CLIs can target production `DATABASE_URL`

- **Severity:** MEDIUM  
- **File:** `seed-golden-matter`, nyaya-bench ingest  
- **Beta blocker:** no (operational)

### SEC-M12 — `x-forwarded-for` trusted for auth rate limit

- **Severity:** MEDIUM  
- **File:** `apps/web/src/lib/rate-limit.ts`  
- **Beta blocker:** no

### SEC-L1 — No Postgres RLS

- **Severity:** LOW (defense in depth)  
- **Beta blocker:** no

### SEC-L2 — No latest-version filter on hybrid search

- **Severity:** LOW (latent)  
- **Beta blocker:** no

### SEC-L3 — Unused `workspace_type`

- **Severity:** LOW  
- **Beta blocker:** no

### SEC-L4 — Citation document title lookup by document id only

- **Severity:** LOW  
- **File:** `citations/[chunkId]/route.ts`  
- **Beta blocker:** no

### SEC-L5 — MinIO without SSE; default compose credentials

- **Severity:** LOW–MEDIUM depending on network exposure  
- **Beta blocker:** no if localhost-only

### SEC-L6 — Benchmarks in Docker build context

- **Severity:** LOW  
- **Beta blocker:** no

### SEC-L7 — Task `assignedToUserId` not membership-checked

- **Severity:** LOW  
- **Beta blocker:** no

### SEC-L8 — Embeddings sent in full to OpenAI

- **Severity:** LOW (subprocessor; expected for the product)  
- **Beta blocker:** no — disclose in privacy notice

**Positive controls (not findings):** matter hybrid org+matter + assert; agent tool re-auth and prohibited tools; approval pending-only; OpenAI `store: false`; log redaction; production config gate; Guide/Professor table isolation; GT ingest allowlist; private bucket default; download quarantine for malware states; webhook signature verify.

---

## 30. Prioritized Fix Order

### P0 — before any multi-tenant legal beta

1. Disable or admin-gate `POST /api/v1/research/import`; never put client document text in `legal_authorities`.  
2. Require matter membership + `research.run` on org research session create/query/list when `matterId` is present; validate org match.  
3. Internet-facing deploy: `APP_ENV=production`, `AUTH_PROVIDER=clerk`, no DevAuth, strong Clerk webhook secret.  
4. Bind invite accept to invite email; restrict inviteable `roleKey` (no casual extra `owner`).  
5. Require real `INNGEST_SIGNING_KEY` in production config.  
6. If Professor is on the same cluster as client files: apply upload/malware limits or keep `FEATURE_PROFESSOR=0`.  
7. Professional uploads: pass file buffer into archive rejection (docx exception).  
8. Wire rate limits on research, import, agents, extract/analysis.

### P1 — before wider beta

1. Uniform 404 for cross-tenant ids.  
2. Production 500 without raw `error.message`.  
3. Cap matter `access` by assignee role.  
4. Filter org time-entry/invoice lists by authorized matters (or owner-only).  
5. Apply `allowedDocumentIds` in hybrid SQL.  
6. Deletion executor + `deleteObject` **or** explicit “no erasure yet” legal copy.  
7. Matched Postgres+S3 backup rehearsal on the real provider.  
8. DATABASE SSL required in production config.  
9. Hide or auth-protect detailed health/config.  
10. Seed/bench CLI refuse `APP_ENV=production`.

### P2 — after beta acceptable

1. Next.js middleware for `/app` and `/api/v1`.  
2. Postgres RLS.  
3. Untrusted delimiters on professional QA (when reliability track allows).  
4. CSP nonce (drop `'unsafe-inline'`).  
5. Auth-proxied downloads for highest-sensitivity files.  
6. Dedicated review capability.  
7. Fresh dependency audit + careful upgrades.  
8. `workspace_type` enforcement if product requires it.

---

## 31. Beta Security Decision

**READY AFTER P0 FIXES**

**Why not NOT READY:** Core matter APIs, hybrid retrieval, agent tools, and guest review gates are real and tested. This is not “no auth.” A closed dogfood with one org, Clerk, and import disabled is close.

**Why not READY FOR CONTROLLED BETA as of this commit:** SEC-C1 and SEC-C2 are live confidentiality bugs against the beta threat model (other firms, client guests, shared corpus). SEC-C3 is an instant bypass if env is wrong. Those are the user’s stated blocker class: cross-tenant (or equivalent) confidential exposure and broken matter membership.

**Controlled beta definition used here:** a small number of professional organizations, real confidential documents, **no** premium legal databases, humans in the loop. It does **not** require SOC 2. It **does** require that a guest or another firm cannot pull a client’s matter into AI context.

After P0, re-audit those three paths only, then reconsider **READY FOR CONTROLLED BETA**.
