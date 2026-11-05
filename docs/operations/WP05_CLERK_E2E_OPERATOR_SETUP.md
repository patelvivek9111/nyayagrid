# WP-05 — Clerk authenticated E2E operator setup

Staging target: `https://staging.nyayagrid.com`  
Harness: `playwright.staging.config.ts`  
Branch intent: `wp05/clerk-e2e-auth` (not the continuous-monitor PR)

## Non-negotiables

- Do **not** disable MFA on the Clerk instance or set `REQUIRE_CLERK_MFA=0` to make tests pass.
- Do **not** replace real Clerk with DevAuth mocks and claim authenticated PASS.
- Do **not** create real customer matters, confidential evidence, or production users.
- Do **not** print `CLERK_SECRET_KEY`, cookies, OTPs, or storageState contents.
- Do **not** point this harness at production (`nyayagrid.com` without `staging`).

## Dependency (engineering — done on this branch)

| Package | Version | Notes |
| --- | --- | --- |
| `@clerk/backend` (app) | `^2.29` → lock `2.33.x` | Production session verification |
| `@clerk/testing` (dev) | **`1.14.9`** | Matches backend v2; do **not** install `@clerk/testing@2.x` (pulls `@clerk/backend@3`) |
| `@playwright/test` | `^1.62.1` | Staging + local E2E |

Prior `ECONNRESET` during install: retry with `--fetch-retries=5` and prefer installing into an existing `node_modules` tree (avoid empty-worktree full reify on flaky networks). Pin `1.14.9` in root `devDependencies`.

## Synthetic staging identities (create in Clerk Dashboard — staging instance)

Create **least-privilege** users labeled clearly as E2E (private metadata `e2eTestUser: true` recommended):

| Alias | Purpose | Org membership |
| --- | --- | --- |
| `e2e-professional@…` | Professional attorney/staff smoke | Synthetic Professional org only |
| `e2e-prosecution@…` | Prosecution smoke | Synthetic Prosecution org only |
| `e2e-unauthorized@…` | Authz negative (no org / no membership) | None |
| `e2e-cross-org-b@…` | Tenant isolation second identity | Different org than professional |

Optional emails via env (never commit values):

- `E2E_CLERK_USER_EMAIL` — primary storageState (`staging-user.json`)
- `E2E_CLERK_USER_EMAIL_B` — document only; second file via interactive login below

## Auth modes

### A) Interactive (recommended when MFA is required)

Preserves MFA. Human completes sign-in + MFA once; artifact reused until expiry.

```bash
# From repo root (this worktree)
npx playwright install chromium
$env:STAGING_E2E_BASE_URL="https://staging.nyayagrid.com"
$env:STAGING_AUTH_INTERACTIVE="1"
# headed by default unless STAGING_AUTH_HEADLESS=1
npm run staging:auth:setup
```

Acceptance: `playwright/.auth/staging-user.json` exists (gitignored) and  
`GET /api/v1/session` with that state returns `{ ok: true, provider: "clerk" }`.

Second identity (tenant isolation optional test):

```bash
# After primary auth file exists, copy pattern: headed login saving staging-user-b.json
# Manual: run a one-off headed Playwright script or re-run setup after moving AUTH path.
# Operator: sign in as e2e-cross-org-b, save storageState to playwright/.auth/staging-user-b.json
```

### B) `@clerk/testing` emailAddress helper (automation)

Requires local env (staging Clerk keys only):

- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY` or `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `E2E_CLERK_USER_EMAIL`

```bash
$env:STAGING_E2E_BASE_URL="https://staging.nyayagrid.com"
$env:CLERK_SECRET_KEY="<staging secret — not printed>"
$env:CLERK_PUBLISHABLE_KEY="<staging publishable>"
$env:E2E_CLERK_USER_EMAIL="e2e-professional@…"
$env:STAGING_AUTH_HEADLESS="1"
npm run staging:auth:setup
```

**MFA caveat:** Clerk’s `clerk.signIn({ emailAddress })` creates a server-side sign-in token and **does not satisfy MFA**. If the user has MFA enrolled, or NyayaGrid `REQUIRE_CLERK_MFA=1` rejects non-MFA sessions, this path fails — use **interactive mode (A)** instead. Do not disable MFA to unblock automation.

## Run suites

```bash
# Auth negatives only (no credentials required) — expect 4 passed (security project)
npx playwright test -c playwright.staging.config.ts --project=security-negatives

# Audit export negatives + authenticated probe — expect 1 passed, 1 skipped without storageState
npx playwright test -c playwright.staging.config.ts --project=audit-clerk

# Full staging suite (setup + authenticated projects)
npx playwright test -c playwright.staging.config.ts

# Convenience
npm run staging:e2e:security
npm run staging:e2e:clerk
```

Authenticated Professional / Prosecution / tenant-isolation / q9 projects **skip** cleanly when `staging-user.json` is absent (setup skipped non-interactively). That is **BLOCKED**, not PASS.

## MFA certification note

Successful automated or interactive sign-in does **not** by itself certify MFA enforcement.

NyayaGrid currently resolves Clerk identity via verified session cookies (`ClerkAuthProvider`); there is **no** in-repo `REQUIRE_CLERK_MFA` gate or `mfa-acceptance.test.ts` yet. MFA enforcement for WP-05 is therefore:

1. **Clerk Dashboard (staging instance):** require MFA / second factor for synthetic E2E users (or org-wide MFA policy). Do **not** disable MFA to unblock `@clerk/testing`.
2. **Live operator demo (required evidence):** enroll MFA on a synthetic user → attempt access without second factor → confirm Clerk denies → complete MFA → confirm `/api/v1/session` returns `{ ok: true, provider: "clerk" }`.
3. **Interactive E2E path:** `STAGING_AUTH_INTERACTIVE=1` headed login so MFA is completed by a human once; reuse `playwright/.auth/staging-user.json`.

Do not claim automated MFA enforcement PASS from unit tests that do not exist.

## Forbidden claims

| Claim | Allowed? |
| --- | --- |
| Auth negatives 4/4 against staging without cookies | Yes, after run |
| Authenticated Professional/Prosecution PASS without storageState | No |
| MFA disabled for convenience | No |
| Production host E2E | No |
| Real customer data in fixtures | No |
