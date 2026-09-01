# NYAYAGRID BETA UX — ANALYSIS REVIEW INTEGRATION (UX-REVIEW-3)

UI / Review-queue integration only. Contract, deposition, evidence-matrix, compare, contradiction, Analysis prompts, trust boundaries, Analysis → Ask filtering, provenance generation, schemas (except a read-only list adapter), Graph, Timeline, Memory, Draft, Research, Agents, Case Q&A, security, performance, and frozen baselines were not modified.

No AI calls. No new Analysis inference. No auto-review.

---

## 1. Existing Analysis review architecture

Reviewable Analysis objects already had POST review endpoints on Analysis. This phase only **discovers** proposed rows from the primary Case Review tab.

| Object | List / generate surface | Review POST | Capability (unchanged) |
| --- | --- | --- | --- |
| Contract analysis **items** | Analysis → Contract | `POST .../analysis/contracts/{analysisId}/items/{itemId}/review` → `reviewAnalysisItem` | `documents.edit` + matter edit |
| Analysis **findings** (deposition, contradiction) | Analysis → Depositions | `POST .../analysis/findings/{findingId}/review` → `reviewFinding` | `documents.edit` |
| Contract **redlines** | Analysis → Contract | `POST .../analysis/redlines/{suggestionId}/review` → `reviewRedlineSuggestion` | `documents.edit` |

Parent jobs (`document_analyses`, `analysis_runs`) are informational. Opening Review is GET-only (`listProposedIntelligence` + `listProposedAnalysisForReview` + counts).

Intelligence / Graph review still uses `timeline.manage`. Analysis review still uses `documents.edit`. Chrome now exposes both: `canReview` and `canReviewAnalysis`.

---

## 2. Reviewable Analysis object types

**In Review (this phase):**

1. `document_analysis_items` — Contract Analysis clause/risk items.
2. `analysis_findings` — persisted findings from deposition and contradiction runs (and any future run that writes this table).
3. `redline_suggestions` — independent Accept / Reject lifecycle.

**Not in Review counts or queue:**

- Completed analysis jobs / parent runs.
- Evidence Matrix derived display rows (`getEvidenceIntelligence` already binds **reviewed** contradiction findings).
- Document Compare (`document_comparisons` / changes have no human review status).
- Discovery classification (`document_review_states` relevance/privilege) — different workflow, stays on Analysis.
- Graph edges (already in intelligence counts).
- Memory, Agents, Research.

---

## 3. Status vocabularies

| Type | Pending | Done (kept) | Done (removed from work) |
| --- | --- | --- | --- |
| Contract items | `proposed` | `reviewed` | `dismissed` |
| Findings | `proposed` | `reviewed` | `dismissed` |
| Redlines | `proposed` | `accepted` | `rejected` |
| Timeline / Graph | `proposed` | `approved` / `edited_and_approved` | `rejected` |

UI copy matches the product:

- Timeline / Graph: Confirm / Approve / Edit & approve / Reject
- Contract items & findings: **Mark reviewed** / **Dismiss**
- Redlines: **Accept** / **Reject**

---

## 4. Pending Analysis definition

An object counts as awaiting Analysis review only if:

1. It is independently reviewable (has an existing review POST).
2. Status is the pending value above (`proposed`).
3. `organizationId` and `matterId` match the open Case.

Reviewed, dismissed, accepted, and rejected rows are excluded.

---

## 5. Count architecture

`getReviewQueueCounts` now returns:

```
proposedEvents
proposedFacts
proposedEntities
proposedDeadlines
proposedGraphEdges
intelligencePendingCount   // sum of the five; Graph once; Analysis not folded in
analysis: {
  pendingContractItems
  pendingFindings
  pendingRedlines
  pendingCount             // sum of the three Analysis objects, each once
}
pendingCount               // intelligencePendingCount + analysis.pendingCount
```

Chrome badge and Home use `pendingCount` (one number). Internal fields stay distinguishable. Contradiction findings are `analysis_findings` and are counted **once** (not again as Compare or Evidence Matrix).

---

## 6. Review page grouping

Existing intelligence sections are unchanged (Timeline, Facts, People, Deadlines, Suggested relationships).

A separate block **Analysis waiting for review** groups:

- Contract (items + redlines)
- Deposition
- Contradictions (only if proposed findings exist)
- Discovery (only if `analysis_findings` with `runType = discovery` exist — none are generated today)

Timeline facts, Graph edges, and contract findings are not shown as one identical list.

---

## 7. Contract Analysis UX

Cards show title, category/attention, document title, original text, Nyaya explanation, and stored source excerpts (page / supporting text). Empty sources: **Source support unavailable**. Trust label before action: **Analysis finding awaiting review** / **Nyaya analysis**. Actions: Mark reviewed / Dismiss via the existing item review endpoint.

Redlines show current clause, proposed clause, and reason. Actions: Accept / Reject.

---

## 8. Deposition Analysis UX

Shows finding type, explanation, and source testimony from `analysis_finding_sources` (document title, page, excerpt, side when stored). Copy for tension/contradiction: possible inconsistency — **not** a false statement. No witness field is invented when the row does not store one.

---

## 9. Compare / Contradiction decision

**Compare:** no independent review lifecycle → **not counted**, not listed.

**Contradiction:** persisted as `analysis_findings` (`runType: contradiction`) with Mark reviewed / Dismiss → **counted once** in `pendingFindings` and listed under Contradictions.

---

## 10. Evidence Matrix double-count decision

**Do not count Evidence Matrix rows.** EM2 is a derived view. Production matrix code selects **reviewed** contradiction findings. Counting matrix cells would either double-count reviewed work or invent a second pending object. Proposed contradiction findings appear only as Analysis findings.

---

## 11. Provenance UX

Review cards reuse stored `documentTitle`, `page`, `supportingText`, `segmentRef`, clause text, and chunk-backed source rows. Missing support is labeled **Source support unavailable**. No fabricated quotes. Frozen Analysis provenance logic was not changed.

---

## 12. Permissions

| Action | Capability (existing backend) | Chrome flag |
| --- | --- | --- |
| View Review queue | `matters.view` | — |
| Approve Timeline / Graph | `timeline.manage` or `organization.manage` | `canReview` |
| Mark reviewed / Dismiss / Accept redline | `documents.edit` or `organization.manage` | `canReviewAnalysis` |

Backend authorization was not changed. View-only users can inspect Analysis cards; mutation controls are hidden when `canReviewAnalysis` is false. Timeline Approve is not used for Analysis.

---

## 13. Home / badge integration

Review tab badge = `pendingCount` (intelligence + Graph + Analysis, each object once).

Home CTA: **N items waiting for review** (covers suggestions and findings). Documents uses the same total (“N items are waiting on Review”) without splitting types.

Review header badges: case intelligence (Timeline/Facts/People/Deadlines), Graph relationships, Analysis findings.

---

## 14. Tests

- `packages/intelligence/src/review-queue-analysis.contract.test.ts`
- `apps/web/src/lib/analysis-review-integration.test.ts`
- Updated `review-queue.test.ts`, `review-discovery.test.ts`, `graph-review-integration.test.ts`

Coverage: pending contributes; reviewed/dismissed excluded; matter/org scope; Analysis-only badge; separate section; Graph/Timeline fields unchanged; no EM/Compare double count; GET does not mutate; existing review endpoints; refetch; view-only; provenance from stored data; Agents-off gating unchanged.

---

## 15. Manual walkthrough (synthetic only)

1. Open a synthetic Case.
2. Run Contract Analysis from Analysis (not from Review).
3. Confirm a proposed item exists.
4. Return Home — Review badge includes it; CTA says items waiting for review.
5. Open Review — **Analysis waiting for review** / Contract.
6. Inspect original text and source.
7. Mark reviewed — count decreases (load + refreshChrome).
8. Produce another proposed item; Dismiss — count decreases.
9. Analysis-only Case: badge still appears.
10. Zero pending: no badge.
11. View-only user: no Mark reviewed / Dismiss.

Do not use client data.

---

## 16. Remaining Review gaps

- Discovery document classification (relevance/privilege) is not in this queue.
- Memory, Agent approvals, and Research are still on their own surfaces.
- Review still includes “Run extraction” for Timeline intelligence (pre-existing); it does not generate Analysis.

---

## 17. Controlled-beta assessment

**Ready for controlled beta as Review discovery for Analysis.** Lawyers can find proposed Contract items, deposition/contradiction findings, and redlines from the primary Review tab without changing frozen Analysis reliability.

---

## 18. Exactly one next UX recommendation

Make **Nyaya Memory proposed entries** discoverable from the same Review hub as a **third distinct section** (not mixed with Timeline, Graph, or Analysis), reusing Memory’s existing review vocabulary and endpoints only.

---

## Explicit answers

1. **Which Analysis types now enter Review?** Proposed `document_analysis_items`, proposed `analysis_findings`, proposed `redline_suggestions`.
2. **What status makes each pending?** `proposed` for all three (redlines leave pending on `accepted` / `rejected`).
3. **Are reviewed/dismissed items excluded?** Yes (`reviewed` / `dismissed`; redlines `accepted` / `rejected`).
4. **Are counts matter/org scoped?** Yes.
5. **Can Analysis-only pending trigger Review discovery?** Yes (`pendingCount` includes Analysis).
6. **Is Analysis visually separate from Timeline/Graph?** Yes.
7. **Are existing review semantics preserved?** Yes (Mark reviewed / Dismiss / Accept / Reject vs Approve / Reject).
8. **Can opening Review mutate Analysis?** No (GET list only).
9. **Can derived Evidence Matrix representations be double-counted?** No (not counted).
10. **Is provenance shown without fabrication?** Yes; missing support is stated.
11. **Were frozen Analysis reliability semantics modified?** **NO.**
