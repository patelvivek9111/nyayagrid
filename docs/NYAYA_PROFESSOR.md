# Nyaya Professor

Nyaya Professor is NyayaGrid's Student Workspace: a private study tool for law students to upload
judicial opinions, get case briefs, ask questions about their own uploaded cases, and compare two
cases against each other. It lives in `packages/workspaces/src/professor` and the `phase8`
database schema (`packages/database/src/schema/phase8.ts`).

The single rule underlying every decision in this package: **a student's uploaded case is personal
study material, not firm evidence, and it is never joinable against professional matter data.**
Every table Professor writes to is scoped by `userId` alone — there is no `organizationId` and no
`matterId` column anywhere in the Student Workspace schema.

## Data model

- `student_conversations` / `student_messages` — one user's Q&A history with Nyaya Professor.
- `student_cases` — a judicial opinion the student pasted or uploaded. Idempotent on
  `(userId, sha256)`: re-uploading identical text returns the existing case instead of duplicating
  it.
- `student_case_versions` — append-only case text. A changed re-upload adds a new version; nothing
  is overwritten.
- `student_case_chunks` — the retrieval/embedding unit, tagged with `opinionPart`
  (`majority | concurrence | dissent | null`) whenever the text itself labels a separate opinion.
- `student_case_briefs` — one persisted brief per case version (`onConflictDoUpdate` on
  `caseVersionId`), with a `sectionSources` map recording which chunk(s) back each section.
- `student_case_comparisons` — a pairwise comparison between two of the student's own cases.
- `student_saved_items` — a student's personal library of saved explanations/briefs/authorities/
  comparisons.

Professor may also read the shared `legal_authorities*` corpus (see `NYAYA_RESEARCH.md`) — the one
deliberate exception to "user-scoped only," because that corpus is non-confidential reference
material, not another tenant's data.

## Ingestion (`ingestStudentCase`)

`ingestStudentCase` (`packages/workspaces/src/professor/ingest.ts`) accepts pasted text or an
uploaded file buffer:

1. Idempotent on `(userId, sha256)` — re-uploading identical text returns the existing case/version
   rather than creating a duplicate.
2. `detectOpinionPartHeading` conservatively labels a concurrence/dissent from short, heading-shaped
   lines (mostly-uppercase or naming a judge, containing "dissent"/"concur"). Unlabelled text stays
   `opinionPart: null` — it is never guessed into the majority, because mislabelling a dissent as
   the holding is the single most damaging error a case brief could make.
3. `labelSegmentsWithOpinionParts` tags every paragraph with whichever opinion part heading most
   recently appeared above it; `buildChunkDrafts` chunks each opinion part's paragraphs separately
   so a chunk never straddles the boundary between the majority and a dissent.
4. Every chunk is embedded (batches of 32) and inserted with the owning `userId`.
5. An audit event (`student_case.ingested`) records counts and labelled opinion parts only — never
   the case text itself.

## Case briefs (`generateCaseBrief`)

Built entirely from that one case version's own passages — nothing else is retrieved. Validation
(`validateCaseBrief`, `packages/workspaces/src/professor/briefs.ts`) enforces three things before a
generated brief is persisted:

- **Citations must name a real chunk of this case version.** A hallucinated `chunkId` is dropped and
  counted in `droppedChunkIds`.
- **Quotations must be verbatim.** `validateQuoteAgainstText` requires a typography-normalized
  substring match; a quote that doesn't appear in its cited chunk is dropped and counted in
  `rejectedQuotes`, falling back to a verbatim excerpt of the passage.
- **A majority-only section (facts, issue, rule, holding, reasoning, judgment, procedural posture,
  parties) may not cite a passage labelled as a concurrence or dissent.** `concurrence`/`dissent`
  sections may only cite their own labelled part, and are dropped entirely (not left empty) if
  nothing supports them.

`sectionSources` records, per section, exactly which chunk(s) and quote(s) back it — this is what
`packages/permissions/src/phase8.integration.test.ts` checks ownership of (every cited `chunkId`
must resolve to a `student_case_chunks` row owned by the same student).

## Ask Professor (`askProfessor`)

Retrieval reads the student's own case chunks (`searchStudentCaseChunks`, hybrid pgvector + full-text
search, both filtered on `userId`) and, for a doctrinal-sounding question
(`looksLikeLegalDoctrineQuestion`), the shared legal authority corpus via
`AuthorityHybridRetriever` — the exact same retriever Nyaya Research uses (see
`NYAYA_RESEARCH.md`).

`validateProfessorAnswer` keeps the two provenance classes separate all the way to the persisted
message:

- `UPLOADED_CASE` sources must reference a chunk that retrieval actually returned, belonging to the
  case the source claims (`caseId` re-checked, not trusted from the model).
- `LEGAL_AUTHORITY` sources must reference an authority/chunk retrieval actually returned.
- A quote on either kind of source that isn't verbatim in its cited passage is stripped, not passed
  through.
- If **nothing** survives validation, the answer is replaced with `NO_STUDENT_SOURCES_ANSWER` rather
  than presented as an ungrounded explanation.
- `NO_AUTHORITY_LIMITATION` is added whenever the answer has zero legal-authority sources — this is
  how a hypothetical or unsupported-by-the-record question is flagged as not stating binding law,
  distinguishing it from the case's actual holding (which, for a `caseId`-scoped question, is
  supported by `UPLOADED_CASE` sources with no such limitation).
- Every answer carries `PROFESSOR_STUDY_AID_NOTICE` — Nyaya Professor is a study aid, not a
  substitute for course instruction.

## Comparing cases (`compareStudentCases`)

Ownership is proven for **both** cases before anything is read. `validateCaseComparison`
(`packages/workspaces/src/professor/compare.ts`) enforces that each side's citations come from that
side's own case (`caseAChunkIds` only from case A, `caseBChunkIds` only from case B), and a claimed
"tension" between the two cases only survives if passages from **both** cases actually support it —
an unsupported difference is dropped rather than reported as a doctrinal split, since "these cases
conflict" is a claim a student might carry straight into an exam answer.

## Saved items (`saveItem` / `listSavedItems` / `deleteSavedItem`)

A student's personal library (`student_saved_items`). Deleting only ever succeeds after ownership is
proven, so an item id from another student's library resolves the same as a nonexistent id — never
a distinguishable "forbidden" response.

## Isolation guarantees

`packages/workspaces/src/professor/isolation.ts` makes the "student data never touches professional
data" guarantee enforceable at runtime, not just documented:

- `STUDENT_READABLE_TABLES` is the exhaustive allow-list of tables Professor may ever read (student
  workspace tables, the shared authority corpus, and `audit_events`).
- `WORKSPACE_FORBIDDEN_TABLES` lists professional/cross-workspace tables (`documents`,
  `document_chunks`, `matters`, `matter_*`, `research_*`, `agent_*`, `drafts`, and Guide's
  `guide_documents*`) that a student query must never mention.
- `assertStudentQueryIsIsolated(label, sqlText)` scans a SQL fragment for any forbidden table by
  whole-identifier match (so `student_cases` never trips on `cases`-style prefixes) and throws if
  found. This runs on every retrieval query's FROM/JOIN skeleton before it is ever sent to Postgres.
- `assertStudentHitsOwnedBy(hits, userId)` re-checks retrieval output: every hit must belong to the
  requesting user and must carry case provenance (`caseId`/`caseVersionId`/`chunkId`), and must
  **not** carry any of `FORBIDDEN_STUDENT_RESULT_FIELDS` (`documentId`, `documentVersionId`,
  `matterId`, `organizationId`) — fields that would prove a result crossed into professional scope.

See `SECURITY.md` for the security-specific summary and `DATA_MODEL.md` for the full table
reference.

## Free/local limitations

- Study aid, not legal instruction. Every answer carries `PROFESSOR_STUDY_AID_NOTICE`; briefs and
  comparisons are explicitly labelled as study aids to be checked against the source opinion.
- No fabricated separate opinions. If the uploaded text never labels a concurrence or dissent,
  `BRIEF_NO_SEPARATE_OPINIONS_LIMITATION` says so rather than the model inventing one.
- Mock providers (`MockAIProvider`/`MockEmbeddingProvider`) are deterministic but not semantically
  aware — see the same caveat in `NYAYA_RESEARCH.md`. A naive nearest-neighbor search over a shared,
  persistent authority corpus will always return _something_, even for an off-topic query, so
  integration fixtures that need to prove "this specific authority was found" should phrase their
  query using vocabulary unique to that authority's own text rather than generic doctrinal language
  that other fixtures in the corpus might share.
