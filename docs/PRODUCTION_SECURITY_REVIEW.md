# Production Security Review — NyayaGrid (Phase 9)

Scope: application-layer authorization/tenant isolation, dependency vulnerabilities, secrets
handling, and known gaps. This is a self-review by the team that wrote the code, not an
independent third-party penetration test — treat it as a starting point, not a certification.

## Tenant isolation model

NyayaGrid handles legal matters across multiple law firms (organizations), individual students
(Professor workspace), and unauthenticated members of the public (Guide workspace). Cross-tenant
data exposure is the single most severe class of bug this system can have.

### The model: application-layer authorization, not database RLS

**Row-Level Security (RLS) has deliberately NOT been adopted as the tenant-isolation control.**
Instead:

1. Every request resolves an authenticated identity via the configured `AuthProvider`
   (`@nyayagrid/auth`) — either `DevAuthProvider` (trusts an `x-nyayagrid-dev-user` header, dev
   only) or `ClerkAuthProvider` (verifies a real session).
2. Every organization/matter-scoped query is explicitly filtered by `organizationId`/`matterId` in
   application code (`@nyayagrid/database` query builders).
3. Before that query runs, `@nyayagrid/permissions` resolves the caller's membership,
   role-derived capabilities, and (for matters) matter-level access rank
   (`read`/`comment`/`edit`/`manage` — see `packages/permissions/src/index.ts`), and throws
   `AuthorizationError` (mapped to HTTP 403) if the caller lacks the required capability for that
   organization/matter.
4. A forged or nonexistent resource ID is never distinguishable from "exists but you can't see
   it" in the response — both return a rejection (401 unauthenticated / 403 forbidden / 404 for a
   route that leaks no existence information), never partial data. This is exercised by
   `e2e/security.spec.ts`.
5. Every authorization decision writes an audit event (`auditEvents` table) so access can be
   reconstructed after the fact.

### Why not RLS too (defense in depth we chose not to build yet)

Postgres RLS would add a second, independent enforcement layer at the database connection level,
so that even a bug in application-layer filtering could not leak cross-tenant rows. That is a real
security improvement and is listed as **OPTIONAL / future work** in
[Production Readiness](./PRODUCTION_READINESS.md), not because it isn't valuable, but because:

- It requires either per-request Postgres roles/`SET LOCAL` session variables or a connection-pooling
  strategy that supports them, which is a non-trivial infrastructure change to the current
  single-pooled-connection (`postgres.js`) setup in `@nyayagrid/database`.
- It would need its own full test suite (RLS policies are easy to write incorrectly in ways that
  silently pass most tests), which has not been budgeted in Phase 9.
- The current application-layer model already has significant automated coverage: capability
  matrix unit tests, `phase*.integration.test.ts` files in `packages/permissions` exercising
  cross-organization/cross-matter access attempts against a real database, and now
  `e2e/security.spec.ts` exercising it over real HTTP.

**Conclusion: application-layer authorization is the actual, tested, load-bearing control today.
RLS is a recommended future hardening step, not a currently-relied-upon one — do not assume it is
active.**

## Authentication

- Local/dev: `DevAuthProvider` trusts the `x-nyayagrid-dev-user` request header outright. This is
  intentionally insecure and is a hard production blocker enforced by
  `collectProductionConfigProblems()` — the app refuses to boot as `APP_ENV=production` with
  `AUTH_PROVIDER=dev`.
- Production: `ClerkAuthProvider` (`@nyayagrid/auth`) verifies real Clerk sessions. **Its
  production wiring (webhook signature verification, organization membership sync, sign-in/up
  redirect URLs, session cookie domain/CORS) has not been exercised against a live Clerk
  production project** — see [Production Readiness](./PRODUCTION_READINESS.md).

## Prompt-injection / AI safety

`packages/agents/src/prompt-injection.test.ts` and the manual Phase 7 walkthrough in the README
cover: instruction-like text embedded in user input is detected and recorded as a limitation
rather than acted on; agent tool calls are restricted to an authorized, plan-scoped allowlist; no
agent action can send email, accept a settlement, or otherwise bind the user without an explicit
human approval step (`awaiting_approval` → review/approve/reject).

## Rate limiting

`packages/platform/src/rate-limit.ts` defines per-endpoint-class presets (`auth`, `upload`,
`ask_nyaya`, `research`, `agent_run`, `professor`, `guide`, `expensive_ai`), scoped by
IP/user/organization as appropriate, enforced by `InMemoryRateLimiter`. This is correctly
implemented for a **single process** but is **not** a distributed rate limiter — running more than
one web instance means each instance enforces its own independent counters, effectively
multiplying the real limit by the instance count. A shared-store (e.g. Redis) implementation is a
BLOCKER before horizontal scaling (tracked in Production Readiness).

## Malware scanning

Uploaded documents are scanned before being persisted. `DevelopmentMalwareScanner` (the default)
never reports a file clean and must not be used for real uploads. `ClamAvMalwareScanner`
(`packages/documents/src/malware.ts`) implements the real client protocol and includes a
`fixtureMode` (`CLAMAV_FIXTURE=1`) that recognizes the EICAR test string and any storage key
containing `infected`, for tests and local development without a real `clamd`. **No production
ClamAV deployment has been provisioned or load-tested** — BLOCKER.

## Secrets handling

- `.env` is gitignored; `.env.example` documents every variable with no real secret values.
- `validateConfig()`/health endpoints only ever report provider _names_ and _booleans_, never
  values — verified by reading `apps/web/src/app/api/health/ready/route.ts` and
  `packages/platform/src/config.ts`'s `summarizeConfig()`.
- The `Dockerfile` does not embed any secret; all configuration is supplied at container runtime
  via environment variables.
- No secret is logged: `createLogger` (`@nyayagrid/observability`) is only ever passed provider
  names/booleans/error messages in the config bootstrap path reviewed here.

## Dependency audit

Run: `npm audit --omit=dev` (production dependencies only, across the full npm workspace tree),
`npm@10.9.2`, on 2026-08-11.

```
# npm audit report

drizzle-orm  <0.45.2
Severity: high
Drizzle ORM has SQL injection via improperly escaped SQL identifiers
https://github.com/advisories/GHSA-gpj5-g38j-94v9
fix available via `npm audit fix --force`
Will install drizzle-orm@0.45.2, which is a breaking change
node_modules/drizzle-orm

postcss  <=8.5.22
Severity: high
PostCSS has XSS via Unescaped </style> in its CSS Stringify Output (GHSA-qx2v-qp2m-jg93)
PostCSS: Arbitrary file read via attacker-controlled sourceMappingURL (GHSA-6g55-p6wh-862q)
PostCSS: Path Traversal in Previous Source Map Auto-Loading (GHSA-r28c-9q8g-f849)
PostCSS: incomplete fix of GHSA-6g55-p6wh-862q (GHSA-fxqj-rqcc-2cmp)
fix available via `npm audit fix --force`
Will install next@16.3.0, which is a breaking change
node_modules/next/node_modules/postcss
  next  9.3.4-canary.0 - 16.3.0-preview.10
  Depends on vulnerable versions of postcss
  Depends on vulnerable versions of sharp
  node_modules/next

sharp  <0.35.0
Severity: high
sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591
https://github.com/advisories/GHSA-f88m-g3jw-g9cj
fix available via `npm audit fix --force`
Will install next@16.3.0, which is a breaking change
node_modules/sharp

4 high severity vulnerabilities
```

### Remediation attempted and reverted

We attempted to fix the `drizzle-orm` advisory by bumping `drizzle-orm` from `0.40.0` to the
patched `^0.45.2` across every workspace package that declares it
(`packages/{auth,database,permissions,platform,workspaces}` and the root `overrides` entry). This
broke the install: several call sites (`apps/web`'s API routes, `packages/intelligence`) import
`drizzle-orm` as a _transitive/phantom_ dependency (relying on npm's hoisting rather than declaring
it directly), and after the bump `npm install` left `drizzle-orm` un-resolvable for those call
sites (`tsc --noEmit` failed with `Cannot find module 'drizzle-orm'` in 12+ files). Per this
review's instruction to fix only what is safe without breaking the build, **this upgrade was
reverted** back to `drizzle-orm@0.40.0`, and `npm run typecheck` / `npm test` were re-verified
clean afterward.

### Why the other two were not force-upgraded

- **`next` 15.5.23 → 16.3.0** is a semver-major upgrade of the web framework itself. The `postcss`
  and `sharp` advisories are both transitive through `next`'s own bundled dependencies (not
  something this repo can patch independently), and a Next.js major version bump changes the App
  Router / build output contract broadly enough that it needs its own dedicated
  upgrade-and-regression-test pass, not a drive-by dependency fix inside a documentation task.
- All three "high" findings here require code the CVEs describe to actually be reachable by an
  attacker to matter in practice: the PostCSS/sharp findings are about processing
  attacker-supplied CSS/image files with attacker-controlled `sourceMappingURL`/crafted image
  data, which is not a documented input path in this app's build-time or runtime CSS/image
  processing today. This does not mean "ignore it" — it means the risk is lower than "high" implies
  for this specific application, and the correct fix (a coordinated `next` major upgrade) should be
  scheduled as its own tracked piece of work rather than rushed.

### Action items

1. Schedule a dedicated `next@16` upgrade spike (framework migration guide review, full
   regression pass, Playwright E2E rerun) — tracked as a BLOCKER-adjacent follow-up, not required
   before _this_ Phase 9 documentation lands, but required before it can be marked resolved here.
   Once done, `sharp`/`postcss` resolve as a side effect.
   {{Note: 4 high, 0 critical, 0 moderate — every remaining prod finding is one of these two upgrades.}}
2. Fix the phantom `drizzle-orm` dependency: have `apps/web` and `packages/intelligence` declare
   `drizzle-orm` explicitly in their own `package.json` (they currently rely on hoisting), so a
   future version bump doesn't silently break module resolution the way it did in this pass.
3. Re-run `npm audit --omit=dev` after each dependency change and update this document.

## Known gaps summary (do not launch until addressed)

See [Production Readiness](./PRODUCTION_READINESS.md) for the full checklist. The highest-severity
security-relevant gaps from this review specifically are: (1) no production ClamAV deployment, (2)
Clerk production wiring unverified, (3) rate limiting is per-process only, (4) RLS not adopted as a
second layer, (5) the two pending "high" dependency advisories above.
