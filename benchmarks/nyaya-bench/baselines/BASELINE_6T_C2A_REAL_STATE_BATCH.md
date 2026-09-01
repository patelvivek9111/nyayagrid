# BASELINE 6T C2A — Real state-batch certification

**Run:** 2026-08-20T15:25:19.946Z  
**Duration:** 360496 ms  
**Nationwide claim:** NO  
**Agents certified by state:** no  
**C1 / CORPUS-1 overwrite:** none

"Certified" / VALIDATED / LIMITED here means **NyayaGrid internal benchmark certification**. It is not government certification, bar certification, court approval, or attorney validation.

## Totals

| Metric | Value |
| --- | ---: |
| Tasks | 127 |
| PASS | 124 |
| NEEDS WORK | 3 |
| FAIL | 0 |
| CRITICAL | 0 |
| Real primary authorities | 30 |
| States evaluated | PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA |

## State scorecards

| State | Quality | PASS | NEEDS WORK | FAIL | CRITICAL | Contract | Employment | Civil | Criminal |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| PA | 100% | 12 | 0 | 0 | 0 | VALIDATED | VALIDATED | LIMITED | UNVALIDATED |
| NJ | 100% | 12 | 0 | 0 | 0 | VALIDATED | VALIDATED | LIMITED | UNVALIDATED |
| NY | 100% | 12 | 0 | 0 | 0 | VALIDATED | VALIDATED | LIMITED | UNVALIDATED |
| DE | 100% | 12 | 0 | 0 | 0 | VALIDATED | VALIDATED | LIMITED | UNVALIDATED |
| CA | 91.7% | 11 | 1 | 0 | 0 | LIMITED | VALIDATED | LIMITED | UNVALIDATED |
| TX | 91.7% | 11 | 1 | 0 | 0 | LIMITED | VALIDATED | LIMITED | UNVALIDATED |
| FL | 100% | 12 | 0 | 0 | 0 | VALIDATED | VALIDATED | LIMITED | UNVALIDATED |
| IL | 100% | 12 | 0 | 0 | 0 | VALIDATED | VALIDATED | LIMITED | UNVALIDATED |
| MA | 100% | 12 | 0 | 0 | 0 | VALIDATED | VALIDATED | LIMITED | UNVALIDATED |
| VA | 91.7% | 11 | 1 | 0 | 0 | LIMITED | VALIDATED | LIMITED | UNVALIDATED |

## Dimensions

| State | Routing | Retrieval | Citation | Hierarchy | Grounding | Wrong-state | Temporal | Abstention |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PA | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| NJ | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| NY | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| DE | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| CA | 100 | 100 | 100 | 100 | 0 | 100 | 100 | 100 |
| TX | 100 | 100 | 100 | 100 | 0 | 100 | 100 | 100 |
| FL | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| IL | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| MA | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| VA | 100 | 100 | 100 | 100 | 0 | 100 | 100 | 100 |

## Representative extras (Ask / Draft / governing law / multi-jurisdiction)

| Id | State | Severity | Detail |
| --- | --- | --- | --- |
| T6T-C2A-GOV-01 | PA | PASS | Delaware UCC present for governing-law question; PA forum metadata unchanged. |
| T6T-C2A-MULTI-01 | PA | PASS | Multi-jurisdiction query did not flatten PA/DE/NJ roles. |
| T6T-C2A-ASK-PA | PA | PASS | Ask used structured jurisdiction and did not invent nationwide contract law. |
| T6T-C2A-ASK-NY | NY | PASS | Ask used structured jurisdiction and did not invent nationwide contract law. |
| T6T-C2A-ASK-CA | CA | PASS | Ask used structured jurisdiction and did not invent nationwide contract law. |
| T6T-C2A-DRAFT-PA | PA | PASS | Draft generated against retrieved home-state authority without metadata-as-evidence substitution. |
| T6T-C2A-DRAFT-DE | DE | PASS | Draft generated against retrieved home-state authority without metadata-as-evidence substitution. |

## Coverage labels (honest, narrow)

Contract VALIDATED: PA (UCC § 2-725 limitations retrieval and citation); NJ (UCC § 2-725 limitations retrieval and citation); NY (UCC § 2-725 limitations retrieval and citation); DE (UCC § 2-725 limitations retrieval and citation); FL (UCC § 2-725 limitations retrieval and citation); IL (UCC § 2-725 limitations retrieval and citation); MA (UCC § 2-725 limitations retrieval and citation)  
Employment VALIDATED: PA (Imported wage/employment statute retrieval); NJ (Imported wage/employment statute retrieval); NY (Imported wage/employment statute retrieval); DE (Imported wage/employment statute retrieval); CA (Imported wage/employment statute retrieval); TX (Imported wage/employment statute retrieval); FL (Imported wage/employment statute retrieval); IL (Imported wage/employment statute retrieval); MA (Imported wage/employment statute retrieval); VA (Imported wage/employment statute retrieval)  
Civil VALIDATED: none (Civil is excerpt-only LIMITED at best)  
LIMITED: Contract: CA (UCC § 2-725 present but not at 90%+ material quality); Contract: TX (UCC § 2-725 present but not at 90%+ material quality); Contract: VA (UCC § 2-725 present but not at 90%+ material quality); Civil: PA (Excerpt-only high-court retrieval; not general civil completeness.); Civil: NJ (Excerpt-only high-court retrieval; not general civil completeness.); Civil: NY (Excerpt-only high-court retrieval; not general civil completeness.); Civil: DE (Excerpt-only high-court retrieval; not general civil completeness.); Civil: CA (Excerpt-only high-court retrieval; not general civil completeness.); Civil: TX (Excerpt-only high-court retrieval; not general civil completeness.); Civil: FL (Excerpt-only high-court retrieval; not general civil completeness.); Civil: IL (Excerpt-only high-court retrieval; not general civil completeness.); Civil: MA (Excerpt-only high-court retrieval; not general civil completeness.); Civil: VA (Excerpt-only high-court retrieval; not general civil completeness.)  
UNVALIDATED: Criminal: PA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: NJ (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: NY (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: DE (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: CA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: TX (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: FL (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: IL (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: MA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: VA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.)  
FAILED: none
