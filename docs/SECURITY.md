# NyayaGrid Security Notes

- Encrypt in transit (HTTPS in production) and at rest (Postgres/MinIO/S3 configuration).
- Tenant isolation via `organization_id` on owned records and server-side capability checks.
- Storage keys must be prefixed `org/{organizationId}/...`.
- Malware scanning is required before production deployment; development scanner must never mark documents as scanned.
- Do not log document bodies, matter text, secrets, tokens, or confidential prompts.
- Student/Public workspaces must remain isolated from Professional matter data.

## Matter intelligence (Phase 3)

- Timeline/facts/entities/deadlines are matter-scoped and require matter authorization.
- Source provenance chunk IDs are validated server-side against organization + matter before persistence.
- Hallucinated or cross-matter chunk IDs are rejected.
- Unapproved proposals are excluded from Nyaya verified-intelligence context by default.

## Graph + Memory (Phase 4)

- Graph nodes/edges/memories are matter-scoped; traversal cannot escape the matter.
- Edge sources must belong to the same organization and matter.
- Canonical entity IDs are untrusted for authorization (matter access is re-checked).
- Only approved/edited_and_approved graph edges enter default Nyaya Graph context.
- Only active approved memories enter default Nyaya Memory context.
- Proposed/rejected/superseded/archived memories are excluded from default AI context.
- Semantic memory ranking happens only after matter-scoped candidate selection.
- Job payloads do not establish authorization.

## Nyaya Draft, professional analysis, and discovery (Phase 5)

- All Phase 5 domain functions accept `organizationId` + `matterId` and scope every query
  accordingly; matter-level access must be checked by the caller via `requireMatterAccess`
  before any domain function runs (domain functions themselves are not an authorization layer).
- `generateDraft`, `analyzeContract`, `generateRedlineSuggestions`, `analyzeDeposition`, and
  `detectContradictionCandidates` never accept AI-proposed chunk IDs as-is: proposed
  `chunkIds`/`sourceChunkIds` are always re-resolved against `document_chunks` scoped to the
  same `organizationId` + `matterId` (`loadAuthorizedChunks` / `resolveValidatedSources`).
  Chunk IDs belonging to another matter or organization silently drop from the result rather
  than being trusted.
- `analyzeContract`, `compareDocuments`, and `analyzeDeposition` additionally verify the
  target `documentId`/`documentVersionId` belongs to the requested matter before touching any
  data; a cross-matter document ID throws instead of returning another matter's analysis.
- Draft assertions with zero authorized `chunkIds` are dropped, never persisted with an
  ungrounded or cross-matter citation.
- Accepting a redline suggestion never mutates `document_versions`; the original document
  content and `sha256` are immutable. Redlines are proposals layered on top of the document.
- **Privilege designations require a human.** `document_review_states` keeps AI proposals
  (`aiRelevance`, `aiPrivilege`, `aiResponsiveness`, `aiProposalNote`) in separate columns from
  the human-authoritative fields (`relevance`, `privilege`, `responsiveness`, `confidentiality`).
  `proposeDiscoveryClassification` only ever writes the `ai_*` columns. `updateDiscoveryReview`
  refuses to set `privilege` to `privileged` or `not_privileged` unless the caller explicitly
  passes `humanPrivilegeFinal: true` in the same call, and Nyaya's prompt instructs the model
  that human privilege designations are authoritative while AI privilege proposals are not final.
- `detectExactDuplicates` / `detectNearDuplicates` only ever add duplicate-group membership
  rows; they never delete a document or version, so accidental data loss from a false-positive
  duplicate match is not possible.
- Reviewed (`reviewed`) analytical findings and contract-analysis items may enter Nyaya's
  professional-analysis context; `proposed` findings are still included but must be labeled as
  unreviewed AI proposals in the answer. `dismissed` findings are excluded.

## Nyaya Research (Phase 6)

- **Corpus/matter separation is structural, not just a query filter.** `legal_authorities` and its
  child tables (`legal_authority_versions`, `legal_authority_chunks`, `legal_authority_citations`,
  `legal_authority_relationships`) carry no `organizationId`/`matterId` column at all — there is no
  column to leak. Confidential matter documents live exclusively in `document_chunks`, which the
  authority retriever (`AuthorityHybridRetriever`) never queries. `matter_authorities` is the only
  bridge between the two, and it only ever stores id references plus a status, never authority text
  copied into a matter or matter text copied into the corpus.
- Every authority search result is verified twice before it leaves the retriever:
  `assertAuthorityHitsOnly` rejects any hit carrying a matter-scoped field
  (`documentId`/`documentVersionId`/`matterId`/`organizationId`) or missing authority provenance,
  and `assertChunksBelongToAuthorityCorpus` re-queries `legal_authority_chunks` to confirm every
  returned `chunkId` actually exists there. A regression that accidentally joined in
  `document_chunks` would throw immediately rather than silently leaking matter content into
  research results.
- `runResearchQuery` and `generateResearchMemo` load **verified matter context** (facts, timeline,
  graph, approved memory) only to formulate the issue/search concepts; that text is passed to the
  model in a clearly separated, explicitly-labeled block and is never treated as, or merged with,
  legal authority. Authorities returned to the caller always come from `AuthorityHybridRetriever`
  or a caller-supplied `LegalAuthorityProvider`/retriever, never from matter facts.
- `saveAuthorityToMatter` / `updateMatterAuthorityStatus` / `listMatterAuthorities` /
  `loadMatterLegalAuthorityContext` all accept `organizationId` + `matterId` and scope every query
  accordingly; as with Phase 5, matter-level access must be checked by the caller via
  `requireMatterAccess` before any of these domain functions run. `getResearchSession` scopes by
  `organizationId`, so a session id from another tenant resolves to `null` rather than throwing or
  leaking existence.
- **Import safety.** `importAuthority` requires the caller to supply explicit metadata (title,
  citation/docket, jurisdiction, etc.) — nothing is inferred from a filename, and a
  filename-shaped title (e.g. `opinion_final.pdf`) is rejected by schema validation. Import is
  idempotent on `(sourceProvider, sourceExternalId)`: byte-identical re-import is a no-op; changed
  content always creates a new, immutable version rather than mutating history, so a compromised or
  buggy re-import can never silently rewrite what an attorney previously cited.
- **Provenance separation in AI output.** Every `ResearchProposition` persisted to
  `research_artifacts.propositions` carries a `provenanceClass`. `LEGAL_AUTHORITY` entries may only
  reference `authorityIds`/`chunkIds` from the corpus; `FACT_SOURCE` entries may only reference
  `matterChunkIds` from `document_chunks` and always have `authorityIds: []`. `classifyDraftAssertions`
  (Nyaya Draft) enforces the same split when a draft cites both saved authorities and matter facts.
- **No-fabrication guarantees.** `validateSynthesisAgainstRetrieval` and
  `validateMemoAgainstRetrieval` re-check every model-cited `authorityId`/`chunkId` against what
  retrieval actually returned; anything not retrieved is dropped and counted toward
  `fabricatedAuthorityIds`/`unknownChunkIds` rather than being trusted. `validateQuoteAgainstText`
  additionally requires every quotation to appear verbatim (modulo whitespace/typography) in the
  cited authority text — a quote that cannot be matched is stripped, never passed through.
  `resolveCitationAgainstCorpus` refuses to guess: it returns `null` whenever zero or more than one
  authority matches a citation, so an ambiguous cite is never silently attributed to the wrong case.
- **Treatment claims require a source.** `getTreatmentDisplay` only ever reports
  `treatmentStatus: source_reported` when a `legal_authority_relationships` row with
  `origin: source_metadata | reviewed` backs it; otherwise every authority is labeled "Treatment
  unknown" with the `TREATMENT_UNVERIFIED_NOTICE`. `assertTreatmentClaimIsSourced` throws if
  editorial vocabulary ("overruled", "good law", etc.) would otherwise reach a user without a
  sourced relationship behind it — NyayaGrid never generates its own treatment conclusions.
- Coverage warnings (`buildCoverageWarnings`) are mandatory, not optional: every synthesis and memo
  always states that the corpus is not a comprehensive survey of the law of any jurisdiction, that
  treatment is unverified, and whether a contrary-authority search or jurisdiction filter was
  actually applied.

## Nyaya Agents (Phase 7)

Full design detail lives in `NYAYA_AGENTS.md`; this section is the security-specific summary.

- **Tool authorization is re-checked on every call, not inherited.** `ToolRegistry.invoke`
  (`packages/agents/src/tools/registry.ts`) calls `requireMatterAccess`/`requireCapability` fresh
  for every single tool invocation, using the live caller identity — never a cached result from an
  earlier step or from run creation time. A run can outlive the membership that authorized it; a
  membership revoked mid-run causes the next tool call to fail with `AuthorizationError`, and the
  step is marked `failed` with `errorCode: "authorization"` rather than silently succeeding.
- **A step's tool surface is the intersection of two independent lists, not either one alone.** The
  plan's `requiredTools` (what the orchestrator authorized for this specific step) is intersected
  with the executing agent's own `allowedTools` (what that agent type is capable of at all) before
  a step ever runs (`intersectTools` in `engine.ts`). Neither list alone can widen scope: a
  compromised/rewritten plan cannot grant a tool the agent type doesn't support, and an agent
  cannot reach a tool the plan didn't authorize for that step, even if the agent's own code calls
  `ctx.tools.invoke` for it. An unauthorized call throws `ToolNotAllowedError` and the step fails
  with `errorCode: "tool_not_allowed"` — the attempt is recorded, nothing is executed.
- **A fixed set of tools is permanently prohibited, not merely unregistered.**
  `PROHIBITED_TOOL_NAMES` (`sendEmail`, `fileCourt`, `makePayment`, `deleteEvidence`,
  `approvePrivilege`, `contactExternal`) can never be registered on a `ToolRegistry` or invoked
  through one — `assertToolNotProhibited` runs before every `register()` and every `invoke()` call
  and throws `ProhibitedToolError` unconditionally. This is enforced in code, not by omission: even
  a future contributor who adds a `sendEmail` tool implementation cannot wire it into an agent's
  tool surface without deleting/renaming the check itself.
- **Forged/cross-tenant resource ids are denied, not silently scoped away.** Every matter-scoped
  tool calls `requireMatterId`/`requireMatterAccess` with the caller's real organization and the
  `matterId` the tool call actually carries; a `matterId` for a matter in a different organization
  (or one the caller has no `matter_members` row for) throws `AuthorizationError` before any domain
  function runs — it never falls back to "no results" or an empty page, which would look like a
  legitimate answer instead of a denial.
- **Cross-org run/approval lookups return `null`, not another tenant's data or a stack trace.**
  `getAgentRun` and `getApproval` filter by `organizationId` in the same query as the id lookup, so
  a run/approval id from another organization resolves to `null` — indistinguishable from "does not
  exist" to the caller, which avoids confirming that a given id exists in someone else's tenant.
- **Approving an action always re-checks matter access at review time**, independent of whatever
  access existed when the proposal was created (`reviewApproval` calls `requireMatterAccess` with
  `minAccess: "edit"`). An approval with no `matterId` cannot be reviewed at all
  (`AuthorizationError`) — every approved write is scoped to a specific, currently-accessible
  matter.
- **Approval gates cannot be bypassed by a model's output.** `createTaskProposal` never inserts a
  task; `proposeMemory` always writes memory rows with `status: "proposed"`. The only code path
  that turns a proposal into a real `tasks` row or an `approved` memory is `reviewApproval`, invoked
  by a human reviewer action — nothing in the agent/engine/planner layer can transition an approval
  out of `pending` on its own. A step whose output includes a proposal at `approvalRequirement:
"high"` is marked `awaiting_approval`, not `completed`, so the run's own status makes the pending
  human decision visible rather than implying the work already landed.
- **Retrieved content is data, never instructions — structurally, not just by prompt wording.**
  Every tool result an agent scans (`AgentOutputBuilder.scanRetrievedText`) is checked against
  `INSTRUCTION_LIKE_PATTERNS` (`packages/agents/src/prompt-injection.ts`); a match is recorded as a
  run limitation ("...contains instruction-like text that was ignored as data; it did not change
  tool authorization") but never changes what tools the step is allowed to call, because that
  allow-list was already fixed before the agent read a single byte of retrieved content (see tool
  authorization above). `wrapUntrustedContent` additionally escapes any `<untrusted_content>`
  delimiter appearing inside the retrieved text itself, so untrusted content cannot forge a closing
  tag and jump out of its own quoted block in a downstream prompt. The same
  `containsInstructionLikeDirectives` check runs on the user's own goal text during intent
  classification, so an instruction-shaped goal ("Ignore prior instructions and...") is surfaced as
  a `safetyNotes` entry rather than silently reinterpreted.
- **The autonomy boundary is enforced at the rules layer, before any model call.**
  `classifyIntentWithRules` (`packages/agents/src/intent.ts`) detects a fixed set of blocked
  operations (`send_email`, `court_filing`, `payment`, `accept_settlement`, `delete_evidence`,
  `approve_privilege`, `contact_external`) by pattern match on the goal text; the resulting
  `blockedActions` list is always merged into whatever the AI-fallback classification returns
  (`classifyIntent` unions `rules.blockedActions` with the model's), so a model call can only add
  blocked actions, never remove ones the rules already found. A request naming a blocked action is
  still routed to a real agent run (typically `drafting`), scoped to producing reviewable draft
  text — NyayaGrid never simply refuses the whole request, but it also never executes the
  irreversible external action itself, because no tool for it exists in the registry at all.
- **A run cannot spawn further runs.** `MAX_ORCHESTRATION_DEPTH = 1` (`orchestrator.ts`) reflects
  that only the orchestrator creates a plan and its steps, once, from a validated template; nothing
  an agent or a tool returns can enqueue additional steps or a nested run, so a run's total possible
  work is bounded by its plan at creation time, not by what a model decides mid-run.
- **Idempotent job dispatch.** `agent.execute_run`/`agent.continue_run` job payloads carry an
  `idempotencyKey`; `InMemoryJobDispatcher` (and the Inngest-backed dispatcher in production) skip a
  payload whose key was already processed, so a retried or duplicated job event cannot execute the
  same run's steps twice. As with every other phase, job payloads carry identifiers only and never
  establish authorization by themselves — `executeAgentRun` re-derives authorization per tool call
  exactly as a direct API call would.

## Nyaya Professor + Nyaya Guide (Phase 8)

Full design detail lives in `NYAYA_PROFESSOR.md` and `NYAYA_GUIDE.md`; this section is the
security-specific summary.

- **User-scoping is structural, not just a query filter.** Every Phase 8 table
  (`packages/database/src/schema/phase8.ts`) carries a `userId` column and no
  `organizationId`/`matterId` column at all — there is no column to leak. A student's uploaded case
  and a public user's uploaded document are private to that one user; there is no role/membership
  model to fall back on, so ownership is the entire authorization boundary for both workspaces.
- **Allow-listed table access, enforced at retrieval time, not just documented.**
  `assertStudentQueryIsIsolated` (`packages/workspaces/src/professor/isolation.ts`) scans every
  retrieval query's SQL text for any table outside `STUDENT_READABLE_TABLES` and throws if found;
  `assertSqlTemplatesAreIsolated` (`packages/workspaces/src/guide/search.ts`) does the same for
  Guide against `GUIDE_SEARCH_ALLOWED_TABLES`, checked as plain string templates specifically so the
  check runs without a live database connection. A regression that accidentally joined
  `document_chunks`, `matters`, or the other workspace's tables into either retrieval path fails a
  test immediately instead of silently leaking.
- **Retrieval output is re-checked, not trusted.** `assertStudentHitsOwnedBy` rejects any student
  search hit that doesn't belong to the requesting `userId` or that carries a
  professional-scoped field (`documentId`/`documentVersionId`/`matterId`/`organizationId`).
  `assertChunksBelongToUser` (Guide) re-queries `guide_document_chunks` directly to confirm every
  returned `chunkId` actually belongs to the requesting user. Both run on every search call.
- **Ownership errors never leak existence.** `StudentAccessError` and `GuideAuthorizationError` are
  thrown identically whether a resource id doesn't exist at all or belongs to a different user —
  `assertStudentCaseOwnership`, `assertGuideDocumentOwnership`, and
  `assertGuideSituationOwnership` all follow this pattern, so probing another user's case/document
  id cannot distinguish "not found" from "found, but not yours."
- **Cross-workspace access is refused, not merely unlinked.** Guide has no code path that reads
  `student_case_*` or professional `document_chunks`; Professor has no code path that reads
  `guide_document_*`. `packages/permissions/src/phase8.integration.test.ts` asserts this end to end
  against real rows: a confidential matter document and a student's own uploaded case are both
  created in the shared dev database, and neither `askProfessor` nor `askGuide` ever returns a
  source whose `chunkId` matches one of those rows.
- **No fabricated case content.** `validateCaseBrief` and `validateCaseComparison`
  (`packages/workspaces/src/professor`) enforce that a majority-only brief section (facts, issue,
  rule, holding, reasoning, judgment, procedural posture, parties) may never cite a passage labelled
  as a concurrence or dissent, and that a claimed "tension" between two compared cases survives only
  when passages from **both** cases actually support it. `validateQuoteAgainstText` additionally
  requires every quotation to be verbatim (typography-normalized only) in its cited passage.
- **No fabricated dates, amounts, or deadlines.** Nyaya Guide's grounding rules
  (`GUIDE_GROUNDING_RULES`, `packages/ai/src/guide.ts`) forbid calculating, estimating, or inferring
  a procedural deadline; `explainGuideDocument`'s `filterVerified` /
  `validateExplicitDatesAgainstChunks` (`packages/workspaces/src/guide/explain.ts`) enforce this in
  code by dropping any date/amount/obligation/risk item whose quote is not verbatim in a chunk that
  was actually retrieved. `toIsoDateOrNull` only ever re-renders a date already found verbatim in
  the text — it never computes one.
- **Untrusted content, never instructions.** Guide's grounding rules explicitly instruct the model to
  treat uploaded document content and user-provided situation text as untrusted data; the
  illegality guardrail and quote-verification layers below run in code regardless of what the model
  does with that instruction, so a provider that ignores its own system prompt still cannot make an
  ungrounded claim it into a persisted answer.
- **Illegality claims require authority, enforced in code.**
  `enforceIllegalityGuardrail` (`packages/workspaces/src/guide/guardrails.ts`) strips any sentence
  asserting a clause/term/provision/notice/action is illegal, void, unenforceable, invalid, or
  unlawful unless the answer has a verified `LEGAL_AUTHORITY` source. Because Guide's authority
  search (`searchLegalAuthorityChunks`) has no relevance threshold and always returns the nearest
  neighbors once the shared corpus is non-empty, tests that need to exercise the no-authority branch
  must ensure the corpus is genuinely empty at that moment — see the fixture caveat in
  `NYAYA_GUIDE.md`.
- **Jurisdiction is never assumed.** `jurisdictionKnown` on a Guide answer is derived server-side
  from whether a jurisdiction was actually supplied, never trusted from the model's own
  self-report; when unknown, a jurisdiction caveat is unconditionally attached.
- **High-stakes detection is deterministic, not model-dependent.** `detectHighStakes`
  (`packages/ai/src/guide.ts`) is a fixed set of keyword-category regexes (eviction, arrest/
  detention, deportation, domestic violence, custody emergency, imminent court deadline,
  foreclosure, self-incrimination, threat to safety) evaluated in code; a match sets
  `cautionLevel: "elevated"` and appends `HIGH_STAKES_GUIDANCE` regardless of what the model itself
  concludes.
- **Guide situation events are always user-provided.** `addSituationEvent` unconditionally stamps
  `sourceLabel: "user_provided"` — there is no code path that lets Guide insert a fabricated
  timeline entry on the user's behalf, and `generateConsultationPacket` separates
  document-extracted dates from user-provided events in its own output.
- **Idempotent job dispatch.** `student.ingest_case` / `guide.ingest_document` job payloads carry an
  `idempotencyKey`; `InMemoryJobDispatcher` skips a payload whose key was already processed, exactly
  as with every other phase's ingestion/execution jobs.
