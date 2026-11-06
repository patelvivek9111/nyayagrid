# WP-06 — Staging Clerk E2E identity setup

**Classification:** `NYAYAGRID_WP06_STAGING_RELEASE_READINESS`  
**Status:** `DEFERRED_OPERATOR_ACTION` until Clerk Dashboard work is done.  
**Rule:** Do **not** bypass MFA. Do **not** commit secrets or storageState. Do **not** point fixtures at production.

## Required staging-only identities

| Account            | Purpose                   | Org                 | Role                |
| ------------------ | ------------------------- | ------------------- | ------------------- |
| `e2e-professional` | Professional workflow E2E | Staging Firm A      | Lawyer (or Partner) |
| `e2e-prosecution`  | Prosecution workflow E2E  | Staging DA Office A | Prosecutor          |
| `e2e-unauthorized` | Negative auth / RBAC      | none or revoked     | none                |
| `e2e-cross-org-b`  | Cross-tenant denial       | Staging Firm B      | Lawyer              |

Create users in the **staging** Clerk application only (`CLERK_*` for staging). Enable MFA policies already enforced by server config.

## Repository wiring (already in tree)

- Setup: `e2e/staging/auth.setup.ts` — requires `provider === "clerk"`; refuses silent DevAuth.
- Config: `playwright.staging.config.ts` + `npm run staging:auth:setup`
- Auth artifacts: `playwright/.auth/` and `e2e/staging/.auth/` are gitignored.

## Operator steps

1. Confirm staging env: `AUTH_PROVIDER=clerk`, staging Clerk publishable/secret keys, MFA required for these users.
2. Create the four users above; map org memberships/roles in product DB (or invite flow).
3. Store credentials in an approved secret manager — **never** in `.env` committed to git.
4. Optional automation: set `E2E_CLERK_USER_EMAIL` + staging `CLERK_SECRET_KEY` with `@clerk/testing` locally.
5. Otherwise: headed `npm run staging:auth:setup` once; complete MFA interactively; storageState stays local.
6. Run staging Playwright project against `https://staging.nyayagrid.com` only.
7. Confirm failures surface as auth/session errors — suite must not fall back to DevAuth.

## Pass criteria

- Session JSON `provider: "clerk"`
- Cross-org B cannot read Firm A matters/cases
- Unauthorized cannot reach `/app`
- MFA challenge observed at least once in setup evidence (screenshot in private ops store, not git)
