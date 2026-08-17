# User lifecycle (P7)

NyayaGrid owns **authorization**. Identity providers authenticate. This file is the documented lifecycle procurement asks for when SCIM is not yet implemented.

## Identity

- Production intent: `AUTH_PROVIDER=clerk`. Sessions are verified in `apps/web/src/lib/clerk-session.ts`. Missing Clerk email → unauthenticated (no `${userId}@clerk.local`).
- Development: `AUTH_PROVIDER=dev` with `x-nyayagrid-dev-user`. `DevAuthProvider` returns no identity on staging/production.
- **SSO (SAML/OIDC)** is a Clerk Enterprise configuration on the Clerk application (Account Portal / SSO connections). NyayaGrid does not implement a SAML service provider. Until a live Clerk production app exists (P2 BLOCKER), SSO cannot be verified end-to-end.

## Joining an organization

1. An existing member with `members.invite` creates an invite (`POST /api/v1/organizations/{id}/invites`).
2. Only the SHA-256 of the token is stored. The raw token is returned **once**.
3. The invitee accepts (`POST /api/v1/invites/accept`) while authenticated as themselves.
4. Membership + **NyayaGrid** role capabilities are applied. Clerk organization membership webhooks are **ignored** so IdP metadata cannot grant `organization.manage` or matter access.

## Client Guest

System role `client_guest`: `matters.view` + `documents.view` only. Guests see matters they are assigned on (`matter_members`). They cannot export audit logs, place holds, or invite members.

## Leaving / deletion

- Membership `status` may be `active` | `invited` | `disabled`.
- Clerk `user.deleted` is audited only. It does **not** cascade-delete matters, documents, or audit rows (spoliation and hold risk).
- Professional data deletion is a **request** (`data_deletion_requests`), checked against legal holds, never a synchronous wipe of originals.

## SCIM

Not implemented. If Clerk SCIM is enabled later, it may create/disable **identities**. It must not write NyayaGrid roles, matter memberships, or capabilities. That stays `POST` invites + Settings assign-to-matter.

## Disable vs delete

Disable the membership when someone leaves the firm. Do not delete legal rows because a directory user vanished.
