# Citation resolution (corpus-owned)

Corpus-owned identity-resolution artifacts. No shared product schema migration.

- `local-high-write-plan-*.json` — dry-run write plans (not applied until authorized)
- `ledger/*.jsonl` — reversible resolution provenance (created on authorized apply)
- `checkpoints/` — CourtListener identity-batch checkpoints (future live runs)

## States

`IDENTITY_UNRESOLVED` → `AUTHORITY_RESOLVED` → `CORPUS_COMPLETE`

`AUTHORITY_RESOLVED` never implies full opinion text exists.
