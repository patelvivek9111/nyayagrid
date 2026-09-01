# NYAYAGRID BETA UX — DRAG-AND-DROP DOCUMENT UPLOAD (UX-DOCS-3)

UI input convenience only. Dropped files enter the **existing UX-DOCS-2 queue**. The document POST API, ingest pipeline, Inngest functions, limits, concurrency (4), retry rules, search/filter, Review, Ask, and frozen reliability systems were not modified.

No AI calls. No folders, directory crawl, ZIP ingest, or a second upload queue.

---

## 1. Existing Upload Queue Architecture

Unchanged from UX-DOCS-2:

| Piece | Location |
| --- | --- |
| Picker | `<input type="file" multiple>` |
| Normalize files → queue | `enqueueIncomingFiles` → `takeFileSelection` + `buildUploadItemsFromFiles` |
| Queue | `uploadQueue` / `uploadQueueRef` (`waiting` / `uploading` / `received` / `failed`) |
| Batch cap | `DOCUMENT_UPLOAD_BATCH_MAX` = 50 per selection/drop |
| Scheduler | `drainUploads` + `drainLockRef` + `runWithConcurrency(4)` |
| POST | existing `POST .../documents` one `file` field |
| Retry / remove | `canRetryUpload` / `canCancelWaitingUpload` |
| List refresh | debounced after 202 |
| Permission | `canUpload` from `documents.upload` |

Drop calls **`enqueueIncomingFiles`**, the same function as the picker.

---

## 2. Drop Target Design

The **Add documents** panel is the drop target (not a second panel, not a full-page overlay).

| State | UI |
| --- | --- |
| Normal | Add documents + picker |
| File drag over (desktop) | Title: **Drop files to add to this Case**; restrained accent ring |
| Drag leave | Counter-based leave so nested events do not stick |
| Drop | `preventDefault` + `stopPropagation` → classify → enqueue |

Mobile/narrow: picker stays primary; drop hint is `sm:block` only. No touch-drag implementation.

---

## 3. Queue Reuse

Picker and drop both:

1. Collect `File[]`
2. `enqueueIncomingFiles`
3. Same 50-file slice, validation, POST, drain lock, refresh

Appends to `uploadQueueRef.current`. A drop while uploads are in flight does **not** start a second scheduler (`drainLockRef`).

---

## 4. Validation

Unchanged: 15 MB client hint, server authoritative for type/archive/malware. `buildUploadItemsFromFiles` uses existing `clientRejectReason`.

---

## 5. Folder / Non-File Behavior

Uses `DataTransferItem` + `webkitGetAsEntry` when present. **Directories are skipped, never `createReader`-walked.** `dt.files` is only a fallback when `items` is empty (so a folder drop does not silently ingest children listed on `files`).

| Content | Result |
| --- | --- |
| Folder | “Folder upload is not supported. Drop individual files instead.” |
| Text / links | “Only files can be added. Text and links are not uploaded.” |
| Mix of files + folder | Files enqueue; folder copy shown |

---

## 6. Batch Limit

Same 50 per drop/selection. Excess omitted with the existing note. No second cap.

---

## 7. Concurrency

Still **4**. One drain loop. Peak in-flight cannot exceed that helper.

---

## 8. Failure / Retry

Unchanged: 202 never retried; 503 not retried; other HTTP/network failures may Retry; waiting may Remove. Source (picker vs drop) does not change rules.

---

## 9. Permission Gating

Drop handlers are attached only when `canUpload`. View-only: no drop target, no POST. Backend `documents.upload` unchanged.

---

## 10. Search/Filter Compatibility

Drop/enqueue does not call `clearFind` / `replaceFindParams`. List refresh still uses current `q` / `status` / `sort`.

---

## 11. Accessibility / Responsive

Picker remains the required path. Drop is optional. Visible **Add documents** label. Drop hint hidden on the smallest widths. Keyboard users never need drag.

---

## 12. Security

No alternate storage path. Every dropped file still hits the existing authenticated POST (matter/org scope, rate limit, validation, archive rejection, malware scan, Inngest ingest).

Drop `preventDefault` on the zone so a PDF does not navigate the tab.

---

## 13. Tests

Helpers: directory skip, non-file ignore, shared `buildUploadItemsFromFiles`, 50-file cap, 202/503/429 retry rules, concurrency ≤ 4.

Source: shared `enqueueIncomingFiles`, preventDefault, `canUpload` gating, no `webkitdirectory` / `createReader`, search URL untouched, ingest/Review/Agents unchanged.

---

## 14. Synthetic Dogfood

| Case | Expected |
| --- | --- |
| A — drop 5 | Same queue/POST as picker |
| B — drop 25 | Queue usable, max 4 HTTP |
| C — mixed validity | Isolated failures |
| D — drop then picker | One queue |
| E — picker then drop mid-upload | Append, one scheduler |
| F — folder | No crawl; folder copy |
| G — view-only | No drop |
| H — `?q=&status=&sort=` | Preserved |
| I — drop PDF on zone | No navigation |

---

## 15. Remaining Documents UX Gaps

- Compare still uses currently loaded ready docs
- No resumable uploads, folders, tags, or bulk delete (intentional)
- Missed drops outside the Add documents panel may still use browser default

---

## 16. Controlled-Beta Assessment

A lawyer can drag individual files onto Add documents and get the **same** queue, limits, concurrency, and per-file outcomes as the picker.

**Stop.**

---

## 17. Exactly One Next UX Recommendation

**Show a Case-level processing summary on Documents** (for example how many files are still Scanning / Indexing vs Ready) after a large drop, using existing processing states — not a new ingest system.

---

## Explicit questions

1. Can a lawyer drag individual files onto Documents? **Yes** (Add documents zone).  
2. Do dropped files enter the exact same queue as picker files? **Yes.**  
3. Does concurrency remain 4? **Yes.**  
4. Does the 50-file limit remain unchanged? **Yes.**  
5. Are folders recursively uploaded? **No.**  
6. Can non-file dragged content trigger an upload? **No.**  
7. Can one dropped failure stop the rest? **No.**  
8. Can 202 files be retried accidentally? **No.**  
9. Does a view-only user get drag upload? **No.**  
10. Does dropping preserve q/status/sort? **Yes.**  
11. Can dropping navigate the browser away? **No** (zone `preventDefault`).  
12. Were upload API semantics modified? **No.**  
13. Were ingest semantics modified? **No.**  
14. Were AI/Review/reliability systems modified? **No.**  
15. What is the largest remaining Documents friction? **Seeing batch processing progress on the list after many files are received.**  
