# NYAYA-BENCH subsystem routing

NyayaGrid is one platform. NYAYA-BENCH V1/V2 were written as Case Q&A tasks. Full-system mode **does not** rewrite those fixtures. It maps each task category onto a production pathway, or marks the task `NOT_APPLICABLE_TO_SUBSYSTEM`.

Baseline A / A.1 remain **Case Q&A only**.

---

## Relationship to other harnesses

| Harness                    | Command                                                | What it tests                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing eval              | `npm run eval:ai` / `eval:ai:live`                     | Fast prompt/model/canary evaluation on golden snippets. Keep it.                                                                                                                             |
| NYAYA-BENCH Case Q&A       | `npm run bench -- v1 run …` (default mode `case-qa`)   | Full-PDF ingest + retrieval + `askNyayaAboutMatter`. Baseline A / A.1.                                                                                                                       |
| NYAYA-BENCH full-system    | `npm run bench -- v1 run SYNTH-001 --mode full-system` | Same fixtures, routed to Compare / Contradiction / Timeline when the category maps. Graded output is the **subsystem artifact**, not a chat substitute.                                      |
| NYAYA-BENCH filtered modes | `--mode compare` / `contradictions` / `timeline` / …   | Runs only tasks whose mapping matches. Graph, Memory, Research, Draft, and Agents have **zero** V1/V2-compatible tasks; those modes return `not_applicable` unless a smoke override is used. |
| NYAYA-BENCH agents         | `--mode agents` or smoke `agent`                       | `NyayaOrchestrator.runTask` → `planAgentRun` → `createAgentRun` / `executeAgentRun`. Do not call helper tools as a substitute.                                                               |
| Smoke                      | `npm run bench -- smoke-subsystems`                    | One live call per pathway on SYNTH-001. Do not use this as a score.                                                                                                                          |

Do not replace `eval:ai` with NYAYA-BENCH.

---

## Category → execution target (mapping layer)

`case-qa` mode forces every task through Case Q&A.

`full-system` uses this table. Unlisted categories default to `case_qa`.

| Benchmark category                                                                                                                                                                                                | Production system under test | Entrypoint                                                                                                                                                                                                            | Output being graded                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `case_qa`, `insufficient`, `numeric`, `numeric_precision`, `adversarial`, `email_reliability`, `citation`, `quote_accuracy`, `termination`, `reasoning`, `missing_exhibit`, `entity_resolution`, `cross_document` | Case Q&A                     | `askNyayaAboutMatter` (`packages/search/src/nyaya.ts`); HTTP `POST /api/v1/matters/[matterId]/ask` with `mode=ask`                                                                                                    | Case Q&A answer + citations                                                                                                                            |
| `contract_compare`, `contract_decoy`, `decoy`                                                                                                                                                                     | Contract compare             | `compareDocuments` (`packages/intelligence/src/analysis/compare.ts`); HTTP `POST /api/v1/matters/[matterId]/analysis/comparisons`                                                                                     | Comparison summary + structured `changes` (not a chat answer)                                                                                          |
| `contradiction`, `false_contradiction`                                                                                                                                                                            | Contradiction engine         | `detectContradictionCandidates` (`packages/intelligence/src/analysis/deposition.ts`); HTTP `POST /api/v1/matters/[matterId]/analysis/contradictions`                                                                  | `findings` (pairs, sources, classification)                                                                                                            |
| `timeline`                                                                                                                                                                                                        | Nyaya Timeline               | `extractMatterIntelligenceForReadyDocuments` then `listTimelineEvents` (`packages/intelligence/src/extract.ts`, `queries.ts`); HTTP extract + `GET /api/v1/matters/[matterId]/timeline`; review `reviewTimelineEvent` | Timeline events including proposed, with sources                                                                                                       |
| _(no V1/V2 category)_                                                                                                                                                                                             | Nyaya Graph                  | `extractGraphRelationshipCandidates` + `listGraph`; materialize `materializeVerifiedGraph`; HTTP `POST .../graph/extract`, `GET .../graph`                                                                            | Nodes/edges/candidates. V1/V2 tasks: `NOT_APPLICABLE_TO_SUBSYSTEM`                                                                                     |
| `memory` (overlay tasks, V2 PDFs reused) | Nyaya Memory | `proposeMatterMemories` / `createMatterMemory` / `reviewMatterMemory` / `supersedeMatterMemory`; HTTP `POST/GET .../memory` | Structured persisted memories + downstream eligibility. Mode: `npm run bench -- v2 run memory` |
| _(no V1/V2 category)_                                                                                                                                                                                             | Nyaya Research               | `runResearchQuery` (`packages/research/src/synthesize.ts`); HTTP `POST .../research/query`                                                                                                                            | Research session query/synthesis/citations against the **local** authority corpus only. V1/V2: `NOT_APPLICABLE_TO_SUBSYSTEM`                           |
| _(no V1/V2 category)_                                                                                                                                                                                             | Nyaya Draft                  | `generateDraft` (`packages/intelligence/src/draft/index.ts`); HTTP `POST .../drafts`                                                                                                                                  | Draft artifact (grounding, not style). V1/V2: `NOT_APPLICABLE_TO_SUBSYSTEM`                                                                            |
| `analysis` (overlay tasks, V2 PDFs reused) | Contract analysis, deposition analysis, evidence matrix view | `analyzeContract` / `analyzeDeposition` / `getEvidenceIntelligence` / `loadProfessionalAnalysisContext`; HTTP contract/deposition/findings/evidence routes | Structured persisted Analysis items/findings + Ask Nyaya formatter snapshot. Mode: `npm run bench -- v2 run analysis`. Generic `executionTarget=analysis` still throws. Do not score Compare/Contradiction as Analysis. |
| _(no V1/V2 category)_ | Agents | `NyayaOrchestrator.runTask` | `--mode agents` loads `datasets/v2/agents/catalog.json` (24 overlay tasks). Hidden GT under `hidden_ground_truth/agents/`. |

Do not funnel Compare / Contradiction / Timeline / Graph / Memory / Research / Draft / Agents through Ask Nyaya in full-system mode.

V1/V2 hidden ground truth was written for chat-shaped answers. **Phase 6B** grades Compare and Contradiction from persisted structured production output (change rows / findings), not by needle-matching serialized JSON. Case Q&A still uses the frozen chat grader. If a task cannot score a subsystem honestly, the runner must emit `not_applicable` rather than invent a score.

Process-level agent metrics are **NOT CURRENTLY MEASURABLE** until agent-specific ground truth exists.

---

## Production pathways (current code)

### Case Q&A

- Package: `askNyayaAboutMatter` in `packages/search/src/nyaya.ts` (app re-exports via `apps/web/src/server/nyaya.ts`).
- HTTP: `POST /api/v1/matters/[matterId]/ask` with `mode=ask` calls Case Q&A directly. `mode=task` / auto may hand off to `NyayaOrchestrator`.
- Benchmark `case-qa` always calls `askNyayaAboutMatter`, never the orchestrator.

### Contract compare

- `compareDocuments` diffs two matter document versions, persists `documentComparisons` / `documentComparisonChanges`, optional AI summary aligned to the diff.
- App: comparisons API. Agent tool: `compareDocuments`.

### Contradiction

- `detectContradictionCandidates({ force: true })` in analysis/deposition.
- App: contradictions API. Agent tool: `detectContradictions`.
- Not a Case Q&A prompt that asks “is there a contradiction?”

### Timeline

- Extraction: `extractMatterIntelligenceForReadyDocuments` / `extractMatterIntelligenceForDocument` writes **proposed** timeline events with source chunk provenance.
- List: `listTimelineEvents` (benchmark includes `proposed`, `approved`, `edited_and_approved`).
- Approval: `reviewTimelineEvent` — humans materialize; the extractor does not auto-approve.
- Duplicate handling lives in extract/dedupe. Missing dates stay unknown; extraction must not invent them.

### Graph

- Nodes come from approved intelligence/entities; `extractGraphRelationshipCandidates` proposes edges with provenance.
- `materializeVerifiedGraph` writes verified structure after review.
- `listGraph` is the read model. Inference vs sourced is on edge status/provenance, not a chat graph.

### Memory

- `proposeMatterMemories` creates **proposed** rows via `createMatterMemory`.
- `reviewMatterMemory` approves/edits/rejects. Supersession is `supersedesId`.
- Unverified AI memories must not be treated as facts in product UI; the benchmark must grade proposal status and sources.

### Research

- `runResearchQuery` searches the configured legal-authority provider (local/test corpus in bench), synthesizes, writes `researchQueries` / `researchResults` / artifacts.
- Matter evidence and legal authority are separate provenance classes. Do not require Westlaw/Lexis.

### Draft

- `generateDraft` builds a draft with matter context, instructions, optional authority, version/provenance.
- HTTP drafts routes create/list/restore versions. Style is not a reliability metric.

### Analysis

- Contract: `analyzeContract`.
- Deposition: `analyzeDeposition`.
- Compare / contradiction as above.
- Evidence matrix is an agent tool (`getEvidenceMatrix`) over verified facts, not a separate public “matrix app.”

### Agents

| Piece        | Current implementation                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestrator | `NyayaOrchestrator` (`packages/agents/src/orchestrator.ts`)                                                                                                             |
| Intent       | `classifyIntent` — simple QA can return `mode: "qa"` and the HTTP layer then calls `askNyayaAboutMatter`. Benchmark agent smoke forces `mode: "task"`, `execute: true`. |
| Planner      | `planAgentRun` (`packages/agents/src/planner.ts`)                                                                                                                       |
| Run engine   | `createAgentRun` / `executeAgentRun` (`packages/agents/src/engine.ts`)                                                                                                  |
| Depth        | `MAX_ORCHESTRATION_DEPTH = 1` (no agent-spawned sub-agents)                                                                                                             |
| Approvals    | `createActionProposal` — pending even for low risk; `reviewApproval`                                                                                                    |
| Budgets      | Default `maxSteps: 12`, `maxToolCalls: 40`, `maxRetries: 1`, `maxRetrievedContext: 20`, `timeoutMs: 120000`                                                             |
| HTTP         | `POST /api/v1/matters/[matterId]/agents` and `.../ask` task mode; execute route under `agents/[runId]/execute`                                                          |

Known agent types (`KNOWN_AGENT_TYPES`):

`research_agent`, `draft_agent`, `contract_agent`, `evidence_agent`, `discovery_agent`, `deposition_agent`, `timeline_agent`, `graph_agent`, `memory_agent`.

Default tools:

`searchMatterDocuments`, `retrieveMatterChunks`, `searchLegalAuthorities`, `getVerifiedTimeline`, `getMatterGraphNeighborhood`, `retrieveMatterMemory`, `analyzeContract`, `analyzeDeposition`, `compareDocuments`, `getEvidenceMatrix`, `getDiscoveryReview`, `detectContradictions`, `createDraft`, `reviseDraft`, `createTaskProposal`, `proposeMemory`, `saveResearchArtifact`, `proposeDiscoveryClassification`.

There is no `sendEmail` tool.

Benchmark agent route: `NyayaOrchestrator().runTask({ mode: "task", execute: true })`. Do not call `compareDocuments` / `askNyayaAboutMatter` as a stand-in for an agent score.

Agent metrics to add once agent ground truth exists (until then **NOT CURRENTLY MEASURABLE**):

```
agent_run_success_rate
planner_accuracy
tool_selection_accuracy
unnecessary_tool_rate
approval_compliance_rate
budget_compliance_rate
partial_failure_handling_rate
agent_artifact_grounding_rate
agent_citation_accuracy
```

A correct final answer reached through unsafe agent behavior must not receive a perfect agent score.

---

## CLI

Live execution requires `run` (or `smoke-subsystems`). Mode names without `run` list the catalog; they do not spend tokens on 500 tests.

```bash
npm run bench -- v1 list
npm run bench -- v1 run SYNTH-001 SYNTH-001-Q001
npm run bench -- v1 run SYNTH-001 --mode case-qa
npm run bench -- v1 run SYNTH-001 --mode full-system
npm run bench -- v2 run --mode compare-contradiction
npm run bench -- v1 run SYNTH-001 --mode timeline
npm run bench -- regrade 2026-08-18T03-14-16-862Z 2026-08-18T03-20-13-556Z
npm run bench -- smoke-subsystems
```

`--mode graph|research|draft|agents` against current V1/V2 catalogs yields `NOT_APPLICABLE_TO_SUBSYSTEM` for every task. `--mode memory` loads a V2 overlay catalog (existing PDFs, new M-tasks) and grades persisted Memory. Smoke uses `executionTargetOverride` so those pathways can be invoked once without inventing fixtures.

---

## Reporting

Future live full-system reports must show subsystem rows first, then overall. Do not hide everything in one number.

Failure classes (use when classifiable; otherwise leave unset rather than guessing):

```
RETRIEVAL_FAILURE
REASONING_FAILURE
GROUNDING_FAILURE
CITATION_FAILURE
TIMELINE_FAILURE
GRAPH_FAILURE
MEMORY_FAILURE
RESEARCH_FAILURE
DRAFT_FAILURE
AGENT_PLANNING_FAILURE
AGENT_TOOL_SELECTION_FAILURE
AGENT_APPROVAL_FAILURE
AGENT_EXECUTION_FAILURE
AGENT_ARTIFACT_FAILURE
INFRASTRUCTURE_FAILURE
GRADER_FAILURE
POSSIBLE_BENCHMARK_DEFECT
```
