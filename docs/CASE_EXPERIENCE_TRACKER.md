# Case Experience — Task Tracker

Living checklist for an industrial Case-centered professional workspace.
Mark items `[x]` in this file as they ship. Do **not** create a new plan `.md` for each slice — update this one.

Prior track (complete): [`AGENT_QUALITY_TRACKER.md`](./AGENT_QUALITY_TRACKER.md)  
Chrome: `apps/web/src/components/ux/case-chrome.tsx` · Pages: `apps/web/src/app/app/cases/[matterId]/*`  
Product anchors: `.cursorrules` §6.1 Matter Dashboard · `NYAYA_DRAFT.md` · `NYAYA_MEMORY.md` · `NYAYA_GRAPH.md`

---

## Scope

**Goal:** Harden the Case-centered professional workspace so the primary Case tabs feel industrial end-to-end — especially thin surfaces (**People**, **Tasks**, **Work**) and attorney-facing polish on **Memory**, **Graph**, **Draft**, and **Case Home**.

**In scope**

- Review UX (approve / reject / edit) on People, Memory, Graph, deadlines
- Provenance badges (`SuggestedBadge` / `VerifiedBadge`) — proposed never styled as verified
- Tasks + deadlines with timezone and source honesty
- Work as a real attorney command hub (not link-only panels)
- Draft source assertions, assumptions, unresolved placeholders
- Case Home panels per product §6.1
- Discoverability for Draft / Research / Analysis / Review via chrome or Work-first IA
- Playwright / API tests for each section’s definition of done

**Out of scope** (do not pull in unless asked)

- Firm ops: email / calendar sync, time tracking, billing, client portal, notifications
- Production infra: ClamAV, OCR provider, Redis rate limits, S3 / Clerk provisioning, monitoring
- Licensed reporter corpus / Westlaw–Lexis replacement
- Autonomous filing, send, or settlement
- Auto-verifying Memory or Graph
- Agent Quality Phase B eval science (statistical P/R, live-eval corpus growth) — keep on the agent-quality track if revisited

---

## Done

### 1. People & entity review

- [x] Inline approve / reject / edit on `people/page.tsx` via `entities/[entityId]/review` (stop bouncing only to `/review`)
- [x] Create / edit person or org + roles / aliases with Suggested vs Verified badges
- [x] Link entity → source docs / chunks and Graph neighborhood
- [x] Empty / loading / error states consistent with Evidence / Timeline UX components
- [x] Playwright: propose entity → approve on People tab → appears Verified on Case Home

### 2. Tasks & deadlines

- [x] Upgrade `tasks/page.tsx`: priority, description, status transitions (not just complete)
- [x] Surface verified + proposed deadlines (timezone + source) next to tasks; review via deadlines review API
- [x] Case Home: upcoming deadlines panel (spec §6.1) wired from matter chrome / GET matter
- [x] Work tab deep-link into task / deadline detail, not only title lists
- [x] Tests: task create / patch permission + deadline never shown without source / dateKind honesty

### 3. Work hub

- [x] Make `work/page.tsx` the attorney command center: approvals, open tasks, drafts needing review, analysis findings count
- [x] First-class links to Draft / Research / Analysis / Review / Nyaya (secondary surfaces not only buried)
- [x] Agent run cards open the specific run / approval on `nyaya/page.tsx`, not a generic Ask page
- [x] “Saved work” becomes real lists (recent research memos, draft statuses) — not link-only Panels
- [x] Smoke e2e: `awaiting_approval` run visible on Work → approve path

### 4. Memory & Graph attorney UX

- [x] Replace `any[]` Memory / Graph page models with typed DTOs; group by `memoryType` / `nodeType`
- [x] Memory: edit-and-approve, supersede flow, provenance / chunk cites before approve (never auto-verify)
- [x] Graph: clearer proposed-edge review + neighborhood provenance; keep list / neighborhood usable (visual canvas optional later)
- [x] Cross-links: Memory item ↔ People / Timeline; Graph node ↔ People / Documents
- [x] Guardrail check: proposed never styled as Verified (`SuggestedBadge` / `VerifiedBadge`)

### 5. Draft industrial pass

- [x] Show `sourceAssertions`, assumptions, unresolved placeholders beside editor (`draft/page.tsx` + draft version payload)
- [x] Document-scoped generate (pick matter docs) + “insufficient source material” honesty from `NYAYA_DRAFT.md`
- [x] Attorney-review banner for `aiGenerated`; status stays draft until explicit approve (no send / file)
- [x] Restore / version history UX that matches append-only ledger
- [x] Playwright: generate → sources panel nonempty or explicit insufficient → save version

### 6. Case Home & chrome completion

- [x] Home (`page.tsx`): key facts, open questions, people strip, docs, timeline peek, tasks, AI insights per product §6.1
- [x] Chrome: discoverability for Draft / Research / Analysis / Review (subnav or Work-first IA — pick one, document it)
- [x] Notes entry point if API exists; otherwise explicit “Notes via Memory / manual” until a notes tab
- [x] Align `/app/matters/*` redirects or deprecation so Cases is the only professional path
- [x] One e2e “day in the life”: upload → review entity → task / deadline → draft generate → Work hub reflects state

**IA (chrome):** Primary tabs stay Case objects (Home, Chats, Documents, Timeline, Evidence, People, Graph, Memory, Work). Draft, Research, Analysis, and Review sit on a **work-surfaces subnav** under those tabs. Work remains the attorney command hub.

---

## To do

All Case Experience tracker sections are complete. Do **not** add a §7 here.

**Pick one next track (do not start all three):**

- [`CASE_DOGFOOD_TRACKER.md`](./CASE_DOGFOOD_TRACKER.md) — use a SYNTH Case; open a new tracker only if a surface is still unusable for an attorney
- [`PRODUCTION_READINESS_TRACKER.md`](./PRODUCTION_READINESS_TRACKER.md) — ops: Clerk, ClamAV, S3, backup/restore, monitoring, attorney-reviewed terms
- [`NYAYA_PROFESSOR_TRACKER.md`](./NYAYA_PROFESSOR_TRACKER.md) — named product track: harden Nyaya Professor (not firm ops)

---

## How to use

1. Pick the next unchecked section (order above is preferred).
2. Implement + test.
3. Check off boxes in **this file** in the same PR / session.
4. Move a whole section to **Done** only when all of its boxes are `[x]`.
