# NYAYAGRID PHASE 6M — EVIDENCE MATRIX / ANALYSIS INTEGRATION RELIABILITY

Synthetic-fixture evaluation only. This is **not** attorney review.

Frozen and not modified: Case Q&A, Compare B.2, Contradiction B.2, Timeline T2, Memory M2, Phase 6J, Deposition DA1, Contract Analysis CA1.

Do not overwrite AN1 / AN2 / DA1 / CA1 / 6I–6L baselines.

Companions: `BASELINE_EM1_EVIDENCE_MATRIX.md` / `.json` (unchanged production). After fixes: `BASELINE_EM2_EVIDENCE_MATRIX.md` / `.json` (do not overwrite EM1).

---

## 1. Existing architecture (pre-change audit)

### 1.1 Production path (verified)

```text
documents (ready) + optional extractMatterIntelligence / analyze* / detectContradictionCandidates
  → persisted:
       timeline_events + timeline_event_sources
       matter_facts + matter_fact_sources
       graph_edges/nodes + graph_edge_sources  (approved only in matrix)
       entity_sources (no status filter on document links)
       analysis_runs / analysis_findings (contradiction, proposed|reviewed)
       document_review_states.important
  → GET /api/v1/matters/:matterId/evidence
       getEvidenceIntelligence (packages/intelligence/src/evidence/index.ts)
       buildEvidenceMatrix (same file, in-memory)
  → UI: apps/web/.../evidence/page.tsx and analysis/page.tsx "Evidence matrix" panel
  → Agent tool getEvidenceMatrix (read-only wrapper; Agents not modified this phase)
```

`matter.refresh_evidence_matrix` exists as a **job name only**. There is **no persisted matrix table**. The matrix is recomputed on every `getEvidenceIntelligence` call.

Exact symbols:

| Piece | Symbol / table |
| --- | --- |
| API | `GET .../evidence` → `getEvidenceIntelligence` |
| Mark important | `markDocumentImportant` → `document_review_states.important` |
| Matrix builder | `buildEvidenceMatrix` (private) |
| Timeline input | `timeline_events` status `approved` \| `edited_and_approved` |
| Facts input | `matter_facts` same statuses |
| Graph input | `graph_edges` / `graph_nodes` approved (document links only; **not** matrix issue rows) |
| Contrary input | contradiction `analysis_findings` status **`proposed` or `reviewed`** |
| Contract/Deposition Analysis | **not read** by the matrix |
| Memory | **not read** |
| Compare | **not read** |
| Raw chunks | only via already-persisted source rows |

### 1.2 Audit answers

1. **Dynamic view**, not a stored object. Regenerated each request.
2. Rows come from **verified facts** (one issue per fact) plus leftover **verified timeline events** not already attached to a fact by shared `documentId`.
3. Consumes: **approved/edited_and_approved Timeline and Facts**; **proposed and reviewed Contradiction findings** as contrary; approved Graph only as per-document links; **not** proposed Timeline/Facts; **not** Contract/Deposition Analysis; **not** Memory; **not** Compare; not raw chunks directly.
4. Verified here means Timeline/Fact `approved` or `edited_and_approved`. Analysis `reviewed` vs `proposed` is used only for contradiction contrary rows. `dismissed`/`rejected` findings/events/facts are excluded from those queries (except proposed contradictions are included).
5. **Yes, in one path:** a **proposed contradiction finding** is attached as `contrary` with kind `analysis_finding` and no status label. That can look like established conflicting evidence.
6. User-created facts with origin `user` would appear the same as AI facts **once approved**. Unapproved user assertions do not enter (status filter). Origin is **not** shown on matrix rows.
7. Proposed Contract/Deposition Analysis: **does not enter** the matrix (not a leak; also not available as reviewed intelligence).
8. Proposed Timeline: **does not enter** issues (status filter). Good.
9. Unverified Graph: **does not enter** matrix issues. Proposed entities **can** appear on the per-document `linkedEntities` list (entity_sources unfiltered).
10. Dismissed findings / rejected events/facts: **excluded** from matrix queries.
11. **Yes, association is coarse:** any verified event that shares a **documentId** with a fact is added as supporting for that fact. Distinct propositions on the same PDF can look like mutual corroboration.
12. Empty matrix when nothing is verified — AN012 passed for that. Gaps exist for unsourced verified facts and “important docs not cited.” Absence is not automatically “evidence of absence,” but labels can be misleading if a fact value overclaims.
13. Sources carry `documentId` in DB; the **matrix citation object drops** `documentVersionId` and `chunkId`. Wrong-version attribution is not represented on the row.
14. Same-document linking (see 11) can attach an event span to an unrelated fact. Chunk IDs are not on matrix citations, so the UI cannot show clause-level provenance.
15. Preserved on matrix citations today: supporting **text** (as `rationale`) and a **kind** + record **id**. **Not** exposed: documentId, documentVersionId, chunkId, source type vs review status, origin.
16. Downstream: Evidence UI, Analysis page matrix panel, `getEvidenceMatrix` agent tool. **Not** Ask Nyaya (6J). Matrix is not in `loadProfessionalAnalysisContext`.

### 1.3 Trust policy (target)

| Class | Policy |
| --- | --- |
| A. Source evidence | Approved fact/event citations with document + chunk + span |
| B. Reviewed intelligence | Reviewed Analysis/Contradiction may appear **labeled reviewed**, not as source |
| C. Proposed AI | Visible for review elsewhere; **must not** appear as established matrix evidence |
| D. User assertion | Must remain distinguishable from source-backed evidence if shown |
| E. Disputed | Both sides + uncertainty; tension ≠ proven contradiction |
| F. Missing | Gaps / unavailable; do not invent Exhibit Z or universal negatives |

Smallest enforcement: keep the dynamic view; **filter proposed contradictions out of contrary** (or label them proposed and exclude from “established”); **pass through provenance fields already on source tables**; do not auto-approve.

---

## 2. Independent overlay

Mode: `evidence` (`npm run bench -- v2 run evidence`). 28 tasks. Reuses V2 PDFs. Hidden GT: `datasets/v2/hidden_ground_truth/evidence/`. Grader `em1-2026-08-19` scores structured `getEvidenceIntelligence` output, not chat.

---

## 3. EM1 (unchanged production)

Live: `benchmarks/nyaya-bench/reports/runs/2026-08-19T13-56-47-498Z`

| | |
| --- | --- |
| Pass | 26 / 28 |
| Needs work | 0 |
| Fail | 2 (EM009, EM021 provenance) |
| Infrastructure | 0 |
| Critical | 0 |
| Proposition accuracy | 1.00 |
| Provenance accuracy | 0.93 |
| Supporting-span accuracy | 1.00 |
| Trust-status accuracy | 1.00 (live tasks) |
| Disputed-evidence accuracy | 1.00 |
| Unsupported-evidence rate | 0 |
| Proposed→verified leakage rate | 0 |
| Wrong-document attribution rate | 0 |
| Duplicate/corroboration error rate | 0 |
| Missing-evidence fabrication rate | 0 |

Official EM1 used `AI_TIMEOUT_MS=180000`. An earlier 30s timeout run is not EM1.

Caveat: contradiction detector produced **0 findings** on EM004, so the audited proposed-contrary leak was not live-hit. Same-document corroboration join was not live-hit (EM025).

---

## 4. Root-cause taxonomy (EM1)

| Task | Class | Frozen? |
| --- | --- | --- |
| EM009, EM021 | **B provenance** — matrix citations dropped documentId/chunkId already stored on source tables | Integration only |
| Audit, not live-hit | **A trust-boundary** — proposed contradiction `contrary` | Integration only (do not change Contradiction B.2) |
| Audit, not live-hit | **G duplicate evidence** — same-document event attached as fact support | Integration only |
| Audit | **D** user origin not labeled | Integration only |
| EM004 0 findings | **M** frozen Contradiction detector completeness | Report only; not modified |
| Analysis not in matrix | Completeness, not a leak | Frozen CA1/DA1 not opened |

---

## 5. Production changes

Only `packages/intelligence/src/evidence/index.ts` (+ unit tests). No extractors, 6J, DA1, CA1, Compare, Timeline, Memory, Agents.

1. Contradiction contrary: **`reviewed` only** (proposed excluded).
2. Citations pass through `documentId`, `documentVersionId`, `chunkId`, `status`, `trustClass`, `origin`.
3. Stop attaching timeline events to facts by shared documentId; events remain their own rows.
4. Contrary attached only on **matching chunkId**; leftover reviewed findings become distinct `finding:` rows with sides preserved.
5. User-origin facts/events labeled `User assertion —`.
6. Non-exact `datePrecision` and `uncertaintyNotes` appear on labels.
7. Document-card entity links: **approved entities only**.
8. Matrix still does **not** auto-approve anything.

---

## 6–10. Behavior after fix

**Provenance:** citations include document/version/chunk IDs from source tables. EM009/EM021 citationsMissing* = 0.

**Review/status:** proposed Timeline/Facts/Analysis still do not enter. Proposed contradictions no longer enter. Dismissed/rejected remain excluded. No auto-review.

**Conflict:** reviewed tension/contradiction sides stay distinct; no “proven contradiction” language. Chunk-level attach avoids collapsing unrelated docs.

**Missing evidence:** empty/unverified matrix does not fabricate Exhibit Z, universal nonpayment, or named physical entry.

---

## 11. Targeted safety gate

| Gate | EM2 |
| --- | --- |
| Proposed Analysis ≠ verified | PASS (EM003, EM015) |
| Proposed Timeline ≠ verified | PASS (EM002, EM014) |
| Dismissed/rejected excluded | PASS (EM007, EM008, EM016, EM020, EM027) |
| Badge ≠ named physical entry | PASS (EM005, EM010) |
| Missing exhibit not fabricated | PASS (EM019) |
| Invoice silence ≠ universal negative | PASS (EM006) |
| Conflict remains tension/dispute | PASS (EM011) |
| Provenance on supporting source | PASS (EM009, EM021, EM022) |
| Wrong document/version = 0 | PASS (EM024) |
| No automatic review/approval | PASS (EM012, EM028) |

---

## 12. EM2

Live: `benchmarks/nyaya-bench/reports/runs/2026-08-19T14-07-09-015Z`

**28 / 28 pass.** 0 fail, 0 needs_work, 0 infra, 0 critical.

All listed accuracy rates 1.00; leakage/wrong-doc/duplicate/fabrication rates 0.

---

## 13. EM1 → EM2 transitions

| Transition | Count | Tasks |
| --- | --- | --- |
| PASS → PASS | 26 | all except EM009, EM021 |
| PASS → NEEDS WORK | 0 | |
| PASS → FAIL | 0 | |
| NEEDS WORK → * | 0 | |
| FAIL → PASS | 2 | EM009, EM021 |
| FAIL → NEEDS WORK | 0 | |
| FAIL → FAIL | 0 | |

Regressions: **none**.

---

## 14. Critical failures

**0** on EM1 and EM2 live scores. Residual audit risk (proposed contrary) is closed in production even though EM004 did not generate findings.

---

## 15. Remaining non-critical weaknesses

- Matrix still does **not ingest reviewed Contract/Deposition Analysis** as issue rows (completeness).
- Contradiction detector often emits **zero findings** (frozen B.2; not retuned).
- Supporting-span grader is token-overlap, not attorney quote quality.
- UI matrix panel still shows counts more than full citation IDs (formatter/UI-only).
- Graph approved edges remain document links, not matrix propositions.

---

## 16. Performance impact

No extra model calls. One additional `matter_entities` status filter query. EM1 ~294s / EM2 ~334s wall time dominated by overlay extract/analyze, not the matrix builder.

---

## 17. Regression verification

Frozen engines were not modified. Overlay AN1 path still uses `structuredKind: "analysis"` for `evidence_matrix` on analysis-category tasks. 6J context loader untouched.

---

## 18. Beta assessment

Dangerous establishment errors were not observed after the integration fix. Remaining issues are completeness/noise (Analysis not listed in matrix; detector misses), not false factual establishment.

---

## 19. Freeze decision

**FREEZE EVIDENCE MATRIX / ANALYSIS INTEGRATION** for controlled beta.

---

## 20. Analysis as a whole

**Yes — Analysis as a whole can be frozen for controlled beta**, without reopening Contract Analysis, Deposition Analysis, or 6J:

- 6J Ask Nyaya trust boundary: already frozen
- DA1 Deposition Analysis: already frozen
- CA1 Contract Analysis: already frozen
- Evidence Matrix / integration: frozen on EM2

Do not combine EM scores with AN1/DA1/CA1.

---

## Next phase (do not start here)

**PHASE 6N — DRAFT RELIABILITY**
