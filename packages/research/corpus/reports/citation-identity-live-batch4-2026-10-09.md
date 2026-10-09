# Citation Identity Live Batch 4 — Efficiency Frontier

**Stop:** EFFICIENCY_FRONTIER_REACHED  
**CL total:** 21 (probe 1 + lookups 20)  
**Full-text acquired:** 0  
**Day remaining (est):** 492

## Local pre-pass

aliases available: 487  
parallels available: 244  
newly local targets: **0**  
newly local edges: **0**  
CL avoided: **0**

## Demand buckets (external)

| Bucket | Attempted | Resolved | Rate | Edges/CL |
|---|---:|---:|---:|---:|
| >=10 | 19 | 4 | 21.1% | 2.68 |
| 5–9 | 1 | 1 | 100.0% | 9.00 |
| 3–4 | 0 | 0 | 0.0% | 0.00 |
| 1–2 strategic | 0 | 0 | 0.0% | 0.00 |

## Yield

external HIGH: **25.0%** (5/20)  
external edges / CL: **3.00**  
total edges / CL (incl local): **2.86**  
edges resolved: external **60** + local **0** = **60**

Batch1 90%/14.15 → Batch2 87%/7.50 → Batch3 81%/4.56 → Batch4 25.0%/2.86

## Frontier

**Recommended bulk threshold:** >=5 edges  
- Batches 1–3: 5–9 ~88% HIGH / ~5.5–7.5 edges/CL (durable bulk band)
- 3–4 historically ~2.3–3.5 edges/CL — near stop gate; not permanent bulk default
- Batch 4 remaining >=10: 79% NOT_FOUND, mostly `YYYY Page N` extraction artifacts
- Reporter-valid HIGH still efficient (3.0 edges/external CL) before frontier stop

Below threshold: local-first / strategic exceptions only; filter page artifacts from external queue.

## Next

**MIX_IDENTITY_AND_FULLTEXT** — next CL budget (not executed): **40**  
**CITATION_IDENTITY_EFFICIENCY_FRONTIER_ESTABLISHED**
