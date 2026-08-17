# Live remasure packet (2026-08-14 evening) — files overwritten

The **live 2** `gpt-4o-mini` markdown files that used to live here were overwritten by a later mock `eval:ai` in the same shell (`EVAL_EXPORT_DIR` leaked). Those files are **not** live model quality.

**Keep the live-2 rates.** They were recorded from the actual run in:

- [`AGENT_QUALITY_TRACKER.md`](../../AGENT_QUALITY_TRACKER.md) (live 2 table)
- [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](../../AGENT_QUALITY_ATTORNEY_REVIEW.md) (Layer 1 operator remasure)

The first live packet is still at [`../exports-live/`](../exports-live/).

Do not score anything currently in this folder as live. A mock-export guard now refuses to write mock output into a `*live*` path.
