# MANUAL_WEEK2_REQUEST_EFFICIENCY_RECOVERY_AND_SCALE

STATUS: **PARTIAL** (efficiency diagnosed; productive path recovered to 2.643; hour 429 stop; +84 cases)

## EFFICIENCY ROOT CAUSE (prior 3.17)

Previous healthy baseline: ~2.1–2.5 CL/useful-case  
Prior session (W1 closeout → W2 launch): **248 CL / 78 useful = 3.17**

Authoritative lane split (ops, excl. probe accounting in grand):

| Lane | CL | Useful | CL/case |
|------|----|--------|---------|
| State historical (G2) | 139 | 61 | **2.28** |
| District | 44 | 12 | **3.67** |
| Federal circuit (G3H) | 64 | 5 | **12.8** |

**Why 2.1–2.5 → 3.17:** avoidable zero-yield / empty-window court burns on federal circuits + weak district windows. Productive-only counterfactual = **184 CL / 78 = 2.359** (delta vs healthy ≈ +0.81 from waste, not ingest failure).

### Cause attribution (prior session)

| Cause | CL attributable |
|-------|-----------------|
| EMPTY_WINDOW / ZERO_YIELD courts | **63** |
| LOW_HIT federal circuit aggregate | **64** (includes empty ca2/ca4/ca10/cafc) |
| District mixed | **44** |
| State hist good | **139** |

### Quarantined circuits (prior evidence)

| Court | Requests | Cases | CL/case | Root cause |
|-------|----------|-------|---------|------------|
| ca2 | 9 | 0 | ∞ | EMPTY_WINDOW 1990–1999 hist; fetch/search with zero useful |
| ca4 | 11 | 0 | ∞ | EMPTY_WINDOW 1990–1999 hist |
| ca10 | 11 | 0 | ∞ | EMPTY_WINDOW 1990–1999 hist |
| cafc | 18 | 0 | ∞ | empty windows (also quarantined) |

### Districts by court (prior)

| Court | CL | Cases | CL/case | Status |
|-------|----|-------|---------|--------|
| cand | 11 | 5 | 2.20 | TIER A keep |
| dcd | 14 | 6 | 2.33 | TIER B keep |
| txnd | 6 | 1 | 6.00 | weak |
| waed | 9 | 0 | ∞ | quarantine 1985–1994 |
| txsd | 3 | 0 | ∞ | empty window |
| mad | 1 | 0 | empty | micro only |

### State historical (prior aggregate ~2.28 TIER B)

Tier A examples: sd 2.22, wyo 2.18, nd 2.18, miss 2.17, mont 2.20, me 2.25, cand(district) 2.20  
Tier B: nh 2.29, ri 2.50, dcd 2.33, vt 2.50

## THIS SESSION

### Quota (one probe)

- minute: 30/30 remaining  
- hour: 300/300 remaining  
- day: 392 remaining (usage 808/1200)  
- session budget: 300 then cont 220  
- actual CL: 1 probe + 153 (block1) + 148 (cont) = **302**  
- 429: **1** (hour; STOP)  
- 408: **0**

### Corpus

- start 3568 → end **3652** (+**84**)  
- state/DC **2858** / federal **794**  
- remaining to ~4700: **1048**  
- Week 2: YELLOW

### Session efficiency

| Block | CL | Useful | CL/case | Notes |
|-------|----|--------|---------|-------|
| Block1 1970s re-hit Tier A | 153 | 28 | **5.46** | ALREADY_INGESTED fetch waste |
| Cont 1990s underfilled states | 148 | 56 | **2.643** | recovered; stopped on 429 |
| Session overall | 301 | 84 | **3.58** | mixed; cont proves recovery path |

Rolling (cont productive path): overall **2.643** vs prior **3.17** → improvement **−0.527**

### Acquisition this session

- state historical: +68-ish of net (G2 dominant on cont)  
- district: +12 in block1 (cand/dcd/nysd/cacd/ilnd/flsd/paed productive micro)  
- federal circuit: +4 (cadc/ca1 only; ca2/ca4/ca10 not called)  
- intermediate: 0  
- dual-value: 0  

### Citations (unchanged; hist ingest does not extract)

- extracted 9485 / resolved 1230 / TARGET_ABSENT 8255 / raw 12.97%  
- old edges newly resolved: 0  
- new edges: 0  

### Queue #3 / #4

- new cases normalized via identity/court/jurisdiction paths  
- historical currentness apply: **+84**  
- unknown currentness preserved: **144**  
- silent-current defects: 0  

### Integrity

- duplicates 0 / orphans 0 / missing embeddings 0 / duplicateCitationEdges 0  

### Validation

- queue2:validate PASS  
- queue2:preflight PASS  
- research typecheck PASS  

### External AI

All 0 (OpenAI/Claude/Gemini/Grok/other LLM/embeddings/subagents)

### Queues

#2 OPEN · #3 OPEN · #4 OPEN · #5 NOT_OPEN · #9 CLOSED

## NEXT BEST ACTION

After hour reset: continue **1990–1999 underfilled state historical** only (lowest counts: WV/DC/DE/NJ/MI/KS/VT/NV/AK…), micro-pilot districts with prior ≤2.75 (cand/dcd/flsd), circuits **cadc/ca1 only**. Never reopen ca2/ca4/ca10/cafc/waed_1985_1994 unchanged. Cap per-court with circuit breaker before deep fetch on already-dense 1970s windows.

Classification: MANUAL_WEEK2_REQUEST_EFFICIENCY_RECOVERY_AND_SCALE
