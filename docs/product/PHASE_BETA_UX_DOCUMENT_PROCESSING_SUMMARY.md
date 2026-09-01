# NYAYAGRID BETA UX — CASE DOCUMENT PROCESSING SUMMARY (UX-DOCS-4)

Status visibility only. Existing processing states, ingest, Inngest, upload API, search/filter, Review, Ask, and frozen reliability systems were not modified.

No AI calls. No percentages, ETAs, new statuses, or legal-completeness claims.

---

## 1. Existing Processing Architecture

Document `processingState` lives on `documents` (same enum as ingest). UX-DOCS-1 already maps those values to **Ready / Processing / Needs attention** for list filters (`processingStatesForFilter` in `apps/web/src/lib/document-list.ts`).

Row labels (`processingLabel`) stay on each document. This phase adds Case-wide counts of those same groups.

---

## 2. Status Grouping

Same helper buckets as filters (verified against the schema enum):

| UI group | Stored states |
| --- | --- |
| Ready | `ready` |
| Processing | `uploaded`, `awaiting_malware_scan`, `unscanned_development`, `scan_clean`, `extracting_text`, `chunking`, `embedding`, `indexed` |
| Needs attention | `scan_blocked`, `quarantined`, `malware_scan_failed`, `extraction_failed`, `failed`, `requires_ocr` |

`tallyDocumentProcessing` uses `documentMatchesStatusFilter` so summary grouping cannot diverge from the filter.

`requires_ocr` is **Needs attention**, matching UX-DOCS-1 (not Processing).

---

## 3. Count Query

`GET /api/v1/matters/{matterId}/documents` now also returns `processingSummary`.

```
SELECT processing_state, count(*)
FROM documents
WHERE matter_id = :matterId AND organization_id = :organizationId
GROUP BY processing_state
```

Then `tallyDocumentProcessing`. **No `q` / `status` / cursor** on this aggregate.

List `total` remains the **filtered** match count. `processingSummary.total` is the **Case** document count.

Auth: same as list (`documents.view` + matter read).

---

## 4. Case-Level Summary Design

Under the Documents heading, when `processingSummary.total > 0`:

- **N Ready** · **N Processing** · **N Need attention** (buttons)
- If every file is Ready: calm **All N documents ready**
- Page copy: Ready = pipeline finished, **not** legal completeness

Zero documents: summary hidden; existing empty upload state remains.

No dashboard, no “% complete”, no ETA.

---

## 5. Search / Filter Interaction

**Option A (chosen):** summary is always **Case-wide**, even if `q=invoice`. Caption: “all documents in this Case, not limited to this search.”

Click a chip → existing URL `status=ready|processing|attention` via `replaceFindParams`. **`q` and `sort` are kept.** Clicking the active chip clears status only.

List then shows that group (combined with search). **Clear search** still resets query + filters + sort.

---

## 6. Multi-Upload Interaction

Local Waiting / Uploading rows are **not** counted. Only server `documents` rows after **202**. List refresh (`applyListPayload`) updates `processingSummary` from the GET body.

---

## 7. Refresh / Polling Decision

Reused the existing **2.5s** Documents poll.

**Change:** poll while `processingSummary.processing > 0` **or** a loaded row is in-flight (including insight extraction on Ready files). Previously, a Ready-only filter could hide processing rows and stop polling.

Overlapping GETs are skipped (`requestOpen`). Interval stops when processing is 0 and no in-flight loaded rows; cleared on unmount. `q` / `status` / `sort` preserved.

---

## 8. Pagination Correctness

Summary is a grouped `count(*)` for the matter, not `page.items.length`. Load more does not change the meaning of the totals (values only change if server state changed).

---

## 9. Permissions / Isolation

Same `documents.view` list endpoint. Matter + org in the aggregate WHERE. View-only users see the summary; they still cannot upload.

---

## 10. Accessibility / Responsive

Chips are labeled buttons (`N documents ready/processing/need attention`), `aria-pressed` when the filter is on. Text, not color-only. Wrap with `flex-wrap`.

---

## 11. Performance

One extra `GROUP BY processing_state` per list GET, using existing `documents_matter_idx` / `documents_organization_idx`. Fine for tens–low hundreds of Case documents. No new indexes.

---

## 12. Tests

Tally: 65/30/5 on 100 synthetic states; first-50 ≠ Case total; groups match filters; empty zeros.

Source: grouped query unscoped by `q`; chips call `replaceFindParams`; hide at 0; no GET ingest/AI; Review/Agents/onboarding/search unchanged; no % / ETA / “Case analysis complete”.

---

## 13. Synthetic Dogfood

| Case | Check |
| --- | --- |
| A 3 Ready / 2 Processing | Summary 3 / 2 / 0 |
| B mixed 25 | Counts + chip filters |
| C 100: 65 / 30 / 5 | Case totals ≠ first 50; Load more independent |
| D `q=invoice` then Processing | Query kept; list = search ∩ processing |
| E 202 uploads | Summary from server after refresh |
| F all ready | Calm “All N documents ready” |
| G zero docs | Empty upload state, no 0·0·0 |
| H view-only | Summary visible, no picker |

---

## 14. Remaining Documents UX Gaps

- Compare dropdown still only loaded ready files
- No folders/tags/resumable upload/bulk delete (intentional)
- Documents stop here unless a blocker appears

---

## 15. Controlled-Beta Assessment

After adding many files, a lawyer can see how much of the Case is Ready vs Processing vs Needs attention, and click through using the existing filters.

**Stop expanding Documents.**

---

## 16. Exactly One Next UX Recommendation

**Case context / header + jurisdiction UX** — a clean Case-level place for State/jurisdiction, court, federal vs state, practice area, governing/choice of law, and as-of date (needed for upcoming Nyaya Jurisdiction). Do not start that in this phase.

---

## Explicit questions

1. Can a lawyer see how many Case documents are Ready? **Yes.**  
2. Processing? **Yes.**  
3. Need attention? **Yes.**  
4. Entire Case? **Yes.**  
5. Independent of pagination? **Yes.**  
6. Matter-scoped? **Yes.**  
7. Organization-scoped? **Yes.**  
8. Click reuses existing status filters? **Yes** (`status=ready|processing|attention`).  
9. Active `q` kept? **Yes.**  
10. Waiting/Uploading excluded until 202? **Yes.**  
11. Summary refresh after 202? **Yes** (existing list refresh).  
12. Fake percentage? **No.**  
13. ETA? **No.**  
14. Does Ready mean legal analysis complete? **No.**  
15. Ingest semantics modified? **No.**  
16. AI / Review / reliability modified? **No.**  
17. Largest remaining UX friction? **Case header / jurisdiction context for Nyaya.**  
