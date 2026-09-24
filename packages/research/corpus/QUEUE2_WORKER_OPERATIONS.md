# Queue #2 Worker Operations

Autonomous dual-lane corpus worker for **Queue #2 only**.

- Queue #2: OPEN  
- Queue #9: CLOSED  
- Queue #3: NOT OPEN (never auto-transitioned)  
- `FEATURE_AGENTS=0`  
- Routine AI calls: **0**

## Canonical start

```bash
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

Do **not** pass Lane A / Lane B manually. The controller chooses.

## Stop

`Ctrl+C` (SIGINT) or SIGTERM.

On clean shutdown the worker:

1. Persists scheduler + checkpoints  
2. Emits `WORKER_STOP`  
3. Releases `queue2-worker.lock.json`

## After laptop sleep / lid close

While Windows is asleep, the process does not run.

- If the terminal/process **survived** sleep: on wake it detects a wall-clock gap (`SYSTEM_RESUME_DETECTED`), revalidates lock/network/quota, and resumes the correct lane. Quota probes are **not** assumed to have run while asleep.
- If the terminal/process **ended**: run `npm run queue2:worker` again. Restart restores Lane A/B checkpoints idempotently.

## Network loss

Transient Wi-Fi changes are normal.

- Network-dependent work pauses (`WAITING_FOR_NETWORK`)  
- Local-only Lane B tasks may continue  
- Heartbeat continues locally (no git push)  
- On recovery: reconcile state, re-check CL quota before Lane A, resume exact checkpoint  

No human action for ordinary network flaps.

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

Any competing Queue #2 **mutator** (second CL ingest, offline import, etc.) refuses with:

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

Milestones include: human review, completion candidate, major lane/batch close, daily summary close, material health change, clean shutdown after meaningful work, code/config changes.

Never: `git add .` / staging benchmark dirt / committing the live lock file.

## When to contact a human

Only when status shows:

`HUMAN_REVIEW_REQUIRED`

Examples: missing durable checkpoint, unexpected 429, integrity/retrieval regression, lock inconsistency, **Queue #2 completion candidate**, no remaining productive strategy, prolonged network failure, external source limitation blocking required scope.

Routine Lane A ↔ Lane B quota switching is **not** human review.

## Lane overview

- **Lane A**: CourtListener depth expansion using the persisted production depth manifest (`queue2-lane-a-depth-manifest.json`). Useful capacity ≥25 requests (or enough to finish a verified partial court).  
- **Lane B**: Deterministic tasks from `packages/research/corpus/config/queue2-offline-task-registry.json` only. No AI planner.  
- **Idle-safe**: If no Lane B task is eligible → `LANE_B_IDLE_SAFE` / task `NONE` and sleep until next quota probe or task eligibility. Not a failure.

## Status freshness (`runtimeState`)

| Value | Meaning |
|-------|---------|
| `RUNNING` | Live mutator/worker process |
| `IDLE_SAFE` | Healthy idle; no eligible offline work |
| `WAITING_FOR_NETWORK` | Transient offline |
| `SUSPENDED_OR_OFFLINE` | Likely sleep/offline gap |
| `STOPPED` | Process not running |
| `HUMAN_REVIEW_REQUIRED` | Stop strategic work; await human |

Do not treat a stale GitHub snapshot as proof the worker is currently `RUNNING`.

## Completion

When the production checklist is satisfied, the worker sets completion candidate review and **stops**. It never opens Queue #3.

## Key paths

- Lock: `packages/research/corpus/reports/queue2-worker.lock.json` (runtime-local; gitignored)  
- Status: `packages/research/corpus/reports/corpus-worker-status.json`  
- Events: `packages/research/corpus/reports/corpus-worker-events.jsonl`  
- Scheduler: `packages/research/corpus/reports/queue2-dual-lane-state.json`  
- Lane A manifest: `packages/research/corpus/reports/queue2-lane-a-depth-manifest.json`  
- Lane B registry: `packages/research/corpus/config/queue2-offline-task-registry.json`  
- Completion checklist: `packages/research/corpus/config/queue2-completion-checklist.json`  
- Policy: `scripts/queue2-autonomy-policy.cjs`  
- Milestone helper: `npm run queue2:milestone`
