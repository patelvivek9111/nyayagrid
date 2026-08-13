# Agent Quality — Task Tracker

Living checklist for industrial Case Q&A / contract / contradiction quality.
Mark items `[x]` in this file as they ship. Do **not** create a new plan `.md` for each slice — update this one.

Spec: [`AGENT_QUALITY.md`](./AGENT_QUALITY.md) · Evals notes: [`AI_EVALUATIONS.md`](./AI_EVALUATIONS.md)

---

## Done

- [x] Agent Quality Spec (3 money workflows)
- [x] Verbatim quote validation on Case Q&A
- [x] Verified intel without doc cites → `partial` (never `grounded`)
- [x] Contract compare wired in planner + contract agent
- [x] Case Chat quality surfaces (`evidenceState`, sources drawer, insufficient UX)
- [x] Documents: Compare versions UI
- [x] Evidence: dual-sided contradiction cards + detect/review
- [x] Timeline: proposed vs verified callout; link to Evidence conflicts
- [x] Playwright smoke (insufficient path, Documents compare, Evidence contradictions)
- [x] Golden matter corpus + graded rubrics (`faithfulness`, `completeness`, `need_more_docs`)
- [x] Multi-hop retrieval + `needsMoreDocuments` in ask path + Case Chat banner
- [x] `npm run eval:ai` smoke + golden graded suite (mock)
- [x] Clause-aligned comparison summary scoring vs deterministic diffs (+ Documents/Analysis UI cues)
- [x] Contradiction ↔ Timeline linking (read-only related IDs; dual sides never auto-merged)
- [x] Live regression suite (pinned model, budgets, baselines, optional nightly/manual CI)
- [x] Seeded SYNTH golden matter fixtures + `seed:golden-matter` demo CLI
- [x] Playwright grounded answer path (upload synth lease → sources + grounded badge)
- [x] Issue-spotting graded cases (CAM date conflict across depo + email)

---

## To do

_(none — hardening slice complete; open a new section only if product asks)_

**Next track:** [`CASE_EXPERIENCE_TRACKER.md`](./CASE_EXPERIENCE_TRACKER.md) — industrial Case tabs (People, Tasks, Work, Memory, Graph, Draft, Home).

---

## Out of scope (do not pull in unless asked)

- Autonomous filing / send / settle
- Auto-verifying Memory or Graph
- Licensed Westlaw/Lexis replacement
- Confidence % as mathematical certainty
- Expanding agent count before the three workflows feel industrial end-to-end

---

## How to use

1. Pick the next unchecked section (order above is preferred).
2. Implement + test.
3. Check off boxes in **this file** in the same PR/session.
4. Move a whole section to **Done** only when all of its boxes are `[x]`.
