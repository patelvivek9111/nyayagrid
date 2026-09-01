# Benchmark erratum: T014 “current contractual requirement”

Status: documented, **fixtures and graders not rewritten**.

A.1–A.4 baselines are preserved and must not be recalculated against this erratum.

A future A.5+ run that adopts a corrected T014 expectation must be labeled **benchmark version changed**. This Phase 5B product run does **not** adopt that change.

---

## Defect class

`BENCHMARK_DEFECT` (primary), with `GRADER_DEFECT` (needle weakness) on some A.4 passes.

Not a reason to make Nyaya treat a September-effective amendment as already current on 2026-08-18.

---

## Scope

All 16 V2 tasks `SYNTH-V2-001-T014` … `SYNTH-V2-016-T014`.

Question form (no explicit as-of date):

> An internal email says the contract “still says N days.” Should that be treated as the current contractual requirement?

Hidden ground truth form:

> No. The email is expressly a recollection and is corrected; Amendment 1 controls and requires {T002 November term} days.

---

## Documented facts (SYNTH-V2-001; the other 15 rotate the same structure)

| Item | Value |
| --- | --- |
| Eval / product “now” | 2026-08-18 |
| Original agreement notice | 45 days (`formal notice requires 45 days`) |
| Amendment 1 | Effective **2026-09-11**; notice becomes 30 days |
| Amendment 2 | Signed 2026-10-06; effective **2027-01-01**; notice becomes 45 days |
| Internal email | Dated **2026-11-10**; “I think the contract still says 45 days” |
| Email correction | 2026-11-11; “Amendment 1 changed the current notice period to 30 days” |
| T002 (as of November 2026) | 30 days — correct |
| T003 (January 2, 2027) | 45 days — correct |
| T014 expected | Amendment 1 / 30 days as “current” — **not correct as of 2026-08-18** |

Amendment 1 effective dates on inspected siblings are also mid-September 2026 (e.g. V2-002: 2026-09-12; V2-008: 2026-09-18), all after 2026-08-18.

---

## Per-failure questions (applies to every T014)

### A. What does the question ask?

Whether the **email’s recalled day-count** should be treated as the **current contractual requirement**. It is a source-hierarchy question, not “quote Amendment 1.”

### B. Is an explicit as-of date supplied?

No.

### C. What does “current” reasonably mean?

NyayaGrid product semantics: actual/current date (here 2026-08-18). Do not select a future-effective amendment because it is newer. A useful answer states the in-force term **and** later-effective signed changes.

The email itself is dated November 2026. In *that* documentary window Amendment 1 is in force. The fixture never says “as of the email” or “as of November 2026.”

### D. What term is legally operative on 2026-08-18?

The original agreement notice period (45 / 60 / 30 days rotating with the scenario). Amendment 1 is signed-but-not-yet-effective.

### E. What does hidden ground truth expect?

That Amendment 1 already “controls” with the November T002 number.

### F. Are those different?

Yes.

### G. Why?

Ground truth imported November 2026 matter chronology into an undated “current” question evaluated on 2026-08-18.

---

## Original vs corrected expected behavior

**Original expected answer:** No; Amendment 1 currently controls (T002 number).

**Corrected expected behavior (product semantics, fixtures not changed):**

- No: the email is informal recollection and does not control.
- As of 2026-08-18, the original notice period remains in force.
- A signed Amendment 1 changes the notice period to the T002 number effective mid-September 2026.
- Amendment 2’s later notice term is not yet effective.

Supporting passages: main agreement §4; Amendment 1 “Effective 2026-09-xx … Formal notice now requires …”; email chain dated 2026-11-10/11.

---

## Grader note

Needles are distinctive tokens from the canonical string (including the Amendment 1 day-count). An answer can **pass** while asserting a wrong current term (e.g. 90-day convenience termination) if it also mentions Amendment 1’s number. That is needle weakness, not product truth.

---

## Versioning

- Hidden ground truth files: **unchanged** (`ground_truth_version` implicit 1.0 / existing V2 files).
- Grader version: **unchanged** (`a1-2026-08-18`).
- A.1–A.4: **not** restated against this erratum.
