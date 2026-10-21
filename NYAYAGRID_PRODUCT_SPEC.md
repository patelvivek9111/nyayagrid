# NyayaGrid Product Specification

Canonical product and domain reference for NyayaGrid. Implementation details live in code and capability docs under `docs/`. Build/setup: [`NYAYAGRID_BUILD_GUIDE.md`](NYAYAGRID_BUILD_GUIDE.md). Engineering constraints: [`.cursorrules`](.cursorrules).

## 1. What NyayaGrid is

NyayaGrid is an **AI-native legal operating system** that combines:

1. **Legal intelligence** — answer questions, research authority, explain concepts, review documents, and draft work with source grounding.
2. **Legal operations** — manage clients, matters, documents, evidence, timelines, tasks, deadlines, research, drafts, and collaboration.

It is **not** a generic chatbot and **not** a traditional practice-management app with an AI button bolted on.

Primary audiences (initial product):

- Law firms
- Solo lawyers
- Law students
- Public users

Do not add government, corporate legal-department, insurance, or general enterprise workspaces unless explicitly requested.

## 2. Brand and modules

**NyayaGrid** is the single platform and primary domain (`NyayaGrid.com`).

Built-in capabilities (not separate companies, codebases, or `{module}.com` products):

| Module | Role |
| --- | --- |
| **Nyaya** | Conversational AI and orchestration |
| **Nyaya Graph** | Matter knowledge graph |
| **Nyaya Memory** | Persistent, reviewable matter intelligence |
| **Nyaya Timeline** | Source-linked chronology |
| **Nyaya Research** | Source-grounded legal research |
| **Nyaya Draft** | Drafting, editing, citation, document generation |
| **Nyaya Professor** | Law-student learning |
| **Nyaya Guide** | Public legal information and document understanding |

All modules share one identity system, design system, API surface, security model, and data platform.

## 3. Core principle: Matter-first

The central object for professional work is a **Matter**. Documents, people, organizations, facts, events, evidence, deadlines, notes, tasks, drafts, communications, research, and AI outputs connect to a Matter whenever applicable.

Every feature should support at least one of:

- Understand a legal matter
- Answer a legal question
- Draft or review legal work
- Organize evidence and documents
- Track tasks, deadlines, and events
- Improve collaboration and accountability
- Explain legal information safely to students or the public

## 4. Non-negotiable constraints

- Never present AI output as guaranteed legal advice.
- Never fabricate cases, statutes, quotes, docket numbers, judges, deadlines, or citations.
- Legal answers based on external or uploaded sources must include source references.
- Distinguish sourced facts, user-provided facts, AI inferences, and unresolved questions.
- Preserve original uploads; maintain an immutable audit record.
- Destructive operations require explicit confirmation.
- Respect workspace, matter, and document permissions at every layer.
- Never expose one tenant’s data to another.
- Never use customer data for model training without explicit, separately recorded consent.
- No autonomous filing, sending, accepting, signing, or submitting without human approval.
- Dates and deadlines must show timezone and source when asserted.
- Generated documents remain drafts until explicitly approved.

## 5. Workspaces

### Professional (firm + solo)

Same core system. Solo gets simpler onboarding/defaults; upgrade path to multi-user firm. No separate codebase.

Supports (among others): organizations/roles, clients/contacts, matters/teams, documents/versioning, Nyaya research and Q&A, drafting/review, Memory, Timeline, Graph, evidence organization, deposition/contract analysis, discovery review, tasks/deadlines/calendar, notes, audit logs, basic time/billing assistance.

### Student — Nyaya Professor

Supports: concept explanation, case upload/briefing, interactive case Q&A, case comparison, citation-backed study answers, saved conversations/notebooks.

Exclude for now: flashcards, quiz generation, bar exam coaching, grade prediction, academic-dishonesty features.

### Public — Nyaya Guide

Supports: plain-language information, document/court-notice explanation, process explanation, timeline builder, evidence organizer, attorney consultation summary, lawyer-type guidance (not lawyer-selection guarantees), escalation when risk is high.

Must **never** imply attorney–client privilege or an attorney–client relationship.

## 6. Capability summary (current product)

### Nyaya (Ask)

Context modes: general research, current matter, selected documents, drafting, review, student explanation, public explanation. Always show active context. Never silently mix unrelated matters or workspaces.

Answers must be citation-aware. Quotes from matter documents must be validated against retrieved chunks.

### Documents

Upload → process (extract/OCR/chunk/embed) → `ready` for retrieval. Preserve originals and versions. Matter-scoped retrieval only.

### Matter intelligence / Timeline

AI proposes timeline events, facts, entities, and deadlines from document evidence. Humans approve/edit/reject. Proposed items are never shown as verified facts. Deadlines are extracted from evidence — NyayaGrid does not invent procedural court calendars.

### Nyaya Graph

Matter-scoped nodes/edges with provenance. AI/document-derived edges require validated sources. Humans approve proposed edges.

### Nyaya Memory

Curated matter knowledge (not chat history). Only approved / edited_and_approved, non-superseded memories enter default answer context.

### Nyaya Draft

Matter-scoped drafting with version history. AI drafts require attorney review. No e-filing or court submission.

### Professional analysis

Contract analysis, document comparison, deposition analysis, contradiction candidates, evidence matrix. All proposals for attorney review. Citations mandatory for persisted findings.

### Discovery review

Human-authoritative classifications separate from AI proposals. Privilege finals require explicit human authority (`humanPrivilegeFinal`).

### Motions and communications

First-class matter tables (`matter_motions`, `matter_communications`, link tables) with org/matter scope and provenance. Dates are explicit/source-backed only — no automatic jurisdictional deadline inference. See [`docs/architecture/motions-communications.md`](docs/architecture/motions-communications.md).

### Nyaya Research

Shared legal authority corpus (not matter-scoped) plus org/matter research sessions. Propositions separate `LEGAL_AUTHORITY` from `FACT_SOURCE`. Never invent authorities. Treatment/status honesty required.

### Nyaya Agents

Goal → plan → tool-mediated steps with budgets, authorization, and human approval for consequential writes. Refused actions (email, file, accept settlement, etc.) prepare reviewable drafts only.

### Nyaya Professor / Guide

User-scoped (no professional matter tables). Strict provenance separation. Guide: no legal advice claims, no invented deadlines, elevated caution for high-stakes situations.

### Jurisdiction

US jurisdiction awareness for research and matter context. Laws vary; ask for jurisdiction before jurisdiction-dependent guidance. See [`docs/architecture/NYAYA_JURISDICTION.md`](docs/architecture/NYAYA_JURISDICTION.md).

## 7. Safety by workspace

**Professional:** Label AI output as draft work product. Human review before send/file/sign/publish. Warn when citations cannot be verified.

**Student:** Encourage learning. Do not impersonate a professor or complete restricted exams.

**Public:** Legal information, not definitive advice. Highlight urgent deadlines; recommend qualified help for high-risk matters. No outcome guarantees. No false confidentiality/privilege expectations.

## 8. Roles (professional)

Organization Owner, Administrator, Partner/Supervising Lawyer, Lawyer, Paralegal, Staff, Client Guest — capabilities are permission-based, not title-hardcoded alone.

Student and Public accounts stay isolated from professional organizations unless explicitly invited into a shared portal.

## 9. Technical stack (default)

| Layer | Choice |
| --- | --- |
| Frontend | Next.js, React, TypeScript (`apps/web`) |
| Worker | `apps/worker` |
| Database | PostgreSQL + pgvector |
| Schema | Drizzle (`packages/database`, SQL migrations under `drizzle/`) |
| Auth | Provider adapter (dev / Clerk) with MFA path for enterprise |
| Object storage | S3-compatible (MinIO locally) |
| AI | Provider-agnostic adapters (OpenAI, Anthropic, Google, …) |
| Jobs | Durable queue (Inngest via `@nyayagrid/jobs`) |

Do not introduce microservices until boundaries require them.

## 10. Explicit non-goals (initial)

Proprietary foundation model; autonomous court filing or representation; government/corporate-legal workspaces; jury/judge outcome guarantees; settlement probability as fact; flashcards/quizzes/bar coaching; blockchain/crypto payments; native mobile before responsive web is stable; full e-discovery production platform as MVP; replacing Westlaw/Lexis without licensed data.

## 11. Definition of done (features)

Permission checks, input validation, loading/empty/error/success states, audit events where applicable, tests, accessible UI, source attribution for AI outputs, human approval for consequential actions.

## 12. Related capability docs

- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- [`docs/MATTER_INTELLIGENCE.md`](docs/MATTER_INTELLIGENCE.md)
- [`docs/NYAYA_GRAPH.md`](docs/NYAYA_GRAPH.md) · [`docs/NYAYA_MEMORY.md`](docs/NYAYA_MEMORY.md)
- [`docs/NYAYA_DRAFT.md`](docs/NYAYA_DRAFT.md) · [`docs/NYAYA_RESEARCH.md`](docs/NYAYA_RESEARCH.md)
- [`docs/NYAYA_AGENTS.md`](docs/NYAYA_AGENTS.md)
- [`docs/NYAYA_PROFESSOR.md`](docs/NYAYA_PROFESSOR.md) · [`docs/NYAYA_GUIDE.md`](docs/NYAYA_GUIDE.md)
- [`docs/DISCOVERY_REVIEW.md`](docs/DISCOVERY_REVIEW.md) · [`docs/PROFESSIONAL_ANALYSIS.md`](docs/PROFESSIONAL_ANALYSIS.md)
- [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md)
