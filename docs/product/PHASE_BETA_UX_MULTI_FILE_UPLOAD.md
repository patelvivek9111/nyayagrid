# NYAYAGRID BETA UX — MULTI-FILE UPLOAD (UX-DOCS-2)

Queue UX only. Parsing, malware semantics, chunking, embeddings, intelligence extraction, Inngest functions, ingest state machine, retrieval, Ask, Timeline, Memory, Graph, Analysis, Draft, Research, Agents, Review, Security P0, Performance P0 concurrency, and frozen baselines were not modified.

No AI calls. No folders, tags, ZIP ingest, or bulk intelligence approval.

UX-DOCS-1 search/filter was not reopened: `q` / `status` / `sort` still drive the list; upload does not clear them.

---

## 1. Existing Upload Architecture

Verified from `POST /api/v1/matters/{matterId}/documents`:

| Item | Production |
| --- | --- |
| UI (before) | `<input type="file">` — first file only |
| API | Exactly one multipart field `file` |
| Auth | `documents.upload` + matter `edit` |
| Size | `MAX_UPLOAD_BYTES` = **15 MB** |
| Types | PDF, DOCX, TXT, MD (MIME and/or extension) |
| Archives | `rejectZipBombsOrArchives` on the buffer |
| Rate limit | `endpointClass: "upload"` — 120 / hour / organization |
| After storage | Insert document + version, audit, `enqueueDocumentIngest`, **202** |
| Enqueue failure | Document row left `failed`, **503** (file may already be stored) |
| List refresh | Single-file path called `refreshDocs()` after 202 |

There is **no** bulk upload API. None was added.

---

## 2. Multi-File Design

`<input type="file" multiple>`. One or many files. Each selected file becomes a queue row and is sent with the **existing** POST (`FormData` field `file`).

---

## 3. Why Per-File POST

Independent document rows, objects, scans, Inngest events, and processing states. One invalid PDF cannot abort the rest. No multi-file transaction.

---

## 4. Batch Limit

**50 files per picker selection** (`DOCUMENT_UPLOAD_BATCH_MAX`). Extra files in that selection are omitted with a notice. This is a UX guard, not a storage cap. Another selection can be added afterward.

Per-file size remains **15 MB** (unchanged).

---

## 5. Client Concurrency

**4** simultaneous HTTP uploads (`DOCUMENT_UPLOAD_CONCURRENCY`, in the 3–5 range).

Inngest global/per-org ingest concurrency was **not** changed. Fifty accepted files still process under Performance P0 job caps. Copy states that received ≠ all processing at once.

---

## 6. Upload Queue

Each row: filename + phase.

| Queue phase | Meaning |
| --- | --- |
| Waiting | Not started (can Remove) |
| Uploading | HTTP in flight |
| Received | **202** — server accepted |
| Failed | HTTP/client rejection |

Received rows do not duplicate the Documents processing badges. Those remain on the matter list (Scanning, Indexing, Ready, …).

---

## 7. Upload vs Processing States

Copy: files are **received individually**; scanning and indexing continue in the background; the Case does not need to stay open.

**Received** ≠ fully processed.

---

## 8. Failure Isolation

Each POST has its own outcome. Mixed valid/invalid batches: valid files continue. Failures show the filename and the server-safe message (or the 429 wording below).

---

## 9. Retry Behavior

| Outcome | Retry? |
| --- | --- |
| 202 Received | **No** (would duplicate) |
| 503 enqueue | **No** (row/object may already exist) |
| 429 / network / other HTTP failure | **Yes**, that file only, manual |
| Waiting | Remove only, not cancel-after-accept |
| Later malware/OCR/`failed` on the list | Existing processing UI — **not** upload Retry |

Refresh before 202: that local file is lost. After 202, state is on the server.

---

## 10. Document List Integration

On 202, the list refresh is **debounced (400ms)** and flushed when the queue drains. In-flight documents are listed and remain searchable under UX-DOCS-1.

---

## 11. Search/Filter Compatibility

Upload does not call `clearFind` / `replaceFindParams`. Active `q` / `status` / `sort` stay in the URL. A new file may be hidden by the current filter. Summary notes that search/filters were kept when a find is active.

---

## 12. Rate Limits

Upload `enforceRateLimit` is unchanged. 429 → “Upload temporarily limited. Retry this file.” No automatic retry loop. Concurrency 4 reduces request bursts vs 50 parallel POSTs.

---

## 13. Security / Permissions

Each POST still: auth, matter access, `documents.upload`, org/matter scope, rate limit, size/type, archive magic, then malware scan in the existing pipeline.

Chrome exposes **`canUpload`** from the existing `documents.upload` capability (UI only; roles unchanged). Without it, the picker is hidden.

Malware on one file does not mark the batch malicious.

---

## 14. Accessibility / Responsive

Labeled **Add documents** control; selected count in text; phase labels not color-only; Retry/Remove have accessible names; filename `title` for truncation; queue scrolls on narrow width.

---

## 15. Tests

Helpers: batch cap, concurrency peak ≤ 4, 202 not retryable, 429 retryable, 503 not retryable, isolated summary, cancel waiting.

Source: multiple picker, one POST path, Inngest caps untouched, permission gating, no AI, Review/onboarding/Agents/enqueue/search compatibility.

---

## 16. Synthetic Dogfood

| Case | Expected |
| --- | --- |
| A — 5 valid | 5 POSTs, all Received, rows appear |
| B — 25 | Queue usable, peak 4 HTTP, background copy clear |
| C — mixed | Only invalid fails |
| D — one HTTP fail | Others continue; Retry that file; 202 not resent |
| E — active `q`/`status` | Find state intact |
| F — duplicate names | Allowed (backend never unique-on-title) |

No client documents. Live 50-file ingest completion was **not** benchmarked (Performance P0).

---

## 17. Performance

| Item | Value |
| --- | --- |
| Client HTTP concurrency | 4 |
| Peak simultaneous uploads | ≤ 4 |
| 25 / 50 selection | Queue + 4-wide POST; list GET debounced |
| Rate limit | Still 120/hour/org |
| Ingest jobs | Existing Inngest caps |

---

## 18. Remaining Documents UX Gaps

- No drag-and-drop onto the panel (picker only)
- No folder / ZIP ingest (intentional)
- Compare dropdown still uses currently loaded ready docs
- No resumable uploads
- 503 enqueue remains an awkward stored-but-not-202 edge (no retry, to avoid duplicates)

---

## 19. Controlled-Beta Assessment

A lawyer can select a realistic group of files, see per-file Waiting / Uploading / Received / Failed, retry only unsafe-to-skip HTTP failures, and keep working while ingest runs.

**Stop.**

---

## 20. Exactly One Next UX Recommendation

**Drag-and-drop onto Add documents**, reusing this same per-file POST queue (still no folders or ZIP).

---

## Explicit questions

1. Can a lawyer select multiple files at once? **Yes.**  
2. Does each file use the existing upload API? **Yes.**  
3. Does each file retain independent ingest state? **Yes.**  
4. Is client concurrency bounded? **Yes — 4.**  
5. Can one failed file stop the batch? **No.**  
6. Can failed HTTP uploads be retried individually? **Yes**, except 202 and 503.  
7. Can accepted 202 uploads be accidentally duplicated by retry? **No** (retry disabled once accepted).  
8. Do documents appear before full processing? **Yes.**  
9. Does active search/filter state survive upload? **Yes.**  
10. Do rate limits remain active? **Yes.**  
11. Does malware scanning remain per file? **Yes** (existing pipeline).  
12. Were ingest semantics modified? **No.**  
13. Were Review/AI/reliability systems modified? **No.**  
14. How does 25-file upload feel? **Queue of 25, 4 at a time, list refresh debounced.**  
15. How does max-batch upload feel? **50 per selection, same 4-wide HTTP; ingest still backend-capped.**  
16. What is the largest remaining Documents friction? **Adding files still requires the picker — drag-and-drop is the next increment.**  
