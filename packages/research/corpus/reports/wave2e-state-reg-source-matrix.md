# Wave 2E — State Regulation Source Matrix

Phase: **50S-WAVE-2E** | Jurisdictions: **52** (US + 50 states + DC)

Generated: 2026-09-18T02:44:06.127Z

## Summary

| Metric | Count |
| --- | ---: |
| With canonical URL | 18 |
| adapter_available | 5 |
| implementationStatus: adapter_available | 5 |
| implementationStatus: blocked_by_proprietary_browse | 6 |
| implementationStatus: manual_or_unimplemented | 38 |
| implementationStatus: ready | 1 |
| implementationStatus: source_unstable | 1 |
| implementationStatus: terms_review_required | 1 |

### platformFamily counts

| Platform | Count |
| --- | ---: |
| jcar_html | 1 |
| legislative_reference_bureau | 1 |
| lexis_publisher_contract | 4 |
| lis_revisor | 6 |
| mass_cms | 1 |
| sos_portal | 6 |
| unknown | 31 |
| westlaw_browse_contract | 2 |

## Honest limits

- Only US eCFR is `ready`; five Wave-1 states have `adapter_available` configs in state-regulation.ts.
- CA, NJ, NY blocked by proprietary Lexis/Westlaw browse contracts.
- Many states lack a recorded official regulation URL — not triaged beyond registry.

## Matrix

| Code | Status | Platform | Format | URL |
| --- | --- | --- | --- | --- |
| US | ready | unknown | API | [link](https://www.ecfr.gov/) |
| AL | manual_or_unimplemented | unknown | unknown | — |
| AK | manual_or_unimplemented | unknown | unknown | — |
| AZ | manual_or_unimplemented | sos_portal | HTML | [link](https://apps.azsos.gov/public_services/CodeTitle.htm) |
| AR | manual_or_unimplemented | sos_portal | HTML | [link](https://www.sos.arkansas.gov/rules-and-regulations/arkansas-administrative-code) |
| CA | blocked_by_proprietary_browse | westlaw_browse_contract | mixed | [link](https://oal.ca.gov/publications/ccr/) |
| CO | manual_or_unimplemented | unknown | unknown | — |
| CT | blocked_by_proprietary_browse | lexis_publisher_contract | unknown | — |
| DE | adapter_available | sos_portal | HTML | [link](https://regulations.delaware.gov/) |
| FL | adapter_available | sos_portal | HTML | [link](https://www.flrules.org/) |
| GA | manual_or_unimplemented | lis_revisor | HTML | [link](https://rules.sos.ga.gov/) |
| HI | manual_or_unimplemented | unknown | unknown | — |
| ID | manual_or_unimplemented | unknown | unknown | — |
| IL | adapter_available | jcar_html | HTML | [link](https://www.ilga.gov/commission/jcar/admincode/titles.html) |
| IN | manual_or_unimplemented | lis_revisor | HTML | [link](https://iga.in.gov/laws/administrative-rules) |
| IA | manual_or_unimplemented | unknown | unknown | — |
| KS | manual_or_unimplemented | sos_portal | HTML | [link](https://sos.ks.gov/publications/Regulations.html) |
| KY | manual_or_unimplemented | unknown | unknown | — |
| LA | manual_or_unimplemented | unknown | unknown | — |
| ME | manual_or_unimplemented | unknown | unknown | — |
| MD | manual_or_unimplemented | unknown | unknown | — |
| MA | terms_review_required | mass_cms | HTML | [link](https://www.mass.gov/lists/code-of-massachusetts-regulations-cmr-by-number) |
| MI | manual_or_unimplemented | unknown | unknown | — |
| MN | manual_or_unimplemented | lis_revisor | HTML | [link](https://www.revisor.mn.gov/rules/) |
| MS | manual_or_unimplemented | unknown | unknown | — |
| MO | manual_or_unimplemented | unknown | unknown | — |
| MT | manual_or_unimplemented | unknown | unknown | — |
| NE | manual_or_unimplemented | unknown | unknown | — |
| NV | manual_or_unimplemented | unknown | unknown | — |
| NH | manual_or_unimplemented | unknown | unknown | — |
| NJ | blocked_by_proprietary_browse | lexis_publisher_contract | HTML | [link](https://www.nj.gov/oal/rules/accessp/) |
| NM | manual_or_unimplemented | unknown | unknown | — |
| NY | blocked_by_proprietary_browse | westlaw_browse_contract | mixed | [link](https://dos.ny.gov/division-administrative-rules) |
| NC | manual_or_unimplemented | unknown | unknown | — |
| ND | manual_or_unimplemented | lis_revisor | unknown | — |
| OH | manual_or_unimplemented | unknown | unknown | — |
| OK | manual_or_unimplemented | unknown | unknown | — |
| OR | manual_or_unimplemented | unknown | unknown | — |
| PA | adapter_available | legislative_reference_bureau | HTML | [link](https://www.pacodeandbulletin.gov/) |
| RI | blocked_by_proprietary_browse | lexis_publisher_contract | unknown | — |
| SC | manual_or_unimplemented | unknown | unknown | — |
| SD | manual_or_unimplemented | unknown | unknown | — |
| TN | manual_or_unimplemented | unknown | unknown | — |
| TX | source_unstable | sos_portal | mixed | [link](https://www.sos.texas.gov/texreg/index.shtml) |
| UT | manual_or_unimplemented | unknown | unknown | — |
| VT | manual_or_unimplemented | unknown | unknown | — |
| VA | adapter_available | lis_revisor | HTML | [link](https://law.lis.virginia.gov/admincode/) |
| WA | manual_or_unimplemented | unknown | unknown | — |
| WV | blocked_by_proprietary_browse | lexis_publisher_contract | unknown | — |
| WI | manual_or_unimplemented | lis_revisor | HTML | [link](https://docs.legis.wisconsin.gov/code/admin_code) |
| WY | manual_or_unimplemented | unknown | unknown | — |
| DC | manual_or_unimplemented | unknown | unknown | — |
