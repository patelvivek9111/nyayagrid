# NyayaGrid Product Specification

Canonical product and domain reference for NyayaGrid. Implementation details live in code and capability docs under `docs/`. Build/setup: [`NYAYAGRID_BUILD_GUIDE.md`](NYAYAGRID_BUILD_GUIDE.md). Engineering constraints: [`.cursorrules`](.cursorrules).

## 1. What NyayaGrid is

NyayaGrid is an **AI-native legal operating system** that combines:

1. **Legal intelligence** — answer questions, research authority, explain concepts, review documents, and draft work with source grounding.
2. **Legal operations** — manage clients, matters, documents, evidence, timelines, tasks, deadlines, research, drafts, and collaboration.

It is **not** a generic chatbot and **not** a traditional practice-management app with an AI button bolted on.

**Primary product workspaces (canonical):**

1. **Professional** — law firms and solo lawyers
2. **Nyaya Prosecution** — district attorney / prosecution offices (prosecutors, supervising prosecutors, investigators, legal support, prosecution read-only users, prosecution office administrators)

Nyaya Prosecution is a first-class workspace and near-term commercial / design-partner priority.

**Removed from product scope:** law students, public users, Nyaya Professor, and Nyaya Guide. Do not rebuild those surfaces.

Do not add corporate legal-department, insurance, or general enterprise workspaces unless explicitly requested. Prosecution / DA-office workspaces are in scope (they are not a “government non-goal”).

## 2. Brand and modules

**NyayaGrid** is the single platform and primary domain (`NyayaGrid.com`).

Built-in capabilities (not separate companies, codebases, or `{module}.com` products):

| Module                | Role                                                 |
| --------------------- | ---------------------------------------------------- |
| **Nyaya**             | Conversational AI and orchestration                  |
| **Nyaya Graph**       | Matter / case knowledge graph                        |
| **Nyaya Memory**      | Persistent, reviewable matter intelligence           |
| **Nyaya Timeline**    | Source-linked chronology                             |
| **Nyaya Research**    | Source-grounded legal research                       |
| **Nyaya Draft**       | Drafting, editing, citation, document generation     |
| **Nyaya Prosecution** | Criminal case workspace for DA / prosecution offices |

All modules share one identity system, design system, API surface, security model, and data platform.

## 3. Core principle: Matter-first (and Case-first for Prosecution)

The central object for professional work is a **Matter**. Documents, people, organizations, facts, events, evidence, deadlines, notes, tasks, drafts, communications, research, and AI outputs connect to a Matter whenever applicable.

For Nyaya Prosecution, the central object is a **Criminal Case** (tenant-scoped), with the same source-traceability and human-authority rules.

Every feature should support at least one of:

- Understand a legal matter or criminal case
- Answer a legal question
- Draft or review legal work
- Organize evidence and documents
- Track tasks, deadlines, and events
- Improve collaboration and accountability
- Support human-controlled prosecution operations (discovery, disclosure review, procedure, motions)

## 4. Non-negotiable constraints

- Never present AI output as guaranteed legal advice.
- Never fabricate cases, statutes, quotes, docket numbers, judges, deadlines, or citations.
- Legal answers based on external or uploaded sources must include source references.
- Distinguish sourced facts, user-provided facts, AI inferences, and unresolved questions.
- Preserve original uploads; maintain an immutable audit record.
- Destructive operations require explicit confirmation.
- Respect workspace, matter/case, and document permissions at every layer.
- Never expose one tenant’s data to another.
- Never use customer data for model training without explicit, separately recorded consent.
- No autonomous filing, sending, accepting, signing, or submitting without human approval.
- Dates and deadlines must show timezone and source when asserted.
- Generated documents remain drafts until explicitly approved.

### Prosecution-specific safety

- No guilt verdicts or probability-of-guilt scores.
- No autonomous charging recommendations.
- No autonomous plea recommendations.
- No autonomous final Brady / Giglio / disclosure determinations — humans decide.
- No autonomous court filing.
- No silent factual invention; no unsupported authority.
- No cross-case or cross-tenant data bleed.
- Consequential legal decisions remain human-controlled.

## 5. Workspaces

### Professional (firm + solo)

Same core system. Solo gets simpler onboarding/defaults; upgrade path to multi-user firm. No separate codebase.

Supports (among others): organizations/roles, clients/contacts, matters/teams, documents/versioning, Nyaya research and Q&A, drafting/review, Memory, Timeline, Graph, evidence organization, deposition/contract analysis, discovery review, tasks/deadlines/calendar, notes, audit logs, basic time/billing assistance.

### Nyaya Prosecution (DA / prosecution offices)

Primary workspace for prosecution offices. Roles include:

- Prosecution Office Admin
- Supervising Prosecutor
- Prosecutor
- Investigator
- Legal Support
- Prosecution Read-Only

Supports (target product surface): criminal case intake and assignment, defendants/charges/elements, evidence with provenance and chain of custody, witnesses and statements, discovery intake and production tracking, human disclosure review (Brady/Giglio candidates), warrants/suppression, motions, subpoenas, hearings, pleas (tracking only — no autonomous recommendations), case timeline, research, tasks, supervisor caseload operations, and audit.

## 6. Capability summary (current product)

### Nyaya (Ask)

Context modes: general research, current matter, current prosecution case, selected documents, drafting, review. Always show active context. Never silently mix unrelated matters, cases, or workspaces.

Answers must be citation-aware. Quotes from matter/case documents must be validated against retrieved chunks.

### Documents

Upload → process (extract/OCR/chunk/embed) → `ready` for retrieval. Preserve originals and versions. Matter-scoped or case-scoped retrieval only.

### Matter intelligence / Timeline

AI proposes timeline events, facts, entities, and deadlines from document evidence. Humans approve/edit/reject. Proposed items are never shown as verified facts. Deadlines are extracted from evidence — NyayaGrid does not invent procedural court calendars.

### Nyaya Graph

Matter-scoped (and prosecution case graph where implemented) nodes/edges with provenance. AI/document-derived edges require validated sources. Humans approve proposed edges.

### Nyaya Memory

Curated matter knowledge (not chat history). Only approved / edited_and_approved, non-superseded memories enter default answer context.

### Nyaya Draft

Matter-scoped drafting with version history. AI drafts require attorney review. No e-filing or court submission. Prosecution drafting follows the same human-review rule.

### Professional analysis

Contract analysis, document comparison, deposition analysis, contradiction candidates, evidence matrix. All proposals for attorney review. Citations mandatory for persisted findings.

### Discovery review (Professional)

Human-authoritative classifications separate from AI proposals. Privilege finals require explicit human authority (`humanPrivilegeFinal`).

### Motions and communications

First-class matter tables (`matter_motions`, `matter_communications`, link tables) with org/matter scope and provenance. Dates are explicit/source-backed only — no automatic jurisdictional deadline inference. See [`docs/architecture/motions-communications.md`](docs/architecture/motions-communications.md).

### Nyaya Research

Shared legal authority corpus (not matter-scoped) plus org/matter research sessions. Propositions separate `LEGAL_AUTHORITY` from `FACT_SOURCE`. Never invent authorities. Treatment/status honesty required. Prosecution research uses the same authority honesty rules with case jurisdiction context.

### Nyaya Agents

Goal → plan → tool-mediated steps with budgets, authorization, and human approval for consequential writes. Refused actions (email, file, accept settlement, etc.) prepare reviewable drafts only.

### Jurisdiction

US jurisdiction awareness for research and matter/case context. Laws vary; ask for jurisdiction before jurisdiction-dependent guidance. See [`docs/architecture/NYAYA_JURISDICTION.md`](docs/architecture/NYAYA_JURISDICTION.md).

## 7. Safety by workspace

**Professional:** Label AI output as draft work product. Human review before send/file/sign/publish. Warn when citations cannot be verified.

**Prosecution:** Label AI output as draft work product for office use. Human review for disclosure determinations, charging, pleas, and filings. Preserve case and tenant isolation. Never imply automated prosecution or CJIS/government certification unless separately and explicitly achieved.

## 8. Roles

**Professional:** Organization Owner, Administrator, Partner/Supervising Lawyer, Lawyer, Paralegal, Staff, Client Guest — capabilities are permission-based, not title-hardcoded alone.

**Prosecution:** Prosecution Office Admin, Supervising Prosecutor, Prosecutor, Investigator, Legal Support, Prosecution Read-Only — capability-based (`prosecution.view` / `prosecution.edit` / `prosecution.review` and related document/research/timeline caps).

Professional and Prosecution organization memberships stay isolated unless a user is explicitly invited into a shared portal or dual membership.

## 9. Technical stack (default)

| Layer          | Choice                                                         |
| -------------- | -------------------------------------------------------------- |
| Frontend       | Next.js, React, TypeScript (`apps/web`)                        |
| Worker         | `apps/worker`                                                  |
| Database       | PostgreSQL + pgvector                                          |
| Schema         | Drizzle (`packages/database`, SQL migrations under `drizzle/`) |
| Auth           | Provider adapter (dev / Clerk) with MFA path for enterprise    |
| Object storage | S3-compatible (MinIO locally)                                  |
| AI             | Provider-agnostic adapters (OpenAI, Anthropic, Google, …)      |
| Jobs           | Durable queue (Inngest via `@nyayagrid/jobs`)                  |

Do not introduce microservices until boundaries require them.

## 10. Explicit non-goals (initial)

Proprietary foundation model; autonomous court filing or representation; corporate-legal / insurance / general enterprise workspaces (Prosecution / DA offices are in scope); jury/judge outcome guarantees; settlement or guilt probability as fact; flashcards/quizzes/bar coaching; student or public consumer workspaces; blockchain/crypto payments; native mobile before responsive web is stable; full e-discovery production platform as MVP; replacing Westlaw/Lexis without licensed data; claiming CJIS or government certification without an explicit certified program.

## 11. Definition of done (features)

Permission checks, input validation, loading/empty/error/success states, audit events where applicable, tests, accessible UI, source attribution for AI outputs, human approval for consequential actions.

## 12. Related capability docs

- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- [`docs/MATTER_INTELLIGENCE.md`](docs/MATTER_INTELLIGENCE.md)
- [`docs/NYAYA_GRAPH.md`](docs/NYAYA_GRAPH.md) · [`docs/NYAYA_MEMORY.md`](docs/NYAYA_MEMORY.md)
- [`docs/NYAYA_DRAFT.md`](docs/NYAYA_DRAFT.md) · [`docs/NYAYA_RESEARCH.md`](docs/NYAYA_RESEARCH.md)
- [`docs/NYAYA_AGENTS.md`](docs/NYAYA_AGENTS.md)
- [`docs/DISCOVERY_REVIEW.md`](docs/DISCOVERY_REVIEW.md) · [`docs/PROFESSIONAL_ANALYSIS.md`](docs/PROFESSIONAL_ANALYSIS.md)
- [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md)
