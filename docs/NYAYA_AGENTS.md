# Nyaya Agents

Nyaya Agents is NyayaGrid's goal-to-plan orchestration layer: it turns a user's natural-language
goal into a validated, budgeted, human-approval-gated multi-step run over NyayaGrid's existing
domain packages. It lives in `packages/agents` and the `phase7` database schema
(`packages/database/src/schema/phase7.ts`).

The single rule underlying every decision in this package: **an agent composes existing,
already-authorized capabilities — it never reimplements them, and it never gets more authority
than the human who kicked off the run.** Every tool call re-checks live membership; every
irreversible or judgment-laden write goes through a pending approval row a human must act on;
retrieved text is always data, never instructions; and a run that could not finish honestly says
so instead of claiming success.

## Orchestrator

`NyayaOrchestrator` (`packages/agents/src/orchestrator.ts`) is the single entry point
(`createOrchestrator()` / `new NyayaOrchestrator()`). `runTask` does five things in order:

1. Checks the caller has at least read/`matters.view` access to `matterId` (or, for a matterless
   run, the `research.run` capability) — **before** any classification or planning happens, so an
   unauthorized caller can never even see what plan would have been generated.
2. Classifies the goal (`classifyIntent`) into an `AgentIntent` plus any `blockedActions`.
3. If the intent doesn't require a run (`mode: "qa"`), returns immediately with no `agent_runs`
   row at all — the caller is expected to answer directly via `askNyayaAboutMatter`.
4. Otherwise builds a plan (`planAgentRun`) from a fixed per-intent template and persists it
   (`createAgentRun`) as a `planned` run — nothing executes yet.
5. Executes the run (`executeAgentRun`) unless the caller passed `execute: false`, in which case
   the run stays `planned` for the caller to confirm/resume later (`orchestrator.resumeRun`).

`MAX_ORCHESTRATION_DEPTH = 1`: only the orchestrator ever creates a plan and its steps, once, from
a validated template. Nothing an agent or tool returns can enqueue more steps or spawn a nested
run — a run's maximum possible work is fixed at creation time.

`getRun(organizationId, runId)` is the only supported lookup path, and it is `organizationId`-
scoped in the same query as the id lookup: a run id from another tenant resolves to `null`, not an
error and not another tenant's data.

## Contracts

- **`RunTaskParams` → `RunTaskOutcome`** (`QaOutcome | TaskOutcome`) is the whole public surface
  for starting work. `QaOutcome` carries just the `intent` and a `reason` string; `TaskOutcome`
  carries the full `AgentRunDetail` (`run`, `steps`, `toolCalls`, `artifacts`, `approvals`),
  `userFacingPlan`, and whether it was actually `executed`.
- **`PlanStep`** — `{ stepId, agentType, objective, dependencies, requiredTools,
approvalRequirement }`. This is the unit the planner produces, the engine executes, and
  `agent_run_steps` persists.
- **`AgentExecutionResult`** — what a specialized agent hands back to the engine per step:
  `summary`, optional `content`/`canonicalRef`, `provenance` (`AgentProvenanceEntry[]`), `sources`,
  optional `actionProposals` (`AgentActionProposalInput[]`), and `limitations`.
- **`ToolInvocationResult`** — `{ ok, summary, data, resourceIds, provenanceClass?,
errorClassification? }`, returned by every tool whether it succeeded, failed, or was denied.
- **`AgentBudgets`** — `{ maxSteps, maxToolCalls, maxRetries, maxRetrievedContext, timeoutMs }`,
  defaulting to `{ maxSteps: 12, maxToolCalls: 40, maxRetries: 1, maxRetrievedContext: 20,
timeoutMs: 120000 }` (`DEFAULT_BUDGETS`/`resolveBudgets`). A caller may override any subset; the
  rest fall back to the default, so an old persisted run with a partial `budgets` object still
  resolves safely.

## Intent classification and the autonomy boundary

`classifyIntentWithRules` (`packages/agents/src/intent.ts`) is a deterministic, regex-first
classifier that runs before any model call. It always:

- Detects **blocked actions** — `send_email`, `court_filing`, `payment`, `accept_settlement`,
  `delete_evidence`, `approve_privilege`, `contact_external` — by pattern match on the goal text.
  `blockedActions` always includes `ALWAYS_BLOCKED_ACTIONS` (a fixed baseline) plus whatever the
  text specifically requested. A request naming one of these is **not refused outright** — it is
  routed to a real intent (typically `drafting`, scoped to producing reviewable text) with the
  blocked actions recorded as `safetyNotes`, because no tool exists in `DEFAULT_TOOLS` to actually
  send an email, file with a court, make a payment, delete evidence, finalize privilege, or contact
  an external party. Refusal is structural (the tool doesn't exist), not a prompt-level promise.
- Detects **instruction-like text in the goal itself** (`containsInstructionLikeDirectives`) and
  records it as a `safetyNote` — a goal phrased like "ignore prior instructions and..." is
  surfaced, not silently reinterpreted.
- Classifies a **plain question** (`isPlainQuestion`: question form or a `wh-`/`is/are/was` opener,
  and no task verb) as `simple_qa` with `requiresAgentRun: false` — this is the `mode: "qa"` path
  that never creates a run.
- Otherwise pattern-matches into one of nine `AgentIntent` values (`research`, `drafting`,
  `contract_review`, `deposition_prep`, `evidence_analysis`, `discovery_review`,
  `timeline_analysis`, `multi_step_task`, or falls back to low-confidence `simple_qa`).

`classifyIntent` only calls the model (`intentClassificationSchema`-validated generation) when the
rules are confident=`"low"` and an `AIProvider` was supplied; even then, the user's own goal text is
wrapped as untrusted content (`wrapUntrustedContent`) in the prompt, and the model's
`blockedActions` are unioned with — never allowed to replace — the rules' own list. A model call
can only ever add restrictions, not remove ones the rules already found.

## Planner

`planAgentRun` (`packages/agents/src/planner.ts`) builds a plan from a **fixed template per
intent** — there is no free-form, model-authored planning step. Templates chain 1–4
`PlanStep`s with explicit `dependencies` and a `requiredTools` allow-list per step, e.g.:

| Intent                                                                          | Steps (agent → tools)                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `simple_qa`                                                                     | `evidence_agent` → `searchMatterDocuments`, `getVerifiedTimeline`                                            |
| `research`                                                                      | `research_agent` (search) → `research_agent` (`saveResearchArtifact`)                                        |
| `drafting`                                                                      | `evidence_agent` (gather) → `draft_agent` (`createDraft`)                                                    |
| `contract_review`                                                               | `contract_agent` (`analyzeContract`) → `memory_agent` (`proposeMemory`)                                      |
| `multi_step_task`                                                               | `evidence_agent` → `research_agent` → `draft_agent` → `memory_agent` (`createTaskProposal`, `proposeMemory`) |
| `deposition_prep`, `evidence_analysis`, `discovery_review`, `timeline_analysis` | see `TEMPLATES` in `planner.ts`                                                                              |

Guardrails applied after template expansion, in order:

1. **No-matter fallback**: when `hasMatter === false`, every step that isn't `research_agent` is
   dropped (matter-scoped work has nothing to run against), and the run records a limitation. If
   the resulting plan is empty, planning is rejected (`PlanRejectedError`) rather than silently
   returning an empty run.
2. **Budget truncation**: a plan longer than `budgets.maxSteps` is truncated to the budget, with
   dangling `dependencies` on dropped steps stripped and a limitation recorded — this catches an
   over-budget plan at creation time, before any step runs (see Engine below for the separate
   execution-time budget check).
3. **Well-formedness** (`assertPlanIsWellFormed`): every `agentType` must be in the allowed set (the
   orchestrator's live `agentTypes()`, so a plan can never name an agent that isn't actually
   registered), `stepId`s must be unique, and every `dependencies` entry must reference an earlier,
   real step id — never itself, never something undefined.

`renderUserFacingPlan` produces the operator-facing bullet list (`userFacingPlan`) shown to the
user; it strips instruction-like text from step objectives (`stripInstructionLikeDirectives`)
before rendering, and it is built from the plan's own objectives — never a model's raw
chain-of-thought — so an attorney sees "what will be done," not the model's intermediate reasoning.

## Tools

Every domain capability an agent can reach is wrapped as an `AgentTool`
(`packages/agents/src/tools/registry.ts`), declaring: `risk`, `capability`, `minAccess`,
`requiresMatter`, an optional `provenanceClass`, a Zod `inputSchema`, and an `execute` function
that calls into an existing package (`@nyayagrid/intelligence`, `@nyayagrid/research`,
`@nyayagrid/search`) — never new domain logic.

`DEFAULT_TOOLS` (`packages/agents/src/tools/index.ts`) currently registers 18 tools spanning matter
retrieval (`searchMatterDocuments`, `retrieveMatterChunks`), authority research
(`searchLegalAuthorities`, `saveResearchArtifact`), verified intelligence
(`getVerifiedTimeline`, `getMatterGraphNeighborhood`, `retrieveMatterMemory`), document analysis
(`analyzeContract`, `analyzeDeposition`, `compareDocuments`, `detectContradictions`,
`getEvidenceMatrix`), drafting (`createDraft`, `reviseDraft`), discovery
(`getDiscoveryReview`, `proposeDiscoveryClassification`), and the two proposal-only tools
(`createTaskProposal`, `proposeMemory`).

`ToolRegistry.invoke` (`createToolRegistry`/`createDefaultToolRegistry`) is the sole call path:

1. `assertToolNotProhibited` — see Security section.
2. Validate `input` against the tool's `inputSchema`; a validation failure returns
   `ok: false, errorClassification: "invalid_input"` rather than throwing, so a step can record and
   continue past a malformed tool call from a model.
3. `authorizeToolCall` — re-derives `ToolAuthorization` from the **live** caller identity via
   `requireMatterAccess`/`requireCapability`, every single call, never cached.
4. Calls `tool.execute`; an `AuthorizationError` is re-thrown (denial is not swallowed into a
   generic failure), any other thrown error is caught and returned as
   `ok: false, errorClassification: classifyError(error)`.

Two proposal-only tools are worth calling out specifically because they perform **no write** of
their own: `createTaskProposalTool` returns a `CREATE_TASK` proposal payload, and
`proposeMemoryTool` always calls into `@nyayagrid/intelligence` with `status: "proposed"`. Neither
one can ever result in a visible task or an active memory by itself — see Approvals.

## Agents

`NyayaAgent` (`packages/agents/src/agent.ts`) is deliberately thin: `id`, `supportedIntents`,
`requiredCapabilities`, `allowedTools`, `riskClass`, and an `execute(ctx, input)` that only reaches
the database through `ctx.tools`. `DEFAULT_AGENTS` (`packages/agents/src/agents/index.ts`)
registers nine agents (`research_agent`, `draft_agent`, `contract_agent`, `evidence_agent`,
`discovery_agent`, `deposition_agent`, `timeline_agent`, `graph_agent`, `memory_agent`), each
mapping 1:1 with the domain package it composes.

`AgentOutputBuilder` (`packages/agents/src/agents/shared.ts`) is the shared helper every agent uses
to assemble its `AgentExecutionResult`: `addToolResult` accumulates a running summary and derives
`provenance` entries directly from each tool call's own `provenanceClass`/`resourceIds` (an agent
never hand-writes a provenance claim), and `scanRetrievedText` runs the injection scanner over any
retrieved text the agent read, appending a limitation on a hit without altering behavior.
`invokeIfAllowed` is the standard way an agent calls a tool: if the step's allow-list doesn't
include it, the agent records a limitation and moves on instead of throwing — a narrower plan is a
degraded run, not a crashed one.

## Lifecycle

`agent_runs.status`: `planned → running → {completed | partially_completed | failed |
awaiting_approval} `, or `cancelled` from any non-terminal state.

`executeAgentRun` (`packages/agents/src/engine.ts`) is **re-entrant**: it reloads the run's current
`AgentRunDetail`, skips any step already `completed`/`skipped`/`cancelled`, and for each remaining
step, in plan order:

1. If the step is `awaiting_approval` and still has a pending approval, it stays that way (records
   a limitation) and execution continues to the next step — a step blocked on approval never blocks
   independent steps behind it in a different branch of the dependency graph forever, though in
   practice most templates are linear.
2. If any `dependencies` did not complete, the step is `skipped` with
   `errorCode: "dependency_unsatisfied"`.
3. If `counters.stepsExecuted >= budgets.maxSteps`, `counters.toolCalls >= budgets.maxToolCalls`, or
   `Date.now() > deadline` (`budgets.timeoutMs` from run start), the step is `skipped` with
   `errorCode: "budget_exhausted"`/`"timeout"` and a limitation is recorded. These are **execution-time**
   checks, independent of the planner's own creation-time truncation — a plan that fit the budget at
   creation time can still hit a tighter _effective_ budget if it's re-run with different budgets,
   or simply take one step too many, and the engine still stops cleanly.
4. If `step.agentType` isn't registered, the step `fails` with `errorCode: "unknown_agent_type"`.
5. Otherwise the step actually runs: a `ToolInvoker` is built with `allowed = intersectTools(step,
agent)` (the plan's `requiredTools` ∩ the agent's own `allowedTools` — see Security), the agent's
   `execute` is called, and the result becomes one `agent_artifacts` row plus zero or more
   `agent_approvals` rows (one per `actionProposals` entry).
6. A step whose proposals include a `high`-risk one becomes `awaiting_approval` instead of
   `completed` — the write is inert until a human reviews it, and the run-level status reflects that
   (see below) rather than reporting the run as done while a proposal sits unactioned.
7. A thrown error (tool denial, `ToolNotAllowedError`, or any other) marks the step `failed` with a
   classified `errorCode` and a limitation, and execution moves to the next step rather than
   aborting the whole run — one bad step degrades the run, it doesn't kill it.

**Final run status** is derived from the finished steps' statuses, not asserted by any single step:
`awaiting_approval` if any step is `awaiting_approval`; else `failed` if zero steps completed and at
least one failed/skipped; else `partially_completed` if any step failed/skipped; else `completed`.
This means a run can never end `completed` while it silently dropped work — "everything that ran,
ran; here's what didn't and why" is always visible in `limitations`.

**Cancellation** (`cancelAgentRun`) is immediate and non-destructive: the run flips to `cancelled`,
only its still-`pending` steps flip to `cancelled`, and every step that already ran keeps its
recorded status, output, and artifacts — a cancelled run's partial work remains fully auditable.

## Approvals

`agent_approvals` is the only path from a proposed action to a real write. `createActionProposal`
(called once per `actionProposals` entry a step produced) always inserts `status: "pending"` —
including low-risk proposals — because the table's whole purpose is proving a human looked at it;
an auto-approved row would misrepresent an unreviewed write as reviewed.

`reviewApproval` is the only function that can change that status, and the only one that performs
the actual write:

- Requires the approval to currently be `pending` (already-reviewed approvals are immutable) and to
  carry a `matterId` (a matterless approval cannot be reviewed at all — `AuthorizationError`).
- Re-checks `requireMatterAccess(minAccess: "edit")` against the **reviewer's own, current** access
  — independent of whatever access existed when the proposal was created.
- On `approve`/`edit_and_approve`, dispatches by `actionType`:
  - `CREATE_TASK` → inserts a real `tasks` row (`executeCreateTask`), attributed to the reviewing
    user.
  - `SAVE_MEMORY` → calls `reviewMatterMemory` to flip the memory row from `proposed` to
    `approved`/`edited_and_approved`.
  - `SAVE_AUTHORITY` → calls `saveAuthorityToMatter`.
  - `CREATE_DRAFT`, `PROPOSE_TIMELINE_EVENT`, `ADD_GRAPH_RELATIONSHIP`, `OTHER` → recorded as
    approved with an `executionNote`; drafts already exist as reviewable work product the moment
    they're created; timeline/graph proposals are executed through their own Phase 3/4 review
    workflows, not duplicated here.
- On `reject`, nothing downstream is touched — the proposal's `proposedData` is preserved for the
  record, but no task/memory/authority state ever changes.

Because `createTaskProposalTool`/`proposeMemoryTool` never write anything themselves, the
`tasks`/`matter_memory` tables are the ground truth for whether an approval actually took effect —
tests and evaluations should assert against those tables, not just the approval row's `status`.

## Provenance

Every `agent_artifacts` row carries a `provenance: AgentProvenanceEntry[]`, built by
`AgentOutputBuilder.addToolResult` directly from each tool call's own `provenanceClass` and
`resourceIds` — never hand-authored by an agent. The six provenance classes
(`MATTER_EVIDENCE`, `VERIFIED_MATTER_INTELLIGENCE`, `GRAPH_RELATIONSHIP`, `MATTER_MEMORY`,
`LEGAL_AUTHORITY`, `USER_INSTRUCTION`) mirror the Phase 6 provenance model
(see `NYAYA_RESEARCH.md`), extended with two agent-specific classes:
`VERIFIED_MATTER_INTELLIGENCE` (Phase 3 timeline/facts/entities/deadlines) and
`GRAPH_RELATIONSHIP` (Phase 4 approved graph edges). A single artifact from a multi-tool step (e.g.
`multi_step_task`'s evidence-gathering step, which calls `retrieveMatterChunks`,
`getVerifiedTimeline`, and `getEvidenceMatrix`) naturally accumulates multiple provenance entries
with different classes and different `refs`, each resolving only inside its own source table —
`MATTER_EVIDENCE` refs are `document_chunks` ids, `LEGAL_AUTHORITY` refs are corpus authority ids,
and the two are never merged into one entry.

## Failure model

Every failure mode surfaces as a **step-level `errorCode`** plus a **run-level limitation string**,
never as a silent gap:

| `errorCode`              | Meaning                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `dependency_unsatisfied` | An upstream step this one depends on didn't complete                 |
| `budget_exhausted`       | `maxSteps` or `maxToolCalls` reached before this step could run      |
| `timeout`                | The run's `timeoutMs` deadline passed before this step could run     |
| `tool_not_allowed`       | The agent tried a tool outside its intersected allow-list            |
| `authorization`          | A tool call's live authorization check failed (`AuthorizationError`) |
| `unknown_agent_type`     | The plan named an `agentType` that isn't registered                  |
| `step_error`             | Any other thrown error during the agent's `execute`                  |

A research step that legitimately finds zero corpus coverage is not an engine failure at all: the
`research_agent`/`saveResearchArtifactTool` path returns `grounded: false` with
`NO_CORPUS_SYNTHESIS_ANSWER`/coverage warnings (see `NYAYA_RESEARCH.md`), which
`AgentOutputBuilder` folds into the step's `limitations` — the step still completes, honestly
reporting that it found nothing, rather than the engine treating "no results" as a crash.

## Security

Full detail lives in `SECURITY.md`; the mechanisms specific to this package are:

- **Tool authorization is re-checked on every call** against live membership (never cached from run
  creation or an earlier step).
- **A step's effective tool surface is the intersection** of the plan's `requiredTools` and the
  executing agent's own `allowedTools` — neither list alone can widen scope.
- **`PROHIBITED_TOOL_NAMES`** (`sendEmail`, `fileCourt`, `makePayment`, `deleteEvidence`,
  `approvePrivilege`, `contactExternal`) can never be registered or invoked, full stop.
- **Forged cross-tenant `matterId`s are denied** (`AuthorizationError`), never silently scoped to
  an empty result.
- **Cross-org run/approval lookups return `null`**, not another tenant's data.
- **High-risk proposals block step completion** until a human reviews them via `reviewApproval`.

## Prompt injection defenses

`packages/agents/src/prompt-injection.ts` treats every piece of retrieved content — matter
documents, OCR text, opposing-party correspondence, authority text — as data, never instructions:

- `wrapUntrustedContent` wraps it in an `<untrusted_content source="...">...</untrusted_content>`
  block for any downstream prompt, escaping any literal `<untrusted_content`/`</untrusted_content>`
  sequences already inside the text so it cannot forge a closing tag and escape its own block.
- `INJECTION_SYSTEM_RULE` is a fixed system-prompt preamble stating that only the authenticated
  user's request and the system prompt itself carry instructions.
- `containsInstructionLikeDirectives` / `INSTRUCTION_LIKE_PATTERNS` detect a fixed set of
  injection-shaped phrases (e.g. "ignore prior instructions", "you are now a...", "developer mode",
  "upload all documents", "delete all evidence", "file this with the court"). A match is recorded
  as a limitation/safety note — via `scanForInjection` on retrieved tool output, or
  `containsInstructionLikeDirectives` on the goal text at classification time — but is **never**
  used to change what tools a step may call, because that allow-list is already fixed by the plan
  and the agent's own `allowedTools` before any retrieved text is read. Detection is a transparency
  signal, not the authorization boundary itself — the boundary is the tool intersection.
- `stripInstructionLikeDirectives` redacts matched phrases (as `[redacted-directive]`) when quoting
  suspicious text back into a safety note or the user-facing plan, so the note itself doesn't
  re-inject the same directive into a downstream prompt.

This means a prompt-injection attempt embedded in a matter document or an opposing party's email
can, at most, cause a run to record a limitation about ignored instruction-like text — it cannot
invoke `sendEmail` (doesn't exist), cannot reach a tool outside the step's allow-list (denied by the
intersection, not by the scanner), and cannot escalate the run's own authorization (re-checked live
per call, independent of anything a document said).
