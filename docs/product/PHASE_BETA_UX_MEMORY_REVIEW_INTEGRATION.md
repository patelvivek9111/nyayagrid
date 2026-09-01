# NYAYAGRID BETA UX — NYAYA MEMORY REVIEW INTEGRATION (UX-REVIEW-4)

UI / Review-queue integration only. Memory extraction, trust eligibility, prompts, provenance generation, status transitions, downstream loaders, Ask, Draft, Graph, Timeline, Analysis, Research, Agents, security, performance, and frozen baselines were not modified.

No AI calls. No automatic Memory generation. No automatic approval.

---

## 1. Existing Memory review architecture

Verified from production code (`packages/database/src/schema/index.ts`, `packages/intelligence/src/memory/index.ts`, `trust.ts`, `present.ts`, `apps/web/.../memory`).

| Item | Production |
| --- | --- |
| Table | `matter_memories` |
| Statuses | `proposed`, `approved`, `edited_and_approved`, `rejected`, `archived`, `superseded` |
| Origins | `ai`, `manual` only (`intelligence_origin`). There is no stored `agent` origin. |
| Active rows | `approved` or `edited_and_approved` **and** `supersededBy` is null |
| Downstream eligible | `isDownstreamEligibleMemory`: verified status **and** not superseded. `retrieveActiveMatterMemories` loads ACTIVE statuses then filters. Proposed / rejected / superseded never enter that loader. |
| List | `GET .../memory` → `listMatterMemories` (optional status filter). Proposed listed as `badge: suggested`. |
| Review POST | `POST .../memory/{memoryId}/review` → `reviewMatterMemory` |
| Actions | `approve`, `edit_and_approve`, `reject`, `archive` |
| Supersede | Separate `POST .../memory` with `oldMemoryId` → creates a **new** row (`status: approved` today) and marks the old row `superseded`. Not a Review-queue action. |
| Provenance | `sourceReference.chunkIds` resolved to document title, page, excerpt via `listMatterMemories`. Manual rows often have empty chunk lists. |
| Permission | **`timeline.manage`** + matter edit (same as Timeline/Graph review, not `documents.edit`) |

STORAGE != VERIFICATION remains in `resolveMemoryCreateStatus`: omitted status defaults to `proposed` regardless of origin or `memoryType`.

---

## 2. Pending Memory definition

Pending for Review when:

- `status = proposed`
- `organizationId` and `matterId` match the open Case
- `supersededBy` is null

**Not counted:** `approved`, `edited_and_approved`, `rejected`, `archived`, `superseded`, rows with a successor, Timeline/Facts already in intelligence counts.

---

## 3. Memory origins

Production values: **`manual`** and **`ai`**.

Review copy:

- `manual` → **Manually added — awaiting review**
- `ai` with stored sources → **Suggested by Nyaya** plus **Derived from Case sources**
- `ai` without sources → **Suggested by Nyaya** (no derived-from-sources claim)

No invented `agent-generated` category. Agent proposals still persist as `origin: ai` if they go through the existing create path.

---

## 4. Memory types

Schema types include `verified_context`, `strategic_note`, `entity_resolution`, `document_significance`, `factual_caveat`, `user_instruction`, `matter_preference`, `procedural_context`, `other`.

**Display-only:** proposed `verified_context` is labeled **Proposed context**, never “Verified context” / “Confirmed fact”. Status remains `proposed`. Frozen `memoryType` values were not changed.

---

## 5. Provenance

Review reuses `listMatterMemories({ status: "proposed" })` sources (document title, page, excerpt). Empty sources:

- manual → **Manually added. No document source attached.**
- otherwise → **No document source attached.**

No fabricated chunks. No generic “Source” badge hiding emptiness.

**Edit & approve provenance:** existing `reviewMatterMemory` can rewrite title/content/embedding; it does not attach new chunks. Documented, not redesigned.

---

## 6. Manual-memory trust UX

Manual create still defaults to proposed (M2). Review states **Manually added — awaiting review**. Approving is an explicit POST. Copy does not imply “I entered it, therefore Nyaya verified it.”

---

## 7. Review actions

Reuse `POST .../memory/{id}/review`:

- Approve
- Edit & approve (title + content)
- Reject

**Not on Review:** Generate / Extract Memory; supersede (creates a new Memory, stays on the Memory page); archive (historical, not the primary pending path).

Opening Review is GET-only.

---

## 8. Count architecture

```
intelligencePendingCount = events + facts + entities + deadlines + graphEdges
analysis.pendingCount = contract items + findings + redlines
memory.pendingCount = proposedMemories
pendingCount = intelligence + analysis + memory
```

Chrome, Home, Documents, and Review all use server `pendingCount`. Graph stays inside intelligence (prior UX decision). Memory is added once.

---

## 9. Review-page grouping

1. Case intelligence (Timeline, Facts, People, Deadlines)
2. Suggested relationships (Graph)
3. **Nyaya Memory**
4. Analysis waiting for review

Rows are not a single generic fact list.

---

## 10. Permissions

Memory mutations require **`timeline.manage`** (existing endpoint). Chrome `canReview` already maps to that (or `organization.manage`). View-only users inspect Memory; Approve / Edit & approve / Reject are hidden. Backend unchanged. Analysis still uses `canReviewAnalysis` / `documents.edit`.

---

## 11. Home / Documents integration

Home CTA remains **“N items waiting for review.”** Documents still uses the shared badge total. No “3 Memory items” message on Documents.

---

## 12. Downstream trust regression (read-only)

Frozen functions were not edited. Contract tests confirm:

- `isDownstreamEligibleMemory({ status: "proposed" })` remains false (existing `trust.test.ts`)
- `retrieveActiveMatterMemories` still filters `ACTIVE` + `supersededBy` null
- Review GET does not call `reviewMatterMemory` / `createMatterMemory` / `proposeMatterMemories`

This UX change cannot put proposed Memory into trusted prompt context.

---

## 13. Tests

- `packages/intelligence/src/review-queue-memory.contract.test.ts`
- `apps/web/src/lib/memory-review-integration.test.ts`
- Updated `review-queue.test.ts`, Analysis count-formula tests

Coverage: pending increment; approved/edited-and-approved/rejected/superseded excluded; org/matter scope; Memory-only badge; visual separation; origin; unsourced honesty; GET no mutation; approve/reject/edit-and-approve refetch; view-only; intelligence/Graph/Analysis fields unchanged; no double count; downstream exclusion; Agents-off gating.

---

## 14. Manual walkthrough (synthetic only)

1. Open a synthetic Case.
2. On Memory, add a manual note or run the existing propose path — row is proposed.
3. Home Review badge increases; copy still “items waiting for review.”
4. Open Review → **Nyaya Memory**.
5. Origin readable (manual vs Nyaya).
6. Inspect sources or the unsourced message.
7. Approve → count drops (`load` + `refreshChrome`).
8. Create another proposed Memory → Reject → count drops.
9. Manual unsourced Memory: no invented document support.
10. Memory-only Case: badge still appears.
11. View-only user: no Approve/Reject.
12. Downstream: proposed/rejected still excluded (`retrieveActiveMatterMemories` / Ask). Use existing Memory page + Ask on synthetic data.

Do not use client data.

---

## 15. Remaining Review gaps

Review now covers Timeline / Facts / People / Deadlines, Graph, Memory, and Analysis.

**Intentionally not in Review:** Agent approvals, Research, Evidence Matrix derived rows, Compare, generic tasks, Discovery classification.

Per stop rule: do not expand Review further.

---

## 16. Controlled-beta assessment

**Ready as Review discovery for Nyaya Memory.** Lawyers can find proposed Memory from the primary Review tab with origin and provenance honesty. Frozen Memory M2 semantics were not reopened.

---

## 17. Exactly one next UX recommendation

**Onboarding into the first Case.** The professional audit still shows `/app/onboarding` creates a firm and does **not** continue into creating or opening a Case. With Review now covering the main human-review surfaces, the highest remaining beta drop-off is lawyers who never reach a Case (and therefore never reach Review, Documents, or Ask-with-files). Do not start that work in this phase.

---

## Explicit answers

1. **Do proposed Memory entries now enter Review?** Yes.
2. **What makes a Memory entry pending?** `status = proposed`, this org + matter, `supersededBy` null.
3. **Are approved/rejected/superseded excluded?** Yes (also archived and edited-and-approved).
4. **Are counts matter/org scoped?** Yes.
5. **Can Memory-only pending trigger Review discovery?** Yes.
6. **Can a lawyer tell manual from Nyaya-derived?** Yes (`manual` vs `ai` copy).
7. **Can unsourced Memory masquerade as document-supported?** No.
8. **Does opening Review mutate Memory?** No.
9. **Are existing Memory review semantics preserved?** Yes (Approve / Edit & approve / Reject on the existing endpoint).
10. **Can proposed Memory enter trusted downstream context because of this UX change?** **NO.**
11. **Were frozen Memory reliability semantics modified?** **NO.**
