# PHASE 6T-C2A — INITIAL STATE CERTIFICATION

**Date:** 2026-08-20  
**Baseline:** `BASELINE_6T_C2A_REAL_STATE_BATCH.json` / `.md`  
**Preserved:** `BASELINE_6T_C1_50_STATE.*`, `PHASE_6T_50_STATE_JURISDICTION_CERTIFICATION.md`, `BASELINE_6T_CORPUS1.*`  
**Agents:** FEATURE_AGENTS remains **OFF** in production/staging defaults (agents===false check passed: production=true, staging=true)  
**Nationwide claim:** **NO**  
**Database:** localhost:5433/nyayagrid  
**APP_ENV:** (unset)

"Certified" in this document means **NyayaGrid internal benchmark certification**. It is not government certification, bar certification, court approval, or attorney validation.

## 1. Executive Summary

C2A is the first **real-corpus** state-law certification for the initial 10-state batch. It is not routing-only C1 and not a nationwide claim.

| Metric | Value |
| --- | ---: |
| States evaluated | 10 |
| Tasks | 127 |
| PASS | 124 |
| NEEDS WORK | 3 |
| FAIL | 0 |
| CRITICAL | 0 |
| States at 90%+ material quality | PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA |
| States with 0 CRITICAL | PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA |
| Beta-eligible scopes | PA Contract (VALIDATED); PA Employment (VALIDATED); NJ Contract (VALIDATED); NJ Employment (VALIDATED); NY Contract (VALIDATED); NY Employment (VALIDATED); DE Contract (VALIDATED); DE Employment (VALIDATED); CA Contract (LIMITED); CA Employment (VALIDATED); TX Contract (LIMITED); TX Employment (VALIDATED); FL Contract (VALIDATED); FL Employment (VALIDATED); IL Contract (VALIDATED); IL Employment (VALIDATED); MA Contract (VALIDATED); MA Employment (VALIDATED); VA Contract (LIMITED); VA Employment (VALIDATED) |
| NEEDS WORK (not FAIL) | T6T-C2A-CA-09, T6T-C2A-TX-09, T6T-C2A-VA-09 |
| Next phase | **PHASE 6U — JURISDICTION-AWARE FULL-SYSTEM REGRESSION / BETA GATE** |

Production was not patched mid-run. Coverage writes are limited to these 10 states × four practice areas. The other 41 C1 jurisdictions remain UNVALIDATED.

## 2. Real Corpus Scope

Imported under `us-primary-corpus` (CORPUS-1), not synthetic fixtures:

- 10 states: PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA
- 30 real primary authorities expected in the certification DB (observed: 30)
- 20 statutes (UCC § 2-725 + one wage/employment statute per state)
- 10 state high-court excerpts
- 0 regulations
- 0 effective dates unless a bundle explicitly provided one
- Synthetic / overlay authorities remain in the same database but are excluded from coverage and treated as CRITICAL if labeled controlling

## 3. Certification Scope

C2A certifies **narrow retrieved-corpus behavior**, not completeness of any state's law.

In scope:

- Retrieval and citation of imported UCC § 2-725
- Retrieval of the imported wage/employment statute
- Retrieval of the imported high-court excerpt
- Wrong-state / decoy safety
- Hierarchy labels on the home high court
- Quote and proposition grounding against stored text
- Family-law abstention (no family corpus)
- Temporal honesty when effective dates are missing
- Excerpt-limit honesty
- Representative Ask (PA, NY, CA) and Draft (PA, DE)
- Governing-law vs forum (PA forum / DE governing)
- Multi-jurisdiction flattening (PA / DE / NJ)

Out of scope:

- Nationwide support
- Agents-by-state certification
- Criminal practice
- Regulations
- Complete civil procedure, family law, or high-court completeness
- 41 jurisdictions not in this batch

## 4. Benchmark Design

Production path only: `runResearchQuery` → retrieve / rank / synthesize / cite. Hidden ground truth (citation needles, `sourceExternalId`) is used for **grading**, never injected as retrieval filters. Queries are not forced to `sourceProvider: us-primary-corpus`. Shared questions are cached per `matterId::question`.

Graders live in `runner/t6t-c2a-grade.ts`. Failure taxonomy: A corpus depth, B retrieval, C ranking, D jurisdiction, E authority relationship, F citation, G proposition grounding, H quote grounding, I temporal, J abstention, K synthesis overclaim, L metadata, M grader, N infrastructure.

## 5. State Results

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

## 6. Contract

VALIDATED scopes (UCC § 2-725 limitations retrieval and citation only): PA (UCC § 2-725 limitations retrieval and citation); NJ (UCC § 2-725 limitations retrieval and citation); NY (UCC § 2-725 limitations retrieval and citation); DE (UCC § 2-725 limitations retrieval and citation); FL (UCC § 2-725 limitations retrieval and citation); IL (UCC § 2-725 limitations retrieval and citation); MA (UCC § 2-725 limitations retrieval and citation).

LIMITED / UNVALIDATED / FAILED: see coverage lists below. This is not general contract-law completeness.

## 7. Employment

VALIDATED scopes (imported wage/employment statute only): PA (Imported wage/employment statute retrieval); NJ (Imported wage/employment statute retrieval); NY (Imported wage/employment statute retrieval); DE (Imported wage/employment statute retrieval); CA (Imported wage/employment statute retrieval); TX (Imported wage/employment statute retrieval); FL (Imported wage/employment statute retrieval); IL (Imported wage/employment statute retrieval); MA (Imported wage/employment statute retrieval); VA (Imported wage/employment statute retrieval).

## 8. Civil

Civil remains **LIMITED at best** because the corpus holds excerpt-only high-court opinions. VALIDATED Civil: none, by design.

## 9. Criminal

**UNVALIDATED in every C2A state.** DE/VA excerpts that are criminal-adjacent are not a criminal statute corpus and do not certify Criminal practice.

## 10. Retrieval

Contract / employment / high-court retrieval dimension average: 100%. Failures of expected home-state authority in top hits are class B.

## 11. Citation Validity

Citation tasks: 15. CRITICAL fabricated citations (class F): 0. Stored citations must match imported records; canonical source URLs were required on retrieved home authorities.

## 12. Proposition Grounding

Grounding tasks: 10. FAIL/CRITICAL unsupported propositions (G/K): 0. Four-year UCC limitations language is the Contract grounding needle.

## 13. Wrong-State Safety

Wrong-state / decoy CRITICAL: 0. Synthetic-as-controlling CRITICAL: 0. Dimension average: 100%.

## 14. Hierarchy

Home high court must not be labeled `out_of_jurisdiction`. Dimension: 100%.

## 15. Temporal

Imported statutes generally have **unknown effective dates**. Current-law overclaim FAILs: 0. Dimension: 100%.

## 16. Abstention

Family-law waiting-period and excerpt-limit questions must abstain or warn. Dimension: 100%.

## 17. Governing Law

T6T-C2A-GOV-01: **PASS** — Delaware UCC present for governing-law question; PA forum metadata unchanged.

Forum (PA) and governing law (DE) must remain distinct. Substituting forum law for governing law is CRITICAL.

## 18. Multi-Jurisdiction

T6T-C2A-MULTI-01: **PASS** — Multi-jurisdiction query did not flatten PA/DE/NJ roles.

## 19. Ask

Representative Ask on PA, NY, CA via `askNyayaAboutMatter` with `AuthorityHybridRetriever` plus empty-matter document retrieval. Nationwide-rule invention is CRITICAL. Ask CRITICAL: 0. Evidence states: PA=insufficient, NY=insufficient, CA=insufficient.

## 20. Research

Live `runResearchQuery` on each state's 12 specs (cached shared questions). Research-path CRITICAL states: none.

## 21. Draft

PA and DE: retrieve, then `saveAuthorityToMatter`, then `generateDraft`. Authorities are **not** injected into Research. Draft CRITICAL: 0.

## 22. Agents Context Regression

`getFeatureFlags({ APP_ENV: "production" }).agents === false`: **true**  
`getFeatureFlags({ APP_ENV: "staging" }).agents === false`: **true**  
Agents were **not** certified by state.

## 23. Quality Scores

Material quality = PASS / all tasks for that state (CRITICAL counts as not-PASS). 90%+ states: PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA.

## 24. Coverage Labels

DB writes use `supported` / `limited` / `unvalidated` (VALIDATED maps to `supported`). Report labels:

- VALIDATED Contract: PA (UCC § 2-725 limitations retrieval and citation); NJ (UCC § 2-725 limitations retrieval and citation); NY (UCC § 2-725 limitations retrieval and citation); DE (UCC § 2-725 limitations retrieval and citation); FL (UCC § 2-725 limitations retrieval and citation); IL (UCC § 2-725 limitations retrieval and citation); MA (UCC § 2-725 limitations retrieval and citation)
- VALIDATED Employment: PA (Imported wage/employment statute retrieval); NJ (Imported wage/employment statute retrieval); NY (Imported wage/employment statute retrieval); DE (Imported wage/employment statute retrieval); CA (Imported wage/employment statute retrieval); TX (Imported wage/employment statute retrieval); FL (Imported wage/employment statute retrieval); IL (Imported wage/employment statute retrieval); MA (Imported wage/employment statute retrieval); VA (Imported wage/employment statute retrieval)
- VALIDATED Civil: none
- LIMITED: Contract: CA (UCC § 2-725 present but not at 90%+ material quality); Contract: TX (UCC § 2-725 present but not at 90%+ material quality); Contract: VA (UCC § 2-725 present but not at 90%+ material quality); Civil: PA (Excerpt-only high-court retrieval; not general civil completeness.); Civil: NJ (Excerpt-only high-court retrieval; not general civil completeness.); Civil: NY (Excerpt-only high-court retrieval; not general civil completeness.); Civil: DE (Excerpt-only high-court retrieval; not general civil completeness.); Civil: CA (Excerpt-only high-court retrieval; not general civil completeness.); Civil: TX (Excerpt-only high-court retrieval; not general civil completeness.); Civil: FL (Excerpt-only high-court retrieval; not general civil completeness.); Civil: IL (Excerpt-only high-court retrieval; not general civil completeness.); Civil: MA (Excerpt-only high-court retrieval; not general civil completeness.); Civil: VA (Excerpt-only high-court retrieval; not general civil completeness.)
- UNVALIDATED: Criminal: PA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: NJ (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: NY (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: DE (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: CA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: TX (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: FL (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: IL (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: MA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: VA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.)
- FAILED: none

Criminal is UNVALIDATED everywhere. Other 41 C1 jurisdictions were not rewritten.

## 25. Beta Eligibility

- PA / Contract / VALIDATED: UCC § 2-725 limitations retrieval and citation
- PA / Employment / VALIDATED: Imported wage/employment statute retrieval
- NJ / Contract / VALIDATED: UCC § 2-725 limitations retrieval and citation
- NJ / Employment / VALIDATED: Imported wage/employment statute retrieval
- NY / Contract / VALIDATED: UCC § 2-725 limitations retrieval and citation
- NY / Employment / VALIDATED: Imported wage/employment statute retrieval
- DE / Contract / VALIDATED: UCC § 2-725 limitations retrieval and citation
- DE / Employment / VALIDATED: Imported wage/employment statute retrieval
- CA / Contract / LIMITED: UCC § 2-725 present but not at 90%+ material quality
- CA / Employment / VALIDATED: Imported wage/employment statute retrieval
- TX / Contract / LIMITED: UCC § 2-725 present but not at 90%+ material quality
- TX / Employment / VALIDATED: Imported wage/employment statute retrieval
- FL / Contract / VALIDATED: UCC § 2-725 limitations retrieval and citation
- FL / Employment / VALIDATED: Imported wage/employment statute retrieval
- IL / Contract / VALIDATED: UCC § 2-725 limitations retrieval and citation
- IL / Employment / VALIDATED: Imported wage/employment statute retrieval
- MA / Contract / VALIDATED: UCC § 2-725 limitations retrieval and citation
- MA / Employment / VALIDATED: Imported wage/employment statute retrieval
- VA / Contract / LIMITED: UCC § 2-725 present but not at 90%+ material quality
- VA / Employment / VALIDATED: Imported wage/employment statute retrieval

Eligibility is **explicit-scope only** for Contract (UCC § 2-725) and Employment (imported wage statute). Civil LIMITED is excerpt-retrieval honesty, **not** a Civil beta slice. It is not statewide Nyaya Research completeness and not a nationwide beta.

## 26. Root Causes

- G: 3

## 27. Production Changes

**None during C2A.** The runner graded current behavior. Environment reconciliation (env load, inventory split, C1 freeze) was a prior phase and is not a mid-run C2A patch.

## 28. C2B if applicable

C2B is **not** opened. No production-class CRITICAL defect was recorded that requires a general mid-certification patch.

## 29. Regressions

C1 routing snapshot is preserved (7 synthetic authorities, 0 mapped US-state rows, 51 UNVALIDATED). C2A did not overwrite those files. This run does not re-score the 41 jurisdictions outside the batch.

## 30. Remaining Corpus Gaps

- 3 authorities per state
- 0 regulations
- 0 (or nearly 0) effective dates
- High-court texts are excerpts, not full opinions
- No family, criminal-statute, or civil-procedure corpus
- 40 states + DC still have no real primary authorities
- DE/VA criminal-adjacent excerpts must not be read as Criminal VALIDATED

## 31. Controlled-Beta State Decision

Controlled beta may exercise **only** the listed scopes in §25. No statewide or nationwide Research beta. Agents stay OFF.

Do not deploy beta. Do not enable Agents. Do not claim nationwide support.

## 32. Exactly One Next Phase

**PHASE 6U — JURISDICTION-AWARE FULL-SYSTEM REGRESSION / BETA GATE**

At least one honest VALIDATED/LIMITED real-corpus scope exists, citation and proposition grounding were exercised, and no CRITICAL defects were recorded.

---

## Explicit questions

1. Which 10 states were evaluated? **PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA**
2. Which states achieved 90%+ material quality? **PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA**
3. Which states had 0 critical failures? **PA, NJ, NY, DE, CA, TX, FL, IL, MA, VA**
4. Which Contract scopes are VALIDATED? **PA (UCC § 2-725 limitations retrieval and citation); NJ (UCC § 2-725 limitations retrieval and citation); NY (UCC § 2-725 limitations retrieval and citation); DE (UCC § 2-725 limitations retrieval and citation); FL (UCC § 2-725 limitations retrieval and citation); IL (UCC § 2-725 limitations retrieval and citation); MA (UCC § 2-725 limitations retrieval and citation)**
5. Which Employment scopes are VALIDATED? **PA (Imported wage/employment statute retrieval); NJ (Imported wage/employment statute retrieval); NY (Imported wage/employment statute retrieval); DE (Imported wage/employment statute retrieval); CA (Imported wage/employment statute retrieval); TX (Imported wage/employment statute retrieval); FL (Imported wage/employment statute retrieval); IL (Imported wage/employment statute retrieval); MA (Imported wage/employment statute retrieval); VA (Imported wage/employment statute retrieval)**
6. Which Civil scopes are VALIDATED? **none**
7. Which remain LIMITED? **Contract: CA (UCC § 2-725 present but not at 90%+ material quality); Contract: TX (UCC § 2-725 present but not at 90%+ material quality); Contract: VA (UCC § 2-725 present but not at 90%+ material quality); Civil: PA (Excerpt-only high-court retrieval; not general civil completeness.); Civil: NJ (Excerpt-only high-court retrieval; not general civil completeness.); Civil: NY (Excerpt-only high-court retrieval; not general civil completeness.); Civil: DE (Excerpt-only high-court retrieval; not general civil completeness.); Civil: CA (Excerpt-only high-court retrieval; not general civil completeness.); Civil: TX (Excerpt-only high-court retrieval; not general civil completeness.); Civil: FL (Excerpt-only high-court retrieval; not general civil completeness.); Civil: IL (Excerpt-only high-court retrieval; not general civil completeness.); Civil: MA (Excerpt-only high-court retrieval; not general civil completeness.); Civil: VA (Excerpt-only high-court retrieval; not general civil completeness.)**
8. Which remain UNVALIDATED? **Criminal: PA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: NJ (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: NY (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: DE (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: CA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: TX (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: FL (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: IL (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: MA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.); Criminal: VA (No criminal statute corpus; high-court excerpts are not criminal-practice certification.)**
9. Any fabricated citation? **no**
10. Any fabricated quote? **no**
11. Any wrong-state authority as controlling? **no**
12. Any wrong circuit as controlling? **C2A did not include a dedicated other-circuit trap; no C2A CRITICAL was scored as wrong-circuit. C1 remains 0 wrong-circuit controlling.**
13. Any unsupported proposition? **no FAIL/CRITICAL; NEEDS_WORK grounding: T6T-C2A-CA-09, T6T-C2A-TX-09, T6T-C2A-VA-09**
14. Any current-law overclaim with unknown dates? **no**
15. Is governing law preserved separately from forum? **yes**
16. Are multi-jurisdiction cases safe? **yes**
17. Is Ask safe on real state law? **yes — no Ask CRITICAL in PA/NY/CA extras**
18. Is Research safe on real state law? **yes — no Research CRITICAL on the 10-state scorecards**
19. Is Draft safe with real state authority? **yes — no Draft CRITICAL in PA/DE extras**
20. Can any state be beta-eligible now? **yes, explicit scope only**
21. For exactly what practice-area scope? **PA Contract: UCC § 2-725 limitations retrieval and citation; PA Employment: Imported wage/employment statute retrieval; NJ Contract: UCC § 2-725 limitations retrieval and citation; NJ Employment: Imported wage/employment statute retrieval; NY Contract: UCC § 2-725 limitations retrieval and citation; NY Employment: Imported wage/employment statute retrieval; DE Contract: UCC § 2-725 limitations retrieval and citation; DE Employment: Imported wage/employment statute retrieval; CA Contract: UCC § 2-725 present but not at 90%+ material quality; CA Employment: Imported wage/employment statute retrieval; TX Contract: UCC § 2-725 present but not at 90%+ material quality; TX Employment: Imported wage/employment statute retrieval; FL Contract: UCC § 2-725 limitations retrieval and citation; FL Employment: Imported wage/employment statute retrieval; IL Contract: UCC § 2-725 limitations retrieval and citation; IL Employment: Imported wage/employment statute retrieval; MA Contract: UCC § 2-725 limitations retrieval and citation; MA Employment: Imported wage/employment statute retrieval; VA Contract: UCC § 2-725 present but not at 90%+ material quality; VA Employment: Imported wage/employment statute retrieval**
22. Which states need deeper corpus before validation? **All ten still need depth beyond 3 authorities; especially any state without VALIDATED Contract/Employment, plus every Criminal/Civil completeness claim.**
23. Is 6U ready to start? **yes — as the next phase, not started here**
24. What is the largest remaining state-law risk? **Shallow corpus (3 authorities/state, no dates, no regulations, excerpt-only cases) plus any remaining wrong-state/synthetic-controlling or current-law overclaim behavior.**
