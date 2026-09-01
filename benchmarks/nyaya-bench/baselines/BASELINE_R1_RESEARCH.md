# NYAYA RESEARCH — Baseline R1

Synthetic-fixture / local corpus evaluation only. This is **not** attorney review and **not** Westlaw/Lexis coverage.

**Label:** Baseline R1 — Research against **unchanged** production

Live persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T16-09-49-522Z`  
Official grades after a **benchmark-defect** fix on R015 (hits ≠ citations): `.../regrade-A1-2026-08-19T16-14-43-552Z`

Do not overwrite after later product changes. Not combined with Graph G2 or Draft D2.

Production Research was not modified in this phase. **No R2.**

---

## Score (official, post-grader correction)

| | |
| --- | --- |
| Tasks | 18 |
| Pass | 15 |
| Needs work | 3 (R002 ranking decoy in hit set; R003/R004 synthesis ungrounded despite good retrieval) |
| Fail | 0 |
| Infrastructure | 0 |
| Critical | 0 |

Original live tally had R015 FAIL because the grader treated a decoy named in the **question** appearing in **retrieval hits** as a wrong-authority **citation**. Regrade checks proposition `authorityIds` only. Class **L**.

Prompt versions: `research-synthesis-v2`, memo `research-memo-v1`.
