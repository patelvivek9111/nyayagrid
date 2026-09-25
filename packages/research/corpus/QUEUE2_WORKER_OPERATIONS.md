# Queue #2 Worker Operations

Autonomous dual-lane corpus worker for **Queue #2 only**.

- Queue #2: OPEN  
- Queue #9: CLOSED  
- Queue #3: NOT OPEN (never auto-transitioned)  
- `FEATURE_AGENTS=0`  
- Routine AI calls: **0**
- Kill switch: `QUEUE2_WORKER_ENABLED=1` required for mutation

## PRECHECK (required)

```bash
set QUEUE2_WORKER_ENABLED=1
npm run queue2:preflight
```

Expect:

```text
PREFLIGHT_PASS
```

Preflight is **non-mutating** (corpus mutation count must be 0).  
Real `npm run queue2:worker` runs the same preflight automatically before acquiring the ownership lock.

If fail:

```text
PREFLIGHT_FAIL
reasons=[...]
```

Do not start the worker until PASS.

## START

```bash
set QUEUE2_WORKER_ENABLED=1
npm run queue2:worker
```

Equivalent:

```bash
node scripts/run-queue2-dual-lane.cjs --loop
```

Single bounded cycle (ops/debug only):

```bash
npm run queue2:worker:once
```

Do **not** pass Lane A / Lane B manually. The controller chooses from:

- live Lane A depth manifest (`queue2-lane-a-depth-manifest.json`, rebuilt from DB)
- Lane B offline task registry (14 deterministic tasks; no AI planner)

## QUOTA FRESHNESS

Quota probes must parse the **first complete** JSON object from probe stdout (never `lastIndexOf("{")`, which can latch onto nested `rawSample` fragments and look like free-tier defaults).

Persisted quota fields:

- `minuteRemaining` / `hourRemaining` / `dayRemaining`
- reset timestamps
- `lastProbeAt`
- `quotaStateObservedAt`
- `quotaStateSource`
- `quotaStateConfidence` (`AUTHORITATIVE_API` | `AUTHORITATIVE_HEADER` | `DERIVED_ROLLING_WINDOW` | `STALE_FALLBACK` | `AMBIGUOUS`)
- `quotaStateAgeMs`

Lane A may start only when confidence is authoritative. Ambiguous Tier 2 probes raise `HUMAN_REVIEW_REQUIRED` / `COURTLISTENER_QUOTA_STATE_AMBIGUOUS` — do not guess. Stale Tier 2 windows past `dayResetAt` must not indefinitely keep `safeRequests=0` when a fresh live probe succeeds.

Known Tier 2 limits: **30 / min**, **300 / hour**, **1200 / day**.

### Adaptive usable capacity (no fixed 25-request gate)

Lane A capacity is task-aware (`scripts/cl-adaptive-quota.cjs`, config `adaptiveQuota` in `queue2-worker-safety.json`):

- `usableRequests = min(minuteRem-minuteReserve, hourRem-hourReserve, dayRem-dayReserve)`
- Modes: `FINISH_TARGET` | `FULL_BATCH` | `MICRO_BATCH` | `WAIT_MINUTE` | `WAIT_HOUR` | `DAY_BLOCKED`
- Near-complete courts (e.g. WI 44/45) finish when estimated need fits usable budget
- Short minute blocks → `WAIT` until reset (not permanent stop); hour/day blocks → Lane B when eligible
- Per-court EWMA request efficiency; >3.0 for 3 meaningful batches → `HUMAN_REVIEW_REQUIRED`
- Do not re-probe every minute while waiting on a known reset timestamp

Default reserves: minute **2**, hour **5**, day **10**. Minimum micro-batch: **3** requests. Uncertainty multiplier: **1.35**.

## LANE B STATUS SEMANTICS

- `currentTask` means the task **actually executing now**
- Idle / not executing → `currentLane=LANE_B_IDLE_SAFE`, `currentTask=NONE`
- Every wake cycle evaluates all 14 registry tasks; eligibility is written to `queue2-lane-b-eligibility.json`
- Terminal may print `LANE_B_SELECT task=<id>` or `LANE_B_IDLE_SAFE nextEligible=...`
- Completed tasks clear `currentTask`, set `lastRunAt` / `nextEligibleAt`, and reevaluate next cycle (no pinning)

## STOP

`Ctrl+C` (SIGINT) or SIGTERM.

On clean shutdown the worker:

1. Finishes the current atomic DB unit if safe  
2. Persists Lane A/B checkpoints  
3. Flushes audit/events  
4. Emits `WORKER_STOP`  
5. Releases `queue2-worker.lock.json`  
6. `runtimeState=STOPPED`

## KILL SWITCH

```bash
set QUEUE2_WORKER_ENABLED=0
```

- Startup with anything other than `=1` → `QUEUE2_WORKER_DISABLED` (no mutation)  
- Flip 1→0 while running → finish current atomic unit only, persist checkpoint, stop before next unit, release lock, emit `KILL_SWITCH_STOP`

## After laptop sleep / lid close

While Windows is asleep, the process does not run.

- If the terminal/process **survived** sleep: on wake it detects a wall-clock gap (`SYSTEM_RESUME_DETECTED` / `CLOCK_REVALIDATION`), revalidates lock/network/quota, and resumes the correct lane. Quota probes are **not** assumed to have run while asleep.
- If the terminal/process **ended**: run preflight, then `npm run queue2:worker` again. Restart restores Lane A/B checkpoints idempotently.

## Network loss

Transient Wi-Fi changes are normal.

- Network-dependent work pauses (`WAITING_FOR_NETWORK`)  
- Local-only Lane B tasks may continue  
- Heartbeat continues locally (no git push)  
- On recovery: reconcile state, re-check CL quota before Lane A, resume exact checkpoint  

## Code-change restart rule

If production worker/config files change while the process is alive:

- emit `CODE_CHANGE_DETECTED`  
- finish current atomic unit  
- persist checkpoint  
- stop  

Require a fresh preflight + start (no hot-adopt of partial code).

## Backpressure

If chunk/embedding/citation/failed-job backlog exceeds configured thresholds:

- Lane A pauses new acquisition (`BACKPRESSURE_PAUSE`)  
- Lane B catch-up tasks may run  
- Resume only after backlog is healthy  

## No manual steps

Do **not** manually:

- Select Lane A or Lane B  
- Choose the next court  
- Time quota probes  
- Invent free-form offline tasks  

## Safe while worker runs

- Read reports under `packages/research/corpus/reports/`  
- `git status` / `git log` / read-only diagnostics  
- GitHub review of milestone commits  

## Blocked while worker runs

Any competing Queue #2 **mutator** refuses with:

```text
QUEUE2_WORKER_ACTIVE
workerId=...
lane=...
task=...
lastHeartbeat=...
```

## Heartbeat vs GitHub

| Action | Cadence | Git commit? |
|--------|---------|-------------|
| Local heartbeat | ~15 minutes | **No** |
| Meaningful event status | Immediate | No (local) |
| Milestone evidence push | Only on milestones | Yes (explicit paths) |

Never: `git add .` / staging benchmark dirt / committing the live lock file.

## When to contact a human

Only when status shows:

`HUMAN_REVIEW_REQUIRED`

Examples: missing durable checkpoint, unexpected 429, integrity/retrieval regression, lock inconsistency, **Queue #2 completion candidate**, source contract change, prolonged network failure, manifest corpus mismatch, no remaining productive strategy.

Routine Lane A ↔ Lane B quota switching is **not** human review.

## Lane overview

- **Lane A**: CourtListener depth using live DB-derived manifest. Unknown counts are `null`/`UNKNOWN` (never fake zeros). Useful capacity ≥25 requests (or enough to finish a verified partial court).  
- **Lane B**: Deterministic registry tasks only.  
- **Idle-safe**: If no Lane B task is eligible → `LANE_B_IDLE_SAFE` / task `NONE`.

## Status freshness (`runtimeState`)

| Value | Meaning |
|-------|---------|
| `RUNNING` | Live mutator/worker process |
| `IDLE_SAFE` | Healthy idle; no eligible offline work |
| `WAITING_FOR_NETWORK` | Transient offline |
| `SUSPENDED_OR_OFFLINE` | Likely sleep/offline gap |
| `STOPPED` | Process not running |
| `HUMAN_REVIEW_REQUIRED` | Stop strategic work; await human |

## Completion

When the production checklist is satisfied, the worker sets completion candidate review and **stops**. It never opens Queue #3.

## Key paths

- Preflight: `npm run queue2:preflight` → `queue2-preflight-last.json`  
- Lock: `queue2-worker.lock.json` (runtime-local; gitignored)  
- Status / events / daily: `corpus-worker-*.json|md|jsonl`  
- Scheduler: `queue2-dual-lane-state.json`  
- Live corpus snapshot: `queue2-lane-a-corpus-snapshot.json`  
- Lane A manifest: `queue2-lane-a-depth-manifest.json`  
- Lane B registry: `config/queue2-offline-task-registry.json`  
- Safety config: `config/queue2-worker-safety.json`  
- Idempotency ledger: `queue2-idempotency-ledger.jsonl`  
- Audit trail: `queue2-worker-audit.jsonl`  
- Policy / safety: `scripts/queue2-autonomy-policy.cjs`, `scripts/queue2-worker-safety.cjs`
