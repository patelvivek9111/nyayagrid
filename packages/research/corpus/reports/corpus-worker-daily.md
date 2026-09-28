# Queue #2 Corpus Worker — Daily Status

Generated: 2026-09-28T16:35:00.000Z (9/28/2026, 12:35:00 PM EDT)
Queue: #2 OPEN | #9 CLOSED | #3 NOT OPEN | transition NONE | FEATURE_AGENTS=0

## CURRENT LANE
STOPPED

## CURRENT TASK
NONE
Worker runtime STOPPED. Manual rapid CourtListener ingest.

Next: West Virginia (`wva`) 39/45 PAUSED_RESUMABLE
checkpoint: cl-opinion-11347355
Prior complete: WA 46/45 checkpoint cl-opinion-11264673

## THIS SESSION
OH/NC/OR/RI already complete at session start (skipped)
WA 32→46 (+14, 30 CL) COMPLETE
WV 20→39 (+19, 47 CL) PARTIAL rate_limited — STOPPED
total +33 authorities / 76 productive CL (+1 zero-progress rate-limit call)
Citation re-resolve: +0 newly resolved (197→197)

## CORPUS
authorities=3742 cases=2425 clCases=2380
statutes=904 regulations=158 rules=254
chunks=57238 embeddings=57238
duplicateSourceIds=0 orphanCount=0
citations extracted=7220 resolved=197 targetAbsent=7023

## COURTLISTENER
session start probe: minuteRem 30 | hourRem 0 | dayRem 68
Stopped after hour/rate-limit exhaustion during WV.
Worker stays STOPPED.

## NEXT
Resume WV (`wva`) from cl-opinion-11347355 when hour quota recovers.
