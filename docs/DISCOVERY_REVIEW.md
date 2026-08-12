# Discovery Review

Matter-scoped e-discovery document review: relevance, privilege, responsiveness, and confidentiality classification, plus tagging and duplicate detection. This is a human review workflow with AI assistance — it is not an automated discovery decision engine.

## Human review model

- `document_review_states` holds one row per document with **two independent sets of fields**:
  - Human-authoritative: `relevance`, `privilege`, `responsiveness`, `confidentiality`, `important`, `reviewNotes`, `humanPrivilegeFinal`.
  - AI-proposed only: `aiRelevance`, `aiPrivilege`, `aiResponsiveness`, `aiProposalNote`.
- `updateDiscoveryReview` writes only the human fields (plus `reviewedByUserId`/`reviewedAt`). It never touches the `ai_*` columns.
- `proposeDiscoveryClassification` calls the AI classifier and writes only the `ai_*` columns. It never sets `relevance`, `privilege`, `responsiveness`, `confidentiality`, or `humanPrivilegeFinal`.
- `listDiscoveryQueue` lists all matter documents with their review state and can filter to documents still pending any classification.

## Privilege requires explicit human authority

Setting `privilege` to `privileged` or `not_privileged` via `updateDiscoveryReview` **requires the caller to pass `humanPrivilegeFinal: true` in the same call**; the call throws before writing anything otherwise. Once that guard is satisfied, the row is stored with `humanPrivilegeFinal = true`. This exists so a privilege determination can never be set accidentally, programmatically, or by an AI proposal alone — only an explicit human call can flip a document to a final privilege state.

Nyaya's professional-analysis context surfaces `humanPrivilegeFinal` alongside `aiPrivilege` and instructs the model that the human designation is authoritative while the AI proposal is not final — see `SECURITY.md` and `AI_EVALUATIONS.md`.

## Tags

- `createTag` normalizes a free-form label into a matter-unique `key` (lowercased, spaces to underscores) and returns the existing tag if the key already exists.
- `assignTag` links a tag to a document (idempotent — re-assigning an existing tag/document pair is a no-op).
- `listTags` returns all matter tags, optionally annotated with whether a given document has each tag assigned.

## Duplicate detection

- `detectExactDuplicates` groups documents whose **latest version** shares an identical `sha256` (`document_duplicate_groups.groupType = "exact_hash"`).
- `detectNearDuplicates` groups documents whose first chunk shares a normalized excerpt fingerprint (`groupType = "near_excerpt"`) — a conservative, deterministic near-duplicate signal, not fuzzy ML matching.
- Both are purely additive: they insert duplicate-group and duplicate-member rows and never delete a document or version. A duplicate match never causes data loss; a human decides whether to act on it.

## Caution

Discovery classification (relevance, privilege, responsiveness, confidentiality) has real legal consequences, including waiver risk for privilege. AI proposals are advisory input for a reviewing attorney only, never a substitute for human sign-off, and the schema is deliberately structured so that no AI call path can mark a document as privilege-final.
