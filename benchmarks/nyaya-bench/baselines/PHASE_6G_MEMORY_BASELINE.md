# NYAYAGRID PHASE 6G — MEMORY BASELINE

Synthetic-fixture evaluation only. This is **not** attorney review.

Production Memory was **not** tuned. Case Q&A, Compare, Contradiction, Timeline T2, Graph, Draft, Research, and Agents were **not** modified. No V3 dataset was created.

Companion files: `BASELINE_M1_MEMORY.md`, `BASELINE_M1_MEMORY.json`

Live persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T02-53-05-072Z`  
Official grades: `benchmarks/nyaya-bench/reports/runs/regrade-A1-2026-08-19T02-54-44-462Z` (grader `createdIds` isolation only)

---

## 1. Production Memory Architecture

```text
documents / user actions / agents
        ↓
createMatterMemory  |  proposeMatterMemories  |  agent proposeMemory
        ↓
matter_memories  (type, origin, status, sourceReference jsonb)
        ↓
reviewMatterMemory  (approve / edit_and_approve / reject / archive)
supersedeMatterMemory
        ↓
retrieveActiveMatterMemories
  status IN (approved, edited_and_approved)
  AND supersededBy IS NULL
        ↓
formatActiveMemoryForPrompt
  "Approved Matter Memory:"
  - [importance/memoryType] title: content
        ↓
Ask Nyaya  |  Draft  |  Research synthesize  |  Agents retrieveMatterMemory
```

Persistence is `matter_memories` in `packages/database/src/schema/index.ts`.

| Column | Role |
| --- | --- |
| `memoryType` | `verified_context`, `strategic_note`, `entity_resolution`, `document_significance`, `factual_caveat`, `user_instruction`, `matter_preference`, `procedural_context`, `other` |
| `status` | `proposed`, `approved`, `edited_and_approved`, `rejected`, `archived`, `superseded` |
| `origin` | `ai` \| `manual` |
| `confidence` | optional enum |
| `sourceType` | optional text (`ai_proposal`, `agent_proposal`, or null) |
| `sourceReference` | **jsonb**; optional `chunkIds`, rationale, model metadata |
| `createdByUserId` / `approvedByUserId` / timestamps | actor + review |
| `supersededBy` | explicit supersession |
| `expiresAt` | **exists and is unused** |

There are **no** first-class `documentId`, `documentVersionId`, `chunkId`, or quote columns. Chunk IDs, when present, live inside `sourceReference.chunkIds`. UI presentation (`presentMatterMemory`) resolves those IDs to chunk text for the attorney list. The downstream prompt formatter does **not** include origin, status, sources, or verification language beyond the header “Approved Matter Memory”.

`attorneyBadgeKind`: `approved` / `edited_and_approved` → badge **verified**; `proposed` → **suggested**; else **historical**.

---

## 2. Memory Creation Paths

Verified from code. Do not assume.

| Source | Writes `matter_memories`? | Default origin / status |
| --- | --- | --- |
| HTTP POST `/api/v1/matters/[matterId]/memory` (manual body) | **yes** | `origin: "manual"`, **`status: "approved"`** |
| `createMatterMemory` default | **yes** | `status ?? (origin === "manual" ? "approved" : "proposed")`; manual confidence defaults **high** |
| `proposeMatterMemories` (HTTP `action=propose`, Memory agent) | **yes**, max 3 | `origin: "ai"`, `status: "proposed"` |
| Hint fallback inside `proposeMatterMemories` when model returns nothing | **yes** | `memoryType: "verified_context"`, `origin: "ai"`, `status: "proposed"`, may attach **first chunk ID** |
| Duplicate HTTP hint fallback if propose still empty | **yes** | same type/status; sourceReference rationale only (no chunk in that branch) |
| Agent `proposeMemory` with `explicit` payload | **yes** | `origin: "ai"`, `status: "proposed"`, `sourceType: "agent_proposal"` |
| Agent `proposeMemory` without explicit | **yes** | calls `proposeMatterMemories` |
| Case Q&A (`askNyayaAboutMatter`) | **no** | reads Memory only |
| Timeline extract | **no** | |
| Analysis (contract / deposition / findings) | **no** | |
| Graph materialization | **no** | |
| Document ingest / chunking / embeddings | **no** | |

Memory can originate from: **manual user entry**, **AI proposal**, **attorney hint fallback**, and **agent propose**. It does **not** originate from Case Q&A, Timeline, Analysis, Graph, or document ingestion.

---

## 3. Current Trust Model

Conceptual classes vs actual schema:

| Conceptual class | Existing fields that can represent it | Gap |
| --- | --- | --- |
| A. Source-supported fact | `origin=ai` + `sourceReference.chunkIds` + later human `approved` | No required quote/span; propose often stores **zero** chunks |
| B. User-provided information | `origin=manual` | HTTP/create **auto-approves**; formatter does not say “user-provided” |
| C. AI inference | `origin=ai`, `status=proposed` | Type can still be `verified_context`; no inference flag |
| D. Disputed / contradicted | none | No dispute type; closest is `factual_caveat` unused by these paths |
| E. Preference / working context | `user_instruction`, `matter_preference`, `strategic_note` | Still auto-approved if created manually; still formatted as Approved Matter Memory |
| F. Verified / human-approved | `status=approved` / `edited_and_approved` | Manual create skips the proposed review step |

There is **no** field for “user-provided vs source-supported vs inference vs disputed.” Closest mapping is `origin` + `status` + `memoryType`. Downstream retrieval does not use `origin` or `memoryType` as a trust filter.

---

## 4. Manual Memory Audit

**Still true.** Phase 6A recorded it; M1 confirmed it live.

`apps/web/src/app/api/v1/matters/[matterId]/memory/route.ts` POST:

```ts
origin: "manual",
status: "approved",
```

`createMatterMemory` if status omitted:

```ts
status ?? (origin === "manual" ? "approved" : "proposed")
confidence ?? (origin === "manual" ? "high" : "medium")
```

A user typing “Mercer entered the records room” as `verified_context` is immediately:

- `status=approved`
- `origin=manual`
- `confidence=high`
- UI badge **verified**
- eligible for `retrieveActiveMatterMemories`
- formatted as:

```text
Approved Matter Memory:
- [normal/verified_context] Records room entry: Mercer entered the records room.
```

That is **not** equivalent to “source evidence proves Mercer entered.” Production stores the user’s sentence, then presents it as approved verified context. Origin is stored on the row and shown in the Memory UI DTO, but **Ask Nyaya / Draft / Research / Agents prompt text omit origin**.

M1: M002 (even as `user_instruction`), M012 (`verified_context` retroactivity), M003 (`verified_context` Mercer) all auto-promoted into downstream context.

This is a **trust-boundary defect**. Manual memories are useful; they currently upgrade certainty by being stored.

---

## 5. Provenance Audit

For a factual memory, production **can** store:

| Need | Stored today? |
| --- | --- |
| documentId | only if a chunk ID in jsonb is later joined |
| documentVersionId | **no** |
| chunkId | optional jsonb `sourceReference.chunkIds` |
| supporting quote/span | **no** dedicated field; UI may slice chunk text |
| originating subsystem | weak (`sourceType` / rationale string) |
| creator | `createdByUserId` |
| review/status | `status`, `approvedByUserId`, `approvedAt` |
| timestamp | `createdAt` / `updatedAt` |

Provenance is missing when:

- Manual create (empty `sourceReference` `{}`) — **correct**; must not fabricate
- AI propose with empty `sourceChunkIds` (M1: every live propose created **0** rows, so no AI-sourced rows to inspect)
- Hint fallback attaches **the first of 12 unordered chunks** even when the hint is unsupported (M017: 1 chunk, overlap with claim &lt; 30%)

`proposeMatterMemories` loads `.limit(12)` chunks with **no retrieval ranking**. That is a creation/provenance weakness, not a Case Q&A issue.

---

## 6. Memory → Ask Nyaya

`askNyayaAboutMatter` (`packages/search/src/nyaya.ts`), when `includeMemory !== false` (default):

```ts
retrieveActiveMatterMemories({ ..., question, limit: 6 })
memoryText = formatActiveMemoryForPrompt(memories)
```

It receives **approved + edited_and_approved**, `supersededBy IS NULL`, ranked by embedding/importance/lexical overlap, cap 6.

It does **not** receive: proposed, rejected, archived, superseded.

It **does** receive: manually created (immediately approved), AI-generated **after human approve**, inferred content if that content was approved, disputed content if a human stored it as approved. Rejected AI proposals stay out.

Dangerous transformation observed:

```text
[user types] Mercer entered the records room.
        ↓ stored approved verified_context
[MEMORY]
Approved Matter Memory:
- [normal/verified_context] Records room entry: Mercer entered the records room.
```

Case Q&A was **not** modified. Any future fix belongs in Memory selection/formatting.

---

## 7. Memory → Draft

`buildDraftVerifiedContext` (`packages/intelligence/src/draft/index.ts`) uses the **same** `retrieveActiveMatterMemories` + `formatActiveMemoryForPrompt` (limit 8).

Yes: an unverified manual memory can become drafting context. Example path:

```text
manual: "Client already paid."  (or M012 "The amendment applied retroactively.")
        ↓ auto-approved
Draft context: Approved Matter Memory: ... The amendment applied retroactively.
```

Draft was **not** modified. The leak is Memory eligibility + formatter, not Draft-specific logic. Draft may still cite matter chunks for assertions; Memory is additional narrative context the model can treat as established.

---

## 8. Memory → Agents

Nine agents:

| Agent | Reads Memory? | Writes Memory? |
| --- | --- | --- |
| memory-agent | `retrieveMatterMemory` | `proposeMemory` (`proposed` only) |
| draft-agent | `retrieveMatterMemory` | no |
| research-agent | `retrieveMatterMemory` | no |
| evidence-agent | `retrieveMatterMemory` | no |
| timeline-agent | `retrieveMatterMemory` | no |
| graph-agent | no | no |
| contract-agent | no | no |
| deposition-agent | no | no |
| discovery-agent | no | no |

`retrieveMatterMemory` calls `retrieveActiveMatterMemories`. Tool description says “attorney-approved context, not evidence,” but it cannot distinguish verified source fact vs user note vs AI inference vs disputed information: it returns the raw approved rows. Agents were **not** modified.

Planner also requires `proposeMemory` on some plans; writes stay `proposed` unless a human later approves.

---

## 9. Memory → Graph

`packages/intelligence/src/graph` does **not** read `matterMemories`. Graph materialization does not create nodes/edges from Memory.

Unverified memory **cannot** become a Graph relationship merely by being stored. Graph-agent tools are neighborhood + verified timeline, not Memory.

Trust status therefore **does not** launder through Graph today. Contamination path is Ask Nyaya / Draft / Research / selected agents, not Graph.

---

## 10. Structured Memory Benchmark

Independent overlay. Does **not** change V2 `tasks.json` or existing hidden Q&A/Compare/Contradiction/Timeline GT.

| Piece | Path |
| --- | --- |
| Catalog | `benchmarks/nyaya-bench/datasets/v2/memory/catalog.json` (16 tasks) |
| Hidden GT | `datasets/v2/hidden_ground_truth/memory/SYNTH-V2-001.json`, `SYNTH-V2-006.json` |
| Execute | `runner/execute-memory.ts` — no `loadGroundTruth` |
| Adapt | `adaptMemoryOutput` |
| Grader | `graders/grade-memory-structured.ts` version `m1-2026-08-19` |

Canonical shape (adapted to existing schema, no production-only fields):

```json
{
  "memoryId": "...",
  "proposition": "title + content",
  "memoryType": "verified_context",
  "trustStatus": "user_provided_auto_approved",
  "sourceDocumentIds": [],
  "sourceChunkIds": [],
  "origin": "manual",
  "reviewStatus": "approved"
}
```

Grades: proposition, provenance, trust classification, review/status, unsupported-memory rate, disputed-fact handling, duplicate/supersession, downstream-context eligibility.

---

## 11. V1/V2 Reuse

No V3 PDFs. Actions run against existing synthetic matters:

- **SYNTH-V2-001** — MSA / Amendment 1 (30 days) / invoice silence / missing Exhibit Z
- **SYNTH-V2-006** — badge log vs testimony (Mercer / Jordan / records room)

Categories actually supportable:

| ID | Category | How tested |
| --- | --- | --- |
| M001 | source-supported fact retention | AI propose on Amendment 1 |
| M002 | manual/user-provided | create `user_instruction` |
| M003 | unsupported user assertion | create Mercer entry on 006 |
| M004 | AI inference must not become fact | propose “intend to extend” |
| M005 | disputed fact | propose Jordan entry |
| M006 | contradiction/tension | propose who entered |
| M007 | source provenance | propose with required chunks |
| M008 | update/supersession | explicit supersede 60→30 |
| M009 | rejected memory | create proposed → reject |
| M010 | cross-document | propose controlling amendment |
| M011 | silence | propose service credit |
| M012 | false premise | manual retroactivity |
| M013 | missing exhibit | propose Exhibit Z deductible |
| M014 | duplicates | create same manual twice |
| M015 | edit | create 60 then edit to 30 |
| M017 | hint / fabricated provenance | hint fallback silence |

V1 was not needed; V2 fixtures already contain the operative/amendment/silence/dispute structures.

---

## 12. Baseline M1

Official (regrade of unchanged persist):

| Metric | Value |
| --- | ---: |
| Scenarios | 2 |
| Memory tasks | 16 |
| Pass | **9** |
| Needs work | **3** |
| Fail | **4** |
| Infrastructure | **0** |
| Critical | **4** |
| Proposition accuracy | **0.8125** |
| Provenance accuracy | **0.9375** |
| Trust-status accuracy | **0.8125** |
| Unsupported-memory rate | **2.3125** (mean active manual-without-chunk rows per task; inflated by shared-matter accumulation) |
| Manual-memory upgrade rate | **0.1875** (3/16) |
| Disputed-fact error rate | **0.0625** (1/16) |
| Stale-memory rate | **0** |
| Downstream-context violations | **3** |

AI propose created **0 rows** on M001, M004, M007, M010, M011, M013, M005, M006. That is production propose (12 unordered chunks, empty verified intelligence because extract was not run). Silence on adversarial propose is safer than inventing facts; missing “30 days” on M001/M007/M010 is a **creation** weakness, not a downstream leak.

---

## 13. Critical Failures

1. **M002** — “Client says payment was made on Friday” auto-approved; entered formatter as Approved Matter Memory.
2. **M012** — “The amendment applied retroactively” stored as approved `verified_context`; documents show prospective effective date; downstream leak.
3. **M003** — “Mercer entered the records room” auto-approved `verified_context`; documents only show badge activity; formatted as verified.
4. **M017** — Hint “No service credit was ever issued” stored as `verified_context` with an unrelated first-chunk ID. Status remained `proposed` (did not enter `retrieveActive`), but the row is typed as a fact-class claim with fabricated provenance.

---

## 14. Failure Taxonomy

| Class | M1 tasks |
| --- | --- |
| creation | AI propose empty on notice-period tasks (also proposition extraction) |
| proposition extraction | M001, M007, M010 |
| provenance | M017 (hint first-chunk) |
| trust classification | M002, M012, M003 |
| **manual-memory semantics** | **M002, M012, M003 (critical)** |
| inference upgrade | not observed as approved AI rows; propose stayed empty |
| dispute handling | M017 (silence typed as `verified_context`) |
| supersession | none (M008 pass) |
| duplicate handling | M014 pass (no merge; two indistinguishable facts) |
| lifecycle/rejection | M009, M015 pass |
| Q&A boundary | same formatter; 3 downstream leaks |
| Draft boundary | same formatter; 3 downstream leaks |
| Agent boundary | same `retrieveActive`; not separately executed |
| Graph boundary | none (Graph does not ingest Memory) |
| benchmark defect | shared-matter isolation; first live grade mixed leftover manuals into empty propose tasks |
| infrastructure | 0 |

---

## 15. Supersession / Staleness

**Explicit supersede (M008):** old row `status=superseded`, `supersededBy` set; `retrieveActive` excludes it (`isNull(supersededBy)`). New 30-day row active. Pass.

**In-place edit (M015):** content replaced; “60 days” not in active blob; “30” present. Pass.

**Document-change staleness:** **not implemented.** `expiresAt` unused. Uploading a new amendment does **not** mark prior memories stale. Retrieval will still prefer an old approved 60-day memory until a human supersedes, edits, rejects, or archives it.

AI propose does not currently refresh or supersede existing memories when evidence changes.

---

## 16. Lifecycle / Rejection

| Step | Observed |
| --- | --- |
| create proposed (AI or explicit `status=proposed`) | stays out of `retrieveActive` |
| reject (M009) | `status=rejected`; not active downstream |
| archive | status historical; not in ACTIVE list |
| edit_and_approve | in-place; previous proposition does not remain as a separate active row |
| delete | no dedicated delete API in this path; reject/archive/supersede |

Rejected/deleted-equivalent memories **do not** remain in Ask Nyaya/Draft/Agents retrieval. That boundary works.

---

## 17. Benchmark Gaps

- Tasks on the same scenario share one ingested matter, so later snapshots include earlier manuals. Official grading now isolates `createdIds`; downstream “active” still reflects accumulation (unsupported-memory rate is therefore a matter-level mean, not a per-action rate).
- Empty AI propose is scored as pass on adversarial “must not invent” tasks; it does **not** prove the model would refuse if it had emitted rows.
- Propose uses first 12 chunks without retrieval; notice-period needles may be off-window.
- Agent and Draft **engines** were not invoked; eligibility was measured via the shared retrieve/format functions they call.
- No live “upload new document → old memory still retrieved” action.
- No V3 needed yet; a small isolation improvement (one matter per Memory task) would make propose grades cleaner. That is a benchmark change, not a Memory product change.

---

## 18. Beta Assessment

1. **Is Memory safe enough for beta?** **No**, not as verified matter context. Manual writes become approved facts in Ask Nyaya and Draft.
2. **Can manual memory currently be trusted?** As a **note**, yes it persists. As a **source fact**, **no**. Auto-approve + “Approved Matter Memory” is the upgrade defect.
3. **Can AI-generated memory currently be trusted?** **Safer while `proposed`.** M1 propose did not auto-approve. Unsafe if a human (or hint typed as `verified_context`) later treats it as evidence, or if hint fallback fabricates chunk provenance.
4. **Does Memory preserve provenance?** **Optionally and weakly.** Manual correctly has none. AI/hint can attach unordered or first-chunk IDs. No version/quote requirement.
5. **Does Memory preserve uncertainty/dispute?** **No first-class dispute type.** Reject/proposed keep some uncertainty. Manual approved `verified_context` erases it. M005/M006 did not resolve the badge/testimony conflict only because propose emitted nothing.
6. **Can stale information contaminate downstream work?** **Yes, if not explicitly superseded.** Explicit supersede/edit/reject work. Evidence change does not expire memories.
7. **Can unverified Memory contaminate Ask Nyaya?** **Yes** — any auto-approved manual row.
8. **Can it contaminate Draft?** **Yes** — same retrieve/format path.
9. **Can it contaminate Agents/Graph?** **Agents that call `retrieveMatterMemory`: yes** (draft, research, evidence, timeline, memory). **Graph: no.**
10. **Single largest Memory risk:** **Manual create auto-approves and is formatted as “Approved Matter Memory” without origin or verification, so a user assertion becomes factual context for Ask Nyaya, Draft, Research, and several agents.**

---

## 19. Next Recommendation

**Exactly one next step (do not start it):** Memory reliability — stop auto-approving manual writes; preserve origin in retrieval/formatting so user-provided/unverified content cannot appear as established fact. Keep AI proposals `proposed` until explicit review. Stop attaching an unrelated first chunk on hint fallback.

Do not reopen Case Q&A, Compare, Contradiction, Timeline, Graph, Draft, Research, or Agents except insofar as they already call Memory retrieve/format (those call sites should pick up a Memory-side formatter/eligibility fix). Do not create V3.
