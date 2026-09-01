# NYAYAGRID PHASE 5B COMPLETION REPORT

Final Case Q&A review before freeze. A.4 was not overwritten. Hidden ground truth and grader version `a1-2026-08-18` were not rewritten. T014 erratum: `ERRATUM_T014_CURRENT_NOTICE.md`.

Prompt remains `nyaya-matter-qa-v11`. No extra LLM calls. No V3 / Graph / Memory / Timeline / Agents work.

---

## 1. T010 Audit

All 16 V2 T010 items are the same structure: Mercer testimony “I never entered the records room” versus an access log `ACCESS GRANTED` for the assigned badge.

**Compatible:** 0. These are not approximate-vs-exact date pairs.

**Tension:** 16. Testimony and badge activity can both be true if someone else carried the badge. The difference is meaningful and must be flagged.

**Contradiction:** 0. The log does not prove physical entry by the named person, so the pair is not logically impossible.

**Ambiguous:** 0.

**Root cause:** A.4 date-precision compatibility ran on the full retrieved blob. Depositions also contain “near the middle of November” plus ISO dates, so T010 was classified `different_precision`. `constrainCitedAnswer` prepended “not a contradiction,” which made the grader treat the answer as missing tension (`assertsContradiction` short-circuits).

**Changes:** First-class `tension` when testimony denies entry and an activity log records `ACCESS GRANTED`, and the question is about that entry/conflict. Date-precision compatibility remains for T011-style questions only. Limitation language: the log does not conclusively prove who carried the badge.

Targeted gate: T010 **4/4 pass**. Isolated SYNTH-V2-001-T010 **3/3 pass**.

---

## 2. T014 Ground-Truth Audit

Question (all 16): whether an internal email’s “still says N days” is the current contractual requirement. No explicit as-of date.

**Current semantics (product):** undated “current” / “now” uses the actual date (eval date **2026-08-18**). Do not treat the newest signed amendment as automatically in force.

**Document facts (all 16 share the structure; numbers rotate):** original notice is the email’s recalled figure; Amendment 1 is effective **mid-September 2026** (after Aug 18); Amendment 2’s notice term is effective **2027-01-01**; the email is dated **November 2026**.

| Class | Count | Notes |
| --- | ---: | --- |
| Product defects | 1 pattern | A.4 often asserted Amendment 2’s **90-day convenience** term as the current *notice period*. That is fixed. Residual: if the original agreement chunk is not retrieved, a restatement can still be selected as the Aug 18 term. |
| Benchmark defects | **16** | Hidden GT says Amendment 1 already “controls” with the November T002 number. On 2026-08-18 Amendment 1 is not yet effective. |
| Ambiguous fixtures | 16 (same items) | “Current” could mean wall-clock or “as of the November email.” Product chooses wall-clock. The fixture never supplies an as-of date. |
| Grader defects | some A.4 passes | Needles fire if Amendment 1’s day-count appears anywhere, even when the asserted current term is wrong. |

Per-item A–G answers are in `ERRATUM_T014_CURRENT_NOTICE.md`. Short form: the question asks source hierarchy; no as-of date; “current” in product means 2026-08-18; operative term that day is the **original** notice; GT expects Amendment 1; those differ because GT imported November chronology into an undated question.

Nyaya should still say **no** to treating the email as the requirement, and may add: original term now; Amendment 1 changes it on its September effective date.

---

## 3. Benchmark Corrections

Were any made? **No.** Erratum only. Fixtures and graders unchanged. A.1–A.4 preserved. No retroactive rescore.

---

## 4. Final Critical Failure

**SYNTH-010-Q008 root cause:** Question “Did Pioneer actually issue or pay a service credit for August?” Assessment skipped (`ever`/`never` required). Generation treated invoice silence (“No service credits reflected on this invoice”) as proof that no credit was issued or paid.

**Fix:** Absence from a document is not proof of an actual-occurrence or universal proposition. `actually issue/pay` and `did … issue or pay` now take the same not-established path as `ever`/`never`. Constraint rewrites “did not issue or pay.”

**Regression test:** unit test plus `golden-invoice-silence-not-proof` still passing.

**Result:** Q008 **3/3 pass**, **0 critical**. Known critical silence class is closed on this fixture.

---

## 5. T006

**Failure taxonomy (A.4):** retrieval miss of the original cap (14/16 said original “not specified”); two full refuses. Assessment skipped because both figures were not in the retrieved set. Not unit/guardrail deletion. Needles are fine when both amounts are present.

**Product defects:** follow-up retrieval for “original … cap … Amendment” previously expanded to “amendment indemnity,” which crowded out the original agreement. Narrow expansion added toward the original aggregate cap. Amount pairing prefers dollars near liability/cap language.

**Benchmark/grader issues:** none demonstrated for T006.

**Changes:** retrieval expansion + cap-adjacent pairing only.

**Gate:** 2/4 pass on the four-scenario sample (001 and 010 pass; 002 and 006 miss original). Isolated 001: 1 pass / 2 refuse. Remaining misses are **retrieval variance**, not a second general extraction bug.

---

## 6. Regression Gates

Four-scenario sample after the T003 notice-window fix (runs `2026-08-18T20-16-29-867Z`, `20-18-10-619Z`, `20-19-31-429Z`, `20-20-52-714Z`):

| Gate | Result |
| --- | --- |
| T025 | **4/4 pass** |
| T020 | **0 critical** (2 pass / 2 NW thin corrective facts — same A.4 shape) |
| T002 | **4/4 pass** |
| T003 | **4/4 pass** |
| T011 | **3/4 pass**; 002 fail is grader brittleness (“rather than a contradiction” vs required “not a contradiction”) on an answer that correctly called the pair compatible |
| T021 | **4/4 pass** |
| T015 | **4/4 pass** |
| Infrastructure | **0** |
| Critical | **0** |

T010 **4/4 pass**. Q008 **3/3 pass**.

---

## 7. Reproducibility

| Item | Retrieval | Assessment | Generation |
| --- | --- | --- | --- |
| T010 (001 ×3) | Stable enough to flag log + testimony | Deterministic `tension` given those passages | 3/3 pass |
| T014 (001 ×3) | Informal email vs instruments varies | Duration as-of 2026-08-18 | 3/3 pass vs unchanged GT needles |
| T006 (001 ×3) | Original cap **not stable** | Fires only when both amounts retrieved | 1 pass / 2 insufficient |
| Q008 (×3) | Invoice silence stable | Deterministic not-established | 3/3 pass |

Assessment is deterministic on identical passages. Remaining T006 and occasional T014 noise is retrieval/generation variance, not assessor jitter.

---

## 8. Verification

| Check | Result |
| --- | --- |
| Format | prettier on changed AI files |
| Lint / typecheck (`ai`, `search`) | pass |
| Unit | **224/224** `@nyayagrid/ai` |
| `eval:ai` | **83/83** ai (was 82; added tension golden) + **27/27** intelligence |

---

## 9. A.5

**Was A.5 run?** No.

Product code changed (tension, silence-as-proof, notice-period extraction). T014 **fixtures did not**. A full 500 would not be a clean A.4→A.5 product-only comparison, would still grade T014 against known-wrong November “current” needles, and would not change the freeze decision. A.4 remains the last official 500.

---

## 10. Remaining Case Q&A Weaknesses

By severity:

1. **Low — T014 undated “current.”** Benchmark expects November Amendment 1. Product uses 2026-08-18. Residual selection error if the original notice chunk is missing. Not a silent-as-proof or false-citation class.
2. **Low — T006 two-value completeness.** Retrieval of the original cap is still variance-prone. Honest insufficient when the original is missing.
3. **Low — T011 grader wording.** “Rather than a contradiction” can fail `not_contradiction` even when the answer is compatible.
4. **Low — T020 thin corrective facts** (needs-work, not critical).
5. **Non-critical completeness** on other clusters (T013 citation, T017/T018 needles) unchanged in kind from A.4.

No remaining **critical** Case Q&A class on the known silence / actor-identity / false-premise / missing-exhibit set.

---

## 11. Freeze Decision

# FREEZE

Dedicated Case Q&A reliability work should stop.

Dangerous classes are controlled: T025 physical-entry overclaim, T020 false retroactivity (0 critical), T015 missing-exhibit abstention, T011 false contradiction (product), T002/T003 temporal notice, citation infrastructure, and the last critical silence case (Q008).

Remaining failures are predominantly non-critical, benchmark/as-of ambiguity (T014), minor numeric completeness (T006), and model/grader wording variance.

Engineering attention should move to Compare, Analysis, Timeline, Graph, Memory, Draft, Research, Agents, security/privacy, performance, and UX. No new product features. No V3. No further Case Q&A optimization phase.
