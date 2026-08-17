# NyayaGrid → Harvey-level — Roadmap from here

**Status:** North-star plan (2026-08-13). Not a go-live sign-off.  
**Audience:** Product, engineering, legal.  
**How to use:** Execute through named trackers. Do **not** reopen finished Case Experience or Nyaya Professor as a punch list. When a phase starts, either use the existing tracker or create one named for that job.

**P1–P7 close-out (required):** after the phase’s code lands, run `npm run seed:golden-matter`, confirm depo + PM email are `ready`, then Detect contradictions on Evidence for `SYNTH-GOLDEN-LEASE-V1`. If anything errors or behaves unexpectedly, fix it and re-run before calling the phase done.

Related (do not duplicate as competing sources of truth):

| Track | File | State today |
| --- | --- | --- |
| Agent quality | [`AGENT_QUALITY_TRACKER.md`](./AGENT_QUALITY_TRACKER.md) · [`AGENT_QUALITY.md`](./AGENT_QUALITY.md) | Hardening done; three live `gpt-4o-mini` runs recorded (live 3 with repeats); Case Q&A and live contract-compare **miss the bar**; contradiction meets the numeric bar on live 3 only; **Section B attorney review still open** |
| Case product | [`CASE_EXPERIENCE_TRACKER.md`](./CASE_EXPERIENCE_TRACKER.md) · [`CASE_DOGFOOD_TRACKER.md`](./CASE_DOGFOOD_TRACKER.md) | Experience + dogfood **closed**; remaining nits logged, not unusable |
| Student | [`NYAYA_PROFESSOR_TRACKER.md`](./NYAYA_PROFESSOR_TRACKER.md) | **Complete** as a product slice; live-model quality still thin |
| Production | [`PRODUCTION_READINESS_TRACKER.md`](./PRODUCTION_READINESS_TRACKER.md) | **Code + local staging-shaped track complete** (2026-08-17). Live Clerk/S3/PITR/monitoring/counsel still **BLOCKER**. NyayaGrid is not go-live |
| Public | [`NYAYA_GUIDE.md`](./NYAYA_GUIDE.md) · [`NYAYA_GUIDE_TRACKER.md`](./NYAYA_GUIDE_TRACKER.md) | **SYNTH/dev Guide complete** (2026-08-17). `FEATURE_GUIDE` stays **off** in staging/production |
| Firm ops (P6) | [`FIRM_OPS_TRACKER.md`](./FIRM_OPS_TRACKER.md) | **SYNTH/dev screens complete** (2026-08-17). Graph/SMTP/Stripe remain ops-only |
| Enterprise trust (P7) | [`ENTERPRISE_TRUST_TRACKER.md`](./ENTERPRISE_TRUST_TRACKER.md) | **In-repo evidence complete** (2026-08-17). Live Clerk SSO, signed DPA, pen test, SOC 2, insurance remain **open** |
| Case polish (P1) | [`CASE_POLISH_TRACKER.md`](./CASE_POLISH_TRACKER.md) | **Complete** (2026-08-17) — originals, CAM dual-sided detect, Graph neighborhood, Case tab navigation |

---

## 0. What “Harvey-level” means here

Harvey is a **production legal-AI product for law firms**: licensed content, polished assistant UX (including Word/Outlook), enterprise trust, and years of attorney QA. It is not a full practice-management OS.

NyayaGrid’s bet is different and must stay different (product spec §1): **legal intelligence plus end-to-end matter work**. Matching Harvey does **not** mean becoming a chatbot with a file button. It means:

1. **Insight quality** — Case Q&A, contract compare, and contradiction/timeline meet [`AGENT_QUALITY.md`](./AGENT_QUALITY.md) on a **live** model, with a lawyer who did not write the code scoring the outputs. Mock 100% scores do not count.
2. **Research honesty with real law** — Nyaya Research cites licensed primary authority the way Harvey cites a reporter: quote-validated, jurisdiction-aware, never invented. Until a license exists, Research must keep the synthetic-corpus warning.
3. **Production trust** — real identity (Clerk + MFA), malware scan, encrypted durable storage, rehearsed backup/restore, monitoring, attorney-reviewed Terms/Privacy. A firm will not put client files in `AUTH_PROVIDER=dev` + MinIO.
4. **Attorney day that does not bounce** — open the original document, see both sides of a conflict, navigate Case tabs, download a draft. Dogfood already proved the loop is *usable*; Harvey-level means the rough edges are gone.
5. **In the flow of work** — Word/Outlook (or equivalent) so drafting and mail are not “go to the web app.” Harvey’s distribution advantage is here.
6. **Firm knowledge, isolated** — retrieve prior work product and playbooks **inside the tenant**, never across tenants, never as invented law.
7. **Enterprise sales bar** — SSO, audit export, retention/legal hold *design*, SOC 2 Type I then Type II, DPA, no-training-without-consent already in the spec.

NyayaGrid can be **better than Harvey as an OS** (Matter, Memory, Graph, Timeline, Professor, Guide) while still being **behind Harvey as a research assistant** until licensed data and live attorney QA exist. Those are different axes. This roadmap covers both.

### What we will not copy (spec §16)

Do not put these on the Harvey-parity punch list:

- Proprietary foundation model
- Autonomous filing, send, sign, settle, or legal representation
- Westlaw/Lexis *replacement* without a license
- Jury/judge/settlement probabilities as fact
- Government or corporate-legal workspaces
- Full e-discovery production platform in v1
- Native mobile before the web app is stable

### Honest baseline (2026-08-13)

| Axis | Today | Harvey |
| --- | --- | --- |
| Matter OS (docs, memory, graph, draft, review) | Built; dogfood **usable-but-rough** | Thin / not the product |
| Citation validation / refuse-to-invent | Strong in code | Strong in product |
| Licensed reporters | **None** (SYNTH fixtures) | Licensed / partnered content |
| Live attorney-scored quality | **Not done** | Continuous |
| Production auth / scan / backup / monitoring | **Not done** | Done |
| Word / Outlook | **None** | Core distribution |
| Student + public workspaces | Professor hardened; Guide not dogfooded | Not Harvey’s product |
| Sellable to an AmLaw firm this quarter | **No** | Yes |

**Verdict:** not even close on performance or trust. Architecture and safety rails are the advantage to keep.

---

## 1. Time — calendar, not wishful coding

Assumptions (change the dates if the team changes):

| Capacity | Meaning |
| --- | --- |
| **A — Solo founder + Cursor** | One builder most days; attorney reviewer part-time; vendors/legal on their clocks |
| **B — Small team** | 2 engineers + 1 practicing lawyer (review, not coding) + 1 ops/security part-time |

Licenses, SOC 2, Clerk production, and restore rehearsals **do not shrink** if you type faster.

| Phase | What “done” means | Solo (A) | Small team (B) | Can parallelize? |
| --- | --- | --- | --- | --- |
| **P0** Quality truth | Live eval rates + attorney scores recorded | 3–5 weeks | 2–3 weeks | Starts immediately |
| **P1** Case polish | Dogfood nits that block Harvey-like daily use | 4–6 weeks | 2–4 weeks | After or overlapping P0 |
| **P2** Production trust | Tracker 1–11 verified on staging | 10–16 weeks | 8–12 weeks | Parallel with P0/P1 once cloud is chosen |
| **P3** Licensed research | Contract signed + Nyaya Research on real primary law | **4–9 months calendar** (legal/commercial dominates) | Same calendar | Start vendor talks in week 1 |
| **P4** Assistant UX | Word add-in, knowledge vault, retrieval quality | 12–18 weeks | 8–12 weeks | After P0; Word after P2 auth |
| **P5** Guide industrial | Phase 7 public workspace dogfood-complete | 6–8 weeks | 4–6 weeks | After Professor; not on the Harvey critical path |
| **P6** Firm ops | Phase 8: email/calendar, time, billing, portal, notifications | 12–16 weeks | 8–12 weeks | After P2 |
| **P7** Enterprise trust | SSO, SOC 2 Type I, DPA, retention/hold | **6–12 months** overlapping P2–P6 | Same | In-repo evidence complete 2026-08-17; live SSO/DPA/pen/SOC2/insurance still open |

**Earliest “Harvey-level on the three money workflows, in production, for a small firm, with licensed research”:**

- Small team: **~12–18 months** if the research license is signed in the first quarter.
- Solo: **~18–30 months**.

**Earliest “safe staging dogfood for SYNTH-only professional users” (no licensed law, no Harvey research parity):** P0 + P1 + P2 ≈ **4–6 months** solo / **3–4 months** small team.

If the research license slips, you can still be a **Harvey-class matter OS on the client’s own documents**. You cannot honestly be a Harvey-class *research* product.

---

## P0 — Quality truth (do this first)

**Tracker:** keep [`AGENT_QUALITY_TRACKER.md`](./AGENT_QUALITY_TRACKER.md) open until Section B is scored.  
**Why first:** without live numbers you will “improve AI” blindly. Harvey’s bar is attorney-judged usefulness, not mock evals.

Written numeric bars ([`AGENT_QUALITY.md`](./AGENT_QUALITY.md)): 0% false-confidence, &lt;5% hallucination, ≥90% citation accuracy, &lt;10% false-insufficient — on a **live** provider, then confirmed by a human lawyer.

### To-do

- [x] Run `EVAL_EXPORT_REVIEW=1 npm run eval:ai:live` against `OpenAIProvider` (pinned model, budget cap). Packets: `docs/agent-quality-review/exports-live/` (live 1), remasure rates in the tracker (live 2 files were later mock-clobbered), `docs/agent-quality-review/exports-live-3/` (live 3, including contract-compare summaries under `contract-compare/`).
- [x] Record live rates in the Section A table (three `gpt-4o-mini` runs, 2026-08-14; live 3 is the first with min/mean/max. Case Q&A still misses. Live 2 prompt/snapshot **unknown** — not a config baseline. Live 5 contract-compare n=16×3 is the first workflow-level live compare number).
- [ ] Blind review by someone with legal judgment who **did not write the code**. Score each: pass / needs-work / fail on (1) would I have caught this, (2) wrong or missing, (3) send to client with light edit vs rewrite.
- [ ] Fill [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](./AGENT_QUALITY_ATTORNEY_REVIEW.md): reviewer, date, per-item scores.
- [ ] File systematic gaps as **named fixes** (not “make the model smarter”). Likely from current dogfood + live Professor:
  - Evidence detect missing dual-sided CAM conflict on golden fixtures
  - Live case-brief JSON failing schema → discarded brief
  - Case-room / Ask retrieval returning `NO_STUDENT_SOURCES_ANSWER` / 0 research hits
  - Graph neighborhood `Invalid request`
- [x] Re-run live eval after each systematic fix; do not close P0 on a single lucky run. Live 4 Case Q&A still misses. Contradiction meeting the numeric bar once does not close P0. Live 5 SYNTH compare 100% does not close P0.
- [ ] Decision rule: if attorney “fail” rate on send-to-client is high, **stop feature work** on new surfaces until the three workflows recover.

**Time:** 3–5 weeks solo (calendar blocked on the reviewer); 2–3 weeks small team.  
**Money:** OpenAI live eval budget (cap it); reviewer time.

### If you do not have a practicing attorney

Do **not** skip P0. Do **not** mark Section B complete, and do **not** say the product is Harvey-level. You can still run a useful quality loop.

**Split P0 into two layers.** Layer 1 is engineering and is not blocked on a lawyer. Layer 2 is legal judgment and stays open until a human with legal training scores outputs.

#### Layer 1 — do this now (no attorney required)

You already know the SYNTH golden file. Grading *faithfulness to that file* is a reading test, not a bar-admission test.

- [x] Run live eval + export (same commands as above). Record live rates even if they look bad.
- [x] **Operator review** of every exported item against the SYNTH source, scored in [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](./AGENT_QUALITY_ATTORNEY_REVIEW.md) with reviewer role **`operator`** (not `attorney`):
  1. Does every retained quote appear in the cited passage? (Code should already enforce this; confirm the live path did.)
  2. Did the answer invent a case, statute, date, or dollar figure that is not in the SYNTH text?
  3. For contract compare: did it catch the planted material changes and ignore decoys?
  4. For contradiction: did it keep both CAM dates, or collapse them?
  5. Would a careful reader of *only* the SYNTH documents call this grounded, partial, or insufficient — and did the product label it that way?
- [x] File systematic misses as named code fixes (detect, schema, retrieval). Re-run live eval. Live 3 (2026-08-14 night, repeats=3) still misses Case Q&A and live contract-compare; contradiction meets the numeric bar after the imprecise-date filter. Remaining gaps logged in the attorney-review file (operator live 3). **Section B stays open.**
- [x] Continue P1 (Case polish) and P2 (production) on SYNTH data. Those tracks do not need a lawyer to start. **P1 complete 2026-08-17** ([`CASE_POLISH_TRACKER.md`](./CASE_POLISH_TRACKER.md)). P2 still not started.

Label the pass: `operator review of SYNTH fixtures — not attorney review, not a Harvey-quality close-out.`

#### Layer 2 — legal judgment (blocked, but you can unblock cheaply)

The question you cannot answer as the person who wrote the product: **“Would I send this to a client with light editing?”** That is Section B. Options, cheapest first:

| Option | What it is | What you may claim | Typical cost / time |
| --- | --- | --- | --- |
| **A. Paid 5–10 hour review** | Junior associate, solo, or contract lawyer. Give them the export folder + SYNTH PDFs only (not the code). | Real Section B if they are admitted and did not write the agents | Often a few hundred dollars; 1–2 weeks calendar |
| **B. Law student / recent grad** | 2L/3L or new graduate, same blind packet | Record as **`student reviewer`**. Useful. **Not** attorney review | Free / modest stipend |
| **C. Paralegal** | Same packet | Record as **`paralegal`**. Good on procedure and quotes; weak on “send to client” | Modest |
| **D. Wait** | Keep Layer 1 only until you can pay for A | Honest. Product stays “not Harvey-level on quality” | $0 |

How to find A/B without a firm: law-school career office, alumni Slack, “legal tech” Discord, a single Upwork/contra post titled “5–10 hours scoring AI outputs on a synthetic lease — not legal advice, NDA, SYNTH data only.” Send SYNTH files only. Never send real client matter.

**You (the builder) scoring your own live outputs is allowed as Layer 1 only.** It is not blind. You wrote the fixtures. Do not put your name in the attorney-reviewer field.

#### What still needs a lawyer later even if you skip Section B for now

- **P2.8 Terms / Privacy** — counsel sign-off before real users. That is a startup/privacy lawyer, not a quality reviewer. Budget it as a separate, smaller engagement when staging exists.
- **P3 license** — commercial counsel.
- **P7 DPA / SOC 2** — counsel + auditor.

None of those should delay Layer 1 or P1.

#### Decision rule without an attorney

- If Layer 1 fail rate on “invented fact / missed planted change / collapsed conflict” is high → **stop new surfaces**; fix those workflows.
- If Layer 1 is clean on SYNTH and you still have no reviewer → **proceed to P1/P2**, keep Section B and Harvey-quality claims **open**.
- Close Section B only when a Layer 2 reviewer who did not write the code has scored a live export.

---

## P1 — Case polish (Harvey-like daily use on *this* matter)

**Do not** open Case Experience §7. Log work here or in a new tracker named for the job (e.g. “attorney cannot open the cited original”).

Dogfood (`SYNTH-GOLDEN-LEASE-V1`) already decided the loop is usable. These are the remaining attorney-facing gaps.

### Major (blocks “I would use this instead of bouncing”)

- [x] **Documents open/download** — original file from the Documents row and from a citation chip (preserve original; audit access).
- [x] **Evidence contradiction detect** — golden CAM conflict (depo vs PM email) must produce dual-sided cards; Timeline related IDs must not merge dates.
- [x] **Graph neighborhood** — fix `Invalid request`; proposed edges remain Suggested until approved.
- [x] **In-page Case navigation** — section `<Link>` must change the route (URL bar already works; attorneys click the nav).

### Medium

- [x] Timeline: timezone + source already required; fix UTC off-by-one; reject-with-reason like Review facts.
- [x] Research: keep corpus honesty; when 0 hits, pin/note still work (note already does); do not fake primary/secondary labels.
- [x] Include `synth-party-roster.txt` in `buildGoldenFixtureDocuments()` / seed if People onboarding should have it.
- [x] Home: in-page nav + slightly clearer next action (do not redesign IA).

### Minor

- [x] Timeline extract discoverability (today it lives on Review — copy on Timeline is enough if Review is one click).
- [x] Graph “Propose AI” empty-state copy when no edges are proposed.
- [x] LoadingState hydration warning already patched; keep `suppressHydrationWarning` if the overlay returns.

**Status (2026-08-17):** P1 executed on [`CASE_POLISH_TRACKER.md`](./CASE_POLISH_TRACKER.md). Not a Harvey-quality close-out; Agent Quality Section B stays open.

**Time:** 4–6 weeks solo / 2–4 weeks small team.  
**Depends on:** P0 findings may reorder this list.

---

## P2 — Production trust (cannot sell to a firm without this)

**Tracker:** [`PRODUCTION_READINESS_TRACKER.md`](./PRODUCTION_READINESS_TRACKER.md) — execute it; update [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) when a row actually flips to READY.

NyayaGrid **refuses to boot** `APP_ENV=production` with unsafe defaults. That is good. It is not the same as having provisioned Clerk/S3/ClamAV.

### P2.1 Staging first (week 1–2 of this phase)

- [x] Choose cloud (compute, secrets, logs). Write the choice on the tracker. Local Docker Compose until a paid cloud is selected. Suggested paid: one region, managed Postgres with `pgvector` + `pgcrypto`, S3, Clerk, Inngest Cloud.
- [x] Staging-shaped env: `APP_ENV=staging` (`.env.staging.example`), `FEATURE_*` off until you enable a workspace. Cloud staging deploy is still operator work.
- [x] `GET /api/health/live` → 200; `GET /api/health/ready` names/booleans only.
- [x] Prove `NODE_ENV=production` alone is not a safe intent declaration.
- [x] `AUTH_PROVIDER=dev` impossible on staging/production (no identity; production boot refuses it).

### P2.2 Clerk (BLOCKER)

- [ ] Separate Clerk **staging** and **production** apps; never reuse dev keys.
- [x] Wire session resolution in `apps/web` so `ClerkAuthProvider.getIdentity` gets a real `userId`.
- [ ] Sign-in / sign-up / cookie domain / CORS on the real origin.
- [x] Webhooks: user/org lifecycle; **authorization stays in `@nyayagrid/permissions`**.
- [x] Real email on the identity, not `${userId}@clerk.local`.
- [ ] MFA on production Clerk.
- [ ] E2E: new user → `ensureUserFromIdentity` → onboarding; forged session → 401 on matter APIs.

### P2.3 ClamAV (BLOCKER — no client uploads until live)

- [x] Provision `clamd` in docker-compose (production host still operator work).
- [x] `MALWARE_SCANNER=clamav`; fixture mode off / forbidden in staging/production.
- [x] Live EICAR blocked on local docker clamd (`npm run ops:verify-clamav`); clean SYNTH payload accepted. Production scanner + Case upload still operator work.
- [x] Scanner-down fails closed ([`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md)).
- [ ] Concurrent-upload load test vs 30s timeout; document back-pressure.

### P2.4 S3 (BLOCKER until provisioned)

- [ ] Staging + production buckets; `STORAGE_PROVIDER=s3`; IAM role preferred.
- [ ] SSE-S3 or SSE-KMS; versioning; public access blocked; tenant-scoped keys only.
- [ ] End-to-end SYNTH upload on staging.
- [x] MinIO in production only with `ALLOW_MINIO_IN_PRODUCTION=1` and owned volume backup — still a durability exception.

### P2.5 Managed Postgres + pgvector

- [ ] Provider that allow-lists `pgvector` and `pgcrypto`.
- [x] Migrations as an **explicit** release step (never on container start).
- [x] Pooling plan before a second web replica (documented).
- [x] Ready probe 503 when DB is down.
- [x] RLS remains OPTIONAL; app-layer `organizationId`/`matterId` stays load-bearing.

### P2.6 Backup + restore (BLOCKER until rehearsed on the managed provider)

- [x] Write RPO/RTO into [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md).
- [ ] PITR on Postgres; S3 versioning covering the same window.
- [x] Local restore Postgres to a **new** database (`npm run ops:backup-rehearse`); MinIO volume archived to the same directory.
- [ ] Managed restore + staging app pointed at restored DB + bucket; verify ready / SYNTH matter / `pgvector`.
- [x] Quarterly rehearsal until automated (cadence in Operations).

### P2.7 Monitoring / on-call (BLOCKER)

- [ ] Log aggregator; confirm **no** document text, prompts, tokens, or PII in logs.
- [ ] Uptime on live + ready; alerts: 5xx, scanner down, AI error rate, connection saturation.
- [ ] Paging destination in [`OPERATIONS.md`](./OPERATIONS.md).
- [ ] Flip READY only when a staged failure actually pages.

### P2.8 Terms / Privacy (BLOCKER)

Counsel must sign off; draft badge comes off only then. Already outlined on the tracker: no A-C relationship from using Nyaya/Professor/Guide; AI is draft work product; no training without separate consent; Guide has no privilege; Professor is not a course substitute.

### P2.9 Other gates

- [ ] OpenAI pinned models; outage communication; **never** silent mock fallback.
- [ ] SMTP for invites; `ConsoleEmailProvider` forbidden in production.
- [ ] Inngest Cloud → `/api/inngest`; unsigned deliveries rejected.
- [ ] `BILLING_PROVIDER` not `DevelopmentBillingProvider` for paying customers (full billing product is P6).
- [x] Redis `RateLimitProvider` before two web instances (code; live Redis still CONFIG REQUIRED).
- [ ] `npm audit`; drizzle-orm identifier issue; Next major only with a regression pass.
- [ ] Staging image from `Dockerfile` (non-root, no secrets in image).
- [ ] Tabletops: cross-tenant scare, DB 503, OpenAI outage, ClamAV down.

### P2.10 Go-live gate (do not check early)

- [ ] Every CONFIG REQUIRED / BLOCKER row READY or a written exception with owner and expiry.
- [ ] Staging dogfood: sign-in, upload, ask, invite — SYNTH only.
- [ ] Engineering sign-off (name, date) + legal sign-off (name, date).

**Time:** 10–16 weeks solo / 8–12 weeks small team **after** cloud accounts exist. Vendor lag (Clerk, AWS, Postgres) is often 1–3 extra weeks.  
**Money:** cloud + Clerk + ClamAV/SaaS scan + log vendor. Modest vs a research license.

**Code track (2026-08-17):** Redis limiter, Clerk session/webhook wiring, docker-compose ClamAV + Redis, local backup rehearsal, health probe hardening. Live Clerk/S3/PITR/monitoring/counsel still open. Not go-live.

---

## P3 — Licensed research (the actual Harvey research gap)

This is a **legal/commercial** project with an engineering tail. Coding a better retriever on SYNTH fixtures will not close it.

### Commercial / legal

- [ ] Decide coverage: US federal + 1–2 launch jurisdictions vs “everything.” Narrower is faster and more honest.
- [ ] Shortlist licensed sources (primary statutes/cases; treatment/citator if affordable). Do not scrape reporters.
- [ ] Negotiate: redistribution into NyayaGrid, embedding/storage, tenant isolation, training prohibition, audit rights.
- [ ] Product copy: never “replaces Westlaw/Lexis” unless the contract and coverage actually support that sentence.

### Engineering (after contract)

- [ ] Provider adapter behind the existing research interface (`@nyayagrid/research`) — same citation validator, same coverage warnings when a query is out of corpus.
- [ ] Ingest pipeline: versions, jurisdiction, court level, publication/treatment when the license provides it.
- [ ] Quote-only-from-retrieved-text remains non-negotiable.
- [ ] Matter-scoped research still cannot leak tenant documents into the shared corpus.
- [ ] Professor may read the **same** licensed corpus with student isolation unchanged (`userId` only on `student_*`).
- [ ] Eval: research graded cases against **licensed** fixtures, not only SYNTH statutes.
- [ ] Feature flag: Research stays warned/off in production until this lands.

**Time:** 4–9 months calendar (2–6 months contracting is typical; 6–10 weeks engineering after data flows).  
**Money:** this is the expensive line item. Budget it as a product decision, not a sprint.

**Fallback if license slips:** ship P0–P2 as “Harvey-class on *your documents and your matter*, not on the law of the jurisdiction.” That is still a real product. It is not Harvey Research.

---

## P4 — Assistant UX and knowledge (how Harvey is *used*)

Quality (P0) + trust (P2) without distribution still loses to Harvey in the lawyer’s Word window.

### P4.1 Retrieval and answer quality (in-app)

- [ ] Multi-document Q&A that names *which* file a proposition came from (already partly true; make it default in the UI).
- [ ] Playbook / prior-work retrieval: tenant-scoped “knowledge” store (prior memos, forms) with the same quote validator. **Never** train foundation models on customer data without the spec’s separate consent.
- [ ] Query routing: matter fact vs legal research vs draft — do not silently mix (Nyaya modes already required in `.cursorrules` §6.2).
- [ ] Structured outputs already exist; tighten live-model JSON (Professor brief schema failures are the canary).
- [ ] OCR adapter (real `OCR_PROVIDER`) so scanned PDFs leave `requires_ocr`. Do not advertise OCR until this is true.

### P4.2 Microsoft 365 (or Google) — Harvey’s wedge

- [ ] Word add-in: draft/revise with Nyaya Draft sources + “this is a draft” banner; no send/file from the add-in.
- [ ] Outlook add-in: file email to a Matter (human confirm); never autonomous send.
- [ ] Auth: Clerk session in the add-in; same permission checks as the web API.
- [ ] Admin install docs for a small firm.

### P4.3 Collaboration polish

- [ ] Keyboard: citation chips and source viewer (Professor already closer than Case).
- [ ] Side-by-side document + analysis as the default for Review/Analysis (spec UI rule).
- [ ] Export: memo/draft to DOCX with source appendix; originals unchanged.

**Time:** 12–18 weeks solo / 8–12 weeks small team after P2 auth exists. Word store review adds calendar lag.  
**Depends on:** P0 (or you will ship a pretty add-in that still fails schema).

---

## P5 — Nyaya Guide (Phase 7) — not on the Harvey critical path

Harvey does not win public users. Guide is NyayaGrid’s fourth audience. Do it after Professor (already done) so isolation patterns stay consistent.

Tracker: [`NYAYA_GUIDE_TRACKER.md`](./NYAYA_GUIDE_TRACKER.md). **SYNTH/dev product complete 2026-08-17.** `FEATURE_GUIDE` stays **off** in staging/production until P2 live trust and legal review of Guide copy. This is not licensed research and not a production go-live.

- [x] Plain-language Q&A with jurisdiction asked before jurisdiction-dependent guidance
- [x] Document / court-notice explanation (verbatim dates only; never computed deadlines)
- [x] Situation timeline builder (`user_provided` events only)
- [x] Consultation packet
- [x] High-stakes escalation (eviction, arrest, deportation, DV, custody, imminent deadline)
- [x] No privilege / no A-C relationship copy — always visible
- [x] Isolation tests: Guide cannot read `student_*`, `matters`, `documents`
- [x] Playwright beyond smoke; unique ingest hashes per run
- [x] `FEATURE_GUIDE` off in production until P2 + legal review of Guide copy (code default; do not flip on)

**Time:** 6–8 weeks solo / 4–6 weeks small team.

---

## P6 — Firm operations (Phase 8) — how Harvey *plus* a PMS loses

This is NyayaGrid’s OS advantage. Harvey-level *assistant* plus weak operations still loses to Clio+Harvey.

Tracker: [`FIRM_OPS_TRACKER.md`](./FIRM_OPS_TRACKER.md). **SYNTH/dev screens complete 2026-08-17.** P2 live Clerk/S3 remain BLOCKER for real client data. Graph, Outlook/Google calendar sync, live SMTP, and payment collection are **not** done.

- [x] Email **file-to-matter** (paste + human confirm; no autonomous send). Graph / mailbox sync remains ops-only.
- [x] Firm calendar over verified deadlines + task due dates (timezone already on deadlines). Outlook/Google sync remains ops-only.
- [x] Time-entry assistance from chats — suggestions only; human posts the entry
- [x] Basic billing (draft invoices from posted minutes) — not complex accounting, not Stripe
- [x] Client portal (Client Guest role) — documents + limited Ask; no mixing with student/public
- [x] In-app notifications (invite, time suggestion). SMTP/Inngest remain console/dev.

**Time:** 12–16 weeks solo / 8–12 weeks small team.

---

## P7 — Enterprise trust (what procurement asks Harvey)

Start evidence collection during P2. Type II cannot finish in a coding sprint.

Tracker: [`ENTERPRISE_TRUST_TRACKER.md`](./ENTERPRISE_TRUST_TRACKER.md). **In-repo evidence track complete 2026-08-17.** Live Clerk SSO, signed DPA, pen test, SOC 2, and insurance remain **open**.

- [x] SSO (SAML/OIDC) **documented** as Clerk Enterprise operator work ([`USER_LIFECYCLE.md`](./USER_LIFECYCLE.md)). Live verification still blocked on P2 Clerk production.
- [x] SCIM **documented as not implemented**; identity lifecycle (invite hash, webhook identity-only, no cascade delete) is written down
- [x] Audit log export for a matter (JSON; no document text / prompts)
- [x] Retention policies + legal hold **design** + hold UI that blocks deletion requests ([`RETENTION_AND_LEGAL_HOLD.md`](./RETENTION_AND_LEGAL_HOLD.md))
- [x] Draft subprocessors list (`/subprocessors`) — **not** a signed DPA
- [ ] Pen test on staging; fix cross-tenant findings as SEV1
- [ ] SOC 2 Type I, then Type II (6–12 months of operation under the controls) — control map only: [`SOC2_CONTROL_MAP.md`](./SOC2_CONTROL_MAP.md)
- [ ] Insurance (E&O / cyber) — business, not code
- [x] Customer data never used for training unless separately recorded consent (consent table default empty; OpenAI `store: false`; usage metadata sanitizer)

**Time:** 6–12 months overlapping everything after P2 starts.

---

## Suggested sequence (do not run all phases as one PR)

```text
Week 1          Start P3 vendor conversations (calendar clock)
Weeks 1–5       P0 live eval + attorney review
Weeks 3–10      P1 Case polish (reorder from P0 findings)
Weeks 4–18      P2 production trust (staging → Clerk → ClamAV → S3 → restore → monitoring → terms)
Months 4–9      P3 license lands → Research adapter
Months 5–9      P4 Word + knowledge (after Clerk)
After P2        P6 firm ops; P5 Guide when product asks
Month 6–18      P7 SOC 2 / SSO / DPA
```

**Do not** start Production Readiness, Guide, and Word in the same session. Pick one named track.

---

## Definition of “we matched Harvey” (check only when true)

NyayaGrid is Harvey-level **for launch firms** when all of the following are true:

1. Live eval rates meet [`AGENT_QUALITY.md`](./AGENT_QUALITY.md) bars on pinned production models.
2. An independent lawyer’s review pass is recorded; send-to-client “fail” rate is an explicit, accepted residual risk — not “we skipped review.”
3. Nyaya Research cites **licensed** primary law or the UI still says it does not.
4. Production readiness tracker 1–11 is READY (or written exceptions).
5. An attorney can: upload → ask grounded → open the original → review intelligence → draft with sources → work hub — without URL-bar navigation or missing download.
6. Consequential actions still cannot file, send, or sign without a human.
7. No tenant’s data appears in another tenant’s retrieval (pen test + isolation tests).
8. Terms/Privacy signed; no-training-without-consent is contractual and technical.

Until then, say: **NyayaGrid is an AI-native legal OS in active development, stronger as a matter system of record than as a licensed research assistant.**

---

## Cost sketch (order of magnitude, not a quote)

| Item | Ballpark |
| --- | --- |
| Cloud + Clerk + monitoring (year 1, small staging+prod) | low five figures |
| ClamAV or SaaS malware | low–mid four figures / year |
| OpenAI production + eval | usage-based; cap `expensive_ai` |
| Licensed case/statute data | **the large line** — treat as six figures / year unless a narrow jurisdiction deal |
| SOC 2 + pen test + counsel | mid five to low six figures |
| Word add-in store / Microsoft 365 | mostly engineering time |

Engineering time dominates until P3 and P7 invoices arrive.

---

## How this file relates to other docs

- **This file** = sequence, Harvey definition, time, and the full remaining backlog.
- **Named trackers** = what gets checked `[x]` while building.
- Finished trackers stay finished. Dogfood nits live in [`CASE_DOGFOOD_TRACKER.md`](./CASE_DOGFOOD_TRACKER.md) §5 until a *named* job tracker exists.
- `.cursorrules` and `NYAYAGRID_PRODUCT_SPEC.md` still win if this roadmap drifts (no autonomous filing, no fake citations, four audiences only).
