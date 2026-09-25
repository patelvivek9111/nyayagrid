# Queue #2 Corpus Worker — Daily Status

Generated: 2026-09-25T00:52:00.000Z (9/24/2026, 8:52:00 PM EDT)
Queue: #2 OPEN | #9 CLOSED | #3 NOT OPEN | FEATURE_AGENTS=0

## CURRENT LANE
STOPPED
Reason: manual CourtListener run stopped at minute safety floor (safeRequests 16)

## CURRENT TASK
NONE
WI 44/45
checkpoint: cl-opinion-9886466

## TODAY'S PROGRESS
+40 CL authorities
+0 non-CL authorities
+0 new citation edges resolved this pass
total authorities added: 40
Autonomous worker was not started.

## COURTLISTENER
Start probe: minute 30 | hour 300 | day 411 | safeRequests 28 | AUTHORITATIVE_API
End probe: minute 16 | hour 215 | day 328 | safeRequests 16
Requests used: 85
429: 0
AR 33 → 49 / 45 complete, checkpoint cl-opinion-9879067
WI 20 → 44 / 45 partial, checkpoint cl-opinion-9886466
next useful quota: 8:48:30 PM ET minute reset (observed reset 2026-09-25T00:48:30Z)

## OFFLINE WORK
Citation re-resolution: extracted 5768, resolved 179 → 179, new resolved 0, TARGET_ABSENT 5589, parser gaps 0. CourtListener HTTP on that pass: 0.

## CORPUS / DEPTH
authorities 2966 → 3006
cases 1649 → 1689
clCases 1604 → 1644
statutes 904 | regs 158 | rules 254
chunks 38598 | embeddings 38598

## HEALTH
database=ok orphans=0 duplicateSourceIds=0 retrieval=ok FEATURE_AGENTS=0
runtimeState=STOPPED
worker lock absent

## NEXT ACTION
Resume WI (44/45) from cl-opinion-9886466 when minute safeRequests is at least 25. Do not start the autonomous loop until the deferred test window.

## HUMAN REVIEW
not required
