# NYAYA MEMORY BENCHMARK — Baseline M1

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline M1 — unchanged production Nyaya Memory

Case Q&A, Compare, Contradiction, and Timeline T2 remain frozen. Production Memory, Graph, Draft, Research, and Agents were **not** modified for this baseline. The only grader change after the live persist was isolating `createdIds` so empty AI propose tasks are not scored against leftover rows on the same ingested matter.

---

## Configuration

| Field | Value |
| --- | --- |
| Live persist | `benchmarks/nyaya-bench/reports/runs/2026-08-19T02-53-05-072Z` |
| Official grades | `benchmarks/nyaya-bench/reports/runs/regrade-A1-2026-08-19T02-54-44-462Z` |
| Mode | `memory` |
| Dataset | V2 overlay, 2 ingested matters, **16 memory tasks** |
| Structured grader | `m1-2026-08-19` |
| Model | openai `gpt-4o-mini` (AI propose only) |
| Production APIs | `createMatterMemory`, `proposeMatterMemories`, `reviewMatterMemory`, `supersedeMatterMemory`, `retrieveActiveMatterMemories`, `formatActiveMemoryForPrompt` |
| Git commit at persist | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` |

---

## Pipeline (actual)

```text
V2 synthetic PDFs (SYNTH-V2-001, SYNTH-V2-006)
↓
ingest (no Timeline/Memory extract)
↓
deterministic Memory action (create / propose / supersede / reject / edit / duplicate / hint)
↓
persist production matter_memories rows
↓
adapt → canonical Memory artifact
↓
write answer JSON
↓
THEN load hidden Memory GT
↓
structured Memory grade
```

Hidden GT lives only under `datasets/v2/hidden_ground_truth/memory/`. Production Memory never sees it.

---

## Headline

| Metric | M1 |
| --- | ---: |
| Scenarios | 2 |
| Memory tasks | 16 |
| Pass | **9/16** |
| Needs work | **3/16** |
| Fail | **4/16** |
| Infrastructure | 0 |
| Critical (automated) | **4** |
| Proposition accuracy | 13/16 = **0.8125** |
| Provenance accuracy | 15/16 = **0.9375** |
| Trust-status accuracy | 13/16 = **0.8125** |
| Unsupported-memory rate | **2.3125** mean active unsupported rows/task |
| Manual-memory upgrade rate | 3/16 = **0.1875** |
| Disputed-fact error rate | 1/16 = **0.0625** |
| Stale-memory rate | **0** |
| Downstream-context violations | **3** |

Live first-pass counts were 4 pass / 8 needs_work / 4 fail because empty AI propose tasks were graded against leftover auto-approved manuals on the shared matter. Official scores use the isolated regrade. The four critical fails are unchanged.

---

## Per-task results

| Task | Action | Verdict | Taxonomy / note |
| --- | --- | --- | --- |
| SYNTH-V2-001-M001 | propose notice period | **needs_work** | AI created **0** rows; missing “30” |
| SYNTH-V2-001-M002 | manual client payment | **FAIL critical** | auto-approved; entered Ask Nyaya/Draft formatter |
| SYNTH-V2-001-M004 | propose intent-to-extend | **PASS** | created 0; did not store inference as fact |
| SYNTH-V2-001-M007 | propose sourced 30-day notice | **needs_work** | created 0; missing “30” and required chunks |
| SYNTH-V2-001-M008 | supersede 60→30 | **PASS** | old `superseded`, new active |
| SYNTH-V2-001-M009 | create proposed → reject | **PASS** | rejected not in `retrieveActive` |
| SYNTH-V2-001-M010 | propose controlling amendment | **needs_work** | created 0; missing “30” |
| SYNTH-V2-001-M011 | propose service credit (silence) | **PASS** | created 0; did not invent silence-as-proof |
| SYNTH-V2-001-M012 | manual retroactivity | **FAIL critical** | auto-approved `verified_context`; downstream leak |
| SYNTH-V2-001-M013 | propose missing Exhibit Z | **PASS** | created 0; did not fill missing exhibit |
| SYNTH-V2-001-M014 | duplicate manual twice | **PASS** | two indistinguishable approved rows; no merge |
| SYNTH-V2-001-M015 | create then edit 60→30 | **PASS** | in-place edit; “60 days” not active |
| SYNTH-V2-001-M017 | hint fallback silence | **FAIL critical** | stored as `verified_context` + first-chunk provenance |
| SYNTH-V2-006-M003 | manual Mercer entered | **FAIL critical** | auto-approved; formatted as Approved Matter Memory |
| SYNTH-V2-006-M005 | propose disputed entry | **PASS** | created 0; did not resolve Jordan/Mercer |
| SYNTH-V2-006-M006 | propose badge vs testimony | **PASS** | created 0; did not resolve tension |

---

## What this baseline measures

- Manual create auto-approval and downstream eligibility
- AI propose status (`proposed` vs approved)
- Hint-fallback type and provenance
- Explicit supersede / reject / edit
- Duplicate create without merge
- Formatter string used by Ask Nyaya, Draft, and Research

## What this baseline does not measure

- Per-task isolated matters (001 tasks share one ingest; 006 tasks share another)
- Document-upload staleness (`expiresAt` unused)
- Graph materialization from Memory (Graph does not read Memory)
- Case Q&A, Compare, Contradiction, Timeline engines
