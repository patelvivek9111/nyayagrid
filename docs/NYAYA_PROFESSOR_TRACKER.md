# Nyaya Professor Hardening — Task Tracker

**Goal:** Harden Nyaya Professor into the industrial Student Workspace in the product spec: a private, source-grounded case room for law students — upload or paste an opinion, generate a cited brief, ask follow-ups against that opinion, compare two of the student’s own cases, and keep a library of briefs, notes, and saved conversations — without ever touching professional matter data or implying academic authority.

This is the named next **product** track after the professional Case loop. Per build order it is Phase 6 follow-through, **not** Phase 8 firm ops (email, billing, client portal) and **not** production infrastructure.

Spec: `NYAYAGRID_PRODUCT_SPEC.md` §7 · Package docs: [`NYAYA_PROFESSOR.md`](./NYAYA_PROFESSOR.md) · Isolation: `packages/workspaces/src/professor/isolation.ts`  
UI: `apps/web/src/app/professor/*` · API: `apps/web/src/app/api/v1/professor/*` · Domain: `packages/workspaces/src/professor/`  
Schema: `packages/database/src/schema/phase8.ts` (`student_*` tables only)

Prior professional tracks (complete, do not reopen): [`AGENT_QUALITY_TRACKER.md`](./AGENT_QUALITY_TRACKER.md) · [`CASE_EXPERIENCE_TRACKER.md`](./CASE_EXPERIENCE_TRACKER.md)

Mark items `[x]` in this file as they ship. Do **not** create a new plan `.md` for each slice — update this one.

**Status: complete.** All sections below are done. Do not start Production Readiness, Case dogfood, or Nyaya Guide unless product explicitly switches tracks.

---

## Scope

**In scope** (product spec §7.1–7.3 + student navigation)

- Interactive case room: persistent Q&A on an uploaded opinion, source viewer, holding vs concurrence vs dissent
- Case brief generator UX that matches the validated backend (section sources, dropped quotes, no invented separate opinions)
- Compare two of the student’s own cases in the UI (API already exists)
- Student library: cases, briefs, notes, saved conversations — with spec nav
- Opinion ingest that stays on `student_cases*` (paste today; file upload without using the professional document pipeline)
- Isolation, citation, and study-aid guardrails as load-bearing tests, not copy
- Playwright beyond the current smoke (`e2e/professor.spec.ts`)

**Out of scope** (do not pull in unless asked)

- Flashcards, quiz generation, bar exam coaching, grade prediction, academic-dishonesty features
- Firm ops: email, calendar, time tracking, billing, client portal, notifications
- Production infra: Clerk, ClamAV, S3, backup/restore, monitoring, attorney-reviewed terms ([`PRODUCTION_READINESS_TRACKER.md`](./PRODUCTION_READINESS_TRACKER.md))
- Case-workspace tabs or a Case Experience §7 ([`CASE_DOGFOOD_TRACKER.md`](./CASE_DOGFOOD_TRACKER.md) if the professional file still needs a usability pass)
- Nyaya Guide hardening (Phase 7) — start a Guide tracker only after this one, if product asks
- Joining student cases to organizations, matters, or Guide documents
- Licensed Westlaw/Lexis replacement; Professor may read the **shared synthetic** authority corpus the same way Research does, with the same honesty
- Impersonating a professor or claiming academic authority
- Knowingly completing restricted examinations

---

## Current baseline (do not rebuild)

Already in tree — extend it; do not replace isolation or validators:

| Capability | Where | Honest gap |
| --- | --- | --- |
| Paste ingest, idempotent `(userId, sha256)`, opinion-part chunking | `ingest.ts` | No PDF/file upload UI; paste-only |
| Brief generation + `validateCaseBrief` (verbatim quotes, no dissent cited as holding) | `briefs.ts`, `POST .../brief` | Case page is generate + one-shot ask; no challenge/edit, no persisted case-room thread |
| Ask Professor + provenance split (`UPLOADED_CASE` vs `LEGAL_AUTHORITY`) | `conversations.ts`, `/professor/ask` | Case-detail ask creates a **new** conversation every submit and shows answer text only (no sources on that panel) |
| Compare two cases + tension requires both sides | `compare.ts`, `POST /api/v1/professor/compare` | **No UI** |
| Saved items API | `saved.ts`, `/professor/saved` | List dump; no delete in UI; no links back to case/brief/conversation |
| Isolation allow-list + forbidden professional tables | `isolation.ts`, permissions integration tests | Keep as regression; never relax |
| Student nav | `StudentShell` | Ask / Cases / Saved only — spec also wants Case Briefs, Notes, Settings |
| E2E | `e2e/professor.spec.ts` | Smoke: home, paste ingest, generate brief, ask |

Every Professor table is scoped by `userId` only — no `organizationId`, no `matterId`. That constraint is non-negotiable for this track.

---

## 1. Interactive case room

Turn `/professor/cases/[caseId]` into the room spec §7.2 describes, not a one-shot brief page.

- [x] Persistent conversation **on this case** (reuse one case-scoped thread; do not `POST` a new conversation on every question)
- [x] Side-by-side: brief / answer and source viewer (already started — keep it, make sources the default after every answer)
- [x] Follow-up questions stay on the same case; cited `chunkId`s must belong to this case version
- [x] Click a citation to highlight the passage; opinion-part badge (`majority` / `concurrence` / `dissent`) is visible
- [x] Distinguish holding vs commentary vs concurrence vs dissent in the answer UI (use `opinionPart` on `UPLOADED_CASE` sources — do not let the model relabel a dissent as the holding)
- [x] Counterfactual / hypothetical questions are allowed, but `NO_AUTHORITY_LIMITATION` (or equivalent) stays when no legal-authority source survives
- [x] Challenge a generated brief section: student can flag “this does not match the passage”; do not silently overwrite the validated brief without a new generation
- [x] `PROFESSOR_STUDY_AID_NOTICE` visible in the room, not only on `/professor/ask`
- [x] Loading / empty / error: no brief yet, ingest still processing, ask failed, no surviving sources (`NO_STUDENT_SOURCES_ANSWER`)

---

## 2. Case briefs as a first-class library

Backend already persists one brief per case version.

- [x] Student nav item **Case Briefs** (spec navigation) listing generated briefs with case title, court, year
- [x] Open a brief into the case room (not a disconnected HTML dump)
- [x] Each section shows source chips that jump to the passage (already on the case page — reuse)
- [x] Majority-only sections never present a concurrence/dissent citation; if the opinion never labels a separate opinion, show `BRIEF_NO_SEPARATE_OPINIONS_LIMITATION` rather than empty fake sections
- [x] Save brief to `student_saved_items` from the room; Saved lists it as `case_brief` with a link back
- [x] Regenerate is explicit and version-aware (append-only case versions already exist — do not overwrite case text)

---

## 3. Compare two cases (wire the existing API)

`POST /api/v1/professor/compare` + `compareStudentCases` are implemented. There is no page.

- [x] UI to pick Case A and Case B from **this student’s** library only
- [x] Ownership 404-equivalent if either id is missing or belongs to someone else (same as API)
- [x] Render fields: facts, issue, rule, reasoning, holding, outcome — each with per-side chunk citations
- [x] Tensions only if both sides have supporting passages; dropped tensions explained, not shown as a doctrinal split
- [x] Limitations always include the study-aid + “no conflict asserted” copy when tensions were dropped
- [x] Save comparison to the library (`itemType: case_comparison`)
- [x] Playwright: two SYNTH opinions → compare → each side’s cites resolve to that side’s case

---

## 4. Student library, notes, and navigation

Spec student nav: Home · Nyaya Professor · Cases · Case Briefs · Notes · Saved Conversations · Settings

Today: Ask · Cases · Saved.

- [x] Align `StudentShell` with spec labels (Nyaya Professor home, Cases, Case Briefs, Notes, Saved Conversations, Settings) without adding professional Case tabs
- [x] **Notes:** student-owned notes on a case or brief (user-scoped table or existing saved-item type — do not write `notes` / matter notes). Create, edit, delete with ownership checks; existence of another student’s note is indistinguishable from missing
- [x] **Saved Conversations:** `/professor/saved` (or a dedicated route) lists conversations with resume links to `/professor/ask?conversationId=` — not only saved snippets
- [x] Saved items: delete in the UI (API already ownership-checks); link explanation → conversation, brief → case, comparison → both cases
- [x] Tags and course folders (spec §7.3) — lightweight: a `tag` / `courseLabel` string on cases and saved items is enough; do not build a second LMS
- [x] Settings: explanation-level default, study-aid reminder, account/workspace switcher only — no firm admin, no billing

---

## 5. Ingest: file upload without the professional pipeline

Paste ingest is correct and isolated. Students still need to add an opinion from a file.

- [x] Accept a text or PDF **buffer** in `ingestStudentCase` (docs already describe this) and from the Cases UI
- [x] Write only `student_cases` / `student_case_versions` / `student_case_chunks` — **never** `documents`, `document_chunks`, MinIO matter keys, or the professional malware/OCR pipeline
- [x] Idempotent on `(userId, sha256)` of extracted text; duplicate paste/upload returns the existing case
- [x] Conservative opinion-part headings unchanged (`detectOpinionPartHeading` — never guess a dissent into the majority)
- [x] Audit `student_case.ingested` records counts and labelled parts **only** — never case text
- [x] If PDF text extraction fails, say so; do not silently store an empty opinion
- [x] SYNTH fixture opinions for demos/tests, clearly labeled — no mock citations that look like real reporters

---

## 6. Ask Professor quality (study tool, not Case Chat)

`/professor/ask` already has explanation levels (simple / standard / advanced) and case scoping. Harden it to spec §7.1.

- [x] Doctrine questions may retrieve the shared authority corpus; uploaded-case questions must still cite the opinion first
- [x] UI separates `UPLOADED_CASE` vs `LEGAL_AUTHORITY` vs `PROFESSOR_EXPLANATION` the way the validator already does
- [x] Quotes that fail verbatim check are stripped; if nothing survives, show `NO_STUDENT_SOURCES_ANSWER` — never an ungrounded explanation
- [x] Jurisdiction / “not binding law” limitation when zero authority sources survive
- [x] Socratic follow-up (field already on messages) is shown and optional to click — not a hidden JSON field
- [x] Depth: explanation level is applied and visible on the thread
- [x] Patterns from spec as starter prompts: explain simply; why the court ruled; most important fact; hypothetical fact change; compare with another case
- [x] Do not complete an exam the student says is a closed / restricted assessment — refuse and log a limitation (deterministic keyword / user flag, not a silent model hedge)

---

## 7. Isolation and safety (regression, not optional polish)

These are already the point of Professor. This section is tests and proof, not new product ideas.

- [x] `assertStudentQueryIsIsolated` still wraps every retrieval SQL skeleton
- [x] Hits never carry `documentId` / `matterId` / `organizationId`
- [x] Cross-user: another student’s `caseId` is “not found,” never 403-with-existence
- [x] Professor routes cannot read `matters`, `documents`, `guide_documents`, agent tables
- [x] Integration tests in `packages/permissions` / `packages/workspaces/src/professor` cover the new case-room, compare UI path, notes, and file ingest
- [x] No student data in professional Case Home, and no matter data in Professor
- [x] Feature flag `FEATURE_PROFESSOR` still does not replace authorization

---

## 8. Playwright and definition of done

Extend `e2e/professor.spec.ts` (keep unique opinion text per run — ingest is hashed per user).

- [x] Home loads; study-aid notice visible
- [x] Paste (and, once shipped, file) ingest → library row
- [x] Generate brief → section sources open the passage; dissent not cited as holding on a SYNTH majority-only opinion
- [x] Case room: two follow-ups in the **same** conversation; sources on the answer
- [x] Compare two SYNTH cases; tensions require both sides
- [x] Save brief + conversation; Saved / Case Briefs / Notes show them; delete saved item
- [x] Unauthenticated or foreign case id never returns another student’s text
- [x] Loading / empty / error covered on Cases, case room, compare, saved

A slice is not done until it also has: permission checks, input validation, audit where ingest/ask/compare/save run, accessible UI (keyboard to sources), and the study-aid + source-attribution rules above.

---

## How to use

1. Pick the next unchecked section (order above is preferred: case room → briefs library → compare UI → nav/notes → file ingest → ask quality → isolation proof → e2e).
2. Implement + test.
3. Check off boxes in **this file** in the same PR / session.
4. Move a whole section to **Done** only when all of its boxes are `[x]`.
5. Do not start Production Readiness or Case dogfood in the same session as this track.
6. Do not start Nyaya Guide until this tracker has no remaining unchecked product section, unless product explicitly switches tracks.

---

## Done (2026-08-13)

All eight sections shipped in this session:

- Case room reuses one `student_conversations.caseId` thread; sources and opinion-part badges are the default after each answer; brief challenges persist as `student_notes` (`brief_challenge`) without overwriting the validated brief.
- Case Briefs library, Compare UI, Notes (user-scoped `student_notes`, never professional `notes`), Saved Conversations with resume/delete/links, Settings (device preferences only), spec nav.
- File ingest via multipart buffer on `student_cases*` only; empty PDF extraction fails loudly; SYNTH fixtures labeled as non-authority.
- Restricted-assessment refusal is deterministic and audited; starter prompts and clickable Socratic follow-ups on Ask.
- Isolation lists include `student_notes` and forbid professional `notes`; integration tests cover case-room reuse, notes ownership, file ingest, empty extract, exam refuse, and `FEATURE_PROFESSOR` ≠ authorization.
- Playwright `e2e/professor.spec.ts` covers home, two-case ingest, brief, case-room follow-ups, compare, save/notes/delete, Ask, and unauthenticated/foreign 401/404.

Migration: `packages/database/drizzle/0009_professor_hardening.sql`.
