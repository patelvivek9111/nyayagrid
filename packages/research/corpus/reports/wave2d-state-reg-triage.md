# Wave 2D — Wave-1 State Administrative Code Triage

Phase: **50S-WAVE-2D** | Scope: **CA, DE, FL, IL, MA, NJ, NY, PA, TX, VA**

Inputs: `jurisdiction-sources.ts`, `wave2c-regulation-source-registry.json`, plus official `.gov` URL verification (2026-09-18).

## Summary

| Metric | Count |
| --- | --- |
| Wave-1 jurisdictions | 10 |
| Registry URLs present (wave2c) | 3 (CA, FL, NY) |
| Gaps filled this triage | 7 |
| Stale registry URLs | 1 (NY `dos.ny.gov/info/nycrr.html` → 404) |

### formatClass counts

| Class | Count | States |
| --- | ---: | --- |
| A_api_xml_json | 0 | — |
| B_stable_html | 5 | DE, FL, IL, PA, VA |
| C_stable_pdf | 0 | — |
| D_difficult_manual | 2 | MA, TX |
| E_terms_unclear | 3 | CA, NJ, NY |

### Best for curated_snapshot this session

1. **PA** — `pacodeandbulletin.gov`; stable HTML, court rules in Title 231 on same platform.
2. **FL** — `flrules.org`; mature SOS portal, high adapter feasibility.
3. **VA** — `law.lis.virginia.gov/admincode/`; LIS stack aligned with existing statute work.
4. **DE** — `regulations.delaware.gov`; clean official portal, medium-high feasibility.

**Defer:** CA, NJ, NY (Westlaw/Lexis proprietary wrappers); tackle MA/TX after adapter spikes.

## Platform families (all 50 — obvious patterns)

| Family | Proprietary? | Examples |
| --- | --- | --- |
| LexisNexis / Matthew Bender official publisher | Yes | NJ (+ CT, RI, WV among others — verify per state) |
| Thomson Reuters / Westlaw contracted browse | Yes | CA CCR, NY NYCRR |
| State LIS / revisor stack | No | VA, MN, WI, ND, IN, GA |
| SOS register + code portals | No | FL, TX, AZ, AR, KS |
| Legislative reference bureau (code + bulletin) | No | PA |
| State CMS (mass.gov-style) | No | MA |
| American Legal / eCode360 | Mixed | Mostly municipal; confirm official status |
| Cornell LII / Justia mirrors | No (unofficial) | Do not ingest |

## Wave-1 regulation triage

| Code | Official URL | Owner | formatClass | Platform | Feasibility | Approach | Citation example |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CA | [oal.ca.gov/publications/ccr](https://oal.ca.gov/publications/ccr/) | OAL (+ Westlaw browse) | E | Westlaw (proprietary) | low | skip_for_now | Cal. Code Regs. tit. 2, § 11042 |
| DE | [regulations.delaware.gov](https://regulations.delaware.gov/) | DE Register of Regulations | B | Custom DE portal | medium | html_adapter | 16 Del. Admin. Code § 4501.0 |
| FL | [flrules.org](https://www.flrules.org/) | FL Dept of State | B | FLRules SOS | high | html_adapter | Fla. Admin. Code R. 60A-1.004 |
| IL | [ilga.gov/.../admincode/titles.html](https://www.ilga.gov/commission/jcar/admincode/titles.html) | JCAR / ILGA | B | JCAR static HTML | medium | html_adapter | Ill. Admin. Code tit. 77, § 1000.10 |
| MA | [mass.gov CMR list](https://www.mass.gov/lists/code-of-massachusetts-regulations-cmr-by-number) | Commonwealth agencies | D | mass.gov CMS | medium | curated_snapshot | 940 CMR 3.00 |
| NJ | [nj.gov/oal/rules/accessp](https://www.nj.gov/oal/rules/accessp/) | NJ OAL (+ Lexis mirror) | E | LexisNexis (proprietary) | low | skip_for_now | N.J. Admin. Code § 13:45A-1.1 |
| NY | [dos.ny.gov/division-administrative-rules](https://dos.ny.gov/division-administrative-rules) | NY DOS DAR (+ Westlaw) | E | Westlaw (proprietary) | low | skip_for_now | 19 N.Y.C.R.R. § 130-1.1 |
| PA | [pacodeandbulletin.gov](https://www.pacodeandbulletin.gov/) | PA Legislative Reference Bureau | B | PA Code & Bulletin | high | curated_snapshot | 61 Pa. Code § 67.1 |
| TX | [sos.texas.gov/texreg](https://www.sos.texas.gov/texreg/index.shtml) | TX Secretary of State | D | TexReg / Appian | medium | html_adapter | 16 Tex. Admin. Code § 3.30 |
| VA | [law.lis.virginia.gov/admincode](https://law.lis.virginia.gov/admincode/) | VA General Assembly LIS | B | Virginia LIS | high | curated_snapshot | 12 Va. Admin. Code § 5-421-460 |

### Notes by state

- **CA** — OAL is official compiler; online full text via Thomson Reuters contract (`govt.westlaw.com/calregs`). Title 24 excluded from online CCR.
- **NY** — Replace stale registry URL; searchable NYCRR only on Westlaw mirror labeled *unofficial*. State Register PDFs are official but register-only.
- **NJ** — OAL directs public to Lexis hottopics; explicitly not the official Code.
- **PA** — Top Wave-1 pick; regulations and court rules (Title 231) share one platform.
- **TX** — Register index tractable; TAC browse (`readtac.cfm`) returned 401 — expect session/SPA friction with Appian migration.

## Tractable Wave-1 court rules (official)

| Code | URL | Notes |
| --- | --- | --- |
| PA | [Pa Code Title 231](https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/231/chapter1/chap1toc.html) | Court rules codified in Pa Code; verified 200 |
| FL | [flcourts.gov/Rules-Proc](https://www.flcourts.gov/Rules-Proc) | Central rules hub; verified 200 |
| VA | [vacourts.gov/courts/scv/rules](https://www.vacourts.gov/courts/scv/rules) | SCV rules index; verified 200 |

Registry court-rules URLs: CA redirects to [courts.ca.gov/forms-rules/rules-court](https://www.courts.ca.gov/forms-rules/rules-court); NY (`ww2.nycourts.gov/rules`) and PA (`pacourts.us/rules-and-procedures`) failed automated HEAD — use Pa Code Title 231 for PA.

## Recommended next actions

1. **Curated snapshot:** PA (2–3 high-traffic titles), FL (selected FAC chapters), VA (1–2 LIS titles).
2. **html_adapter spike:** DE, IL after PA/FL/VA snapshots land.
3. **Registry update:** Refresh NY regulation URL in `jurisdiction-sources.ts`; add DE, IL, MA, PA, TX, VA official URLs.
4. **Skip for now:** CA, NJ, NY until non-proprietary official bulk source or explicit licensing policy.
