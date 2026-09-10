# Dogfood matters

All files are SYNTHETIC. Parties, amounts, and citations in the packets are fictional test content. Do not ingest `datasets/**/hidden_ground_truth`.

| ID | Title | Domain | Profile | Source | Workflows |
| --- | --- | --- | --- | --- | --- |
| DF-01 | Cedar Gate Office Lease | Commercial lease | Commercial contract dispute | FW-01 text packet | All 10 listed loops |
| DF-02 | Harborline Wage Packet | Employment | Employment dispute | FW-03 text packet | All 10 |
| DF-03 | Mesa Ridge Pay-If-Paid Job | Construction | Civil / construction | FW-04 text packet | All 10 |
| DF-04 | Prairie Revolver | Commercial loan | Contradiction-heavy | FW-06 text packet | All 10 |
| DF-05 | Rivermark Supply Dispute | Goods contract | Document-heavy | FW-09 long packet | All 10 |
| DF-06 | SilverKey Patent License | IP license | Deposition vs access log | V2 `SYNTH-V2-006` PDFs | Orientation, Ask, Timeline, Evidence, Contradictions, Compare, Draft, Missing evidence (no Research unless facilitator enables it) |

Generate local copies:

```bash
npm run dogfood:pack -w @nyayagrid/nyaya-bench
```

## Ask prompts (FW matters)

Use the prompts in each packet `TASKS.md`. They cover operative amount, currently operative notice, a listed-but-missing exhibit, governing law vs a trap state mentioned in the file, meeting date, and physical entry. Check the sources; do not assume the “smooth” answer is right.

## What is not in the reviewer pack

- Hidden ground-truth JSON
- Benchmark bait-case answers
- Isolation-token trap questions (those are certification tests, not lawyer work)
- Live model outputs (facilitator may add `outputs/` later without rerunning V3.1)

## Criminal / procedure note

There is no complete criminal case file in this repo that is safe to present as a criminal matter. DF-06 is the procedure analog: testimony vs system activity, not a charging decision.
