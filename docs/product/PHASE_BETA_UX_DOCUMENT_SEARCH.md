# NYAYAGRID BETA UX — CASE DOCUMENT SEARCH / FILTER (UX-DOCS-1)

List findability only. Ingest, parsing, chunking, embeddings, retrieval, Ask, Timeline, Memory, Graph, Analysis, Draft, Research, Agents, Review, permissions semantics, storage, and frozen reliability systems were not modified.

No AI calls. No content / vector / OCR search. No multi-file upload, folders, tags, or classification.

---

## 1. Existing Documents Architecture

Verified from production code (not assumed from older specs).

| Item | Production |
| --- | --- |
| UI | `/app/cases/[matterId]/documents` — `apps/web/src/app/app/cases/[matterId]/documents/page.tsx` |
| List API | `GET /api/v1/matters/[matterId]/documents` |
| Upload API | `POST` same route (unchanged: one file, 202 + `enqueueDocumentIngest`) |
| Open | `openMatterDocument` → `GET .../documents/[documentId]/download` → `signMatterDocumentDownload` (`documents.view`) |
| Permission (list) | `requireMatterAccess` minAccess `read` + `documents.view` |
| Permission (upload) | minAccess `edit` + `documents.upload` |
| Query | `documents` where `matterId` **and** `organizationId` |
| Pagination | Cursor, `limit` 1–100 (UI sends **50**). Default API limit remains 20 if omitted. |
| Order (default) | `createdAt DESC`, `id DESC` |
| Deleted / archived | No `deletedAt` / archive flag on `documents`. Listed rows are live rows. |
| Previous UX gap | UI fetched **without cursor**, so only the first page was reachable. |

---

## 2. Available Metadata

From `packages/database` `documents` + `document_versions`:

| Field | Stored? | Used for findability |
| --- | --- | --- |
| `documents.title` | Yes (set to `file.name` on upload) | Yes (ILIKE) |
| `document_versions.originalFilename` | Yes | Yes (exists + ILIKE) |
| `processingState` | Yes | Filter groups only |
| `malwareScanStatus` | Yes | Not a separate filter |
| `processingError` | Yes | Display only |
| `createdAt` | Yes | Default / oldest sort |
| `createdByUserId` | Yes | Not shown (no extra metadata in search) |
| MIME / `contentType` | On version | Not filtered (unreliable as “document type”) |
| Version number | Yes | Response field; not a filter |
| Legal category (Pleading, Discovery, …) | **No** | Not invented |

Processing documents and failed / OCR-required documents remain in the list and in name search.

---

## 3. Search Design

Search means: **find a document in this Case by name**.

- Control: labeled **Search by document name**
- Matching: case-insensitive substring on `title` **or** any version `originalFilename`
- Whitespace trimmed/collapsed; max length **100**
- LIKE wildcards in user input (`%`, `_`, `\`) are escaped (literal, not regex)
- Examples: `amend` → Amendment 1.pdf; `INVOICE` → Invoice March.pdf

Not implemented: full-text of contents, embeddings, Ask, authorities, OCR search.

---

## 4. Client vs Server Search Decision

**Server-side.** The list is cursor-paginated. Client-only filtering of the loaded page would miss later pages.

`GET` accepts `q`, `status`, `sort` **and** applies them in SQL **before** the cursor page. `total` is `count(*)` with the same org/matter/q/status predicates and **no** cursor.

---

## 5. Filters

Lawyer-readable groups (existing friendly labels on the row; filter uses stored `processingState`):

| Filter | Stored states |
| --- | --- |
| All | no extra predicate |
| Ready | `ready` |
| Processing | `uploaded`, `awaiting_malware_scan`, `unscanned_development`, `scan_clean`, `extracting_text`, `chunking`, `embedding`, `indexed` |
| Needs attention | `scan_blocked`, `quarantined`, `malware_scan_failed`, `extraction_failed`, `failed`, `requires_ocr` |

No upload-date picker. No invented legal types.

---

## 6. Sorting

Default **Newest** (previous product order). Also: Oldest, Name A–Z, Name Z–A. Cursors encode `createdAt+id` or `title+id` accordingly.

---

## 7. Pagination

**Load more** using `nextCursor`. Limit 50 per request. Search/filter reset the cursor so results are a complete filtered set, paged.

---

## 8. Search / Filter State

URL query on the Documents route:

`/app/cases/{matterId}/documents?q=invoice&status=ready&sort=name_asc`

- Refresh and Back restore `q` / `status` / `sort`
- Default newest sort is omitted from the URL
- Search typing is **debounced 300ms** before the URL (and thus the request) updates
- Status/sort apply immediately
- **Clear search** drops query, filters, and sort (back to all documents, newest)

Not stored in the database or user settings.

---

## 9. Empty / No-Results UX

| Situation | UI |
| --- | --- |
| Case has zero documents (no active find) | Existing **No documents uploaded** empty state |
| Find returns zero | **No documents match '{q}'.** (or current filters) + **Clear search** |

Upload onboarding empty state is not shown when the Case has documents hidden by filters.

Counts use server `total` only, e.g. `23 documents`, `Showing 50 of 100 documents`, `4 matching documents`.

---

## 10. Processing / Failure States

Row badges still use the existing friendly `processingLabel` copy. Name search does not hide in-flight or failed files. **Needs attention** includes the same failure / OCR-required states already grouped for lawyers.

---

## 11. Permissions / Tenant Isolation

- List/search: same `documents.view` + matter read as before
- SQL always `matterId` + `organizationId` from `requireMatterAccess`
- Parameterized ILIKE (no string-concatenated SQL)
- Open/download still goes through `signMatterDocumentDownload` (`documents.view`)
- Search cannot return another Case or org’s files even when filenames match

---

## 12. Accessibility / Responsive

- Visible label on the search field (not icon-only)
- Status and sort are native `<select>` (keyboard)
- Clear search is a labeled button
- `aria-live` announces count / “Updating list…”
- Controls stack on narrow width (`flex-col` / `lg:flex-row`); header is not a single overflowing row
- Initial load may show a list loading line; typing uses list busy text, not a full-page spinner on every keystroke

---

## 13. Tests

| Spec | Coverage |
| --- | --- |
| A–D name / partial / case / whitespace | `document-list.test.ts` |
| E zero results | helpers + page copy |
| F/G matter/org isolation | SQL predicates in GET + helper lists are not mixed |
| H beyond first cursor | 100 synthetic names; `087` not in first 20 unfiltered |
| I–L Ready / Processing / Needs attention + combine | helpers + page/API wiring |
| M/N clear | page **Clear search** + URL replace |
| O open still wired | `openMatterDocument` + `documents.view` |
| P/Q processing & failed searchable | helpers |
| R zero-document copy unchanged | source test |
| S no AI on GET search | no generateText / embed / provider / ingest enqueue |
| T Agents-off | Ask route still gated |
| U Review counts | review GET still `getReviewQueueCounts`, no POST |
| V onboarding | firm create still → `/app/cases/new` |

---

## 14. Synthetic Dogfood

Synthetic filenames only (no real client files).

| Scale | Behavior |
| --- | --- |
| 5 documents | All on first page; name search immediate |
| 25 documents | Fits in one UI page (limit 50); filters understandable |
| 100 documents | First page 50; **Load more** for the rest; `q` matching a later name returns it on the first **filtered** page |

Walkthrough (intended manual, synthetic Case):

1. Open Documents  
2. Exact filename  
3. Partial  
4. Different capitalization  
5. Processing filter  
6. Query + Ready  
7. Clear search  
8. Find a name not on the first unfiltered page  
9. Open original  
10. Back — URL find-state restored  
11. Nonexistent name → no-results, not upload-empty  
12. Same filename on another Case — not in this list  

---

## 15. Performance

Not a performance project. Observations for beta scale:

| Item | Note |
| --- | --- |
| List | Same table + indexes (`documents_matter_idx`, `documents_organization_idx`) + `count(*)` per request |
| Search | `ILIKE` on title + exists on versions; fine for tens–low hundreds of files |
| Typing | Debounce 300ms → typically **one** list request per pause, not per key |
| Pagination | Load more only |
| 100-name filter in helpers | Sub-millisecond in-process substring match |

No production latency numbers were collected in this phase (no live beta traffic harness). If ILIKE stays acceptable at controlled-beta matter sizes, stop.

---

## 16. Remaining Documents UX Gaps

- **One-file-at-a-time upload** (known P1; explicitly out of this phase)
- No folders / tags / binders
- Compare dropdown only sees **loaded** ready docs (clear search to compare others)
- Uploader name not shown
- No MIME/type filter

---

## 17. Controlled-Beta Assessment

A lawyer can open a Case → Documents → search or filter processing → find a known file across the whole Case (not only page 1) → open/download through the existing authorized flow.

**Stop.** Do not continue into multi-upload, classification, Ask consolidation, or semantic document search in this phase.

---

## 18. Exactly One Next UX Recommendation

**Multi-file upload on Case Documents** (still one ingest pipeline per file, no DMS folders). Lawyers adding 25–100 files one at a time remains the largest Documents friction after findability.

---

## Explicit questions

1. Can a lawyer find a document by name? **Yes.**  
2. Does search cover the entire Case, not just the loaded page? **Yes** (server `q` / `status` before cursor).  
3. Is search matter-scoped? **Yes.**  
4. Is it organization-scoped? **Yes.**  
5. Are processing documents searchable? **Yes.**  
6. Are failed documents searchable? **Yes.**  
7. What filters were actually implemented? **Ready, Processing, Needs attention** (plus sort).  
8. Can search and filters combine? **Yes.**  
9. Can the user clear them easily? **Yes** — Clear search.  
10. Does zero-result differ from zero-document state? **Yes.**  
11. Does pagination still work? **Yes** — Load more (and was previously missing in the UI).  
12. Does search trigger any AI call? **No.**  
13. Were ingest/retrieval/reliability semantics modified? **No.**  
14. How does the UX behave around 25 documents? **One page (limit 50); search/filter in the header.**  
15. How does it behave around 100 documents? **50 + Load more; name search still hits files past the first unfiltered page.**  
16. What is the largest remaining Documents friction? **One-file-at-a-time upload.**  
