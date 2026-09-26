# Queue #2 Corpus Worker — Daily Status

Generated: 2026-09-26T15:25:30.000Z (9/26/2026, 11:25:30 AM EDT)
Queue: #2 OPEN | #9 CLOSED | #3 NOT OPEN | transition NONE | FEATURE_AGENTS=0

## CURRENT LANE
STOPPED

## CURRENT TASK
NONE
Worker runtime STOPPED. No worker lock.
Manual one-shot CourtListener ingest only.

SD 45/45 COMPLETE_FOR_CURRENT_DEPTH
checkpoint: cl-opinion-11198423

## TODAY'S PROGRESS
Manual corpus expansion. +100 CourtListener authorities (MI, NM, UT, SD).
+100 qualifying high/appellate cases.
citation edges extracted 5768 → 6058
citation edges resolved 179 → 181
jurisdictions completed for current depth: MI, NM, UT, SD

## COURTLISTENER
sd 45/45
checkpoint: cl-opinion-11198423
mapping: VERIFIED | runner: staging-cl-batch-job
batch session calls: 230
dayRem: 866 | hourRem: 58 | minuteRem: 19
hour reset: 2026-09-26T15:28:39.007524+00:00
day reset: 2026-09-26T17:18:21.103538+00:00
quotaConfidence: AUTHORITATIVE_API source=probe.limits
429: 0

## CORPUS / DEPTH
authorities=3108 cases=1791 clCases=1746 statutes=904 regs=158 rules=254
chunks=42118 embeddings=42118
duplicateSourceIds=0 orphanCount=0

## HEALTH
database=ok orphans=0 duplicateSourceIds=0 missingEmbeddings=0 FEATURE_AGENTS=0

## NEXT ACTION
Idaho (`idaho`), verified mapping, largest remaining authority-depth deficit.
Hour window has 58 requests left until 15:28 UTC. Do not start another 25-case batch on that remainder.
Worker stays STOPPED.
