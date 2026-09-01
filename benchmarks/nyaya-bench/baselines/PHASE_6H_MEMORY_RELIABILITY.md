# NYAYAGRID PHASE 6H — MEMORY RELIABILITY

Synthetic-fixture evaluation only. This is **not** attorney review.

M1 remains frozen. Case Q&A, Compare, Contradiction, Timeline, Graph, Draft, Research, and Agents were **not** modified except that they already call Memory retrieve/format (those call sites pick up the Memory-side formatter). No V3. Hidden GT was not changed.

Companion files: `BASELINE_M2_MEMORY.md`, `BASELINE_M2_MEMORY.json`, `PHASE_6H_M1_ROOT_CAUSE.md`

Official M2 run: `benchmarks/nyaya-bench/reports/runs/2026-08-19T03-24-02-546Z`

---

## 1. M1 root causes (pre-change)

See `PHASE_6H_M1_ROOT_CAUSE.md`. Summary:

| Task | Defect |
| --- | --- |
| M002 / M012 / M003 | `createMatterMemory` inferred `status=approved` from `origin=manual`; HTTP POST forced `status: "approved"`; formatter said `Approved Matter Memory` without origin |
| M017 | Hint fallback used `memoryType=verified_context` and attached the first of 12 unordered chunks |

Invariant implemented: **STORAGE != VERIFICATION**. Approval is never inferred from origin, memoryType, confidence, or create route.

---

## 2. Memory changes

All changes stayed inside Memory create/status defaults, provenance validation, proposal prompt, and the shared retrieve/format boundary.

| Area | Change |
| --- | --- |
| Create status | `resolveMemoryCreateStatus`: default **`proposed`**. Explicit `status: "approved"` still allowed (supersede / callers that mean review). |
| HTTP POST create | No longer forces `status: "approved"`. Origin remains `manual`. |
| Confidence | Default `medium`. Manual no longer defaults `high`. |
| Formatter | Eligible rows only. Labels: `reviewed user-provided information` vs `reviewed AI-derived memory` (adds “with cited sources” only when chunk IDs exist). Never says “source verified”. Unreviewed rows with `status` set are omitted. |
| Hint fallback | `memoryType=other`, `sourceType=attorney_hint`, **`chunkIds: []`**. Same on the HTTP empty-propose duplicate path. |
| AI provenance | Deterministic overlap + silence/badge guards. Unknown provenance stays empty. `verified_context` with no supporting chunks is stored as `other`. |
| Propose prompt | `matter-memory-propose-v2`: hint ≠ evidence, badge ≠ physical entry, silence ≠ universal negative, do not resolve tension as a single fact. |
| Supersede / review | Unchanged: explicit supersede still writes `approved`; `reviewMatterMemory` still approves. |
| Agents | **Not modified.** `proposeMemory` already passed `status: "proposed"`. |
| Graph | **Not integrated.** Confirmed no Memory imports in Graph materialization. |

---

## 3. Grader erratum (not hidden-GT rewrite)

The M1 grader treated a **proposed** user sentence whose `memoryType` was `verified_context` as “resolved as fact in downstream context,” even when the row was excluded from retrieval. That contradicted STORAGE != VERIFICATION and the check’s own “downstream” wording.

Erratum: `disputedResolved` now requires the forbidden phrase in **active/formatted** downstream context, or an **approved** `verified_context` created this action. Hidden GT was not changed. Auto-approved manuals still fail as before.

---

## 4. Targeted gate

M002, M012, M017, M003: **4/4 pass, 0 critical.**

- M002: `origin=manual`, `status=proposed`, `active=0`, trust `user_provided_unverified`
- M012: same; retroactivity not downstream
- M003: same; Mercer assertion not verified
- M017: `origin=ai`, `status=proposed`, `memoryType=other`, **no chunk IDs**, not downstream

Lifecycle still passing on the full run: M008 supersede, M009 reject, M015 edit.

---

## 5. Baseline M2 vs M1

| Metric | M1 | M2 |
| --- | ---: | ---: |
| Pass | 9 | **13** |
| Needs work | 3 | 3 |
| Fail | 4 | **0** |
| Infrastructure | 0 | 0 |
| Critical | **4** | **0** |
| Proposition accuracy | 0.8125 | 0.8125 |
| Provenance accuracy | 0.9375 | **1.0** |
| Trust-status accuracy | 0.8125 | **1.0** |
| Unsupported-memory rate | 2.3125 | 0.6875 |
| Manual-memory upgrade rate | 0.1875 | **0** |
| Disputed-fact error rate | 0.0625 | **0** |
| Stale-memory rate | 0 | 0 |
| Downstream-context violations | 3 | **0** |

Transition: FAIL→PASS 4 (M002, M012, M017, M003). PASS→PASS 9. NEEDS_WORK→NEEDS_WORK 3 (M001/M007/M010 empty AI propose). **0 regressions.**

---

## 6. Safety gates

| Gate | Result |
| --- | --- |
| Critical failures | **0** |
| Manual auto-upgrade | **0** |
| Downstream unreviewed-memory violations | **0** |
| Fabricated provenance | **0** |
| Rejected / superseded leakage | **0** |
| AI / agent auto-approval | **0** |

Did not weaken trust controls to recover AI propose recall.

---

## 7. Performance

- **0 additional model generations**
- Provenance/trust classification is deterministic
- Full M2 wall time ~23s (16 tasks); no extra DB round-trips beyond existing create/retrieve

---

## 8. Residual risk

Explicit supersede/edit/reject still work. **New-document staleness is still absent** (`expiresAt` unused). An old **explicitly approved** memory can survive a later upload until a human supersedes, edits, rejects, or archives it. That was not an M1 critical and was not scored-chased.

AI propose still often returns **0 rows** for operative notice (M001/M007/M010). Completeness, not safety.

---

## 9. Beta assessment

1. Can a manual user assertion automatically become verified factual context? **No.**
2. Can AI Memory automatically become verified? **No.** Stays `proposed`.
3. Can agent-created Memory automatically become verified? **No.** Agents were not changed; they already pass `proposed`. Default create would also stay `proposed`.
4. Can unknown provenance become arbitrary provenance? **No.**
5. Can proposed Memory enter Ask Nyaya? **No** (`retrieveActiveMatterMemories`).
6. Draft? **No** (same retrieve + formatter skip).
7. Research? **No**.
8. Agents? **No** (`retrieveMatterMemory` uses retrieveActive).
9. Do approved memories preserve origin? **Yes**, in the formatter labels.
10. Are rejected and superseded excluded? **Yes.**
11. Can disputed evidence silently become an established memory? **Not via auto-approve.** Propose prompt forbids resolving tension; M005/M006 still emitted 0 rows.
12. Can stale approved memory still survive new evidence? **Yes** — residual, not auto-reconciled.
13. Is Memory safe enough for a controlled beta **review** workflow? **Yes**, if attorneys treat proposed as suggestions and only approved rows as working context. Not a substitute for source evidence.
14. Largest remaining Memory risk: **stale explicitly approved memories after evidence changes**, plus weak AI propose recall for sourced facts.

---

## 10. Freeze decision

Safety gates are met. No serious regression.

**Recommend FREEZE MEMORY.**

This does not mean Memory is finished. Stop dedicated Memory hardening until the later pre-beta full-system reliability campaign.

---

## 11. Next phase

**Exactly one next subsystem: Analysis Reliability.**

No repository dependency requires a different order. Graph does not consume Memory. Draft/Research/Agents already consume the shared Memory formatter. Compare, Contradiction, Timeline, and Case Q&A are frozen. Analysis (contract / deposition / findings / professional review) is the next reliability surface in the established sequence.

Do **not** start it in this phase.
