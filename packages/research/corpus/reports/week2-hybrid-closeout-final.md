# WEEK2 HYBRID CLOSEOUT — FINAL REPORT

STATUS: PARTIAL_QUOTA_WAIT

STOP_REASON: LOCAL_QUOTA_SAFETY_FLOOR_AFTER_PRODUCTIVE_REOPEN (Lane A reopen productive but each batch paused at hour floor; no long wait)

COURTLISTENER:
- live limits start: minute 25 / hour 300 / day 1400
- start remaining: minute 25 / hour 300 / day 1276
- end remaining: hour floor hit (LOCAL_QUOTA_SAFETY_FLOOR); day still ample
- pacing: 4000 ms/request
- planned budget: 100 CL (+40 reopen extension)
- actual CL: 154 (Lane A initial 55 + Lane B 59 + Lane A reopen 40)
- 429: 0
- 408: fly machine exec timeouts on some Lane A attempts (orphans cleaned)

WEEK 2 START:
- cases = 4186
- target ≈ 4700
- numeric gap ≈ 514
- state/DC = 3073
- federal = 1042
- citation: extracted = 46966 / resolved = 4958 / resolution = 10.56%

LIVE CORPUS TRACKER SUMMARY (end):
- total: 4228
- state/DC: 3087
- federal: 1070
- top jurisdiction deficits: MI 101, LA/WA 100, MD/NV/NJ 99, NE/NC/TN/VA 98 (intermediate gaps remain)

LANE A — BALANCED CORPUS:
- CL: 95 (55 unmapped burn + 40 reopen)
- useful cases added: 14 (live-measured reopen only)
- CL/case (reopen productive): 2.857
- state/DC adds: +14
- intermediate adds: WI/UT/IN/KY appellate reopen paths
- old citation edges resolved from Lane A: 3
- initial block failure: unmapped_court for michctapp/lactapp/mdctapp/nevctapp/tennctapp
- reopen productive: wisctapp +3, utahctapp +3, indctapp +3, kyctapp +3, mich +2

LANE A STOPPED/QUARANTINED:
- michctapp/lactapp/mdctapp/nevctapp/tennctapp | unmapped_court
- vacapp/njsuperct/nebrctapp | MAPPING_INVALID_CACHED
- already_completed jobs until targetMax raised above items_imported

LANE B — CITATION DEMAND:
- CL: 59
- targets attempted: 30
- found: 28
- acquired: 28
- exact old edges resolved: 197
- edges/CL: 3.339
- found rate: 93.3%
- U.S.: CL 59 / acquired 28 / edges 197 / edges/CL 3.339 / recent last-10≈3.3 / decay?: no
- REGIONAL: CL 0
- FEDERAL CITATION: CL 0
- FSUPP: CL 0

REALLOCATION LOG:
- checkpoint after_laneA_block: Lane A 40% / Lane B 60% — laneA_weak_shift_to_citation
- post-run corrective: reopen mapped state courts with raised targetMax (+40 CL)

CROSS-LANE VALUE:
- Lane A cases that also resolved old citations: edges +3 after Lane A reopen reresolve
- best dual-value path: mapped intermediate reopen (wisctapp/utahctapp/indctapp/kyctapp) + U.S. citation-demand

CORPUS:
- start = 4186 → end = 4228 (+42)
- remaining to 4700: 472
- state/DC: 3073 → 3087 (+14)
- federal: 1042 → 1070 (+28)
- BALANCE: state share improved slightly but federal still grew more from Lane B; STATE_DEPTH_REBALANCE_NEEDED = YES

CITATIONS:
- extracted: 46966 → 47560
- resolved: 4958 → 5266
- exact old edges Lane A: 3
- exact old edges Lane B: 197
- global resolution %: 11.07%
- live 12.5% target: 5945
- live gap: 679

QUEUE #2: OPEN / clean manual hybrid (worker STOPPED)
QUEUE #3: PASS (norm apply ok; canonical provider/external present)
QUEUE #4: PASS (silent-current suspects = 0; unknown explicit = 144)

EXTRACTION: coverage advancing with ingest; NOT_PROCESSED/FAILED not elevated in integrity
INTEGRITY: duplicates=0 orphans=0 missing embeddings=0
PRODUCTION EMBEDDINGS: chunks 94182 (Δ +1185 from start 92997); experimental = 0

VALIDATION: citations PASS / resolver PASS / queue2 PASS / queue3 PASS / queue4 PASS / preflight PASS / typecheck PASS
EXTERNAL AI: LLM=0 rerankers=0 judges=0 subagents=0

WEEK 2 EXIT SCORECARD:
1. ~4700 useful cases: PARTIAL — 4228 / remaining 472
2. State/intermediate/historical balance: PARTIAL — +14 state; intermediate reopen productive; gaps remain
3. Federal coverage: PASS — maintained/grew via U.S. citation lane
4. 10K Corpus Tracker current: PASS
5. Queue #2 clean: PASS
6. Queue #3 normalization: PASS
7. Queue #4 currentness: PASS
8. silent CURRENT: 0 PASS
9. extraction coverage: PASS (integrity clean; extracted advanced)
10. resolver present-target defects: 0 PASS
11. duplicates/orphans/missing embeddings: PASS

ROADMAP DECISION:
WEEK 1: CLOSED
WEEK 2 CLASSIFICATION: WEEK2_CONTINUE

Blockers preventing Week 2 close:
1. Useful case count still ~472 short of ~4700
2. Intermediate-appellate layer gaps remain on top deficit states (mapped intermediate IDs limited; several MAPPING_INVALID)
3. STATE_DEPTH_REBALANCE_NEEDED still YES

NEXT 100 CL RECOMMENDATION:
- balanced corpus 70% / citation-demand 30%
- top state lanes: wisctapp, utahctapp, indctapp, kyctapp, mich/la/wash/md with targetMax > items_imported
- top citation lane: U.S. Reports (~3.3 edges/CL, no decay)

NEXT BEST ACTION:
Stopped intentionally because safe CourtListener hour quota hit LOCAL_QUOTA_SAFETY_FLOOR. Progress was checkpointed and validated. No long quota wait was performed. Resume next hour with 70/30 Lane A reopen (raised targetMax on mapped courts) + U.S. citation-demand.

Classification: WEEK2_HYBRID_CLOSEOUT_BALANCED_CORPUS_AND_CITATION_DEMAND
