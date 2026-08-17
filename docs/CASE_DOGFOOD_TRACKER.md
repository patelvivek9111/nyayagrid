# Case Dogfood — Task Tracker

**Goal:** Sit in the professional Case workspace as an attorney would, run one real SYNTH matter through every Case tab and work surface, and decide whether the professional Case loop is usable enough to stop building Case chrome — or whether a *new* usability tracker is warranted. This is a use-the-product track, not a build track. Do not invent a §7 on [`CASE_EXPERIENCE_TRACKER.md`](./CASE_EXPERIENCE_TRACKER.md).

Prior tracks (complete): [`AGENT_QUALITY_TRACKER.md`](./AGENT_QUALITY_TRACKER.md) · [`CASE_EXPERIENCE_TRACKER.md`](./CASE_EXPERIENCE_TRACKER.md)

Chrome: `apps/web/src/components/ux/case-chrome.tsx` · Pages: `apps/web/src/app/app/cases/[matterId]/*`  
Fixtures: `packages/ai/src/evals/golden-fixtures/` · Seed: `npm run seed:golden-matter`

Mark items `[x]` in this file as they are walked. Log findings here. Only if something still feels **unusable for an attorney** after the full pass, open a *new* tracker named for that problem — never a Case Experience §7.

---

## Scope

**In scope**

- Create or seed a clearly labeled SYNTH matter (not a real client matter)
- Click every primary Case tab and every work-surface subnav item
- Exercise the attorney loops those tabs were built for (upload, ask, review, verify, draft, work hub)
- Record pass / fail / “usable but rough” against the rubric below
- Open a new tracker **only** if a surface is still unusable for legal work

**Out of scope** (do not pull in unless asked)

- New Case tabs, IA redesign, or a Case Experience §7
- Firm ops: email, calendar sync, time tracking, billing, client portal, notifications
- Production infra: Clerk, ClamAV, S3, backup/restore, monitoring, attorney-reviewed terms
- Nyaya Professor / Nyaya Guide hardening
- Licensed reporter corpus / Westlaw–Lexis replacement
- Autonomous filing, send, or settlement
- Auto-verifying Memory or Graph

---

## Attorney-usability rubric

Judge each surface as an attorney opening a live file, not as an engineer checking that a route 200s. Playwright already navigates tabs (`e2e/professional.spec.ts`); this track is about whether the work is *doable*.

A surface **passes** when all of the following are true:

1. An attorney can complete the job the tab exists for without leaving the Case.
2. Loading, empty, error, and success states are honest — not blank white, not a raw JSON dump.
3. Proposed / Suggested is never styled as Verified.
4. Dates and deadlines show timezone and source (or an explicit “date unknown” / “approximately”).
5. AI output is labeled draft work product, with sources or an explicit insufficient-sources state.
6. Destructive or consequential actions (approve, reject, delete, generate) are explicit — nothing files, sends, or signs.
7. The next action is obvious from the page (not “I have to remember the API”).

A surface is **usable but rough** when the job can be done, but the path is slow, copy is unclear, or a secondary control is missing. Log it; do **not** open a new tracker for polish alone.

A surface is **unusable** when an attorney cannot complete the job, would not trust the output, or would bounce to another tool. That is the only reason to open a new tracker.

---

## 1. Environment and SYNTH matter

Use synthetic data only. Titles, bodies, and the matter number must stay labeled `SYNTH`. Do not upload real client files.

### 1.1 Local stack

- [x] `npm run docker:up` — Postgres (`pgvector`) and MinIO are up
- [x] `npm run db:migrate`
- [x] `npm run dev` — web app reachable; `AUTH_PROVIDER=dev` is expected locally
- [x] Confirm you are in a **professional** workspace (firm or solo), not Professor or Guide

Walked 2026-08-13: `nyayagrid-postgres` + `nyayagrid-minio` healthy; migrations applied; existing `npm run dev` on :3000; `GET /api/health/live` and `/api/health/ready` → 200 (`database`/`storage`/`config` ok). Browser `/app` shows **Professional** (not Professor/Guide). Org switched to **SYNTH Golden Demo Firm**.

### 1.2 Create the matter (pick one)

**Preferred — seeded golden matter** (already labeled, documents attached):

```bash
npm run seed:golden-matter
```

- [x] Seeded / reused org slug `synth-golden-demo`, client `SYNTH Golden Tenant Co`, matter number `SYNTH-GOLDEN-LEASE-V1`. Opened `/app/cases` and entered that matter.

Matter: `3ad4246b-853d-4e18-97c0-f622781293ce`  
Case Home: http://localhost:3000/app/cases/3ad4246b-853d-4e18-97c0-f622781293ce

Documents on the matter (all `ready`, all SYNTH): Master Lease Agreement, First Amendment, Email from Tenant counsel, Deposition of Property Manager, Email from Property Manager. `synth-party-roster.txt` exists on disk but is **not** in `buildGoldenFixtureDocuments()` / this seed — People tab later may need a manual upload if the roster is required.

**Alternative — click-created SYNTH matter** (skipped; preferred seed used):

- [ ] `/app/cases/new` — create a client if needed, then a matter titled with `SYNTH` (e.g. `SYNTH CAM date-conflict walkthrough`)
- [ ] Jurisdiction / court filled with clearly fake values (`SYNTH / Demo`)
- [ ] Upload fixtures from `packages/ai/src/evals/golden-fixtures/` on Documents (do not invent citations)

Golden fixtures (all SYNTH, not real authorities):

| File | Why it is in the corpus |
| --- | --- |
| `synth-master-lease-agreement.txt` | Base commercial lease |
| `synth-first-amendment.txt` | Version compare / contract delta |
| `synth-party-roster.txt` | People / entities |
| `synth-deposition-of-property-manager.txt` | Deposition / contradiction side A |
| `synth-email-from-property-manager.txt` | CAM date-conflict side |
| `synth-email-from-tenant-counsel.txt` | Contradiction / opposing communication |

### 1.3 Matter identity check (Case Home)

- [x] Matter name and number visible — heading `SYNTH-GOLDEN-LEASE-V1 — SYNTH Golden Lease (golden_synth_lease_v1)`
- [x] Client name visible — `SYNTH Golden Tenant Co`
- [x] Matter type / practice area, jurisdiction, court when set — type `commercial_lease`; jurisdiction `SYNTH / Demo`; court **Not recorded** (seed does not set court; honest empty, not a fabricated court)
- [x] Status and responsible lawyer / team (even if just the owner) — status `open`; responsible lawyer `Dev Owner`; team `Dev Owner (manage)`
- [x] SYNTH labeling is obvious — this must never be mistaken for a real file (number, title, client, jurisdiction, and all five document titles)

---

## 2. Primary Case tabs

Click every item in the **Case sections** nav. For each tab: load it, do the listed job, then mark the rubric verdict in §5.

Walked 2026-08-13 on `SYNTH-GOLDEN-LEASE-V1` (`3ad4246b-853d-4e18-97c0-f622781293ce`). In-page Case-section `<Link>` clicks often stay on the current tab; navigating the URL works. Rubric verdicts are in §5 (Home–Work only; §3–§4 not started).

### 2.1 Home — ` /app/cases/[matterId] `

Job: orient on the file in under a minute.

- [x] Key facts, open questions, people strip, documents peek, timeline peek, tasks, upcoming deadlines, AI insights, recent activity
- [x] Notes entry exists on Home (there is no separate Notes tab — copy should say so)
- [x] Proposed review counts do not look like verified facts
- [x] Deep links into Documents / Timeline / People / Work / Chats actually land on the right object
- [x] Create a short manual note from Home and confirm it reappears

Re-check after later tabs: people strip shows **SYNTH Jordan Hale** and **Tenant** as Verified; note **SYNTH dogfood note** still on Home; chat peek `When does the lease term commence? · grounded`. Intelligence strip is `4 Verified` vs `11 Suggestions to review` (not styled as facts). Copy: “There is no separate Notes tab yet.” Key facts / open questions / verified deadlines empty with honest next-action copy. Client-side deep-link clicks are flaky; direct URLs land correctly.

### 2.2 Chats — `/chats` and `/chats/[conversationId]`

Job: ask a Case-grounded question and inspect sources.

- [x] Start a new Case chat from the composer (not a generic global Ask)
- [x] Ask a question the lease actually answers (e.g. when the term commences)
- [x] Grounded badge / sources drawer when the answer is supported; insufficient / need-more-docs when it is not
- [x] Open a cited source; the quote is in the document, not paraphrased as a citation
- [x] Conversation remains listed on Chats and peekable from Home
- [x] Optional: start an agent run from chat only if the UI offers it — do not invent an agent the page does not expose

Composer is “Start a new Case chat…”. Thread `.../chats/3d247e88-7009-4685-a385-3b82d4494d0c`. Asked “When does the lease term commence?” → **GROUNDED IN CASE SOURCES**; term 1 Jan 2024 – 31 Dec 2026. Source 1 **SYNTH — Master Lease Agreement**, quote marked verbatim in cited chunk. Run Task exists; not started.

### 2.3 Documents — `/documents`

Job: get files into the Case and compare versions.

- [x] Upload at least two SYNTH fixtures if the seed did not already attach them
- [x] Processing reaches `ready` (or an honest error — never a silent empty list)
- [ ] Open / download a document; original is preserved — **no open/download control on document rows**
- [x] Compare versions (lease vs first amendment, or two versions of the same doc)
- [x] Diffs read as deterministic, not as AI “rewrite the contract”

Seed already attached five SYNTH docs, all `ready` / `development_unscanned`. Compared Master Lease vs First Amendment: **6 change(s)**, added/removed hunks, copy that the AI summary is a proposal.

### 2.4 Timeline — `/timeline`

Job: see chronology without invented dates.

- [x] Verified events vs proposed events are visually distinct
- [x] Missing dates use “date unknown” / “approximately” — never a fabricated ISO date
- [x] Link to Evidence conflicts / contradictions if any exist
- [ ] Propose or extract events if the page offers it; approve one; reject one with a reason — extract lives on **Review**, not Timeline; reject has **no reason field**

Manual event **SYNTH undated intake call** → **DATE UNKNOWN · UNKNOWN**, Verified (no fabricated ISO). Review `Run extraction` produced Lease Commencement / Lease Expiration suggestions. Verified Commencement; rejected Expiration without a reason prompt. Displayed dates **12/31/2023** / **12/30/2026** with precision `unknown` (UTC off-by-one vs Jan 1 2024 / Dec 31 2026).

### 2.5 Evidence — `/evidence`

Job: see both sides of a contradiction; never auto-merge.

- [x] Dual-sided contradiction cards (or an honest empty state explaining how to detect)
- [x] Run detect if offered; review / confirm / reject without collapsing both sides into one “truth”
- [ ] Related timeline IDs are read-only links, not an automatic merge — **N/A this pass** (no contradiction cards)
- [ ] Source documents are reachable from the card — **N/A this pass**; documents are listed on the tab separately

Honest empty: “No contradictions detected yet.” Detect finished with **no Side A/B cards** (CAM conflict in the SYNTH depo/email fixtures did not surface). Nothing auto-merged.

### 2.6 People — `/people`

Job: review who is in the Case without treating suggestions as parties of record.

- [x] List of people / orgs with Suggested vs Verified badges
- [x] Approve / reject / edit inline (not only via the Review work surface)
- [x] Create a person or org; set role / alias
- [x] Open source docs / Graph neighborhood from the entity
- [x] After approve, the person appears Verified on Case Home

Approved suggested org **Tenant** (disputing party) inline. Created **SYNTH Jordan Hale**, role property manager, alias J. Hale. Home re-check: both **Verified**. Inspect sources + View in Graph present. Memory deep-link `people?entityId=fa0623d7-...` landed on Tenant.

### 2.7 Graph — `/graph`

Job: inspect relationships with provenance.

- [x] Nodes / edges grouped clearly enough to scan (list / neighborhood is acceptable; a visual canvas is not required)
- [x] Proposed edges are Suggested, never Verified
- [ ] Review a proposed edge; neighborhood provenance is visible — **Propose AI returned no proposed edges**; clicking **Lease Commencement** showed **Invalid request** (neighborhood did not load)
- [x] Cross-link a node to People or Documents

9 nodes; 1 verified edge `Lease Commencement — supported_by → SYNTH — Master Lease Agreement` labeled **Verified** (not Suggested). List/scan is usable.

### 2.8 Memory — `/memory`

Job: correct Nyaya Memory; never auto-verify.

- [x] Entries grouped by type (facts, issues, questions, inferences, etc.)
- [x] Edit-and-approve / supersede / reject an AI-generated entry
- [x] Provenance / chunk cites visible before approve
- [x] Cross-link a memory item to People or Timeline
- [x] Proposed never styled as Verified

Propose with **no hint** returned an honest empty. Propose **with a hint** created one **Suggested by Nyaya** `verified_context` item (rationale: proposal payload could not be parsed; hint recorded as suggestion — mock/dev limitation). Source drawer: **SYNTH — Master Lease Agreement**. People link **Tenant** (no Timeline link on this item). Edit & approve → **1 active / 0 suggested**, title `SYNTH lease term is the operative date range`, **Verified**. Types here are Memory types (`verified_context`, …), not Review “facts.”

### 2.9 Work — `/work`

Job: attorney command hub for the file.

- [x] Open tasks with priority and status transitions (create one, move it in progress / complete)
- [x] Deadlines show timezone + source / `dateKind` honesty; none appear without that
- [x] Drafts needing review, analysis findings count, recent research memos — real lists, not link-only panels
- [x] Agent run cards (if any) open the specific run / approval on Nyaya, not a generic Ask page
- [x] First-class links to Draft / Research / Analysis / Review / Nyaya
- [x] Deep-link a task or deadline into its detail, not only a title list

Created task **SYNTH dogfood: calendar CAM invoice request** (`high`) on `/tasks`, moved **open → in_progress**. Work then listed it `in_progress · high` with `?taskId=1a17873e-...` (detail opens, not title-only). Deadlines: **Request for supporting invoices** `explicit · timezone unknown · Suggested`; **Termination Notice Deadline** `Date unknown · inferred · timezone unknown · Suggested`. Deadline detail: 1 source (SYNTH email from Tenant counsel quote). Empty drafts / memos / findings / runs are honest lists. Destination buttons: Nyaya / Draft / Research / Analysis / Review. Run cards N/A (none present; empty copy points at Nyaya after a run).

---

## 3. Work-surface subnav

These four sit under Case chrome, not as primary object tabs. Click each.

Walked 2026-08-13 on the same SYNTH-GOLDEN-LEASE-V1 matter. Rubric in §5.

### 3.1 Draft — `/draft`

Job: generate a draft that stays a draft.

- [x] Pick matter documents / context; generate
- [x] `sourceAssertions`, assumptions, and unresolved placeholders are visible beside the editor — or the page says sources are insufficient
- [x] `aiGenerated` banner; status remains draft until explicit approve
- [x] No send / file / sign control
- [x] Save a version; version history matches an append-only ledger (restore does not silently overwrite)

Generated **SYNTH dogfood: client update on lease term** (`correspondence`) from Master Lease + First Amendment. Banner: **Attorney review required** / “NyayaGrid does not send or file this document.” Status stayed `draft · AI`. Source assertion: term 1 Jan 2024 – 31 Dec 2026, `FACT_SOURCE`. Assumptions / placeholders panels present (empty, honest). Saved v2 (`ai_edited`); restored v1 as **v3** “Restored from version 1” — v1 and v2 remain in the ledger.

### 3.2 Research — `/research`

Job: ask a research question inside the Case, with corpus honesty.

- [x] Run a query scoped to this matter
- [ ] Primary vs secondary (or equivalent labels) and jurisdiction / court when the corpus has them — **N/A: zero authority hits**
- [x] Every proposition links to a retrieved source — no citation from model memory
- [x] Local SYNTH / fixture corpus is **not** presented as real law; coverage / synthetic warnings are visible
- [ ] Save or pin an authority to the matter — **no hits to pin**
- [x] a research note can be added

Query: notice / CAM authority. Result refused to assert law: “No proposition survived citation validation.” Coverage warnings include non-comprehensive corpus, no retrieved passages, treatment unverified, no jurisdiction filter, no contrary-authority search. Banner: matter facts are not a source of law. Added attorney note: do not treat empty corpus as a rule of law.

### 3.3 Analysis — `/analysis`

Job: run contract / comparison / deposition / evidence / discovery analysis without treating output as filed work.

- [x] Subtabs load: contracts, comparisons, depositions, evidence, discovery
- [x] Run one analysis against SYNTH docs (lease vs amendment, or CAM date conflict)
- [x] Findings are reviewable, sourced, and do not auto-verify Memory / Graph
- [x] Empty / error states if a subtab has nothing to analyze

Opened all five subtabs. Re-opened lease vs amendment comparison (6 deterministic changes; AI summary labeled proposal). Ran **Analyze contract** on Master Lease: items `PROPOSED` with original text + Mark reviewed / Dismiss; marked one reviewed. Depositions: honest “No findings yet.” Discovery: “No documents in the discovery queue.” Evidence matrix listed Lease Commencement supporting count — not a CAM dual-sided card.

### 3.4 Review — `/review`

Job: clear the intelligence queue.

- [x] Extract (if offered) then see proposed events, facts, entities, deadlines
- [x] Approve one, edit-and-approve one, reject one with a reason
- [x] Queue counts on Home / Work decrease after review
- [x] Approved items show up in the owning tab (Timeline / Memory / People) as Verified

Queue after §2 extract: 0 events, 9 facts, 0 entities, 2 deadlines. Approved **Lease Start Date**; edit-and-approved **Base Rent** → `Base Rent (SYNTH Master Lease §4.1)`; rejected **Monthly Installment** with reason “duplicate of Base Rent.” Facts 9 → 6. Home `4 Verified / 11 Suggestions` → **`6 Verified / 8 Suggestions`**. Key facts show both approved facts **VERIFIED**. Timeline Commencement still Verified (Suggestions 0). People already Verified from §2. Review facts land on Home key facts, not the Memory tab (Memory is a different object).

### 3.5 Nyaya (agent / ask) — `/nyaya`

Not in the primary tab list; reachable from Work. Still click it.

- [x] Active Case context is visible — Nyaya is not silently mixing another matter
- [x] Ask or open an existing agent run
- [x] Approvals cannot bind the user (no send / file / settle) without explicit review
- [x] Run status, steps, and provenance are inspectable

Heading stayed **SYNTH-GOLDEN-LEASE-V1**. Ask: grounded 1 Jan 2024 with lease citation; copy that legal-authority research was not performed. No Send / File / Settle / Sign. Simple “Plan & Run” was answered directly instead of starting a run (honest). Multi-step CAM/memo goal created run `0143cc6b-…` **awaiting_approval**: steps, plan, limitations, 0 authority hits + coverage warnings, draft as proposal, `proposeMemory` **pending review** (no task created). Work hub deep-links `nyaya?runId=`.

---

## 4. Cross-tab loops (the actual attorney day)

Do these as sequences, not isolated clicks. This is the vertical slice the build guide asked for.

### 4.1 Intake → question → source

- [x] Document on file → Chats question the document answers → grounded sources → open the quote in the doc

Master Lease on file → Chats “When does the lease term commence?” → grounded verbatim quote. Opening the original file from Documents still has **no open/download** (source drawer quote is visible). Nyaya Ask repeated the same grounded citation.

### 4.2 Intelligence → human review → Case objects

- [x] Review extract (or People propose) → approve a person → Verified on Home and People
- [x] Approve a timeline event → it is not still styled Suggested on Timeline
- [x] Memory inference stays Suggested until you approve it

Tenant + SYNTH Jordan Hale Verified on People and Home. Lease Commencement **VERIFIED**, Suggestions (0). Memory: prior item Verified; agent-run proposal **Propose follow-up work…** remains **Suggested by Nyaya** (1 suggested / 1 active) — not auto-verified.

### 4.3 Conflict → both sides preserved

- [ ] Evidence contradiction (depo vs email CAM dates, if those fixtures are on the matter) → both sides visible → Timeline related IDs do not merge the dates — **detect still empty after re-check; no Side A/B cards, so merge could not be tested. Copy on Timeline/Evidence says Nyaya does not collapse conflicts into one truth.**

### 4.4 Work product stays a draft

- [x] Draft generate → sources or insufficient → save version → Work hub lists the draft as needing review / still draft

Generate → FACT_SOURCE assertion → v2 save / v3 restore. Work: **Drafts to review 2**, both `draft · AI` (client update + agent-created draft). Status never left draft.

### 4.5 Command hub reflects the file

- [x] After the loops above, Work and Home show the new task, person, draft, and chat without a refresh hunt (a single reload is acceptable; losing the objects is not)

Home (reload): task, Tenant + Jordan Hale, draft title, grounded chat peek, key facts, 6 Verified / 8 Suggestions. Work: task `in_progress · high`, two drafts, approval run card → `nyaya?runId=`.

---

## 5. Findings log

Fill this during the pass. Do not leave it blank and “remember later.”

| Surface | Rubric (pass / usable-but-rough / unusable) | What you actually did | Notes |
| --- | --- | --- | --- |
| Home | usable-but-rough | Oriented on SYNTH-GOLDEN-LEASE-V1; saved **SYNTH dogfood note**; re-checked after Review/Draft/Nyaya. | After Review: **6 Verified / 8 Suggestions**; key facts show edited Base Rent + Lease Start Date as Verified. Chat peek, people, task, draft present. In-page section `<Link>` clicks often do not navigate; URL does. |
| Chats | pass | New Case chat; asked when the lease term commences; opened source 1. | Grounded badge; verbatim Master Lease quote. Thread `3d247e88-7009-4685-a385-3b82d4494d0c`. Still listed after later Nyaya asks. |
| Documents | usable-but-rough | Confirmed five seed docs `ready`; compared Master Lease vs First Amendment. | Compare: 6 deterministic hunks, AI summary labeled proposal. **No open/download** on rows — 4.1 cannot open the original file from Documents. |
| Timeline | usable-but-rough | Manual undated event; Review extract; verify Commencement; reject Expiration; re-check after Review. | DATE UNKNOWN used. Commencement stays **Verified**, Suggestions (0). Extract is on Review. Reject has no reason field. UTC off-by-one (`12/31/2023` vs Jan 1 2024). |
| Evidence | usable-but-rough | Ran detect in §2; re-checked in §4.3. | Honest empty: “No contradictions detected yet.” SYNTH depo vs PM email CAM conflict never produced Side A/B cards. Copy forbids collapsing to one truth; the dual-sided job itself was not doable this pass. |
| People | pass | Approved suggested **Tenant**; created **SYNTH Jordan Hale**; re-checked Home. | Both Verified on Home after later loops. |
| Graph | usable-but-rough | Scanned 9 nodes / 1 verified `supported_by` edge; ran Propose AI; clicked Lease Commencement. | Propose AI: no proposed edges. Neighborhood: **Invalid request**. |
| Memory | usable-but-rough | Edit-and-approve in §2; re-checked after Nyaya run. | 1 active Verified; agent proposal stays **Suggested by Nyaya** until approve. Not auto-verified. |
| Work | pass | Task + deadlines in §2; re-checked after Draft/Nyaya. | Shows task, 2 draft·AI items, 1 run awaiting approval with `nyaya?runId=` (not a generic Ask page). Deadline timezone/`dateKind` honesty unchanged. |
| Draft | pass | Generated correspondence from lease docs; saved v2; restored v1 as v3. | Attorney-review banner; stays draft; source assertion present; no send/file/sign; restore appends. |
| Research | usable-but-rough | Matter-scoped query; coverage warnings; attorney note. | Honest refusal to assert law (0 hits). Cannot pin an authority or show primary/secondary labels when the corpus is empty — that is correct, but the research job is thin on this SYNTH file. |
| Analysis | pass | All subtabs; contract analysis on Master Lease; opened lease vs amendment comparison. | Findings `PROPOSED` with original text and human review. Empty states honest. Did not auto-verify Memory/Graph. |
| Review | pass | Approve / edit-and-approve / reject-with-reason on facts; Home counts dropped. | No Approve All. Approved facts appear as Verified key facts on Home. Queue 9→6 facts. |
| Nyaya | pass | Ask (grounded + citation); multi-step run `0143cc6b-…` awaiting memory/task approval. | Case heading correct. No send/file/settle. Steps, plan, limitations, provenance inspectable. Simple goals may answer directly instead of starting a run. |
| Cross-tab loops | usable-but-rough | Walked 4.1–4.5 on this file. | 4.1–4.2 / 4.4–4.5 work. **4.3 fails to surface the CAM conflict** despite fixtures; nothing merged, but both sides are not on an Evidence card. Documents still cannot open the cited original. |

**Unusable surfaces (only these may justify a new tracker):**

- _none_ — Evidence contradiction detect missed the SYNTH CAM conflict, but the tab is honest and does not auto-merge. That is a capability gap, not a reason to reopen Case Experience. Log it here; do not invent §7.

**Decision (check exactly one when the pass is finished):**

- [x] **Close this track.** The professional Case loop is usable for attorney work on a SYNTH file. Remaining nits stay in this log; no new Case tracker.
- [ ] **Open a new tracker** named for a specific unusable problem (not “Case Experience §7”). Link it here: _TBD_

If you open a new tracker, its goal must name the unusable job (e.g. “attorney cannot trust contradiction review”) and must not reopen finished Case Experience sections as a punch list.

---

## 6. Guardrails while dogfooding

- [x] Never present mock / SYNTH output as real legal advice or real authority
- [x] Never fabricate a citation, docket, judge, or deadline when a source is missing — log the gap
- [x] Do not “fix” polish mid-pass unless it blocks the walkthrough; this track is evidence-gathering
- [x] Do not start Production Readiness or Nyaya Professor work in the same session as this pass
- [x] Do not commit secrets, `.env`, or real client documents if you stray off SYNTH

Research and Nyaya both refused to invent legal authority when the corpus returned 0 hits. Dates that were missing stayed “date unknown.” No Case chrome rebuild. Hydration overlay on `LoadingState` was a separate Cursor-browser attribute issue handled outside this dogfood pass; no Case IA change. SYNTH fixtures only.

---

## How to use

1. Do §1, then walk §2–§4 in order, filling §5 as you go.
2. Check boxes in **this file** in the same session.
3. Stop when §5 has a decision. Do not start the other two tracks in parallel.
4. If the decision is a new tracker, write that file next — still do not edit Case Experience as if it were unfinished.
