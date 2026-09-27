# Queue #2 Corpus Worker — Daily Status

Generated: 2026-09-27T02:02:30.000Z (9/26/2026, 10:02:30 PM EDT)
Queue: #2 OPEN | #9 CLOSED | #3 NOT OPEN | transition NONE | FEATURE_AGENTS=0

## CURRENT LANE
STOPPED

## CURRENT TASK
NONE
Worker runtime STOPPED. No worker lock.

HOLD: staging Neon DB quota exceeded (SQLSTATE 53000).
CourtListener Tier 2 quota is available (minute 30 / hour 300 / day 726).
Vermont (`vt`) 20/45 cannot start until DATABASE_URL accepts connections again.

## LAST SUCCESSFUL CORPUS SNAPSHOT
authorities=3208 cases=1891 clCases=1846
chunks=44793 embeddings=44793
duplicateSourceIds=0 orphanCount=0
Completed for current depth: MI NM UT SD ID WY NE SC

## COURTLISTENER
probe: AUTHORITATIVE_API Tier 2 active
dayRem: 726 | hourRem: 300 | minuteRem: 30
dayResetAt: 2026-09-27T14:28:39.007524+00:00
429: 0
CL requests this session: 1 (quota probe only)

## NEXT ACTION
Restore Neon staging project quota / plan, then resume Vermont one-shot ingest.
Worker stays STOPPED.
