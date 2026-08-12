# Nyaya Memory

Nyaya Memory is persistent, curated matter knowledge — not conversation history.

## Lifecycle

1. Manual create → approved (manual origin)
2. AI proposal → proposed → human approve/reject
3. Edit + approve
4. Archive
5. Supersede (newer memory replaces active role of older memory; older remains historical)

## Active memory selection

Default Nyaya context includes only:

- status in `approved` / `edited_and_approved`
- not superseded (`supersededBy` is null)
- not rejected/archived

Proposed and superseded memories remain queryable in UI/history but do not silently influence answers.

## Retrieval

Matter-scoped first. Optional semantic ranking over embeddings within that scoped candidate set. No firm-wide memory in Phase 4.

## Importance

`low | normal | high | critical`  
Manual selection overrides AI suggestions. AI proposals may not freely mark everything critical.
