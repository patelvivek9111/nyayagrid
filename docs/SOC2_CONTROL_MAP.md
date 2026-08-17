# SOC 2 control map (internal evidence, not an audit)

This maps a subset of Trust Services Criteria to **existing NyayaGrid controls**. It is not SOC 2 Type I or Type II. No auditor has examined these controls. Do not show this file to a customer as a report.

Related: [`PRODUCTION_SECURITY_REVIEW.md`](./PRODUCTION_SECURITY_REVIEW.md) (self-review, not a pen test).

| Area | What exists in code / docs | Gap |
| --- | --- | --- |
| CC6 access control | `@nyayagrid/permissions`; matter membership default deny; Guide/Professor isolation tests; `e2e/security.spec.ts` | No live Clerk MFA verification (P2) |
| CC6 logical access / SSO | Clerk adapter + webhooks (identity only) | SAML/OIDC is Clerk Enterprise ops, unverified |
| CC7 logging | `audit_events`; matter audit export; structured logs without document text by policy | No log aggregator / paging (P2 monitoring BLOCKER) |
| CC8 change management | Git + CI workflow | Not an audited SDLC |
| A1 availability | `/api/health/live` and `/ready`; local backup rehearsal | Managed PITR and restore-on-target BLOCKER |
| C1 confidentiality | Tenant-scoped storage keys; malware scan interface; encryption in transit expected at TLS terminator | AWS S3 encryption-at-rest not provisioned |
| P1 privacy / training | Usage metadata sanitizer; OpenAI `store: false`; training consent table default empty | No signed DPA; Terms still draft |

**Pen test:** not performed. Isolation tests and this self-review are internal evidence only. Cross-tenant findings from a future staging pen test are SEV1 ([`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md)).
