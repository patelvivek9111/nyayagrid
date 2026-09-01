# NYAYAGRID PERFORMANCE / LOAD BASELINE

Label: **PERF_BASELINE_P1**  
Machine-readable companion: `docs/performance/PERF_BASELINE_P1.json`  
Harness: `benchmarks/performance/` (`npm run perf:baseline`)

This phase recorded architecture, rate limits, frozen live-AI timings, and local CPU-only ingest numbers. It did **not** change models, prompts, retrieval quality, pool size, embedding batching, Security P0 limits, or Analysis/Agent behavior.

Local laptop timings are **not** a production SLA.

---

## 1. Executive Summary

Controlled-beta Ask Nyaya, on small synthetic matters with live OpenAI, already sits inside the guidance band (A.3 median **2.8s**, p95 **5.1s**). Frozen Contract Analysis (median **~16s**) and Deposition Analysis (median **~9s**) are slow but acceptable if the UI shows a running job.

The first scaling risk is **not** pgvector at 100 chunks. It is **HTTP-synchronous ingestion**: `POST .../documents` writes MinIO, then runs malware scan, parse, chunk, **one embedding batch**, **serial per-chunk DB inserts**, then **intelligence extraction (one model call with all chunks)** before returning. Inngest functions exist for the same job names but many domain handlers are optional no-ops. A 100-document large case therefore holds a Next.js worker, a pool connection, and a model call **per file**, with **no OpenAI 429 retry**. A prior reliability run recorded **80× HTTP 429** under burst load.

**Decision:** READY AFTER P0 PERFORMANCE FIXES.

---

## 2. Test Environment

| Item | Value |
| --- | --- |
| Captured | 2026-08-19T14:16:46.947Z |
| Host | Vivek (Windows 10, win32 x64) |
| CPU | 12th Gen Intel Core i7-12700H, 20 logical processors |
| Memory | ~16 GiB RAM (host reported ~1.1 GiB free during run) |
| Node | v22.14.0 |
| This harness AI | mock embeddings / in-process CPU |
| Live AI timings | Frozen NYAYA-BENCH runs (gpt-4o-mini unless noted) |
| DB pool (code) | `postgres(..., { max: 10 })` in `packages/database/src/index.ts` |
| Not measured live this phase | MinIO, real PDF parse, pgvector EXPLAIN, mixed 20-user HTTP, agent/research wall clocks |

---

## 3. Controlled Beta Load Model

Design for **3–8 firms**, **10–25 active professionals**, not millions of users.

| Band | Documents | Pages |
| --- | --- | --- |
| Small case | 5–10 | 50–150 |
| Medium case | 25–50 | 300–800 |
| Large beta case | 100–200 | 1,500–4,000 |

Concurrent active users to model: **1, 5, 10, 20**.

Concurrent operations: Ask Nyaya, upload/ingest, contract analysis, deposition analysis, compare, research, agent runs, Timeline/intelligence extraction.

Architecture caps that dominate before “infinite scale”:

- Upload **15 MiB**, **2000 pages**, **2,000,000** extracted characters.
- Product rate limits (section 4) — do not loosen for tests.
- DB pool **max=10**.
- Agent budgets: **12** steps, **40** tool calls, **120s** wall timeout.
- AI generate timeout: **30s** default (`AI_TIMEOUT_MS`).

---

## 4. Architecture

### Upload → ready

**Synchronous on the HTTP request** (`apps/web/.../documents/route.ts`).

1. Validate + `putObject` (MinIO/S3).
2. Insert document + version + audit.
3. `processDocumentPipeline` in-process: `getObject` **once** (buffer reused for scan + extract), scan (30s), extract (60s), chunk (~1200 chars / 150 overlap), `embeddings.embed(all draft texts)` **one call**, then **N serial `insert`s** into `document_chunks`, state → ready.
4. If ready, `extractMatterIntelligenceForDocument` on the same request (OpenAI if `AI_PROVIDER=openai`, else mock). Loads **all chunks** for the version into **one** generate call. Timeline/facts/entities/deadlines persist with additional per-item inserts.

Inngest: `document.malware_scan`, `matter.extract_intelligence`, etc. exist; upload path does **not** enqueue them. Several handlers return “optional / received” when `domainHandlers` is empty.

### Ask Nyaya

Route rate-limited `ask_nyaya`. Flow: hybrid retrieval (query embedding + **two sequential SQL** queries: vector cosine + FTS) → optional second retrieval → evidence assessment (8s abort) **overlapped** with sequential context loads (verified Timeline/Memory/Graph/analysis + authority) → model generate → citation constrain/validate → persist conversation/messages/artifacts/usage.

### Analysis (frozen)

Load version chunks → **one** model call → provenance/span checks → persist. Idempotency key per document version.

### Compare (frozen B.2)

Load both versions’ chunks → concatenate → **deterministic** clause/paragraph diff → **one** model summary (if changes exist) → persist. Idempotency on version pair.

### Research

Authority hybrid retrieval + optional matter context (`loadResearchMatterContext`) → model synthesize / memo. Org rate limit `research` 40/hour. No dedicated research timeout beyond AI 30s.

### Agents

Planner → sequential steps with tools → persist. Budgets cap runaway. **No agent-run idempotency key** in the agents package. Approvals pause the loop (exclude from “active latency”). Rate limit `agent_run` 20/hour/org.

### Concurrency limits (code)

| Layer | Behavior |
| --- | --- |
| Embeddings | One batch per document (all chunks). Not parallel across documents on the upload route (uploads are one HTTP at a time per request; many users = many pipelines). No 429 retry. |
| Chat generate | Single fetch. Resilient wrapper: **timeout then optional fallback**, not exponential backoff. |
| Chunk DB writes | Strictly serial loop. |
| Ask context | Verified, graph, memory, analysis loaded **one after another**. |
| Hybrid SQL | Vector then FTS; `allowedDocumentIds` not applied in SQL. |
| pgvector | `vector(384)` column; **btree** indexes on org/matter/document; **no ivfflat/hnsw**. |

---

## 4a. Current rate limits (Security P0 — unchanged)

| Class | Limit | Window | Scope |
| --- | --- | --- | --- |
| auth | 10 | 5 min | IP |
| upload | 120 | hour | organization |
| ask_nyaya | 60 | hour | user |
| research | 40 | hour | organization |
| agent_run | 20 | hour | organization |
| professor | 60 | hour | user |
| guide | 30 | hour | user |
| expensive_ai | 10 | hour | organization |

**Product capacity** is what the stack can finish (pool, model, CPU). **Rate-limit rejection** is `RATE_LIMITED` before work. Isolation in the harness: 70 sequential Ask checks on one user → **60 allowed, 10 rate_limit**. Forty concurrent-ish checks on one user did not hit the cap.

`expensive_ai` (10/hour/org) will reject additional contract/deposition/compare/extract POSTs long before 20 users can “load test” those routes. Treat that as product policy, not a pool failure.

---

## 5. Ingestion

### Offline CPU (mock embeddings, no PDF/MinIO/DB)

| Documents (10 pages each) | Pages | Chunks | Wall | docs/min | pages/min | chunks/min |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 10 | 11 | 36 ms | 1685 | 16850 | 18535 |
| 10 | 100 | 110 | 211 ms | 2848 | 28478 | 31326 |
| 25 | 250 | 275 | 528 ms | 2840 | 28395 | 31235 |
| 50 | 500 | 550 | 1093 ms | 2745 | 27448 | 30193 |

Chunk+mock-embed stays **approximately linear** through 50 documents / 250 pages. **100 documents was not run live** (would be ~2s CPU-only at this rate; production will be dominated by PDF parse, MinIO, serial inserts, and **100 intelligence model calls**).

Failures / retries / OpenAI 429s in this harness: **0** (mock). Peak concurrency: 1 ingest pipeline per HTTP request.

**Where linearity breaks in production:** each extra document adds a **30s-class model call** (intelligence) plus N DB round trips, not ~20 ms of mock embed.

---

## 6. Large PDFs

Upload limit **not** changed. Internal harness used synthetic text pages (not scanned image PDFs).

| Pages | Chunks | Bytes (synthetic) | Chunk ms | Mock embed ms | Wall |
| --- | --- | --- | --- | --- | --- |
| 10 | 11 | 25,200 | ~0 | 32 | 33 ms |
| 30 | 31 | 75,600 | ~0 | 67 | 67 ms |
| 100 | 101 | 252,000 | ~0 | 205 | 205 ms |
| 250 | 251 | 630,000 | ~0 | 519 | 520 ms |

RSS stayed ~370–395 MiB; delta per size was small. **PDF parse latency, OCR, and timeout behavior were not measured on real files.** Extraction timeout is **60s**; scan **30s**; a slow 250-page parse can fail extraction without hanging forever. Intelligence generate on 251 chunks in one prompt is likely to hit the **30s AI timeout** on live OpenAI.

---

## 7. Ask Nyaya

**Live (frozen A.3 / A.4, small synthetic matters, gpt-4o-mini in those runs):**

| Source | p50 / median | p95 | Notes |
| --- | --- | --- | --- |
| A.3 | 2788 ms | 5108 ms | Assessment usually deterministic (median assessment 0 ms) |
| A.4 | 2708 ms | — | Same order of magnitude |
| A.2 (prior) | 3184 ms | 6810 ms | |

Retrieved chunk count: hybrid default **limit 8**, follow-up can merge to **12**. Not re-measured per matter size this phase.

Stage breakdown (code, not stopwatch): retrieval = 1 embed + 2 SQL (+ optional second search); context = 4+ sequential loads (unbounded verified lists); generation = 1 chat; citation = CPU; persistence = several inserts.

**Medium/large matter Ask p50/p95: not measured live.** Risk is prompt size (verified Timeline dump) and retrieval seq-scan cost, not the 8-hit LIMIT.

---

## 8. Concurrency

| Experiment | Result |
| --- | --- |
| 10 workers × 40 Ask **rate-limit checks** + 5 ms dummy work | 40/40 success, mean ~8 ms, **not** Ask Nyaya |
| 70 sequential Ask checks, one user | 60 ok / 10 `rate_limit` |
| 1 / 5 / 10 / 20 live Ask Nyaya | **Not run** against OpenAI (avoid 429 storms) |
| Mixed Ask + upload + analysis | **Not run**; pool max 10 + sync ingest makes exhaustion **plausible** |

Safeguards were not disabled. Independent users/matters were not provisioned for a 20-way live test.

---

## 9. Retrieval

Hybrid: query embed → `ORDER BY embedding <=>` **LIMIT 8** → FTS `ts_rank` **LIMIT 8** → in-process merge/rerank.

| Corpus size (mock embed all texts) | Time |
| --- | --- |
| ~100 chunks | 34 ms |
| ~1,000 chunks | 413 ms |
| ~5,000 chunks | 1971 ms |

That is **embedding the whole corpus in-process**, not search. Search SQL still scores **all matter rows with embeddings** (no ANN index) then LIMIT. At 10k chunks a sequential cosine pass is usually tens of milliseconds on Postgres — **not verified with EXPLAIN this phase**.

Look-fors (code):

- Sequential scan likely on `embedding <=>` without ivfflat/hnsw.
- `to_tsvector('english', content)` computed at query time (no stored tsvector index found).
- `allowedDocumentIds` unused in SQL.
- Chunk `content` selected in full for hits (bounded by LIMIT).

**Retrieval p50/p95 by matter size: not measured on Postgres.**

---

## 10. Database

Estimated query counts (order of magnitude, one successful request):

| Path | Estimate |
| --- | --- |
| Ask Nyaya | ~12–25: hybrid 2–4, verified 4–5, graph 1–3, memory 1–2, analysis 1–2, authority 1–2, persist 3–6, usage/audit |
| Timeline extract (per doc) | 1 chunk load + 1 generate + **unbounded per proposed event/fact/entity/deadline inserts** (N+1 sources) |
| Memory/graph context | Extra selects; graph materialize has many sequential selects |
| Contract/deposition | Chunk load + analysis row + findings inserts |
| Compare | 2 chunk loads + comparison persist |
| Agents | Per step: load run + tool DB + writes; 12 steps ⇒ dozens of queries |
| Research | Session + authority search + optional matter intel + persist |

Hot issues: **serial chunk inserts (N round trips)**; **unbounded** `select()` of all approved timeline/facts/entities into the Ask prompt; intelligence source inserts in loops.

---

## 11. Connection Pool

Verified: **`max: 10`**. postgres.js queues additional clients; wait time depends on how long ingest holds a connection during N inserts + model I/O.

**Not measured:** wait ms, `pg_stat_activity`, timeout. Mixed 20 Ask + uploads can **queue behind 10** long ingest/analysis requests. Do not increase pool in this phase.

---

## 12. OpenAI / 429

| Control | Present? |
| --- | --- |
| Retry on 429 | **No** (chat and embeddings throw on non-OK) |
| Exponential backoff / jitter | **No** |
| Concurrency limiting / queue | Product rate limits only; no provider token bucket |
| Timeout | Generate: 30s (`ResilientAIProvider`). Embeddings: **unbounded** until fetch returns |
| Fallback | Optional `AI_FALLBACK_PROVIDER` once after failure/timeout |
| Idempotency | Analysis/extract/compare keys; **not** chat/embed HTTP |

Known storm: reliability run `2026-08-18T17-36-27-621Z`, **80× OpenAI HTTP 429**, excluded from A.3 scoring. This phase did not re-hammer the API.

---

## 13. Embeddings

Per document: **one** `embed(texts[])` with **all chunks**. Not serial per chunk, not unbounded parallel across chunks. Multi-document ingest on the current route is **serial across documents** (one upload request each) unless clients fire parallel uploads.

Batch size = chunk count (≈ pages for this synthetic generator). Char cap implies **≲ ~1,900 chunks/doc**, under typical 2048 embedding-batch limits.

Retry: none. Likely beta bottleneck: **OpenAI embedding + chat 429s during parallel uploads**, not mock CPU (~30k chunks/min locally).

---

## 14. Storage

Pipeline **downloads the object once** and reuses the buffer for scan and extract (no double `getObject`). Upload is `putObject` then later `getObject`. Presigned download default **300s** (`getSignedDownloadUrl`). Upload/download latency and large-PDF MinIO times **not measured**.

---

## 15. Contract Analysis

Frozen CA1 (live OpenAI, gpt-4o-mini, 18 tasks):

- p50 **15891 ms**, p95 **19845 ms**, max **19956 ms**
- **1** model call/task, 0 parse retries
- Findings ~8.4 / document (avg)

Acceptable for beta if the UI is non-blocking. `expensive_ai` 10/hour/org caps how often firms can retry.

---

## 16. Deposition Analysis

Frozen DA1:

- p50 **8840 ms**, p95 **11713 ms**, max **12016 ms**
- **1** model call/task

Same UX comment as contract analysis.

---

## 17. Compare

Frozen B.2 live window: 48 tasks in **~69 s** wall (~**1.4 s mean if serial**; likely overlapping or cheap diffs). Deterministic diff is CPU; **model summary dominates** when many clause changes exist. Per-task p50/p95 **not stored** in `BASELINE_B2_COMPARE.json`. Short synthetic contracts only; 30-page / multi-amendment live timing **not re-run**.

---

## 18. Timeline

Extraction is the intelligence job on each ready document (same request as upload today). **One model call per document** over **all chunks**. DB writes scale with proposed events (N+1 source rows). Repeat extract is skipped when `documentIntelligenceRuns` completed unless `force`. Over-production of proposed events is a **noise/cost** issue, not fixed here.

---

## 19. Research

Not timed live this phase. Expected: authority retrieval (hybrid-like) + optional matter context + **1+** generate for query and **1+** for memo (`packages/research/src/synthesize.ts` has multiple `generate` sites). Default research model selection is **gpt-4o** when `AI_PROVIDER=openai` and `MODEL_RESEARCH` unset — **higher cost/latency than mini analysis**. Rate limit 40/hour/org.

---

## 20. Agents

Correctness not evaluated. Execution envelope:

- Wall budget **120s**; AI step timeout **30s**
- Up to **12** steps and **40** tool calls (each tool may retrieve again)
- Approvals: stop and wait (exclude from active latency)
- DB writes per step/tool; no run-level idempotency
- Representative live wall time: **not measured** this phase (do not start long agent runs against production keys for a baseline)

---

## 21. Cost

Repo does **not** encode dollar prices. Token fields exist on `ai_usage_events`; CA1/DA1 JSON **do not** include token totals.

| Workflow | Model default (OpenAI) | Calls (typical) | Notes |
| --- | --- | --- | --- |
| Ask Nyaya | `MODEL_QA` → gpt-4o | 1 generate + 1 query embed; rare 2nd retrieval embed | Frozen benches used mini in some runs |
| Contract analysis | extraction/analysis path gpt-4o-mini in CA1 | 1 | ~16s |
| Deposition | gpt-4o-mini in DA1 | 1 | ~9s |
| Research query/memo | gpt-4o default | 1–2+ generate + embeds | |
| Agent run | gpt-4o default | planner + per-step; up to 12+ | |
| 100-doc ingest embeddings | text-embedding-3-small | 100 batches | plus **100** extraction generates if intel runs |

Leave USD conversion to current provider billing. Do not invent prices.

---

## 22. Timeouts

| Surface | Setting | Class |
| --- | --- | --- |
| OpenAI chat | 30s (`AI_TIMEOUT_MS`) | Reasonable for Ask; **tight** for huge extract prompts |
| Embeddings fetch | none | **Unbounded** |
| Malware scan | 30s | Reasonable |
| Text extract | 60s | Reasonable; OCR 60s if used |
| HTTP upload route | Next.js default (no `maxDuration` in app) | **Too short** vs sync ingest+intel on large PDFs (platform often 60–300s) |
| DB | postgres.js default | Reasonable; pool wait not capped separately |
| Inngest | retries 1–2 on functions | Unused on the live upload path |
| Agent run | 120s | Reasonable if progress is visible |
| Evidence assessment | 8s abort | Reasonable |

Hang risk: **embedding fetch** and any generate if `AI_TIMEOUT_MS` unset and wrapper not used (direct `OpenAIProvider`). Production Ask uses `createAIProviderFromEnv` (timed). Embeddings path does not.

---

## 23. Idempotency

| Operation | Key? |
| --- | --- |
| Intelligence extract | `matter_intelligence_v1:{documentVersionId}` |
| Contract analysis | per document version |
| Deposition / contradiction | per version / matter+scope |
| Compare | version A+B |
| Graph materialize | `materialize_verified_graph:{matterId}` |
| In-memory job bus | `idempotencyKey` on payload |
| Chunk embed on re-process | delete+reinsert chunks for version |
| Ask Nyaya | **No** (each question is new) |
| Agent execute | **No** package-level key |
| Research query | **No** (new query rows) |
| OpenAI HTTP | **No** |

Accidental cost: retrying a **failed** HTTP upload after the pipeline completed can skip intel but still re-upload; parallel double-click analysis is skipped if the row exists.

---

## 24. P0 / P1 / P2 Findings

### P0 — beta blockers

1. **Synchronous ingest + intelligence on the upload HTTP request.** Large beta cases (100–200 docs) will pin workers, exhaust the 10-connection pool, hit route/proxy timeouts, and fire a **model call per document** with **no 429 backoff**. Small-case happy path can still work.

### P1 — fix before wider beta

1. OpenAI chat/embed **no 429 retry**.
2. Pool **max=10** vs 10–20 concurrent professionals plus long ingest.
3. **No ANN / tsvector indexes** on `document_chunks` (large-matter retrieval cost unknown).
4. Intelligence/analysis prompts send **all chunks** (timeout/cost on 100–250 page PDFs).
5. Serial per-chunk inserts (N round trips).
6. Unbounded verified Timeline/facts loaded into every Ask.
7. Agent runs **not idempotent**; default gpt-4o × 12 steps.
8. Embeddings HTTP **no timeout**.

### P2 — later

1. Sequential Ask context loads (could parallelize).
2. `allowedDocumentIds` not in SQL.
3. Inngest jobs unused / optional handlers.
4. Compare/research/agent live percentile gaps in this baseline.
5. Mock CPU ingest is far above real PDF+MinIO throughput — do not use those docs/min as capacity.

---

## 25. Recommended Beta Targets

Guidance after this baseline (controlled beta, not enterprise SLA):

| Surface | Target | Rationale |
| --- | --- | --- |
| Ask Nyaya | p50 **&lt; 5s**, p95 **&lt; 10s** | A.3 already there on small matters; keep it |
| Retrieval | **&lt; 1s** p95 on medium matters; watch large | LIMIT 8; index work is P1 not P0 |
| Upload accept | **Immediate 202/accepted** + progress | Today’s sync return is the gap |
| Analysis | **10–30s** p95 with visible running state | CA1/DA1 already in band |
| Agents | Minutes OK with step progress; hard stop 120s | Already budgeted |
| Ingest | Small case **minutes not hours**; large case **background** | |
| 429 | User-visible retry later, not failed matter | |

---

## 26. Beta Decision

**READY AFTER P0 PERFORMANCE FIXES**

Ask/analysis latency on small synthetic live runs is good enough for a handful of firms. **Large-case upload and burst model use are not**, given the synchronous pipeline and missing provider backoff. Do not call this PERFORMANCE READY.

---

## 27. Exactly One Next Recommendation

**Move malware scan, parse, chunk, embed, and intelligence extraction off the upload HTTP request onto the existing Inngest job names (return document `uploaded` immediately with processing state), without changing extraction quality, prompts, or Security P0 rate limits.**

Do not implement that in this phase.
