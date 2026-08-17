# Enterprise Trust — P7 Task Tracker

**Goal:** Collect the procurement evidence NyayaGrid can produce in-repo: attorney-exportable matter audit logs, legal-hold UI that blocks deletion, documented user lifecycle (SSO/SCIM as Clerk operator work), a draft subprocessors list, and a technical proof that customer data is not used for model training unless separately recorded. This is Harvey roadmap **P7**. It is **not** SOC 2 Type I/II, a signed DPA, a third-party pen test, Clerk Enterprise SSO on a live app, or insurance.

NyayaGrid is not go-live. P2 live Clerk/S3 remain BLOCKER.

---

## In scope (this track)

- [x] Matter audit-log export (JSON; no document text, prompts, or tokens)
- [x] Legal hold place/release UI + deletion requests rejected while a hold is active
- [x] Retention / legal-hold **design** documented (`docs/RETENTION_AND_LEGAL_HOLD.md`)
- [x] User lifecycle documented (`docs/USER_LIFECYCLE.md`) — Clerk identity, hashed invites, `user.deleted` does not cascade-delete legal rows; SCIM not implemented
- [x] Draft subprocessors page (not a signed DPA)
- [x] Training consent is **off** by default and separately recorded; OpenAI chat calls set `store: false`; usage metadata strips content keys
- [x] SOC 2 control **map** as internal evidence (`docs/SOC2_CONTROL_MAP.md`) — not an audit

## Cannot close in code (remain open)

- [ ] SSO (SAML/OIDC) via **live** Clerk Enterprise — operator/Clerk dashboard after P2 Clerk production
- [ ] SCIM provisioning — not built; IdP groups still do not grant NyayaGrid capabilities
- [ ] Signed DPA + counsel-approved subprocessors list
- [ ] Independent pen test on staging
- [ ] SOC 2 Type I, then Type II
- [ ] E&O / cyber insurance (business)

---

## Close-out (2026-08-17)

In-repo P7 evidence is done. Live Clerk SSO, signed DPA, pen test, SOC 2 Type I/II, and insurance are **not**.

- `npm run db:migrate` — `0011_enterprise_trust` (`training_consents`)
- `npm run seed:golden-matter` — `SYNTH-GOLDEN-LEASE-V1` (`3ad4246b-853d-4e18-97c0-f622781293ce`); all six docs `ready` (depo + PM email included)
- Evidence Detect `{ force: true }` → 201, **Conflicting CAM send dates**, Suggested/proposed (PM email March 3, 2025 / depo February 28, 2025)
- Matter audit export 200 as owner (59 events, no content-like metadata keys); anonymous → 401
- Org-wide SYNTH hold → deletion request stored as **rejected**; hold released after the smoke
- Training consent GET: `consented: false`, `trainsOnCustomerData: false`
