# NyayaGrid legal-professional dogfood pack

**Status: READY-FOR-HUMAN-REVIEW**

This pack is for practicing lawyers or legally qualified reviewers. It is **not** a quality-gate substitute for V3.1 or FW1. Automated scores already exist; this pack tests whether the product is understandable, cautious, source-traceable, and useful in realistic work.

Do not treat an engineering self-score as attorney review. Do not manufacture PASS.

FEATURE_AGENTS=0. Synthetic / public-test material only. No real client files.

## What is in this folder

| File | Audience |
| --- | --- |
| [REVIEWER_INSTRUCTIONS.md](./REVIEWER_INSTRUCTIONS.md) | Reviewers |
| [RUBRIC.md](./RUBRIC.md) | Reviewers |
| [REVIEW_PACKET.md](./REVIEW_PACKET.md) | Compact packet + form |
| [MATTERS.md](./MATTERS.md) | Matter list (no ground truth) |
| [RECRUITMENT.md](./RECRUITMENT.md) | Facilitator |
| [FACILITATOR.md](./FACILITATOR.md) | Facilitator only |
| `forms/*.csv` | Spreadsheet forms |
| `aggregate.ts` | Deterministic rollup |

Generate source files (no model calls):

```bash
npm run dogfood:pack -w @nyayagrid/nyaya-bench
```

Packets land in gitignored `dogfood/dist/packets/`.

After reviews are collected:

```bash
npm run dogfood:aggregate -w @nyayagrid/nyaya-bench
```

## Matters (6)

1. **DF-01** Cedar Gate Office Lease — commercial contract
2. **DF-02** Harborline Wage Packet — employment
3. **DF-03** Mesa Ridge Pay-If-Paid Job — civil / construction
4. **DF-04** Prairie Revolver — contradiction-heavy finance
5. **DF-05** Rivermark Supply Dispute — document-heavy goods
6. **DF-06** SilverKey Patent License (V2 PDFs) — deposition vs access-log procedure analog

No in-repo criminal case file is complete enough to review safely. Do not add one for this pack.

## Gate (after humans)

Preferred **DOGFOOD PASS**: 0 CRITICAL; mean A/B/K ≥ 4; usefulness ≥ 4; majority YES or WITH CHANGES; at least one **attorney** reviewer.

**HOLD** if any reproducible CRITICAL, recurring unsupported material claims, or reviewers cannot trace conclusions to sources.

Until attorney reviews exist, aggregation stays **READY-FOR-HUMAN-REVIEW**.
