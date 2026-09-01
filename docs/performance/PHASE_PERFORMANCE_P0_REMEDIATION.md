# NYAYAGRID PERFORMANCE P0 REMEDIATION — ASYNC INGEST

PERF_BASELINE_P1 is **unchanged**. Post-fix measurements: `docs/performance/PERF_BASELINE_P2.json`.

Draft, Ask Nyaya, Compare, Analysis, prompts, chunking, embedding model, retrieval, and Security P0 rate limits were not modified.

---

## What was wrong

`POST /api/v1/matters/:matterId/documents` wrote MinIO, then ran **malware scan → parse → chunk → embed → serial chunk inserts → intelligence extraction** on the HTTP worker before returning 201.

Existing Inngest functions `nyayagrid/document.malware_scan` and `nyayagrid/matter.extract_intelligence` were **no-ops**: `@nyayagrid/jobs` `domainHandlers` only implemented `ping`. Job names existed; production upload never dispatched them.

## What changed

Upload now:

1. Auth, matter access, upload rate limit, MIME/size, **archive/magic-byte check** (sync)
2. MinIO put + document/version rows + audit
3. `inngest.send` `nyayagrid/document.malware_scan` with event id `document.ingest:{documentVersionId}`
4. **202 Accepted** with `documentId`, `documentVersionId`, `processing.state`

Background (`handleDocumentIngestEvent` → `runDocumentIngestJob` → **unchanged** `processDocumentPipeline`):

scan → parse → chunk → embed → persist chunks → `ready`

Then enqueue `nyayagrid/matter.extract_intelligence` (`matter.extract_intelligence:{documentVersionId}`) which calls **unchanged** `extractMatterIntelligenceForDocument`.

### Why handlers were optional

`packages/jobs/src/index.ts` exported `domainHandlers = { ping }`. Inngest wrappers returned success when the handler was missing so events could be registered before domain wiring. That is now replaced for ingest and intelligence only.

### State machine (existing enums)

`uploaded` → `awaiting_malware_scan` → `scan_clean` | `unscanned_development` → `extracting_text` → `chunking` → `embedding` → `indexed` → `ready`

Failures: `scan_blocked`, `quarantined`, `malware_scan_failed` (retried), `extraction_failed`, `requires_ocr`, `failed`

Crashed `chunking`/`embedding` may resume via `extracting_text`. `indexed` completes to `ready`.

**Searchable vs insights:** chunks exist once the ingest job finishes (`ready`). Intelligence is a second job. Documents UI maps `ready` + intel `queued`/`running` to “Ready (extracting insights)” and polls in-flight states.

### Durable enqueue / residual window

Commit document rows, then send. If send throws: document marked `failed`, HTTP **503**. No silent “accepted but no job”.

If send succeeds and the worker never runs, the document stays `uploaded` until an operator retries. Not a full transactional outbox. Controlled-beta residual.

### Concurrency (controlled beta)

| Cap | Value |
| --- | --- |
| Ingest global | 3 |
| Ingest per organization | 2 |
| Intelligence global | 2 |
| Intelligence per organization | 1 |
| Inngest retries | 4 (ingest and intelligence) |
| DB pool | **max=10 unchanged** |

A 100-document drop cannot start 100 simultaneous model calls.

### 429 / retries

OpenAI adapter **not** changed (frozen AI blast radius). Ingest **throws** on 429/5xx/timeout (`isRetryableProcessingError`); Inngest retries. Permanent states (`scan_blocked`, `requires_ocr`, `extraction_failed`) return without throw — no infinite retry.

### Malware

Pipeline still scans before extract/chunk/embed. `scan_blocked` / `quarantined` skip intelligence. Retrieval only sees `document_chunks` rows; those are inserted after a clean/dev scan path.

### Stale / deleted / tenant

`evaluateIngestGate` requires org + matter + document + version to match DB rows. Missing document/version → skip. Newer `versionNumber` → `STALE_VERSION`, no document state mutation, no intelligence.

### Observability

Structured logs: `ingest.started` / `ingest.finished` / `intelligence.finished` with ids, attempt, stage, elapsedMs. No document text.

---

## P1 → P2 comparison

| Item | P1 (before) | P2 (after) |
| --- | --- | --- |
| Upload HTTP | Full pipeline + intelligence | Auth/store/enqueue only, **202** |
| Upload accept | Dominated by AI (minutes on large files) | In-process enqueue serialize p50 **&lt;1 ms** on laptop (not MinIO+HTTP SLA) |
| Background total | Same work, on the request | Same `processDocumentPipeline` + async intelligence |
| Job retry | None on upload path | Inngest 4 retries; transient vs permanent split |
| 429 | Throw, fail the HTTP request | Job retry; adapter still has no Retry-After |
| Queue/concurrency | Unbounded if many POSTs held workers | Inngest 3/2 ingest, 2/1 intelligence |
| DB pool | HTTP held connections through AI | Pool max 10; jobs capped below pool |
| Failed-document recovery | Failed request, retry whole upload | Per-document job; others continue |
| Eventual correctness | Sync pipeline + extract | **Same functions**, async delivery |

Serial chunk inserts and pgvector indexes remain **P1**, not done here.

---

## Tests

- `packages/documents/src/ingest-job.test.ts` — tenant/deleted/stale gates, 429 vs malware, resume transitions, concurrency caps
- `packages/documents/src/index.test.ts` — processing states including resume
- `apps/web/src/lib/document-ingest-wiring.test.ts` — upload route has no pipeline/intelligence; Inngest ingest is real, not optional
- Existing archive magic tests unchanged
- Security P0 tests not rewritten

---

## Beta checklist

1. Does upload return without waiting for AI? **Yes (202).**
2. Is background processing durable? **Yes, via Inngest event id, with a documented send-after-commit window.**
3. Can duplicate delivery corrupt state? **No — ready is no-op; intel idempotency key unchanged; chunk delete+reinsert per version.**
4. Can malware reach embeddings/retrieval? **No — scan before chunk insert; blocked states skip intel.**
5. Are transient provider failures retried safely? **Yes, at the job layer (not unbounded).**
6. Can 100-document upload create uncontrolled 100-way AI concurrency? **No.**
7. Can failed files recover independently? **Yes.**
8. Can stale versions inject intelligence? **No.**
9. Are tenant boundaries preserved? **Yes — DB reload + identity match.**
10. Does eventual processed output preserve reliability semantics? **Yes — same pipeline and extractor.**
11. Remaining P0 performance blockers? **No for this ingest P0.** Operational requirement: Inngest worker must run.
12. Safe enough for controlled beta? **Yes, if Inngest is configured (real signing key in production) and the worker is up.**

## Decision

**PERFORMANCE READY FOR CONTROLLED BETA**

---

## Exactly one next performance recommendation

**Add bounded HTTP timeout and 429/Retry-After backoff on the OpenAI embeddings (and chat) fetch**, so a provider storm retries the API call instead of re-running the entire ingest pipeline. Do not implement it in this phase.

Serial chunk inserts and retrieval indexes stay later P1 work.
