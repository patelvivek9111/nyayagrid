# NYAYAGRID BETA UX / PRODUCT READINESS

Audit of the professional workspace **as implemented** (`apps/web/src/app/app/` and `components/ux/`). Graph production files and frozen AI reliability/trust logic were not modified. Isolated P0 UI/gating fixes from this phase are noted in §23.

---

## 1. Executive Summary

The professional product is already **case-centric** once a Case is open: a two-row Case chrome (Home / Chats / Documents / Timeline / Evidence / People / Graph / Memory / Work + Draft / Research / Analysis / Review) plus a global ChatGPT-style sidebar (Ask Nyaya, recent chats, recent cases, firm ops).

Friction for a controlled legal beta is mostly **clarity and discovery**, not missing core screens:

- Landing **Ask Nyaya** (`/app`) is general-by-default; Case files are optional via a chip. Easy to start a chat that **does not read case files**.
- **Nine primary Case tabs plus four work surfaces** is a lot; Draft/Analysis/Review can be missed; `/nyaya` and `/tasks` exist off-tab.
- Trust chrome is generally **Suggested vs Confirmed** (amber vs accent), but the shared badge still says **“Verified”**, which overclaims legal truth.
- **Agents** were reachable from Work, Nyaya “longer task”, and Ask `mode: task` even when `FEATURE_AGENTS` is off (Work could hard-fail). Isolated fixes hide that path.
- Document processing now polls, but lawyers previously saw raw enums (`awaiting_malware_scan`). Isolated copy/badge fix.
- **No first-run Case tour**; onboarding only creates a firm and does not redirect.
- Research is a real UI but **not reliability-certified**; Agents stay off.

**Decision: READY AFTER P0 UX FIXES** — remaining P0 after this phase is operator/product: keep Agents off, use `/portal` for guests, and do not treat Research as a Westlaw replacement. Remaining in-product P0s that we did **not** change (frozen surfaces) are listed as P1-with-freeze-note.

---

## 2. Current Professional Workspace

Real flow from code:

1. Auth (Clerk in production) → `/app`
2. Optional `/app/onboarding` (create org; **no auto-continue**)
3. Sidebar: Ask Nyaya / Chats / Cases / Firm / More
4. `/app/cases` → `/app/cases/new` or open a Case
5. Case **Home** overview
6. **Documents** upload (202 + poll)
7. **Chats** Ask Nyaya (matter-scoped)
8. **Review** proposed Timeline/Facts/Entities/Deadlines
9. **Timeline / Memory / Graph / Evidence**
10. **Analysis** (contracts, depositions, comparisons, discovery)
11. **Draft**
12. **Research** (case-scoped + `/app/research`)
13. Return via Case Chats list or sidebar

Legacy `/app/matters` redirects to `/app/cases`.

---

## 3. Case-Centric Navigation

**Inside a Case:** header eyebrow “Case”, title `matterNumber — title`, status. Sidebar highlights the case. Chat threads show a Case chip.

**Gaps:**

- Client name is **not** in Case chrome (Home “Case details” only). Chrome API returns title/number/status only.
- **No breadcrumbs** (Cases → this Case → tab).
- Global **Ask Nyaya** can run **without** a Case (research session). Footer warns files won’t be read — easy to miss.
- Three Ask surfaces: `/app`, Case `/chats`, Case `/nyaya` (citations/source inspector differ).

Switching general chat vs Case chat is the main context-loss risk.

---

## 4. Case Overview

Home (`cases/[matterId]/page.tsx`) is dense but useful: client, status, type, jurisdiction, court, team, intelligence counts, review prompt, AI summary (disclaimer), key facts, open questions, people, timeline slice, documents with processing labels, tasks, deadlines, research teaser, drafts, notes, recent chats.

**Judge is hardcoded “Not recorded.”** Notes admit there is no Notes tab.

Not a failure; it is an **overview plus many deep links**, not a calm “what to do next” for first week.

---

## 5. Information Architecture

| Surface | Placement |
| --- | --- |
| Home | Primary tab |
| Chats | Primary |
| Documents | Primary |
| Timeline / Evidence / People / Graph / Memory | Primary |
| Work | Primary hub |
| Draft / Research / Analysis / Review | Secondary row |
| Nyaya (ask + agents) | Off-tab |
| Tasks & deadlines | Off-tab (`/tasks`) |

**Duplication:** Ask on `/app`, `/chats`, `/nyaya`. Evidence vs Analysis “evidence” tab. Compare on Documents **and** Analysis.

**Hidden:** Review (most important human loop) is a **small secondary** tab. Tasks hidden. Nyaya source inspector better than Case Chats drawer.

**Too many tabs** for 10–25 users in week one. Acceptable for beta if Review is taught; not Harvey-simple.

---

## 6. Trust Language

`plain-labels.ts` maps `proposed` → Suggested, `approved` → Confirmed.

Shared `VerifiedBadge` default copy is **“Verified”** (used on Timeline, Memory, People, Graph, Home). That is stronger than “attorney reviewed this extraction.” Suggested items use amber **Suggested by Nyaya**.

**Misleading / overstrong:**

- Default **Verified** (not “Reviewed” / “Confirmed”)
- Graph count **“verified edges”** (not edited this phase)
- Memory type `verified_context` → “Confirmed fact”
- Ask **Grounded in Case sources** is honest if citations exist
- Analysis items show raw `proposed` status without the Suggested badge (still readable)

Did **not** change Timeline/Memory/Graph/Analysis copy (frozen). Isolated badge default change would also restyle Graph — skipped.

---

## 7. Review Workflows

**Review** page: extract, four queues, inspect sources, Approve / Edit & approve / Reject, **no Approve All**. Empty: cannot approve AI proposals without sources.

Timeline/Memory/People: suggested vs confirmed views, source drawer, reject reasons, supersede (Memory).

Analysis: Mark reviewed / Dismiss on proposed items; busy “Working…” on some actions.

Draft: **Attorney review required** banner; generate/edit/versions/restore; **does not** claim sentence-level citation lock. Source assertions listed on versions.

**Gaps:** Approve visible even if API will 403 (no capability hiding). Review is easy to miss in the secondary row. Graph review exists (read-only audit).

---

## 8. Citation / Source Inspection

| Surface | Provenance UX |
| --- | --- |
| Case chat | `[n]` → SourceDrawer; enrich via chunk API |
| Nyaya Ask | Quote buttons + passage + Open original |
| Timeline / Memory / Evidence | Inspect sources / both sides |
| Draft | `sourceAssertions` on versions, not inline in body |
| Research | citations/snippets; treatment **not independently verified** |
| Graph | provenance in inspector (do not change) |

Backend chunk/page often exists; Case chat drawer titles sometimes generic **“Document source”** until enrich.

---

## 9. Documents / Processing

POST upload → 202 accepted; UI treats `res.ok`. Poll every 2.5s while in-flight. Failed states block open.

**This phase (UI only):** friendly stage labels (Received, Scanning, Reading text, Indexing, Ready — extracting insights, scan blocked, etc.); **raw enum/malware badges removed**; copy that background work is not a failed upload; 503 enqueue messaging.

**Still P1:** one file at a time; no search/filter/pagination (API has cursor); 50–100 docs is a long list; stuck `uploaded` has no in-app operator hint (ops script exists).

---

## 10. Ask Nyaya

Case chats stay on the Case. New chat from Case composer keeps matter in the URL. Global Ask needs an explicit Case chip.

Citations + evidence state (grounded / partial / insufficient). “Need more documents” path exists on threads.

**Start a task** now hidden when Agents flag is off. Ask API **does not start agent runs** when Agents are disabled (`mode: auto` answers Q&A; `mode: task` 404).

Busy label: **Working…** / Nyaya **Retrieving…**. No elapsed timer for long Ask.

---

## 11. Timeline

Verified vs Suggestions views; date precision; origin; Inspect sources; approve/reject; linked conflicts stay dual-sided. Proposed extras are a **separate Suggestions list** (good for noise). Grouping is type filter only. Duplicate events are a reliability issue, not a missing screen.

---

## 12. Memory

Proposed vs confirmed lists; origin badge (raw origin key); types including user instruction vs confirmed fact; supersede/edit. Origin is visible but not always plain English (“Did I tell Nyaya this?”).

---

## 13. Graph

**Read-only.** Workspace: nodes/edges, proposed vs approved, review panel, suggested vs verified badges. Risks: clutter, “verified edges” wording, filters. Recommendations only — Agent 1 owns reliability.

---

## 14. Evidence Matrix

Contradictions: Side A / B, Conflicting evidence badge, proposed vs Reviewed, inspect both sides, link Timeline without auto-merge. Copy says findings stay proposed until reviewed. Not presented as a “truth score.” Provenance via sources/quotes; chunk IDs not shown as IDs (good).

---

## 15. Analysis

Tabs: contracts, comparisons, depositions, evidence, discovery (raw tab labels). Contract/deposition: Analyze button, items with original text + Nyaya explanation, review/dismiss. Compare also on Documents. **Busy** on run. Proposed items not as visually “suggested” as Timeline. Frozen — report only.

---

## 16. Draft

List, generate, edit, versions, restore, transform, AI-generated + attorney-review banner, source assertions. Body is a textarea — **do not imply sentence-level verification**. Status badges are raw keys (`draft`).

---

## 17. Research

Case Research + global Nyaya Research. Sessions, hits, memo “AI-generated draft memo · not attorney work product until reviewed.” Authority HTTP import off in beta ops. **Not beta-ready as a research product.** Keep as optional corpus search with the existing caution.

---

## 18. Agent Disabled State

**Before this phase:** Work `Promise.all` **threw** on agents 404; Nyaya **Start a longer task** always shown; composer **Start a task**; Ask `mode: task`/`auto` could orchestrate.

**After isolated fixes:** `GET /api/v1/features`; hide Professor/Guide sidebar links when flags off; hide task UI; Work degrades without agent panels; Ask will not create runs when Agents off.

Nyaya **Ask** tab remains (Q&A, not Agents). Direct `/agents` URLs still 404.

---

## 19. Roles / Permissions UX

Professional `/app` does **not** hide upload/approve by role. **Client Guest** capabilities are view-only at the API; guests in `/app` see dead-end buttons. Intended guest UI is **`/portal`**. Staff may see Draft/Research they cannot run. **P1:** capability-aware buttons. Controlled beta: do not invite guests into `/app`.

---

## 20. Errors / Empty / Loading States

Shared `EmptyState` / `LoadingState` / `ErrorState`. Many pages still use raw “Loading…”. Empty copy generally explains next action (upload, ask, run detection). Failures usually `error.message` from API (not stacks). Rate limit / 429 may be generic “Too many requests.” OCR: “Needs OCR (not enabled).” Inngest delay: polling + received copy. OpenAI outage: Ask error string.

---

## 21. Accessibility

Case tabs: `aria-label`, `aria-current`. Composer **+** has `aria-expanded`. Mobile: sidebar **Menu**, tab overflow-x. Contrast: professional ink/accent. Gaps: icon-only **+** for new case; many icon-less tables; focus rings inconsistent; no skip-link. **Not a WCAG program.** No isolated blocker beyond the unlabeled Cases **+**.

---

## 22. End-to-End Lawyer Workflow

Synthetic walkthrough from routes (not a live production session):

| Step | Path | Clicks (approx.) | Notes |
| --- | --- | --- | --- |
| Login | Clerk | — | |
| Landing | `/app` | 0 | Easy to ask **without** a Case |
| Cases | sidebar **All cases** or recent | 1–2 | |
| Create Case | **+** / `/cases/new` | 2 | |
| Open Case | title | 1 | Client not in header |
| Upload 5 docs | Documents, 5× file picker | 5+ | One file at a time; wait on badges |
| Ask | Chats composer | 1 | Citations via `[n]` |
| Timeline | tab | 1 | Switch **Suggestions** to review |
| Memory | tab | 1 | Origin badge |
| Evidence | tab | 1 | Run detect if empty |
| Analysis | secondary tab | 1–2 | Easy to miss |
| Review finding | Mark reviewed | 2 | |
| Draft | secondary | 1 | Generate ~16s, **Working…** if wired |
| Reopen chat | Chats list | 1 | Case-scoped |
| Home | Home tab | 1 | |

**Confusing moments:** landing vs Case Ask; Review buried; Nyaya vs Chats; Work previously dying when Agents off; processing enums (fixed). **Dead ends:** guest approve; Agent task before fix; onboarding no redirect.

---

## 23. P0 / P1 / P2 Findings

### P0 (blocked or would have blocked)

| ID | Status |
| --- | --- |
| UX-P0-1 Agent UI / Ask task while Agents off | **Fixed this phase** (UI + Ask gate) |
| UX-P0-2 Work page hard-fail on Agents 404 | **Fixed** |
| UX-P0-3 Processing looks failed / raw enums | **Fixed** (labels + 202 copy) |
| UX-P0-4 Guest in `/app` with full chrome | **Operational:** use `/portal` — not coded as role filter |

### P1 (before wider beta)

- Case client in chrome; breadcrumbs
- Teach / promote **Review**
- Default badge **Verified** → Confirmed/Reviewed (avoid Graph file edits or accept Graph restyle)
- Hide or disable actions the user cannot perform
- Document search/filter; multi-file upload
- Collapse Ask surfaces (keep one Case Ask)
- Analysis proposed styling (when Analysis freeze lifts)
- Onboarding redirect + 5-step contextual checklist
- Long-job progress (analysis/draft ~16s)
- Research not sold as complete research

### P2

- Tab count / Harvey-like simplicity
- Notes tab
- Judge field
- Pagination polish
- Full WCAG
- Capability-aware entire nav

---

## 24. Prioritized Polish Backlog

| ID | Sev | Screen | Problem | Impact | Change | Size | Parallel? | Dep |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UX-01 | P0 | Agents/Ask/Work | Agents discoverable while disabled | Accidental agent runs / Work crash | Hide + gate | S | yes | flags |
| UX-02 | P0 | Documents | Unclear async ingest | Think upload failed | Friendly states | XS | yes | none |
| UX-03 | P1 | Case chrome | No client / crumbs | “Which case?” | Chrome API + header | S | yes | chrome API |
| UX-04 | P1 | Review | Buried in work row | Skip human review | Promote Review | S | yes | IA |
| UX-05 | P1 | VerifiedBadge | Says Verified | Overtrust | Copy Confirmed | XS | **no if Graph freeze** | Graph 6O |
| UX-06 | P1 | Roles | Dead-end buttons | Frustration | Hide by capability | M | yes | capabilities API |
| UX-07 | P1 | Documents | No find-in-list | 25–100 docs | Filter/search | S | yes | GET already paged |
| UX-08 | P1 | Ask | Three Ask UIs | Context loss | One Case Ask | M | careful | chats/nyaya |
| UX-09 | P1 | Onboarding | Firm create only | Lost first hour | Redirect + 5 hints | S | yes | none |
| UX-10 | P1 | Analysis | Proposed looks like finding | Overtrust | SuggestedBadge | XS | **no while Analysis frozen** | Analysis |
| UX-11 | P1 | Draft/Analysis | Frozen 16s | Feels hung | Progress copy | XS | yes | none |
| UX-12 | P1 | Research | Looks like full research | Wrong expectation | Stronger “corpus only” | XS | after Research reliability | Research |
| UX-13 | P2 | Tabs | Too many | Cognitive load | Group Intelligence | L | no | IA |
| UX-14 | P2 | a11y | Cases `+` unlabeled | AT users | aria-label | XS | yes | none |
| UX-15 | P2 | Graph | Clutter / labels | Hard review | After 6O | M | **no** | Graph 6O |

UX-01 and UX-02 implemented this phase.

---

## 25. Beta UX Decision

**READY AFTER P0 UX FIXES**

Core Case loop exists and is usable for 3–8 firms if operators: keep **Agents off**, send clients to **portal**, treat **Research as limited**, and tell lawyers to open **Review** after ingest. Isolated P0s for Agents and processing labels are in. Remaining wider-beta work is P1 (chrome, Review discovery, role-aware UI, document findability).

---

## 26. Exactly One Next Recommendation

**Put Review in the primary Case tab row (or a persistent “N items waiting” control on Home) so proposed Timeline/Memory/Graph/Analysis cannot be skipped after the first upload.**

Do not implement a full IA redesign in this phase.
