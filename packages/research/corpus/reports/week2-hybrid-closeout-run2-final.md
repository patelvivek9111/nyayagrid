# WEEK2 HYBRID CLOSEOUT RUN 2 — FINAL REPORT

STATUS: PASS

STOP_REASON: BUDGET_COMPLETE_WITH_EXTENSION

COURTLISTENER:
- limits: 25/min · 300/hr · 1400/day (Tier 4 live)
- start remaining: minute 25 / hour 190 / day 1159
- pacing: 4000 ms
- actual CL: **98** (Lane A 70 + Lane B 28)
- 429: 0
- 408: one mich HIST_QUERY_TIMEOUT (orphans cleaned; +2 cases still landed)

WEEK 2:
- start cases = 4228 → end **4270** (+42)
- remaining to 4700: **430**
- state/DC: 3087 → **3115** (+28)
- federal: 1070 → **1084** (+14)

TRACKER:
- top remaining deficits: MI/NV/NJ 99, NE/NC/TN/VA 98 (intermediate gaps remain)
- LA/WA/MD improved out of prior top-3 after high-court adds

COURT MAPPING PREFLIGHT:
- candidate courts evaluated locally
- VALID_MAPPED only spent CL
- INVALID quarantined (vacapp/njsuperct/nebrctapp/unmapped *ctapp)
- CL wasted on invalid mapping: **0**

TARGETMAX PREFLIGHT:
- lanes raised above itemsImported before spend
- CL wasted on capped lane: **0**

LANE A:
- CL: 70
- useful cases: **28**
- CL/case: **2.500**
- old edges resolved: **11**
- Productive:
  - mich | ~0–timeout | +2 | high MI
  - la | 10 | +4 | 2.5
  - wash | 10 | +4 | 2.5
  - md | 10 | +4 | 2.5
  - wisctapp | 10 | +4 | 2.5 | intermediate
  - utahctapp | 10 | +3 | 3.33 | intermediate
  - indctapp | 10 | +4 | 2.5 | intermediate
  - kyctapp | 10 | +3 | 3.33 | intermediate

LANE B (fresh U.S. only — stale ops archived):
- CL: 28
- attempted: 14
- acquired: 14
- old edges: **87**
- edges/CL: **3.107**
- found rate: 100%

REALLOCATION:
- initial 70/30
- extension: intermediate reopen + fresh U.S. after main high-court block

CITATION:
- resolved 5266 → **5445**
- resolution 11.07% → **11.34%**
- Lane A exact resolves: 11
- Lane B exact resolves: 87
- live 12.5% target: 6003
- live gap: 558

QUEUE #2: OPEN / clean
QUEUE #3: PASS
QUEUE #4: PASS · unknown 144 · silent CURRENT **0**

EXTRACTION: advancing with ingest (extracted 47560 → 48020)
INTEGRITY: duplicates 0 · orphans 0 · missing embeddings 0
PRODUCTION EMBEDDINGS: chunks **95135** · experimental 0
VALIDATION: citations/resolver/queue2/queue3/queue4/preflight/typecheck **PASS**
EXTERNAL AI: all = 0

WEEK 2 EXIT SCORECARD:
1. ~4700 useful cases: PARTIAL (4270 / rem 430)
2. State-depth: PARTIAL (+28 state > +14 federal)
3. Intermediate appellate: PARTIAL (+wisctapp/utahctapp/indctapp/kyctapp)
4. Historical depth: PARTIAL
5. Federal coverage: PASS
6. Tracker current: PASS
7. Queue #2: PASS
8. Queue #3: PASS
9. Queue #4: PASS
10. silent CURRENT = 0: PASS
11. extraction coverage: PASS
12. resolver defects: PASS
13. integrity: PASS

WEEK 2 CLASSIFICATION: **WEEK2_CONTINUE**

BLOCKERS:
1. ~430 useful cases below ~4700
2. Intermediate-appellate gaps remain on many top deficit states (no VALID mapped intermediate IDs for MI/LA/WA/MD/NV/…)
3. State-depth rebalance still needed (improved this run, not closed)

NEXT 100 CL:
- balanced corpus **70%**
- citation-demand **30%**
- top balanced lanes: wisctapp, utahctapp, indctapp, kyctapp, la, wash, md, mich
- top citation lane: U.S. Reports (~3.1 e/CL)

NEXT BEST ACTION:
Continue 70/30 with VALID_MAPPED courts only and raised targetMax; keep U.S. citation-demand secondary until Week 2 case/balance gates close.

Classification: WEEK2_HYBRID_CLOSEOUT_RUN_2
