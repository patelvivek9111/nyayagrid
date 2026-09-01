# NYAYAGRID PHASE 6E — TIMELINE BASELINE

Synthetic-fixture evaluation only. This is **not** attorney review.

Production Timeline was **not** tuned. Case Q&A (`nyaya-matter-qa-v11`), Compare B.2, and Contradiction B.2 remain frozen. V1/V2 PDFs and hidden ground truth were not modified. Graph, Memory, Draft, Research, and Agents were not changed.

Official T1 run: `benchmarks/nyaya-bench/reports/runs/2026-08-19T01-26-13-290Z`  
Companion files: `BASELINE_T1_TIMELINE.md`, `BASELINE_T1_TIMELINE.json`

---

## 1. Production Timeline Architecture

Verified from current code.

```text
document ingest (processingState = ready)
→ extractMatterIntelligenceForReadyDocuments
→ extractMatterIntelligenceForDocument
→ parseMatterIntelligenceExtraction (matter-intelligence-extract-v2)
→ resolveValidatedSources
→ findDuplicateTimelineEvent
→ persist timeline_events status=proposed
→ reviewTimelineEvent → approved | edited_and_approved | rejected
→ listTimelineEvents
→ loadVerifiedMatterIntelligence (approved + edited_and_approved only)
→ formatVerifiedIntelligenceForPrompt
→ Ask Nyaya / Draft / agents / graph materialization
```

| Concern | Production location | Current behavior |
| --- | --- | --- |
| Extraction entrypoint | `packages/intelligence/src/extract.ts` `extractMatterIntelligenceForDocument` | Per document version, idempotent on completed `documentIntelligenceRuns`. Prompt version `matter-intelligence-extract-v2`. |
| Event schema | `packages/ai/src/intelligence.ts` `timelineProposalSchema`; DB `timeline_events` | `title`, `eventType`, `eventDate`, `eventDateEnd`, `datePrecision`, `actors[]`, `sourceChunkIds` (required), `sourceQuotes`, `confidence`, `uncertaintyNotes`. |
| Source schema | `timeline_event_sources` | `documentId`, `documentVersionId`, `chunkId`, `page`, `segmentRef`, `supportingText`. Chunks must belong to the same org/matter. |
| datePrecision | enum `exact \| approximate \| month \| year \| range \| unknown` | Stored. Prompt field list **omits** `datePrecision`. Parser defaults omitted values to `unknown`. |
| Actors | JSON `actors` | Model-proposed strings. Approval does not require actor proof. |
| Status | `proposed \| approved \| edited_and_approved \| rejected` | Extraction always writes `proposed`. |
| Dedupe | `packages/intelligence/src/dedupe.ts` | Same `eventType` + same calendar day + Jaccard ≥ 0.4 on title/description + actor overlap. Uncertain matches kept separate. **`rejected` rows are skipped.** Existing-events query in extract also loads only proposed/approved/edited. |
| Review | `reviewTimelineEvent` | Approve / edit-and-approve **refuses** if no source row. Edits may change title, dates, precision, actors. |
| Rejection | same | Sets rejected metadata. Rejected events are excluded from default `listTimelineEvents` (default = approved only). |
| Edited-and-approved | same | Status `edited_and_approved`; included in verified loaders. |
| How verified events enter Q&A | `packages/search/src/nyaya.ts` → `loadVerifiedMatterIntelligence` + `formatVerifiedIntelligenceForPrompt` | Approved only. Case Q&A prompt was not changed in this phase. |
| How verified events enter Draft | `packages/intelligence/src/draft/index.ts` | Same verified loader. Approved only. |
| How agents read Timeline | `packages/agents/src/tools/index.ts` `getVerifiedTimeline` | Same verified loader. Approved only. |
| Graph | `materializeVerifiedGraph` | Approved timeline events only. |

T1 lists `proposed + approved + edited_and_approved` so unreviewed extraction is visible to the grader. That is correct for an extraction baseline.

---

## 2. Previous Benchmark Gap

Phase 6A found Timeline had **no independent structured NYAYA-BENCH score**.

Full-system mode invoked Timeline, serialized the event blob, and ran the **chat needle grader** on that JSON. T025 was tagged `timeline` but is a Case Q&A abstention trap. That inflated or distorted Timeline as if it were Q&A.

T1 replaces that with:

- production extraction
- persisted proposed events
- canonical structured artifact
- hidden GT loaded **after** answer persistence
- event/date/actor/source checks, not chat needles

---

## 3. Structured Timeline Grader

Grader version: `t1-2026-08-19` (`grade-timeline-structured.ts`).

Canonical shape (production fields only):

```json
{
  "taskId": "...",
  "events": [
    {
      "eventId": "...",
      "eventType": "...",
      "title": "...",
      "description": null,
      "date": "2026-10-31",
      "dateEnd": null,
      "datePrecision": "unknown",
      "actors": [],
      "sourceDocumentIds": [],
      "sourceChunkIds": [],
      "sources": [{ "documentId": "...", "documentVersionId": "...", "filename": "...", "chunkId": "...", "supportingText": "..." }],
      "status": "proposed",
      "uncertaintyNotes": null
    }
  ]
}
```

Independent scores (not one compressed number):

1. Event recall
2. Event precision (same-day extras vs matches)
3. Date correctness (match requires ISO day)
4. DatePrecision correctness (`exact` or `range` for ISO GT)
5. Actor correctness (automated badge→person physical-act detector)
6. Event type (used in matching text; not a hard T012 enum)
7. Source/provenance (chunk present; supporting filename vs task docs)
8. Duplicate rate
9. Unsupported-event count
10. Approved-only leak (extraction must not auto-approve)

T025 / non-dated GT → `expectationType: not_applicable`. Extra matter-wide events (lease start, amendments, meetings) do **not** auto-fail T012.

---

## 4. V1/V2 GT Reuse

### DIRECTLY USABLE

| Set | Why |
| --- | --- |
| V2 **T012** × 16 | `expectation_type: timeline`. Explicit dated chain: invoice issued, due date, remittance transmitted, receipt/late-payment email. Supporting doc `07_Invoice_and_Remittance.pdf`. Amounts vary by scenario. |

### DERIVABLE (used as weak signals, not required keys)

Source document, actor, event type, relative order from T012 rows and from other extracted events (amendment effective dates, meeting date).

### NOT VALID TIMELINE EXTRACTION GT

| Set | Why |
| --- | --- |
| V2 **T025** × 16 | Category `timeline`, but `must_abstain` badge-carrier / physical-entry Q&A trap. |
| V1 timeline-tagged tasks (e.g. SYNTH-001-Q005 “When did the HVAC meeting occur?” → `June 28, 2026`) | Chat Q&A, not extraction keys. |

T1 scored **only T012**. T025 was executed because it is tagged `timeline`, then graded `not_applicable`.

V2 is sufficient for a **narrow** extraction baseline: can the engine recover an explicit four-date payment chain, with sources, without auto-approving?

It is **not** sufficient for approximate-date traps, reject/reproposal, or dedicated unsupported-actor keys. Those gaps are listed in §13. No V3 was created.

---

## 5. Hidden GT Isolation

Unchanged runner contract:

1. `executeTask` produces Timeline output from PDFs + production extract.
2. `persistAnswer` writes the canonical artifact.
3. `assertAnswerPersisted` then `loadGroundTruth`.

The grader never sees GT during extraction. Chat needles are not applied to serialized JSON for `executionTarget === "timeline"`.

---

## 6. Baseline T1

**Production Timeline was unchanged.**

| Field | Value |
| --- | ---: |
| Tagged timeline tasks | 32 |
| Scored T012 | 16 |
| T025 not applicable | 16 |
| Events expected | 64 |
| Events produced | 256 |
| Events matched | 48 |
| Pass | **0/16** |
| Needs work | **16/16** |
| Fail | 0 |
| Infrastructure | 0 |
| Critical (automated) | **0** |
| Event recall (task-complete) | **0/16** |
| Event recall (event-level) | **48/64 = 0.75** |
| Mean event precision | 0.86 |
| Date accuracy (task-complete) | 0 |
| Date accuracy of matched events | 1.0 (match requires the ISO day) |
| datePrecision accuracy | **0** |
| Actor accuracy (automated detector) | 1.0 |
| Unsupported-event count | 0 |
| Duplicate count (automated same-day extras) | 16 |
| Provenance failures (no chunk on a match) | 0 |

Every scored T012 task: recovered due / remittance / receipt; **missed invoice issuance `2026-10-01`**.

All 256 persisted events: `status=proposed`, `datePrecision=unknown`, exactly one source chunk.

The run-level `counts.pass = 16` is T025 `not_applicable`. Do not read that as T012 pass.

Official artifacts: `BASELINE_T1_TIMELINE.md` / `.json`.

---

## 7. Failure Taxonomy

Automated taxonomy on scored tasks: **16/16 `TIMELINE_EVENT_EXTRACTION`**.

| Class | T1 evidence |
| --- | --- |
| retrieval/source visibility | Invoice date is in the same chunk that sourced the due-date event. Not a retrieval miss. |
| event extraction | **Primary T1 cluster.** Invoice issuance never became its own event (16/16). |
| invented event | Extra events are mostly real other-document facts (lease start, amendments, meeting). Not scored as T012 failures. |
| date extraction | 48/64 expected dates recovered. The missing date exists in source text attached to a sibling event. |
| date precision | **Systemic.** 256/256 `unknown` despite ISO `eventDate`. Prompt does not ask for `datePrecision`. |
| actor extraction | Automated physical-entry detector: 0. Manual: badge-exit events list the assigned person as actor (see §8, §11). |
| event type | Free-form strings (`payment`, `access_granted`, `Lease Start`). T012 does not require a closed enum. |
| dedupe | Conservative. Four scenarios look “duplicative” in the grader because **other real events share 2026-11-05** with the late-payment email (benchmark defect, §13). |
| source mapping | Every event had a matter-scoped chunk id. Supporting text is often the **first 400 characters of the chunk**, not a quote span (203/256 start with the synth header). |
| rejected-event re-proposal | **Not exercised** by T1. Code still skips `rejected` in dedupe and in the extract existing-events query. |
| formatter/trust-boundary | Not hit in T1 output (nothing auto-approved). Still broken in `formatVerifiedIntelligenceForPrompt` if a human later approves. |
| benchmark defect | Same-day non-duplicates counted in precision/duplicate metrics. T025 correctly excluded. |
| infrastructure | One ingest warning: OpenAI timed out at 30s on SYNTH-V2-004; execute retried. No task marked infrastructure. |

---

## 8. Critical Failures

Automated critical bar (invented material event, wrong exact date as certain, wrong actor on an important event, rejected event in verified context, fabricated source, approved event with no source, approximate converted to exact downstream): **0 tasks**.

### Why automated critical is 0

- Extraction did not auto-approve. Verified context was empty for these matters.
- Matched payment events had sources.
- No T012 event claimed a wrong ISO day as `exact` because **nothing was labeled `exact`**.
- The badge→physical-entry detector requires both system language and “entered” language in title/description/actors. Typical titles were “Badge Assignment…” / “Exit from Records Room”, not “Jordan physically entered…”.

### Latent / manual critical risks (not in the automated score)

These would matter after a careless approve:

1. **Formatter converts unknown/approximate into ISO timestamps.** `formatVerifiedIntelligenceForPrompt` emits `eventDate.toISOString()` and drops `datePrecision` and `uncertaintyNotes`. An approved mid-November recollection would look like a certain timestamp. Case Q&A is frozen; this is still a Timeline formatter defect.
2. **Badge-exit actor attachment (16/16 scenarios).** Access log supports “badge assigned to Jordan recorded ACCESS GRANTED / EXIT SENSOR.” Several events list `actors: [Jordan …]` on “Exit from Records Room”. That is stronger than the log.
3. **Title inversion (4 scenarios: 006, 007, 014, 015).** Title `Records Room Entry` / type `entry` (015: type `absence`) with description “Jordan did **not** enter…”. Downstream formatting leads with title and type.
4. **Exact calendar date inferred from a duration.** Example: “Lease Termination Option” dated `2029-03-04` from a 36-month term. If the source does not state that calendar day, this is approximate evidence presented as a dated event (precision still `unknown`, so the field does not claim exactness, but the date value is exact).

None of these entered verified Q&A/Draft/agent context in T1.

---

## 9. Date Precision Audit

| Check | Result |
| --- | --- |
| Schema supports EXACT / APPROXIMATE / MONTH / RANGE / UNKNOWN | Yes |
| Prompt asks for `datePrecision` on timeline items | **No.** Field list is `{title, eventType, sourceChunkIds, description?, eventDate?, actors?, sourceQuotes?, confidence?}`. |
| T1 values | **256/256 `unknown`**, including ISO-dated invoice due / remittance / meeting dates |
| Deterministic backfill if ISO present | **No** |
| Verified prompt formatting | Drops precision. Example of current shape: `` `${eventDate.toISOString()} \| ${eventType} \| ${title} \| actors=...` `` |
| Approximate → exact conversion in T1 extraction | Dates are ISO when the model emitted them, but labeled `unknown`, not `exact`. The dangerous conversion is **downstream formatting after approval**, not the T1 proposed rows by themselves. |

T012 GT is all exact ISO days, so the grader required `exact` or `range` on matches. That check is `false` for every scored task. The reported taxonomy remains event extraction because recall < 1 is evaluated first.

V2 has no dedicated approximate-date Timeline GT (deposition “near mid-November” vs minutes `2026-11-10` is Contradiction T011, not Timeline).

---

## 10. Provenance Audit

### What held in T1

- `resolveValidatedSources` dropped proposals with zero authorized chunks.
- `reviewTimelineEvent` still refuses approve without a source row (not exercised by T1).
- All 256 events had exactly **one** `sourceChunkId`.
- T012 matches cited `07_Invoice_and_Remittance.pdf`.
- No fabricated document ids observed.

### `normalizeSourceChunkIds`

In `packages/ai/src/intelligence.ts`: if the model omits valid UUIDs, the parser returns **all `availableChunkIds` for that document**. Existing test `parses rescued payloads through Zod` **expects** facts without chunk ids to receive `CHUNK_A`.

That was **not** the T1 failure mode (every event already had one UUID). It remains dangerous: a model that forgets ids can attach the entire document as provenance. Preferred fix (not implemented): resolve from quote overlap / known chunk refs; otherwise mark mapping incomplete; never attach every chunk.

### Whole-chunk supporting text

If `sourceQuotes` is missing, `resolveValidatedSources` uses `chunk.content.slice(0, 400)`. **203/256** T1 supporting texts start with the synth header. Approval then “has a source” even when the quote window is the document banner, not the event sentence. Invoice PDFs are short enough that the invoice date still appears in that window — which is how we know the 2026-10-01 miss is extraction, not missing text.

---

## 11. Rejection / Deduplication Audit

### Dedupe (current)

- Same type + same day + Jaccard ≥ 0.4 + actor overlap → merge sources onto the existing row.
- Different events on the same day are **not** merged if type/title differ. T1 confirms this: on SYNTH-V2-004, 2026-11-05 kept payment notification, review meeting, badge assignment, and exit as separate events.
- Same title, different actors: actor overlap required if the candidate lists actors; empty actors count as overlap. Can over-merge.
- Approximate vs exact corroboration: both must share a calendar day key. Unknown-day vs dated events do not merge.

Do not aggressively merge. Current rule is conservative on type/day, loose on empty actors.

### Rejection memory

`findDuplicateTimelineEvent` **skips `rejected`**. Extract’s existing-events query **omits `rejected`**. Therefore:

> extract → reject → re-run extract on unchanged evidence → the identical event can reappear as a fresh `proposed` row.

Valid reason to re-propose: **source text changed** (new version, new document). That should be keyed to document version / content hash, not “always allow”.

T1 did **not** add a failing product test or implement suppression. A workflow regression test still belongs in the next Timeline reliability phase.

One ingest timeout (30s default AI timeout) on SYNTH-V2-004 was swallowed by ingest and retried on execute. Partial-run retry can create extra proposals if a run dies after insert and is not `completed`; T1 producedCount stayed ~15–16/matter, so this did not dominate.

---

## 12. Timeline → Q&A / Draft / Agents Trust Boundary

| Consumer | Reads | Trust |
| --- | --- | --- |
| Ask Nyaya | `loadVerifiedMatterIntelligence` | Approved / edited_and_approved only. Proposed T1 events **did not** enter Q&A. |
| Draft | same verified loader | Approved only. Not modified. |
| Agents `getVerifiedTimeline` | same | Approved only. Not modified. |
| Graph materialization | approved timeline events | Verified intel only. Not modified. |
| T1 benchmark list | proposed + approved + edited | Correct for extraction scoring. |

**Separation of proposed vs verified is intact** at the loader.

**The remaining trust hole is the formatter**, not the status filter: once a human approves, precision and uncertainty are stripped. Case Q&A itself was not changed. Do not patch Q&A prompts to compensate.

Draft/agents inherit that formatter (or raw ISO dates on the row). Documented; not patched.

---

## 13. Benchmark / GT Defects

1. **Same-day extras ≠ duplicates.** On T012 scenarios where the review/badge day is `2026-11-05` (004, 008, 012, 016), the grader’s same-day precision/duplicate counters include meeting and access events. Those are distinct events. Automated `duplicateCount = 16` overstates production duplicates.
2. **Task-complete recall vs event-level recall.** Summary `eventRecall: 0` means no task recovered all four dates. Event-level recall is 0.75. Both must be reported.
3. **T025 is not extraction GT.** Correctly `not_applicable`.
4. **Actor detector is narrow.** It missed title-inversion and badge-exit-as-person. Expanding it after T1 would change scores; left frozen for this baseline.
5. **No GT for rejection, approximate precision labels, or “do not invent 36-month end dates.”** A later small V3 could cover those. Not created here.
6. **Event type is not a closed production enum.** T012 matching uses date + keywords, not type equality.

---

## 14. Recommended Product Fixes

**DO NOT IMPLEMENT IN THIS PHASE.**

Preference order:

1. **Deterministic date/provenance logic**
   - If `eventDate` is a full ISO day and source text is not approximate (`around`, `mid-`, `on or about`), set `datePrecision=exact`.
   - If source is approximate, do not invent an ISO day; keep `approximate` / `month` / `unknown` and omit or qualify `eventDate`.
   - Split multiple ISO dates in one invoice chunk into separate events (invoice date vs due date vs remittance date) in deterministic code, not by hoping the model lists all four.
2. **Source mapping**
   - Stop `normalizeSourceChunkIds` from returning every available chunk.
   - Prefer quote-overlap resolution; otherwise mark incomplete and drop the proposal (already the empty-source path).
   - Stop using first-400-chars as `supportingText` when the model omitted quotes; require an overlapping span or drop.
3. **Dedupe / rejection workflow**
   - Rejection memory: identical eventType+day+normalized title (or content hash) from unchanged document versions must not re-enter as `proposed`.
   - Allow re-proposal when `documentVersionId` changes.
   - Add the extract → reject → re-extract regression test.
4. **Structured extraction changes** only if (1)–(3) still miss invoice issuance.
5. **Prompt changes last** — add `datePrecision` and “one ISO date per event” to the timeline field list. Do not use Case Q&A wording hacks.

**Formatter (Timeline, not Q&A):** `formatVerifiedIntelligenceForPrompt` must retain precision and uncertainty, e.g. `Approximately mid-November 2026 — meeting occurred` instead of an ISO timestamp for `approximate` / `unknown`.

---

## 15. Beta Assessment

| Question | Answer |
| --- | --- |
| Is Timeline safe enough for controlled beta? | **Proposed-queue review: yes, with constraints. Verified Timeline in Ask Nyaya/Draft/agents: not until the formatter preserves precision.** |
| What blocks beta? | (1) Verified-context formatter drops `datePrecision`. (2) Rejection does not suppress re-proposal. (3) `normalizeSourceChunkIds` all-chunk fallback remains. (4) Invoice-chain completeness is 75% event-level; reviewers will see incomplete payment stories. |
| Are proposed events adequately separated from verified? | **Yes.** T1: 256/256 `proposed`. Q&A/Draft/agents/graph load approved only. |
| Is date precision preserved? | **No.** Storage always `unknown` in T1; formatter would still drop it after approval. |
| Is actor grounding acceptable? | **Mixed.** Badge assignment titles are often correctly limited. Exit events and some titles over-attach Jordan. Automated detector did not fail these. |
| Is provenance acceptable? | **Chunk identity: yes. Quote span: weak** (chunk prefix). Approval-without-source remains blocked. |
| Do we need a small targeted Timeline dataset later? | **Yes, later — not now.** V2 T012 is enough for this narrow baseline. A later small V3 should cover approximate dates, reject/reproposal, unsupported actors, and conflicting dates. |

Controlled beta of the **review queue** is reasonable if reviewers treat every row as unverified and the product does not auto-approve. Shipping verified Timeline into conversational/draft context is **not** beta-ready until formatter + precision are fixed.

---

## 16. Next Action

**Exactly one next step:**

> Phase 6F — Timeline reliability after T1: implement deterministic `datePrecision` (ISO → exact unless approximate language) **and** preserve precision/uncertainty in `formatVerifiedIntelligenceForPrompt`. Do not tune Case Q&A, Compare, Contradiction, Memory, Graph, Draft, Research, or Agents. Do not build V3 yet.

Do not start it in this phase.
