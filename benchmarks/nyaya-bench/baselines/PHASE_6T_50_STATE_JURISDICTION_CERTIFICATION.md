# PHASE 6T — 50-STATE JURISDICTION BENCHMARK & CERTIFICATION

**Date:** 2026-08-19  
**C1:** `BASELINE_6T_C1_50_STATE.json` / `.md`  
**C2:** not run (no production defect required a general fix)  
**Agents:** FEATURE_AGENTS remains **OFF**  
**Nationwide claim:** **NO**

"Certified" in this document means **NyayaGrid internal benchmark certification**. It is not government certification, bar certification, court approval, or attorney validation.

## 1. Executive Summary

Phase 6T evaluated all **50 states plus DC** against the 6S jurisdiction trust boundary.

**Routing safety passed. Practice-area research did not certify any state.**

C1: **514 tasks**, **463 PASS**, **51 NEEDS WORK**, **0 FAIL**, **0 CRITICAL**.

Wrong-state authority labeled controlling: **0**.  
Wrong circuit labeled controlling: **0**.  
Fabricated citations / quotes: **not scored in synthesis** (no live state-law Research corpus to synthesize).

The local authority corpus contains **7** records, all unmapped synthetic/other jurisdictions. **0** US states have mapped statute, case, or regulation records. Therefore every practice area remains **UNVALIDATED**. Controlled-beta eligibility for state-law Research is **empty**.

6S architecture was **not** reopened. No C2 production patch.

## 2. Certification Method

C1 graded production functions without fixture-specific branches:

- `classifyAuthorityRelationship`
- `rankAuthoritiesForMatter` / `labelResearchHits`
- `deriveCircuitFromCourtId` / `listFederalDistrictsForState`
- `isAuthorityTemporallyApplicable`
- `shouldAbstainForUnknownJurisdiction`
- `applyMatterJurisdictionInput` (choice-of-law / multi-jurisdiction)
- Draft system prompt + jurisdiction prompt block
- `getFeatureFlags` production/staging Agents default

Hidden GT for home circuits is `datasets/t6t/hidden_ground_truth/expected-circuits.ts` (public geography, not imported from the production district table).

Corpus-backed retrieval was **not invented**. Where mapped authorities = 0, the corpus dimension is NEEDS WORK / UNVALIDATED, not FAIL.

## 3. Corpus Inventory

See `BASELINE_6T_CORPUS_INVENTORY.json`.

| Field | Value |
| --- | --- |
| Total authorities | 7 |
| Types | case: 2, statute: 4, other: 1 |
| Unmapped jurisdiction strings | 7 |
| Unmapped labels | Synthetic Federal (2), Synthetic Jurisdiction (4), Other State (1) |
| States with mapped authorities | 0 |

Do not infer completeness from these counts. The synthetic corpus is useful for R1 Research quality on fictional federal material. It is **not** a 50-state primary-law corpus.

## 4. State Coverage Inventory

Every US state and DC: **0** mapped authorities, **0** statutes, **0** cases, **0** regulations, **0%** normalized US-state metadata, **0%** effective-date coverage for US-state rows.

Meaningful US-state corpus coverage: **0 / 51**.

## 5. Federal Court/Circuit Coverage

District → circuit mapping was checked for every registered district of each state against independent home-circuit GT.

Examples confirmed by the same mechanism: E.D. Pa. → 3; N.D. Cal. → 9; S.D.N.Y. → 2.

**Federal mapping: 100% of tested districts.**  
This is **not** federal authority completeness. The corpus does not contain mapped circuit or district opinions for those courts.

Other-circuit trap (foreign numbered circuit vs the state's home circuit): **persuasive, never controlling**. 0 CRITICAL.

## 6. Practice-Area Scope

Intended beta core: Contract, Employment, Civil, Criminal.

**None were certified.** All four remain UNVALIDATED in every state because the corpus cannot support state-law claims.

Family, tax, immigration, and bankruptcy were not tested and must not be implied.

## 7. Benchmark Design

Per state + DC (~10 tasks):

01 own high court controlling  
02 wrong-state high court out_of_jurisdiction (CRITICAL if controlling)  
03 same-state trial court persuasive  
04 all federal districts → expected home circuit  
05 other-circuit trap  
06 SCOTUS controlling  
07 temporal applicable / inapplicable / unknown  
08 unknown-jurisdiction abstention  
09 Research ranking home vs decoy  
10 corpus dimension (UNVALIDATED when empty)

Representative extras: PA forum + DE governing law + NJ related; Draft metadata; Agents flag.

Run: `npm run bench:6t` (inventory, then C1, no mid-run patches).

## 8. C1 Results

463 PASS / 51 NEEDS WORK / 0 FAIL / 0 CRITICAL.

The 51 NEEDS WORK results are the empty-corpus tasks (one per state/DC). Architecture tasks passed.

## 9. State-by-State Scorecard

| State | Overall | Routing | Hierarchy | Temporal | Abstention | Corpus auths | Contract | Employment | Civil | Criminal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AL | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| AK | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| AZ | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| AR | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| CA | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| CO | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| CT | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| DE | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| FL | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| GA | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| HI | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| ID | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| IL | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| IN | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| IA | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| KS | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| KY | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| LA | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| ME | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| MD | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| MA | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| MI | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| MN | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| MS | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| MO | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| MT | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| NE | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| NV | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| NH | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| NJ | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| NM | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| NY | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| NC | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| ND | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| OH | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| OK | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| OR | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| PA | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| RI | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| SC | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| SD | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| TN | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| TX | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| UT | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| VT | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| VA | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| WA | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| WV | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| WI | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| WY | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |
| DC | NEEDS_WORK | 100 | 100 | 100 | 100 | 0 | unvalidated | unvalidated | unvalidated | unvalidated |

Citation and retrieval precision/recall are **n/a**: C1 did not run live state-law synthesis against missing authorities.

## 10. Wrong-State Safety

Wrong-state high court labeled controlling: **0**.

Research ranking never placed the decoy above home-state high court as controlling.

## 11. Court Hierarchy

Own high court: controlling.  
Same-state trial: persuasive (not silently equal to the high court).  
Intermediate appellate remains conservative (persuasive), matching the 6S model limitation. That limitation is recorded, not "fixed" into a false statewide-binding rule.

## 12. Federal Circuit Safety

Home-circuit mapping: PASS for all 50 states + DC.  
Foreign circuit as controlling: **0**.

## 13. Temporal Safety

Where effective windows exist: expired → inapplicable; current → applicable; decision date only → UNKNOWN. Ranking prefers the applicable window.

Missing effective dates are not treated as current law.

## 14. Statutes

No mapped US-state statutes in the local corpus. Dimension **UNVALIDATED** for all states. Synthetic Jurisdiction Code records remain R1 fixtures, not state certification.

## 15. Regulations

No meaningful state regulatory corpus. **UNVALIDATED**. Not claimed as supported.

## 16. Case Law

No mapped US-state cases. **UNVALIDATED**. Hierarchy tests used registry court ids, not retrieved opinions.

## 17. Citation Validity

No live 50-state synthesis run, so C1 does not award citation-validity certification. R1 still governs synthetic Research. 6T does not lower that bar.

## 18. Proposition Grounding

Not certifiable without state-law sources that actually state the proposition. Not marked PASS.

## 19. Abstention

Unknown jurisdiction + statute-of-limitations question abstains in every state task. Empty corpus is reported as UNVALIDATED rather than a guessed nationwide rule.

## 20. Corpus Gaps

Largest gap: **there is no 50-state primary-law corpus** in this environment. Certification honestly stops at architecture routing.

Root cause **A** (corpus missing) for every state's research/statute/regulation/case-law dimensions.

## 21. Root Causes

| Code | Observed in C1 |
| --- | --- |
| A corpus missing | 51 NEEDS WORK corpus tasks |
| B metadata incomplete | Unmapped synthetic jurisdiction strings |
| C–L, N | No FAIL/CRITICAL in classifier, mapping, ranking, temporal, abstention, or flags |
| M benchmark/grader | Not implicated |

## 22. Production Changes

**None during C1.** After scoring, `jurisdiction_coverage` was populated with **204** rows (51 jurisdictions × 4 practice areas), all `unvalidated`, notes pointing at `2026-08-20` / 6T-C1. UI semantics were not changed.

## 23. C2

**Not applicable.** No general production defect was found that would justify a patch-and-rerun. Preserving C1 as-is.

## 24. Regressions

No 6S classifier/ranking/Ask/Draft/Agent architecture files were edited in 6T. Coverage table writes use the existing 6S schema. J1 remains the live Ask/Draft/Agent context gate from 6S closeout.

## 25. Coverage Matrix

| State | Contract | Employment | Civil | Criminal | Overall |
| --- | --- | --- | --- | --- | --- |
| AL | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| AK | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| AZ | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| AR | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| CA | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| CO | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| CT | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| DE | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| FL | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| GA | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| HI | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| ID | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| IL | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| IN | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| IA | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| KS | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| KY | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| LA | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| ME | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| MD | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| MA | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| MI | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| MN | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| MS | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| MO | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| MT | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| NE | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| NV | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| NH | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| NJ | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| NM | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| NY | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| NC | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| ND | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| OH | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| OK | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| OR | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| PA | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| RI | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| SC | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| SD | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| TN | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| TX | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| UT | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| VT | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| VA | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| WA | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| WV | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| WI | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| WY | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |
| DC | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED | UNVALIDATED |

Do not display this as "Pennsylvania Certified."

## 26. Beta Eligibility Matrix

| List | Jurisdictions |
| --- | --- |
| ELIGIBLE (practice-area Research) | _none_ |
| LIMITED | _none_ (no useful US-state corpus) |
| NOT YET VALIDATED | all 50 states + DC |

Federal district→circuit **routing** is validated everywhere. That does not make a state eligible for state-law Research beta.

## 27. Remaining Risks

1. Operators or marketing collapsing UNVALIDATED into nationwide support.  
2. Future corpus imports without normalized `authority_state` / `court_id` / effective dates.  
3. Intermediate appellate binding rules still not modeled (intentional).  
4. Live Ask/Draft/Research on real state statutes remains unproven because sources are absent.  
5. Lawyer dogfood is still required even after a future CERTIFIED label.

## 28. Controlled-Beta Jurisdiction Decision

**Do not open a nationwide state-law Research beta on this corpus.**

A controlled beta may still use 6S jurisdiction **metadata UX** and synthetic/federal R1 Research, with coverage shown as UNVALIDATED. It must not promise state-specific legal completeness.

## 29. Nationwide Claim Decision

**NO.** NyayaGrid cannot truthfully claim support for all 50 states.

## 30. Exactly One Next Phase

**PHASE 6U — JURISDICTION-AWARE FULL-SYSTEM REGRESSION / BETA GATE**

Do not start 6U automatically. 6U is useful after a real US-state corpus exists or if product wants to lock UX/Ask/Draft/Research boundaries on UNVALIDATED labels before any limited beta.

Do not deploy beta. Do not enable Agents.

---

## Explicit final questions

1. Were all 50 states evaluated? **Yes, plus DC.**  
2. How many states have meaningful corpus coverage? **0.**  
3. How many are internally validated for beta? **0.**  
4. How many are LIMITED? **0** (empty corpus is UNVALIDATED, not LIMITED).  
5. How many remain UNVALIDATED? **51** (50 states + DC) for Contract, Employment, Civil, and Criminal.  
6. Did any state produce wrong-state authority labeled controlling? **No.**  
7. Did any federal matter use the wrong circuit as controlling? **No.**  
8. Did any state produce a fabricated citation? **Not applicable — no live state-law synthesis.**  
9. Did any state produce a fabricated quote? **Not applicable.**  
10. Were temporal/effective-date traps handled safely? **Yes**, on metadata-backed helpers.  
11. Which states have statute coverage? **None in this local corpus.**  
12. Which have meaningful case-law coverage? **None.**  
13. Which have regulation coverage? **None.**  
14. Which states have poor metadata quality? **All US-state rows are absent; existing authorities are unmapped synthetic strings.**  
15. Which practice areas are actually validated? **None.**  
16. Is forum vs governing law preserved? **Yes** (PA forum / DE governing / NJ related representative).  
17. Are multi-jurisdiction cases handled safely? **Yes** in the representative task.  
18. Does unknown/insufficient coverage cause abstention rather than guessing? **Yes** for unknown jurisdiction; empty corpus is UNVALIDATED rather than a nationwide rule.  
19. Can NyayaGrid truthfully claim support for all 50 states? **NO.**  
20. Which states are eligible for the controlled beta? **None for state-law Research.**  
21. Which states must be blocked/limited? **All 50 + DC must stay UNVALIDATED in UI until a real corpus is certified.**  
22. What is the single largest jurisdiction risk remaining? **Absence of a normalized 50-state primary-law corpus, plus the temptation to treat 6S architecture as coverage.**  
23. Is lawyer validation still required? **YES.**
