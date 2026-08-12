# Professional Analysis

Matter-scoped AI-assisted document analysis: contract review, version comparison, deposition review, contradiction detection, and an evidence matrix that ties them together. All analysis is a proposal for attorney review, never a final legal conclusion.

## Contract analysis

- `analyzeContract(documentId, documentVersionId)` — idempotent per document version (`contract_analysis:{documentVersionId}`); re-running without `force` returns the existing analysis.
- Produces `document_analyses` (summary) + `document_analysis_items` (clause-level findings: `category`, `attention: informational|review|high_attention`, `status: proposed|reviewed|dismissed`), each backed by `document_analysis_sources` chunk citations. An item with no authorized source chunk is dropped before persistence.
- `reviewAnalysisItem` moves an item to `reviewed` or `dismissed`; only reviewed items are treated as usable structured context for Nyaya.
- `generateRedlineSuggestions` proposes clause edits (`redline_suggestions`, `status: proposed|accepted|rejected`) from an existing analysis. `reviewRedlineSuggestion` accepts or rejects a suggestion. **Accepting a redline never mutates the underlying document version** — the original text and `sha256` are unchanged; the redline is a proposal layered on top.

## Document comparison

- `compareDocuments(documentAId/versionAId, documentBId/versionBId)` — idempotent regardless of argument order (idempotency key sorts the two version IDs).
- Uses a deterministic paragraph-level LCS diff (`computeParagraphDiffs`) to produce `document_comparison_changes` (`added|removed|changed|moved|formatting`, with an `attention` heuristic for termination/indemnification/liability language). An optional AI summary describes the changes in prose but never replaces the deterministic diff.
- `getDocumentComparison` / `listDocumentComparisons` retrieve persisted comparisons and their changes.

## Deposition analysis and contradictions

- `analyzeDeposition(documentId, documentVersionId)` — requires the document to be `ready` (fully processed); idempotent per version (`deposition:{documentVersionId}`).
- `detectContradictionCandidates(documentId?)` — scans matter-scoped chunks (optionally restricted to one document) for opposing statements; idempotent per matter+document scope (`contradiction:{matterId}:{documentId|"matter"}`).
- Both write to the shared `analysis_runs` / `analysis_findings` / `analysis_finding_sources` tables (`runType: deposition|contradiction`). Contradiction findings tag each source row with `side: "A"` or `"B"`; a finding is only persisted when both sides have at least one authorized citation.
- `reviewFinding` moves a finding to `reviewed` or `dismissed` with an optional note.
- `listFindings` supports filtering by run type, status, finding type, and document.

## Evidence intelligence

- `getEvidenceIntelligence(matterId)` builds a per-document view (linked verified timeline events, verified facts, entities, approved graph edges, and `important` flag) plus an `evidenceMatrix` of issues, each with `supporting` citations, `contrary` citations (from unresolved contradiction findings), and `gaps` (missing citations).
- `markDocumentImportant` toggles the `important` flag on a document's review state, surfaced back into the matrix.
- The matrix is built only from verified/approved records (`approved` / `edited_and_approved`) plus proposed/reviewed contradiction findings — it does not silently include rejected or dismissed material.

## Citations are mandatory

Every analysis item, redline suggestion (when tied to source text), deposition finding, and contradiction side requires at least one server-validated chunk citation scoped to the same organization and matter. Cross-matter or hallucinated chunk IDs never reach persistence — see `SECURITY.md`.
