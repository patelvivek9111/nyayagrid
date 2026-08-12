# Nyaya Draft

Nyaya Draft is matter-scoped AI-assisted drafting. It produces editable draft documents — it never files anything with a court and has no e-filing integration.

## Lifecycle

1. `createDraft` — manual draft, version 1 with attorney-authored content (or empty).
2. `generateDraft` — AI-generated draft, version 1, grounded in matter sources and verified context (Phase 3/4 facts, graph, memory).
3. `saveDraftVersion` — attorney edits create a new version (`ai_edited` if the draft originated from AI, `manual` otherwise).
4. `transformDraftSection` — targeted AI transform (`shorten` / `expand` / `change_tone` / `regenerate`) creates a new AI-edited version from the current content.
5. `restoreDraftVersion` — restoring an older version **appends a new version** with that content; history is never rewritten or deleted.

Every version is immutable once created. `drafts.currentVersionNumber` always points at the latest version; `draft_versions` is the append-only ledger.

## Provenance and grounding

- `generateDraft` and `transformDraftSection` load only matter-scoped source chunks (optionally filtered to specific `documentIds`) plus verified Phase 3 intelligence, verified Graph context, and active Matter Memory.
- The model returns `content` plus `assertions: [{text, chunkIds}]`. Every assertion's `chunkIds` are re-validated against `document_chunks` scoped to the same organization + matter (`loadAuthorizedChunks`). Assertions that cite no authorized chunk are dropped before persistence — the model cannot smuggle in an ungrounded or cross-matter citation.
- `documentIds` outside the current matter simply resolve to zero source chunks; the draft still generates, but with no assertions grounded to that document and an explicit "insufficient source material" assumption.
- If the generated content or assumptions reference external legal authority (case law, statutes, "citation needed", etc.), `appendExternalResearchNoteIfNeeded` appends a fixed disclaimer, since NyayaGrid does not perform external legal research.

## Human authorship

- `aiGenerated` on the draft header flags AI-originated drafts for UI treatment (attorney-review banner).
- AI-generated content is always labeled as requiring attorney review before use; NyayaGrid does not represent AI drafts as final legal work product.

## No court filing

Nyaya Draft produces document content only. There is no e-filing, court-system integration, or automated submission anywhere in this feature. Sending, filing, or serving a draft is entirely a manual, out-of-band human action.
