# Nyaya Research

Nyaya Research is NyayaGrid's legal research capability: a shared corpus of imported legal
authorities (cases, statutes, regulations, etc.), hybrid retrieval over that corpus, and
grounded, citation-verified synthesis. It lives in `packages/research` and the `phase6` database
schema (`packages/database/src/schema/phase6.ts`).

The single rule underlying every decision in this package: **matter documents are not legal
authority, and legal authority is not matter evidence.** The two are stored in separate tables,
retrieved by separate code paths, and never merged into one citation.

## Corpus model

`legal_authorities` is a shared, tenant-agnostic table — it has no `organizationId` or `matterId`
column. This is intentional: authorities are reference material (public-domain-style case law and
statutes), and giving them a tenant column would create a temptation to eventually let one
organization's imported authority leak into a query filtered on another organization's id. Instead,
isolation is structural: confidential matter content lives exclusively in `document_chunks`, and
the authority corpus lives exclusively in `legal_authority_chunks`. Nothing joins the two.

Each authority has:

- `legal_authority_versions` — the actual text, append-only. Importing identical content again is a
  no-op; importing changed content closes the previous version (`validTo = now()`) and inserts a
  new one. Old text is **never deleted or rewritten**.
- `legal_authority_chunks` — the retrieval/embedding unit, tied to exactly one version. Cases can
  tag chunks with `opinionPart` (`majority`/`concurrence`/`dissent`); statutes can tag chunks with
  `sectionRef`/`subsectionRef`. By default, search only reads chunks whose parent version has
  `validTo IS NULL`, so superseded language cannot surface as if it were still good law.
- `legal_authority_citations` — outbound citations parsed out of the authority's own text
  (`extractCitationsFromText`), resolved to another corpus authority only when the match is
  unambiguous.
- `legal_authority_relationships` — structured cites/interprets/supersedes/amends/related edges,
  each tagged with an `origin` (`parsed`, `reviewed`, `source_metadata`) so a human-reviewed edge
  can be distinguished from a machine guess.

## Providers

`LegalAuthorityProvider` (`packages/research/src/provider.ts`) is the pluggable interface for
"where authorities come from." Each implementation declares a `capabilities` object
(`search`, `getAuthority`, `getAuthorityText`, `resolveCitation`, `relatedAuthorities`,
`treatmentInfo`) so callers can degrade gracefully instead of assuming every provider can answer
every question.

`LocalImportedAuthorityProvider` is the only implementation shipped today. It performs **no network
calls** — it can only ever surface an authority that was explicitly imported via `importAuthority`.
This is deliberate for the free/local-first NyayaGrid deployment model: there is no built-in
connection to a commercial case-law database. A production deployment that wants live case-law
lookup would implement a new `LegalAuthorityProvider` (e.g. backed by a licensed API) and pass it
into `runResearchQuery`/`generateResearchMemo` via the `provider` parameter — the retrieval,
validation, and provenance-separation logic does not change.

## Ingestion (`importAuthority`)

`importAuthority` (`packages/research/src/ingest.ts`) is the only way authorities enter the corpus:

1. Metadata is validated by `importAuthorityInputSchema` — title, type, content, and
   `sourceProvider`/`sourceExternalId` are required, and a filename-shaped title (e.g.
   `opinion_final.pdf`) is rejected outright. Nothing is inferred from a file name.
2. Idempotency is keyed on `(sourceProvider, sourceExternalId)`. The content hash (`sha256`) is
   compared against the latest version; identical content is skipped (`skipped: true`) with no new
   version, no new chunks, and no re-embedding.
3. Changed content always creates a **new immutable version** — never an in-place edit. The
   previous version's `validTo` is stamped and it stops being searched by default, but its rows
   remain in the table forever.
4. Structured input (`sections` for statutes, `opinionParts` for cases) is preferred over the flat
   `content` string when chunking, so a citation can point at "§ 100(b)" or a dissent rather than
   an undifferentiated blob. Long paragraphs are split at sentence boundaries; short chunks are
   never merged.
5. Every chunk is embedded (batches of 32) with whatever `EmbeddingProvider` is passed in.
6. Outbound citations are parsed from the raw content and stored with `rawCitation` preserved
   verbatim; `toAuthorityId` is only ever set when `resolveCitationAgainstCorpus` finds exactly one
   match.
7. An audit event (`legal_authority.imported` / `legal_authority.version_added` /
   `legal_authority.import_skipped`) is written for every call.

Because the shared corpus has no per-run namespace, re-running an ingestion script or an
integration test suite against a persistent database is idempotent by design for unchanged
fixtures — but a test suite that intentionally re-imports _modified_ fixture content (to exercise
"new version on content change") should clean up its own fixture rows first if it expects a fixed
version count on every run; otherwise successive runs will legitimately keep adding versions,
which is the same idempotency guarantee working correctly, not a bug.

## Citation architecture

`packages/research/src/citations.ts` implements a small set of composable citation parsers
(`USReportsParser`, `FederalReporterParser`, `StatuteCitationParser`, `RegulatoryCitationParser`).
`parseCitation` returns a `ParsedCitation` with a `confidence` of `high`/`low`/`unknown` and a
`normalized` form that is `null` whenever normalization would be a guess — callers must never
silently coerce an ambiguous citation into a canonical-looking string.

`resolveCitationAgainstCorpus` resolves a citation (or already-parsed `ParsedCitation`) to a corpus
`authorityId` by matching `normalizedCitation` or the raw `citation` column. It returns `null`
whenever **zero or more than one** authority matches — an ambiguous match is never guessed at,
because misattributing a quote to the wrong case is worse than not resolving it at all.

## Versioning and treatment limitations

Versioning is described above (ingestion). Treatment (whether an authority is still good law) is
handled conservatively in `packages/research/src/treatment.ts`:

- `treatmentStatus` is `unknown` unless a source explicitly reported treatment signals
  (`source_reported`, backed by a `legal_authority_relationships` row with
  `origin: source_metadata | reviewed`).
- `containsEditorialTreatmentClaim` / `assertTreatmentClaimIsSourced` actively guard against
  NyayaGrid ever generating its own editorial conclusion ("overruled", "good law", "distinguished",
  etc.) — that vocabulary may only appear when a source actually reported it.
- Every authority display includes the fixed `TREATMENT_UNVERIFIED_NOTICE` unless treatment is
  source-reported, and coverage warnings always add it again if it wasn't already covered.

There is currently no citator/Shepardizing integration; this is the honest floor for a
free/local-first deployment with no licensed treatment data feed.

## Retrieval

`AuthorityHybridRetriever` (`packages/research/src/search.ts`) combines:

- **pgvector cosine similarity** over `legal_authority_chunks.embedding` (`vector(384)`), and
- **Postgres full-text search** (`to_tsvector('english', content)` / `to_tsquery`),

merging results with configurable weights (`VECTOR_WEIGHT = 1`, `FTS_WEIGHT = 1.1`), plus additive
boosts for an exact citation match (`EXACT_CITATION_BOOST = 0.75`) and title overlap. Filters
(`jurisdiction`, `court`, `authorityType`, date range, `sourceProvider`, `citation`, `title`) are
applied at the SQL level before ranking, and by default only `ready`-ingested authorities and
non-superseded (`validTo IS NULL`) chunks are considered.

Two runtime guards make the "never returns matter documents" invariant enforceable rather than just
documented:

- `assertAuthorityHitsOnly(hits)` throws if any hit carries a matter-scoped field
  (`documentId`/`documentVersionId`/`matterId`/`organizationId`) or is missing
  authority/chunk/version ids.
- `assertChunksBelongToAuthorityCorpus(db, chunkIds)` re-queries `legal_authority_chunks` directly
  and throws if any returned id does not actually exist there.

Both run on every `AuthorityHybridRetriever.search()` call, so a future regression that
accidentally joined in `document_chunks` fails loudly instead of leaking silently.

## Quote validation

`validateQuoteAgainstText` (`packages/research/src/quotes.ts`) is the last line of defense against
fabricated quotations. It normalizes only typography (smart quotes, en/em dashes, non-breaking
spaces, ellipses, whitespace) — **never wording** — and then requires the normalized quote to
appear as a verbatim substring of the normalized source text. Quotes under 12 characters or 3 words
are rejected outright as too short to meaningfully verify. `validateQuoteCandidates` applies this
across a batch of model-proposed quotes against a `chunkId -> text` map, splitting them into
`accepted`/`rejected`.

## Jurisdiction and weight

`classifyAuthorityWeight` (`packages/research/src/weight.ts`) produces a coarse, conservative label
— `potentially_binding`, `persuasive`, or `unknown` — **never a numeric score**. An authority is
only ever labeled `potentially_binding` when its jurisdiction matches the query's jurisdiction _and_
it has non-placeholder court metadata; the label's own reason string reminds the reader that binding
force still requires attorney verification of court hierarchy and currentness. Anything short of
that (missing jurisdiction, missing court, cross-jurisdiction) resolves to `persuasive` or
`unknown`.

## Proposition mapping (FACT_SOURCE vs. LEGAL_AUTHORITY)

`ResearchProposition` (defined in `packages/database/src/schema/phase6.ts`, used across
`synthesize.ts`, `memo.ts`, and `packages/intelligence/src/draft`) carries a `provenanceClass`:

| provenanceClass   | Points into                             | `authorityIds` | `matterChunkIds` |
| ----------------- | --------------------------------------- | -------------- | ---------------- |
| `LEGAL_AUTHORITY` | `legal_authority_chunks` (corpus)       | populated      | never set        |
| `FACT_SOURCE`     | `document_chunks` (confidential matter) | always `[]`    | populated        |

`runResearchQuery` only ever produces `LEGAL_AUTHORITY` propositions (a pure research query has no
matter facts to cite). `generateResearchMemo`'s `buildMemoPropositions` adds one additional
`FACT_SOURCE` proposition — built from `memo.factsAssumptions`, never from the legal analysis
section — whenever matter document chunks were loaded. `classifyDraftAssertions` in
`packages/intelligence/src/draft/helpers.ts` applies the same split to draft assertions so a
generated memo/motion never lets a legal rule and a case fact share one citation entry.

## Matter / Draft / Nyaya integration

- **Matter**: `saveAuthorityToMatter` / `updateMatterAuthorityStatus` / `listMatterAuthorities`
  manage the `matter_authorities` join table (`status: saved | key_authority | rejected |
not_relevant`). `loadMatterLegalAuthorityContext` loads the authorities a matter team has saved
  (current-version passages only) and `formatLegalAuthorityContextForPrompt` renders them behind a
  fixed `LEGAL_AUTHORITY` header that explicitly tells the model these passages are the _only_
  permissible basis for rules/holdings/quotes and are _not_ matter evidence. `createResearchNote`
  supports `origin: manual | ai` so an attorney's own note is never confused with an AI-authored
  one.
- **Draft**: `loadDraftLegalAuthorityContext` (`packages/intelligence/src/draft/authorities.ts`)
  pulls the same matter-saved authorities into Nyaya Draft's context, kept in a separate prompt
  block from matter document sources. `classifyDraftAssertions` then re-derives each generated
  assertion's provenance from which chunk ids it actually cited, rather than trusting whatever the
  model claims.
- **Nyaya (Q&A)**: `askNyayaAboutMatter` (`packages/search/src/nyaya.ts`) detects doctrinal
  questions with `looksLikeLegalDoctrineQuestion` and, when the matter has saved authorities, sets
  `usedLegalAuthority: true` and includes the `LEGAL_AUTHORITY` context block alongside (never
  merged with) matter document context.

## Free/local limitations

NyayaGrid's default deployment is free and local-first (`AI_PROVIDER=mock`,
`EMBEDDING_PROVIDER=mock`, `LocalImportedAuthorityProvider`). This means:

- **No live case-law database.** The corpus only contains what was explicitly imported via
  `importAuthority`. There is no built-in connector to a commercial legal research service.
- **No citator/Shepardizing service.** Treatment is `unknown` unless a source explicitly reported
  it; NyayaGrid does not independently determine whether an authority is still good law.
- **No numeric authority ranking.** `classifyAuthorityWeight` returns a coarse three-value label,
  never a score, and always recommends attorney verification.
- **Corpus coverage is whatever was imported.** `buildCoverageWarnings` unconditionally states that
  search covered only the imported corpus and is not a comprehensive survey of the law of any
  jurisdiction; a thin corpus (≤2 distinct authorities matched) gets an explicit extra warning.
- **Mock providers are deterministic but not semantically aware.** `MockEmbeddingProvider` hashes
  text into a vector, so it will always return the nearest neighbors by cosine similarity from
  whatever is in the corpus, even for an unrelated question. The way to reliably exercise the
  "insufficient coverage" path in tests/fixtures is a filter that matches nothing (e.g. an unused
  jurisdiction), not just an off-topic question string.
