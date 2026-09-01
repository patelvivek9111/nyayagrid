# NYAYAGRID BETA UX — GRAPH REVIEW INTEGRATION (UX-REVIEW-2)

UI/Review-queue integration only. Graph extraction, prompts, provenance, statuses, `reviewGraphEdge`, `loadVerifiedGraphContext`, and `formatVerifiedGraphForPrompt` were not modified.

---

## 1. Previous Review count

UX-REVIEW-1 pending count was:

`proposedEvents + proposedFacts + proposedEntities + proposedDeadlines`

Proposed Graph edges were reviewable only on the Graph tab.

---

## 2. Graph review architecture (reused)

| Action | Existing API | Permission |
| --- | --- | --- |
| List proposed edges | `listGraph` / now also `listProposedIntelligence.graphEdges` | `matters.view` |
| Count | `getReviewQueueCounts` → `eq(graphEdges.status, "proposed")` + org + matter | view |
| Approve / edit_and_approve / reject | `POST .../graph/edges/{edgeId}/review` → `reviewGraphEdge` | `timeline.manage` + edit |
| Provenance | `graph_edge_sources` (document title, page, supporting text) | with the edge |

Manual creates remain `origin: "manual"`, `status: "proposed"` (G2). AI edges still cannot be approved without sources (existing `reviewGraphEdge` rule).

No parallel approval system.

---

## 3. New pending-count definition

`getReviewQueueCounts` now returns:

```
proposedEvents
proposedFacts
proposedEntities
proposedDeadlines
proposedGraphEdges
pendingCount  // sum of the five, Graph exactly once
```

Chrome uses `queues.pendingCount`. Home uses `totalPendingReviewCount(reviewCounts)` (prefers server `pendingCount`).

**Excluded:** approved, edited_and_approved, rejected. **Not counted:** Graph nodes, Memory, Analysis, findings, Agents.

---

## 4. Graph queue UX

Review page section **Suggested relationships**:

`fromName — relationship → toName`

Copy: “Confirm only if the cited source supports this relationship.”

Not labeled “Verified relationships.”

---

## 5. Provenance UX

AI edges with sources: document title, page if present, supporting text. No fabricated quotes. Chunk IDs are not the primary label.

Empty sources:

- manual → “Manually added relationship. No document support is stored.”
- AI → cannot confirm without provenance (matches backend).

---

## 6. Manual vs AI origin UX

- `origin === "manual"` → Manually added relationship
- else → Suggested by Nyaya

Not “Source-verified relationship.”

---

## 7. Permissions

Unchanged: view queue with `matters.view`; mutate with `timeline.manage`. Review UI still hides Approve / Edit & approve / Reject when `canReview` is false.

---

## 8. Home / Documents

Home sentence unchanged: “N suggestions waiting for review” — now includes Graph via the shared total.

Documents still uses chrome `reviewPendingCount`.

After Approve/Reject, Review `load()` refetches the queue and `refreshChrome()` updates the tab badge without a full reload.

---

## 9. Tests

- `packages/intelligence/src/review-queue-graph.contract.test.ts` — count query is proposed + matter/org scoped; list does not invent sources
- `apps/web/src/lib/review-queue.test.ts` — Graph-only and combined totals
- `apps/web/src/lib/graph-review-integration.test.ts` — Review UI, GET-only queue, refetch after action, view-only, Home CTA, Agents gating

Live DB approve→count-drop is covered by refetch-after-POST wiring, not a new integration harness (no client data).

---

## 10. Manual walkthrough

Not executed against a live cluster in this session. Expected from code:

1. Proposed Graph edge (`status=proposed`) increments `proposedGraphEdges` / `pendingCount`.
2. Home CTA and Review badge include it, including Graph-only pending.
3. Opening Review is GET — status unchanged.
4. Inspect sources or see unsourced-manual copy.
5. Approve/Reject POST existing Graph review route; `load()` + `refreshChrome()` drop the count.
6. View-only: no Approve/Reject.

---

## 11. Remaining Review integration gaps

- Memory proposed items
- Analysis items / findings
- Evidence Matrix
- Agent approvals
- Live polling while idle on Home

---

## 12. Controlled-beta assessment

| Question | Answer |
| --- | --- |
| Do proposed Graph edges appear in Review? | **Yes** |
| Does the Case badge count them? | **Yes** (`pendingCount`) |
| Are approved/rejected edges excluded? | **Yes** (`status = proposed` only) |
| Are counts matter-scoped? | **Yes** |
| Can Graph-only pending trigger Review discovery? | **Yes** |
| Can viewing Review auto-approve Graph? | **No** |
| Can manual unsourced edges masquerade as sourced evidence? | **No** |
| Were Graph reliability semantics modified? | **NO** |

**Exactly one next UX recommendation:** After Analysis reliability is frozen, add **proposed Analysis items** as a separate Review section with that product’s own status vocabulary — do not merge them into Graph/Timeline counts blindly.
