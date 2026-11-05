# WP-05 — Explicit carry-forward (unresolved external gates)

These items are **not** closed by FIXABLE_NOW production-ops engineering. Do not mark them production-verified from WP-05 docs alone.

| Gate | Source | Status | Why carried forward |
| ---- | ------ | ------ | ------------------- |
| Legal research / corpus credential | WP-03E | OPEN | SELECT-only corpus role + live research certification deferred |
| Managed OCR + load | WP-04 / PROF-DOC-02 | OPEN | `OCR_PROVIDER` production decision + load gate outstanding |
| Clerk MFA live | WP-04 / SEC-AUTH-01 | OPEN | Server policy ≠ staging/production MFA enforcement proof |
| ClamAV production | WP-04 / SEC-MAL-01 | OPEN | Staging ClamAV ≠ production certification |
| Attorney Terms/Privacy | SEC-LEGAL-01 | OPEN | `ATTORNEY_APPROVED: false` |
| Critical security findings | prior audits | OPEN | Tracked outside WP-05 ops closure |
| Production deploy auth | OPS-DEP-01 | OPEN | `PRODUCTION_DEPLOYED=false`; no production Fly app |

## Related engineering (complete locally / staging where noted)

- OCR gate doc: `docs/security/OCR_PRODUCTION_GATE.md`
- ClamAV staging: `docs/operations/CLAMAV_STAGING.md`
- Legal acceptance engineering: WP-04 package (attorney sign-off still required)
- Production release checklist still lists these as unchecked blockers

## Forbidden claims

- Do not claim WP-05 closes WP-03E or WP-04.
- Do not start WP-06 from this carry-forward list.
- Do not treat staging SMTP monitoring ack as production on-call certification.
