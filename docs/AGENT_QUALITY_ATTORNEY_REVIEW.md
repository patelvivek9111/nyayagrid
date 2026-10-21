# Agent Quality — Attorney Review Process

Blind review of **live** agent outputs (Case Q&A, contract compare, contradiction/timeline).

An automated suite passing with no human sign-off is **not** evidence of production attorney-grade quality. Numeric bars in [`AGENT_QUALITY.md`](./AGENT_QUALITY.md) are necessary but not sufficient until an **`attorney`** pass is recorded for Section B. An `operator` pass unblocks engineering; it does **not** close Section B.

## How to run a pass

1. Export live outputs (not mock):

   ```bash
   EVAL_LIVE=1 OPENAI_API_KEY=... EVAL_LIVE_MODEL=gpt-4o-mini EVAL_EXPORT_REVIEW=1 npm run eval:ai:live
   ```

   Packets land under gitignored `docs/agent-quality-review/exports-live/` (question/input, full output, cited sources). Historical packets are not kept in git.

2. Reviewer role (pick one; do not upgrade the label):

   | Role | Who | Counts as Section B close-out? |
   | --- | --- | --- |
   | `attorney` | Admitted lawyer who did **not** write the agent/eval code | **Yes** |
   | `student` / `paralegal` | Legal training, did not write the code | No — record the pass; keep Section B open |
   | `operator` | Builder / founder scoring against SYNTH fixtures they know | **No** — Layer 1 only; never put this name in the attorney field |

   If you have no practicing attorney: run an `operator` pass for engineering unblocking. It does **not** authorize Harvey-level or production attorney-grade claims.

3. For each item, score **pass / needs-work / fail**:
   1. Would I have caught this myself?
   2. Is anything wrong or missing?
   3. Would I send this to a client with light editing, or does it need a rewrite?

   Treat **fail** and **needs-work** as below “useful without major edit.”

4. Record results outside git (or in a private ops log). Any systematic gap (e.g. contract compare missed material changes repeatedly) must be filed as a specific fix and **blocks closing Section A’s bar for that workflow**.

## What to check

- Faithfulness to retrieved SYNTH / matter sources (no invented citations, dates, parties, or holdings)
- Completeness vs planted facts and dual-sided conflicts
- Correct refusal / partial when evidence is missing
- Privilege and confidentiality: AI proposals never treated as final

## Related

- [`AGENT_QUALITY.md`](./AGENT_QUALITY.md) — numeric bars and hard rules
- [`AI_EVALUATIONS.md`](./AI_EVALUATIONS.md) — mock eval suite
- [`AI_EVAL_LIVE.md`](./AI_EVAL_LIVE.md) — live env vars and budgets
