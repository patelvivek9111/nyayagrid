# Deepening Pass 6 — Motions + Communications Architecture

**Classification:** `DEEPENING_PASS6_MOTIONS_COMMUNICATIONS_ARCHITECTURE`  
**Date:** 2026-10-09  
**Branch:** `nyaya/full-completion-deepening-v2`  
**Certified tip:** `b1d7ce373c7b7b97bbb9dbb82a7c259c17a8d8b4`  
**CourtListener:** 0  
**Runtime lock:** not acquired (audit only)  
**DB mutations:** none  
**Migration created:** none  

## Decision

**`PASS6_SHARED_SCHEMA_COORDINATION_REQUIRED`**

Existing professional Matter schema cannot provide L4 motions + communications. Discovery Pass 4 correctly left `motion_id` / `communication_id` opaque pending general tables. Those tables still do not exist.

Exact Integration contract:  
`docs/reports/pass6-motions-communications-shared-schema-required-2026-10-09.md`

## Phase 1 — Current-state audit

| Area | Maturity | Finding |
|---|---|---|
| Professional motions table | L0 | Absent (`prosecution_motions` is criminal-only) |
| Professional communications table | L0 | Absent |
| Discovery motion refs | L2 | Opaque `motion_id` + required `motionDocumentId` isolation proxy |
| Discovery MAC / communication refs | L2 | Opaque `communication_id` on MAC + deficiencies |
| Derived motion links | L2 | `DiscoveryMotionLink` reconstructed from deficiencies |
| Meet-and-confer issues | L3 | Persisted discovery table; not general correspondence |
| Inbound emails | L2–L3 | Org inbox filing aid; not typed matter correspondence |
| Tasks / deadlines | L3–L4 | Reusable; MAC can link `task_id`; no motion-native deadlines |
| Timeline | L3–L4 | Generic `timeline_events`; no motion/comms event generators |
| Documents / evidence | L4 | Canonical reuse targets |
| Claims / defenses / issues | L4 | Civil tables exist; no motion link junctions |
| Graph | L2 for motions | Motions projected as `document` nodes; no `motion`/`communication` enum values |
| Ask | L2 | Discovery Ask can describe motion-to-compel labels; no first-class motion Ask |
| UI | L0–L1 | No Matter → Motions / Communications surfaces (prosecution has separate motions UI) |
| Rulings / hearings | L1 | Prosecution has hearings/motions; professional Matter lacks first-class fields |

**Overall current maturity: L2** (partial/opaque supporting references).  
**Target: L4**

## Real lawyer workflow (minimum)

```
Claim / defense / discovery issue
→ deficiency
→ meet-and-confer communication(s)
→ follow-up / incomplete supplement
→ motion (e.g. compel)
→ supporting documents / evidence
→ opposition / reply (explicit dates only)
→ hearing (if source-backed)
→ order / disposition (if source-backed)
→ follow-up production deadline (explicit only)
→ Ask / Graph / Timeline / Tasks
```

Status labels are extensible; jurisdictions are not forced into one sequence.

## Domain model summary

| Model | Status |
|---|---|
| Motion | **missing** (required) |
| Communication | **missing** (required) |
| Motion–document linking | **partial** (document proxy only) |
| Motion–discovery linking | **partial** (opaque UUID) |
| Communication–discovery linking | **partial** (opaque UUID) |
| Claim–motion linking | **missing** |
| Ruling/order representation | **missing** (professional) |
| Timeline integration | **partial** (generic events only) |
| Tasks/deadlines | **partial** (generic; MAC task link only) |

## Security model (planned)

| Control | Requirement |
|---|---|
| Org scope | Required on every row |
| Matter scope | Required on every row |
| RBAC | `requireMatterAccess` + capability gates |
| client_guest | Read with membership + `matters.view`; no default mutate |
| Cross-workspace | Never expose professional matter communications to Guide / Professor / unrelated tenants |

## Ask requirements

- Pending motions / status / disposition only from persisted fields  
- Deficiency → MAC → communication → motion chain  
- Communication chronology  
- Explicit deadlines/hearings only  
- Source grounding via provenance + document links  
- Abstain on invented rulings / deadlines / communications  

## Graph requirements

| Item | Need |
|---|---|
| New node types | `motion`, `communication` |
| New edge types | free-text relationship types (see schema doc) |
| Existing graph reusable? | Yes for documents/claims/deficiencies/tasks; **not** for motion/communication identity |

## Fixture (proposed D6)

Civil supply-agreement dispute (reuse D4 parties):

1. RFP-12 cure-notice communications deficient  
2. Meet-and-confer letter (communication)  
3. Supplement promised; incomplete  
4. Follow-up communication  
5. Motion to compel (filed) + exhibits  
6. Opposition filed; reply filed (explicit dates)  
7. Hearing scheduled (source-backed)  
8. Order granted in part / denied in part  
9. Follow-up production deadline task  
10. Claim A related for context (motion does **not** dispose entire claim)

## Benchmark D6 (12 assignments)

1. Pending motion identification  
2. Motion status accuracy  
3. Motion–discovery chain  
4. Communication chronology  
5. Deadline traceability (explicit only)  
6. Ruling from source/persisted disposition  
7. Claim–motion connection without overclaiming disposition  
8. Evidence supporting motion  
9. Unsupported conclusion abstention  
10. Cross-matter isolation  
11. Whole-matter motion summary  
12. Privilege / MAC separation from sanctions conclusions  

Critical failures: wrong disposition, cross-tenant leak, invented deadline as fact, invented communication, wrong party, wrong source attribution.

## Performance

| Scale | Design |
|---|---|
| 50+ motions / hundreds of communications | List queries indexed by `(matter_id, status)` / `(matter_id, occurred_at)` |
| Large discovery ledger | Join via link tables; no per-row document scans in list views |
| N+1 risks | Batch document/party loads for detail; list DTOs avoid nested participant queries |

## Implementation estimate (post-schema)

| Item | Value |
|---|---|
| Complexity | **HIGH** (workflow breadth + discovery FK remapping + graph enum) |
| Logical phases | Schema unlock → services → discovery wire → Ask/Graph/Timeline/Tasks → UI → D6 fixture/bench → live cert |
| Release-risk reduction | Removes opaque dangling UUIDs; completes discovery→motion litigation spine |
| Nov 20 impact | Unblocks litigation workflow dogfood; depends on Integration migration slot |

## Next action

**`PASS6_SHARED_SCHEMA_COORDINATION_REQUIRED`**

Do not start product implementation until Integration promotes the minimal shared contract.
