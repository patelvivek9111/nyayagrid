# NYAYAGRID BETA UX — REVIEW DISCOVERY (UX-REVIEW-1)

Surgical navigation/copy change so proposed intelligence is hard to miss. No AI reliability, approval semantics, or Graph/Analysis/Draft production logic was modified.

---

## 1. Previous UX

Review lived on the **secondary** Case work row with Draft, Research, and Analysis.

A lawyer could upload documents, open Timeline / Memory / Graph / Analysis / Ask Nyaya, and never see the Review queue. Case Home had a card titled **“Nyaya found N new items”**, which overclaimed extraction as discovery of facts.

---

## 2. Why Review discovery matters to the trust model

NyayaGrid’s trusted context is:

extraction → **suggested** → **human review** → confirmed → downstream use

If Review is buried, suggested items can be mistaken for case state simply because they appear on Timeline/Memory/Graph after a later approve, or because Home copy sounded like findings. Making Review primary does not auto-approve anything; it makes the human boundary visible.

---

## 3. Existing Review architecture

**A. Navigation (before):** `CASE_WORK_SURFACES` included `review`. Route: `/app/cases/{matterId}/review`.

**B. Objects that actually require human review (from code, not invented):**

| Queue | Status used | Review API | In Review page? |
| --- | --- | --- | --- |
| Timeline events | `proposed` | `timeline/{id}/review` | Yes |
| Facts | `proposed` | `facts/{id}/review` | Yes |
| People / entities | `proposed` (unmerged) | `entities/{id}/review` | Yes |
| Deadlines | `proposed` | `deadlines/{id}/review` | Yes |
| Memory | `proposed` | `memory/{id}/review` | Memory tab, not Review page |
| Graph edges | proposed list | `graph/edges/{id}/review` | Graph tab |
| Analysis items / findings / redlines | `proposed` | analysis review routes | Analysis / Evidence |
| Agent approvals | pending | agents (disabled in beta) | hidden when Agents off |

**C. Review page** loads `GET /api/v1/matters/{matterId}/intelligence/review`, which calls `getReviewQueueCounts` + `listProposedIntelligence`. GET only. Approve/reject are separate POSTs.

**D. Count source:** `getReviewQueueCounts` (`packages/intelligence/src/queries.ts`) counts rows with `status = "proposed"` scoped by `organizationId` **and** `matterId`. It does not count approved, edited-and-approved, rejected, or dismissed.

**E. Home** already received `reviewCounts` from `GET /api/v1/matters/{id}` (same counter).

**F. Permissions:** queue GET requires `matters.view`. Approve/reject require `timeline.manage` (minAccess edit). Staff and client guests can view, not confirm. Chrome now exposes `canReview` from those capabilities without changing authorization rules.

---

## 4. Pending-item definition

**Pending Review count** = sum of:

- `proposedEvents`
- `proposedFacts`
- `proposedEntities`
- `proposedDeadlines`

from `getReviewQueueCounts` for **this matter only**.

**Not included** (correctness > decorative badge): Memory, Graph, Analysis, contradiction findings. Those keep their own surfaces. Adding them would mix status vocabularies and expand scope.

Zero pending → no tab numeral; Home shows “Next action” instead of the amber queue card.

---

## 5. Navigation change

Primary Case tabs:

Home · Chats · Documents · **Review** · Timeline · Evidence · People · Graph · Memory · Work

Secondary row: Draft · Research · Analysis only.

Review is not listed twice. Work still has a Review button as a shortcut, not a second tab.

Tab badge: amber count when `pendingCount > 0`, from `GET .../chrome` (`review.pendingCount`). Count query failure degrades to 0 (tabs still load).

---

## 6. Home CTA / Documents

Home card when pending &gt; 0:

- Title: **“N suggestions waiting for review”** (not “Nyaya found”, not “verified facts”)
- Detail: stay suggested until confirm/reject
- Link: `/app/cases/{matterId}/review`
- Action: **Open Review** if `canReview`, else **View suggestions**

Documents: calm line after the file list. If pending &gt; 0, link with the same count. No modal, no auto-navigation, no block on using the Case.

---

## 7. Permission behavior

- Viewers still see Review (queue GET is view).
- Approve / Edit & approve / Reject / Merge / Run extraction are hidden when `canReview` is false.
- Copy does not promise an action the API would 403.
- Remaining P1: other Case screens (Timeline, Memory, Graph) still show Approve without a capability check.

---

## 8. Trust-language decisions

Used **suggested** / **waiting for review** / **confirm or reject**.

Did **not** change `VerifiedBadge` (would restyle Graph).

Did **not** say AI verified, legally verified, proven, or confirmed by Nyaya for unreviewed items.

Former Home title “Nyaya found N new items” is removed.

---

## 9. Tests

- `apps/web/src/lib/review-queue.test.ts` — sum excludes missing keys; no invented Graph/Memory/Analysis fields
- `apps/web/src/lib/review-discovery.test.ts` — primary Review, not duplicated on work row, Home CTA, matter-scoped chrome GET, Review queue GET-only, view-only Approve hidden, **Ask Agents gating unchanged**
- Existing `expensive-route-limits.test.ts` still covers Agents-off Ask

---

## 10. Manual walkthrough

Not run against a live beta cluster in this session. Expected from code:

1. Open Case → Review is a primary tab.
2. Upload synthetic file → 202 / processing copy → Documents line points to Review; no auto-jump.
3. After intelligence job, `getReviewQueueCounts` &gt; 0 → tab badge + Home card.
4. Open Review → GET only; items remain `proposed` until POST approve/reject.
5. Approve one / reject one → counts drop on next chrome/Home load (chrome does not live-poll; navigating away/back or reloading updates).
6. Zero pending → no badge; Home next-action panel.
7. Guest/`timeline.manage` missing → inspect sources, no Approve.

**Gap:** chrome count does not refresh every few seconds while staying on Home. Reloading or changing tabs refetches chrome.

---

## 11. Remaining P1 UX issues

- Memory / Graph / Analysis suggested items still not in the Review tab count
- Chrome count is not live-polled
- Timeline/Memory/Graph Approve still visible to viewers
- Case client still missing from header
- Document search, onboarding, tab simplification — out of scope

---

## 12. Controlled-beta assessment

| Question | Answer |
| --- | --- |
| Can a lawyer easily discover suggestions waiting? | **Yes** — primary Review tab, badge, Home card, Documents link |
| Is Review now primary in the Case workflow? | **Yes** |
| Can proposed output be mistaken for approved because of this change? | **No** — copy says suggested; badge is amber; opening Review does not confirm |
| Does opening Review change trust status? | **No** — queue GET only |
| Are counts matter-scoped? | **Yes** — `organizationId` + `matterId` + `status=proposed` |
| Zero pending? | No numeral; Home “Next action”; Documents still links to empty Review |
| Frozen AI reliability modified? | **No** |

**Exactly one next UX recommendation:** After Graph reliability (6O) lands, add **proposed Graph edges** (and only that) to the same pending count if they use the same `proposed` status — do not fold Analysis into Review yet.
