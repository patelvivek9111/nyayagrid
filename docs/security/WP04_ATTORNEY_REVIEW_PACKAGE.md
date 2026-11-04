# WP-04 Attorney Review Package — Terms & Privacy

**Status:** DRAFT — awaiting independent attorney sign-off  
**Versions:** Terms `2026-11-04.wp04-draft.1` · Privacy `2026-11-04.wp04-draft.1`  
**Paths:** `/terms` · `/privacy` · acceptance API `/api/v1/legal/acceptances`

## What engineering completed

- Substantive Professional + Prosecution-aware draft language (not placeholders).
- Version identifiers and draft status badges.
- Server-side acceptance recording via audit events (`legal.terms_accepted` / `legal.privacy_accepted`).
- Stale-version rejection (`LEGAL_VERSION_MISMATCH`).
- Explicit “pending attorney review” labeling; no simulated approval.

## Change summary

| Area        | Content                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| Workspaces  | Professional + Nyaya Prosecution; removed student/public surfaces                |
| AI limits   | Draft work product; human review required; research not Westlaw/Lexis equivalent |
| Prosecution | No guilt scores; no autonomous charging/Brady/filing                             |
| Uploads     | Size/MIME/archive/PDF integrity + malware fail-closed                            |
| Privacy     | Holds, export/deletion, subprocessors, no invented certifications                |

## Known legal questions for counsel

1. Binding effect of preview / design-partner access vs order form / MSA.
2. Limitation of liability and warranty disclaimer final wording by jurisdiction.
3. Retention periods by data category for firm vs prosecution offices.
4. Cross-border processing and subprocessors DPAs.
5. Whether acceptance UX must gate product use before attorney approval of drafts.

## Security / data-processing assumptions (engineering)

- Tenant isolation and capability checks are application-enforced.
- Malware scan must clear before document availability/download.
- MFA can be required via `REQUIRE_CLERK_MFA=1` (Clerk Dashboard remains primary control).
- Customer content is not used for model training without separate recorded consent.
- No CJIS / SOC 2 / HIPAA claim is made in product copy.

## Sign-off checklist (human attorney only)

- [ ] Terms reviewed for Professional use
- [ ] Terms reviewed for Prosecution use
- [ ] Privacy reviewed (retention, deletion, subprocessors)
- [ ] Disclaimers adequate for AI research/drafting
- [ ] Version bump authorized for production publication
- [ ] Sign-off recorded outside this repository (ticket / counsel memo)

**ATTORNEY_APPROVED:** NO (must not be flipped by engineering)
