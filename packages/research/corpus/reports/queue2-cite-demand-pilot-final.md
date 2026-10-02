# CITATION_DEMAND_TARGETED_CL_PILOT_AND_ADAPTIVE_SCALE

STATUS: PARTIAL (first calibrated sample; 429 on minute=15 after 16 CL)

## LIVE START
cases 3867 → end 3875
extracted 36605 → 36912
resolved 1815 → 1880 (+65 incl. smoke+pilot)
resolution 4.96% → 5.09%

## PILOT (acquisition CL)
CL 16 | attempted 8 | acquired 7 | found 8 (incl. rate-limited after verify)
old unresolved resolved +54 (pilot window 1826→1880)
useful authorities +7 (pilot) / +8 session incl. smoke
CL/successful target ≈ 2.29 (16/7) | ≈2.0 excluding failed attempt
old-edges/CL ≈ 3.375
old-edges/target ≈ 7.71

## FAMILY (LOW_SAMPLE; edges equal-shared from aggregate reresolve)
US: 2 acq / 4 CL — edges/CL ≈ 3.86
federal_reporter: 2 acq / 4 CL — edges/CL ≈ 3.86
regional_reporter: 3 acq / 6 CL — edges/CL ≈ 3.86
F.Supp: 0 — not piloted

## 429
minute limit 15 binding; STOP persisted; no post-429 CL
next: CL_RATE_MS>=4500

## PRODUCTION CONCLUSION
1. Target-mode cost ≈ 2 CL/successful target via citation-lookup; ≈3.4 old-edges/CL (n=7, LOW_SAMPLE)
2. Highest family TBD — sample too small to rank; all three families produced resolves
3. Old window CL/case correlation: INCONCLUSIVE (different mode; not used for cost)
4. Scale confidently? NO — insufficient sample + minute throttle
5. Next 100 CL: stratified high-demand with 4.5s pacing; prefer mix US/F.3d|F.4th/P.3d|S.E.2d
