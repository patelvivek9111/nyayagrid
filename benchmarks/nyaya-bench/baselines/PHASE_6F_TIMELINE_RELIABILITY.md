# NYAYAGRID PHASE 6F — TIMELINE RELIABILITY REPORT

Synthetic-fixture evaluation only. This is **not** attorney review.

T1 remains frozen (`BASELINE_T1_TIMELINE.md` / `.json`). Case Q&A, Compare, Contradiction, Graph, Memory, Draft, Research, Agents, V1/V2 PDFs, and hidden GT were not modified. No V3 dataset was created.

Official T2 run: `benchmarks/nyaya-bench/reports/runs/2026-08-19T02-15-53-117Z`  
Companion files: `BASELINE_T2_TIMELINE.md`, `BASELINE_T2_TIMELINE.json`

---

## 1. T1 Root Causes

T1 scored 0/16 T012 with 48/64 event-level recall. The failures were systematic, not random:

1. **datePrecision never left `unknown`.** The extraction prompt omitted the field. The parser defaulted omitted values. 256/256 events were `unknown` even when the source stated `2026-10-01`.
2. **Invoice issuance was collapsed.** One invoice chunk contains issue date, due date, remittance, and receipt. The model emitted due/remittance/receipt and skipped issuance in 16/16 scenarios.
3. **Verified-context formatting discarded uncertainty.** `formatVerifiedIntelligenceForPrompt` rendered `eventDate.toISOString()` and dropped `datePrecision` / `uncertaintyNotes`, so an approved approximate date would look exact downstream.
4. **`normalizeSourceChunkIds` attached every chunk** when the model omitted IDs, making unsourced proposals look fully provenanced.
5. **`supportingText` fell back to `chunk.content.slice(0, 400)`**, so 203/256 spans started with the synthetic header.
6. **Actor/title bugs were latent.** Badge activity could be phrased as a named person's physical act. Denial testimony could be titled as a positive entry.
7. **Rejection did not persist as memory.** Extract → reject → re-extract on unchanged evidence could re-propose the same event. T1 did not measure this; the defect was in the extract path.
8. **Duration math could be stored as an exact source date.** A 36-month term could become a fabricated calendar day.

Provenance identity (chunk UUID in-matter) was already intact. Auto-approval did not occur. The proposed/verified loader boundary was intact.

---

## 2. Timeline Changes

All changes stayed inside Timeline extraction, normalization, provenance, review, and verified-intelligence **formatting**.

| Area | Change |
| --- | --- |
| Prompt | `matter-intelligence-extract-v3` requests `datePrecision`, one event per dated proposition, badge ≠ person, denial titles, no duration-calculated source dates. |
| Parser | Deterministic `inferTimelineDate` validates/corrects model precision. Approximate language is never upgraded to exact. Claimed ISO is preferred when a window contains several dates. |
| Multi-event | `extractDatedEventPropositionsFromChunks` splits legally distinct dated propositions (invoice issued / due / remittance / receipt; signed vs effective). Amendment-from-X-to-Y-effective sentences are not split. |
| Merge | Deterministic events merge with model events conservatively (`eventType|date`). Existing Jaccard dedupe was **not** broadened. |
| Provenance | `normalizeSourceChunkIds`: exact UUID → quote overlap → nearby UUID in text → else `[]`. Empty sources drop the proposal. |
| Supporting text | `findSupportingSpan` uses validated quote, then date window, then keyword overlap. Header-only prefixes are refused. Approval requires a non-empty supporting span. |
| Actors / titles | Badge/system activity clears named physical actors. Denial evidence cannot keep a positive-entry title. |
| Duration | Calculated expirations that are not source-stated calendar days are dropped. |
| Rejection memory | Same document version + similar proposition + same day is not re-proposed. A new version may re-propose. |
| Formatter | `formatVerifiedTimelineEventLine` preserves exact / approximate / month / year / range / unknown. |

---

## 3. Date Precision

Previous:

- Prompt did not ask for `datePrecision`.
- Parser stored `unknown`.
- T1: 256/256 `unknown`. DatePrecision accuracy **0**.

New:

- Schema contract includes `datePrecision`.
- Deterministic inference from source text:
  - full explicit date → `exact`
  - around / near mid / on or about / approximately → `approximate` (never upgraded)
  - month-only → `month`
  - year-only → `year`
  - between X and Y → `range`
  - no supported date → `unknown`; no invented ISO for schema convenience
- Claimed date is kept when the source window contains multiple exact days.

T2 histogram (445 produced events): `exact` 407, `approximate` 38, other 0. Matched T012 payment dates were `exact`. DatePrecision accuracy **1.0**.

Tests:

- `packages/ai/src/timeline-date-precision.test.ts` — exact, approximate, month, year, range, unknown, claimed-ISO preference, formatter labels, duration detection
- `packages/ai/src/intelligence.test.ts` — approximate source is not upgraded when the model claims `exact`

---

## 4. Multi-Event Extraction

Invoice issue recovery:

- T1 missed issuance in **16/16**.
- T2 recovered issuance in **16/16**, plus due, remittance, and receipt/late-payment.
- Implementation uses general cues (`invoice date`, `due date`, `transmitted on` / remittance, `email dated` / received / late-payment). No T012 IDs or benchmark amounts are hard-coded.

Other:

- Signed vs effective dates may both emit.
- “Section amended from 30 to 60 days effective …” does not create extra date fragments.
- Dual extractor (deterministic + model) often stores a second same-day row with a different `eventType` (`invoice` vs `invoice_issued`). Left unmerged per conservative-dedupe instruction.

---

## 5. Source Provenance

all-chunk fallback:

- T1: omitted IDs → every available chunk.
- T2: omitted IDs with no quote overlap → proposal dropped. **0/445** events attached more than one chunk. **445/445** have exactly one chunk.

quote resolution:

- Quote overlap can recover a single chunk when IDs are omitted.
- Nearby UUID mentioned in quote/title/description can recover a known chunk.

supportingText:

- T1: 203/256 began with the synthetic header prefix.
- T2: **0/445** synth-header prefixes. Meaningful source-span coverage **445/445**.
- Approval now refuses empty supporting text.

---

## 6. Actor Grounding

Rule carried forward: credential/system activity ≠ named person's physical act.

- Badge ACCESS GRANTED titles rewrite to `Badge assigned to {name} recorded access`.
- `actors` are cleared for those events.
- Automated actor overclaim: T1 0, T2 0.
- Manual T1 issue “badge exit lists assigned person as actor”: T2 `actorsOnBadge` = 0.
- Residual wording: some rows remain titled `Badge Exit from Records Room` without naming a person. That is weaker copy, not a physical-actor assertion.

Tests: `timeline-normalize.test.ts` actor grounding.

---

## 7. Title / Description Consistency

Rule: title/eventType must not assert the opposite of description/source. Denial is not a positive entry.

- T1 manual: Records Room Entry titles with negating descriptions on SYNTH-V2-006/007/014/015.
- T2: title/description contradiction count **0**. Those scenarios did not persist a positive-entry title over denial text.
- Rewrite example: `Testimony denying records-room entry`.

Tests: negative testimony in `timeline-normalize.test.ts`.

---

## 8. Rejection Memory

Keyed to evidence identity: overlapping `documentVersionId`, similar title/description, same calendar day.

- Unchanged evidence → identical rejected event is not re-proposed.
- New document version → re-proposal allowed.

T2 live run did **not** execute reject → re-extract (unmeasured in the 16-task suite). Unit test covers the matcher.

---

## 9. Verified Context Formatting

`formatVerifiedIntelligenceForPrompt` now uses `formatVerifiedTimelineEventLine`. It does not dump `toISOString()` for events and does not drop `datePrecision` / `uncertaintyNotes`.

Examples:

- **exact:** `2026-11-10 — Review meeting`
- **approximate:** `Approximately mid-November 2026 — Review meeting`
- **month:** `November 2026 — Review meeting`
- **range:** `Between November 10 and November 15, 2026 — Review meeting`
- **unknown:** `Date unknown — Review meeting`

If precision is `unknown`, a stored ISO is **not** shown as an exact day. Case Q&A / Draft / Agents were not otherwise changed; they inherit this Timeline formatting when they load verified intelligence.

---

## 10. Verification

| Check | Result |
| --- | --- |
| Format | Source changes are TypeScript/tests/docs; no Prettier failures observed in the Timeline packages during this phase. |
| Lint | `tsc --noEmit` for `@nyayagrid/ai` and `@nyayagrid/intelligence` |
| Typecheck | Pass (`@nyayagrid/ai`, `@nyayagrid/intelligence`) |
| Unit | `@nyayagrid/ai` 251 passed; `@nyayagrid/intelligence` 61 passed; `@nyayagrid/nyaya-bench` 73 passed |
| evals | `@nyayagrid/ai` 88 mock evals passed (Case Q&A / contradiction frozen fixtures). `@nyayagrid/intelligence` 31 contract-compare evals passed. No Timeline eval suite exists; T2 is the Timeline measurement. |

---

## 11. Targeted Gate

Before full T2:

| Scenario | T012 | Notes |
| --- | --- | --- |
| SYNTH-V2-001 | 4/4 pass | Invoice issued/due/remittance/receipt present; payment dates `exact`; all `proposed`; one chunk each; 0 synth-header spans; badge access rewritten, actors empty |
| SYNTH-V2-006 | 4/4 pass | Same invoice chain; no positive-entry/denial title inversion; badge actors empty |

No auto-approval. Source mapping specific. Gate passed; full 16-scenario T2 followed. V3 was not created.

---

## 12. Baseline T2

Official run: `2026-08-19T02-15-53-117Z` (~18 minutes). Grader `t1-2026-08-19` unchanged.

| Metric | T1 | T2 |
|---|---:|---:|
| Pass | 0/16 | **16/16** |
| Needs Work | 16 | **0** |
| Fail | 0 | 0 |
| Critical | 0 | 0 |
| Events expected | 64 | 64 |
| Events matched | 48 | **64** |
| Event-level recall | 75% | **100%** |
| Task-complete recall | 0/16 | **16/16** |
| Date accuracy | matched dates correct; chain incomplete | **1.0** task-complete |
| datePrecision accuracy | 0 | **1.0** |
| Actor accuracy | 1.0 automated | **1.0** automated |
| Unsupported events | 0 | 0 |
| Provenance failures | 0 | 0 |
| Rejected-event reproposal | unmeasured | unit-tested; live unmeasured |
| Meaningful source-span coverage | 53/256 non-header (approx.) | **445/445** |
| all-chunk fallback count | parser attached all chunks on omit | **0** |
| Title/description contradiction count | 4 scenarios (manual) | **0** |

Mean event precision **0.86 → 0.45** because T2 produces extra same-day rows (deterministic + model). That is over-production, not missed GT. T012 still passed because recall, precision-on-matched-events, and provenance checks succeeded.

Ingest warning: OpenAI timed out once on SYNTH-V2-015; timeline extract still recovered 4/4.

---

## 13. Remaining Timeline Failures

No scored T012 failures. Remaining issues, grouped by root cause:

1. **Dual extraction over-production.** Model and deterministic split often both persist on the same day with different `eventType`s. Conservative dedupe does not merge them. Grader `duplicateCount` = 86 (includes genuine same-day meeting/badge events on 004/008/012/016, as in T1).
2. **Copy quality on system events.** `Badge Exit from Records Room` is not a physical-actor claim, but it is still a weak title.
3. **Denial testimony is often not extracted at all.** Safer than a positive-entry title; the denial proposition itself may be missing from the proposed queue.
4. **Rejection memory unmeasured live.** Unit matcher only.
5. **Ingest LLM timeout.** One scenario hit the 30s OpenAI timeout during ingest extract; retry on the timeline target recovered T012. Fragility remains.
6. **Approximate-vs-exact traps are not T012 GT.** T2 produced 38 `approximate` events elsewhere in the matter. No V3 scored those labels.

---

## 14. Critical Failures

None.

Automated critical (actor overclaim, auto-approval, missing provenance on a matched event, infrastructure): **0**.

---

## 15. Beta Assessment

| # | Question | Answer |
| --- | --- | --- |
| 1 | Is proposed Timeline safe for beta? | **Yes, for a human review queue.** 16/16 payment chains recovered, all rows `proposed`, sources are specific, supporting spans are real, no auto-approval. Reviewers must still treat rows as unverified work product and expect extra same-day duplicates. |
| 2 | Is approved Timeline safe to feed Ask Nyaya? | **Conditionally yes, better than T1.** The formatter now preserves precision and uncertainty. Safety still depends on humans not approving extras, weak titles, or duration-derived leftovers. Proposed events still do not enter Ask Nyaya. |
| 3 | Is approved Timeline safe to feed Draft? | **Same as Ask Nyaya.** Draft reads the same verified loader and formatter. Do not auto-approve. Generated drafts remain drafts until explicit approval (unchanged product rule). |
| 4 | Is date precision preserved? | **Yes**, in storage for T2 payment dates (`exact`) and in verified formatting (exact / approximate / month / range / unknown). Approximate language is not upgraded. |
| 5 | Is actor grounding acceptable? | **Yes for beta review.** Automated overclaim 0; badge actors cleared. Residual risk is wording, not naming a person as the physical actor. |
| 6 | Is provenance sufficiently specific? | **Yes.** 445/445 single-chunk; 0 all-chunk fallback; 0 header-prefix quotes. |
| 7 | Are rejected events suppressed correctly? | **In unit tests, yes. Live T2 did not measure it.** Do not call this live-proven. |
| 8 | What remains the largest Timeline risk? | **Over-production of proposed events** (model + deterministic pairs on the same day), which can clutter review and, if rubber-stamped, pollute verified context. Secondary: live rejection-memory unproven; ingest timeout. |

---

## 16. Next Recommendation

Timeline is stable enough to leave frozen as T2.

**Exactly one next step:**

> Phase 6G — Memory Reliability.

Do not start it in this phase. Do not reopen Case Q&A, Compare, Contradiction, Graph, Draft, Research, or Agents. Do not create V3. Do not overwrite T1 or T2.

STOP.
