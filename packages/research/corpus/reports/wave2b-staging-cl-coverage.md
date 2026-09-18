# NyayaGrid — Queue #2 / Wave 2B staging report

Generated: 2026-09-18T00:40:00.000Z
Git: dc4acc3+ (rate-safe short-batch + durable checkpoints)
Classification: **PARTIAL** — durable architecture landed; CourtListener hourly/daily window blocks further live deepen

## Rate limiting (audited on staging)

Live ping from Fly machine `811d3e3f522648`:

```json
{"ok":false,"status":429,"retryAfter":"65021","ms":358}
```

- **Endpoint:** `GET /api/rest/v4/opinions/?cluster__docket__court=ca11&page_size=1`
- **429 cause:** CourtListener token quota / temporary ban window
- **Retry-After:** **65021 seconds (~18.1 hours)** — respected; jobs must exit cleanly (not sleep in-process)
- **Limiter:** single-flight `ClRateLimiter` (concurrency 1), base `CL_RATE_MS` (default 1500), bounded retries, jitter; if Retry-After > 300s → persist `rate_limited` and exit
- **No retry storm**

## Durability

| Mechanism | Status |
|---|---|
| Table `corpus_ingest_jobs` | Migrated (`0015`) + `CREATE IF NOT EXISTS` in job |
| Per-court unique job row | Proven (`ca11` job exists, status tracked) |
| Cursor / completed_external_ids / counters | Persisted after each item |
| Statuses | pending / running / rate_limited / paused / completed / failed |
| Fly strategy | Short detached batch per court; poll DB checkpoint (not `/tmp` alone) |
| Machine stop | Progress survives in Postgres |

## Corpus (unchanged this window — CL blocked)

| Metric | Before Wave 2B | After |
|---|---:|---:|
| Total authorities | 311 | **311** |
| Seed | 186 | **186** |
| CourtListener | 125 | **125** |
| New CL this window | — | **0** (RATE LIMIT WINDOW) |

### Federal CL counts
SCOTUS 18; CA1 11; CA2 10; CA3 11; CA4 12; CA5 10; CA6 12; CA7 5; CA8 15; CA9 15; CA10 6; **CA11 0**; **CADC 0**; **CAFC 0**

### Wave-1 state CL (high / appellate)
All **0 / 0** for CA DE FL IL MA NJ NY PA TX VA (blocked this window)

## Citation graph
- extracted/normalized edges: **2104**
- resolved: **16**
- unresolved: **2088**
- ambiguous: not re-scanned this window (resolver script ready)

## Implementation
- `scripts/staging-cl-batch-job.ts` (+ bundled)
- `scripts/run-staging-cl-batch-job.cjs` / `wave2b` / `job-status` / `court-map-probe` / `citation-resolve`
- `packages/database/drizzle/0015_corpus_ingest_jobs.sql`
- Adapter 429 Retry-After bounded retries
- Tests: `scripts/wave2b-rate-limit.test.ts` (4 passed)
- Staging deploy applied migration 0015
- `FEATURE_AGENTS=0` confirmed on health

## Remaining work
1. Wait until Retry-After window expires (~18h from last 429)
2. Resume `node scripts/run-staging-cl-wave2b.cjs <sha> federal` then `wave1`
3. Re-run citation resolve + coverage report
4. Retrieval validation on newly imported courts

## Honest depth
Not national case-law coverage. Bounded recent CL sample only where already present. No fabricated reporter citations. Legal Research remains corpus-only / no-Web.
