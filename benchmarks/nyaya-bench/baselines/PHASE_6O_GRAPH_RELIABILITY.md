# NYAYAGRID PHASE 6O — GRAPH RELIABILITY

Synthetic-fixture evaluation only. This is **not** attorney review. Graph is **safe enough for controlled beta with human review** after G2. It is not perfect, fully reliable, or attorney-validated.

Frozen and not modified: Case Q&A, Compare, Contradiction, Timeline T2, Memory M2, Analysis/6J, DA1, CA1, EM2, **Draft D2**, Research, Agents product logic, Security P0, Performance P0, V1/V2 PDFs, existing hidden GT, existing frozen baselines.

Graph may **read** verified Timeline/Facts. Those systems were not retuned.

Companions: `BASELINE_G1_GRAPH.md` / `.json` (unchanged production). `BASELINE_G2_GRAPH.md` / `.json` (after Graph-only trust fixes). G1 was not overwritten.

---

## 1. Existing Graph Architecture

Verified in production code (not product-spec assumption).

```text
Approved Timeline / Facts / Entities / Deadlines + all Documents / Tasks
  → materializeVerifiedGraph
       upsertGraphNode (new nodes status=approved)
       upsertGraphEdge supported_by, status=approved, copies intel source rows

Approved nodes + up to 24 document_chunks
  → extractGraphRelationshipCandidates
       prompt graph-relationship-extract-v2
       enum relationship types only; unsourced AI rows dropped
       upsertGraphEdge origin=ai status=proposed

Manual POST .../graph/edges → createManualGraphEdge
  G1: status=approved, no sources
  G2: status=proposed, no sources

reviewGraphEdge: approve | edit_and_approve | reject
  AI cannot approve without graph_edge_sources

listGraph / loadVerifiedGraphContext (approved, edited_and_approved)
  → formatVerifiedGraphForPrompt header "Verified relationships:"
  → Draft (frozen), Ask Nyaya, Research synthesize
Evidence Matrix: approved graph as document links only
Agents: getMatterGraphNeighborhood → getGraphNeighborhood
  G1 default statuses included proposed
  G2 default approved / edited_and_approved only
```

| Question | Answer |
| --- | --- |
| What creates nodes? | `materializeVerifiedGraph` from approved entities/events/facts/deadlines plus all matter documents and tasks. New nodes are **approved**. |
| What creates edges? | Materialize `supported_by` (approved); AI extract (proposed); manual create. |
| Statuses | proposed, approved, edited_and_approved, rejected |
| Are AI edges proposed? | **Yes** on extract. Materialized `supported_by` from already-approved intel is **approved**. |
| Manual auto-approve? | **G1 yes.** **G2 no** — manual edges are proposed. |
| What is approved for downstream? | `approved` and `edited_and_approved` via `loadVerifiedGraphContext` |
| Provenance | `graph_edge_sources`: documentId, documentVersionId, chunkId, page, segmentRef, supportingText |
| Quotes/spans | supportingText from `resolveValidatedSources` (span must match chunk; first supporting text kept per chunk) |
| Edge without provenance? | AI extract: no persist. Manual: yes, unsourced, now proposed. |
| Supersede/delete | Dedupe among active statuses. Rejected excluded from dedupe; a new proposed can appear after reject. G014 did not observe verified return. |
| Downstream | Draft, Ask Nyaya, Research synthesize, Evidence Matrix links, Agents neighborhood |

Allowed AI types: `works_for, party_to, signed, sent, received, attended, mentioned_in, supports, contradicts, occurred_before, occurred_after, related_to, represents, assigned_to, alleges, paid, owns, communicates_with, supported_by, participated_in, contains_fact`. There is no `entered` enum.

---

## 2. Trust Model

| Class | Graph posture |
| --- | --- |
| A source-backed | Materialize `supported_by` copies sources from already-approved Timeline/Facts |
| B human-reviewed derived | Approved AI or approved manual after review |
| C proposed AI | Must not enter verified loader — G012 pass |
| D user assertion | Must stay proposed until review — G1 fail / G2 pass |
| E dispute | Prefer `alleges` / `contradicts`; G006/G009 pass on persisted edges |
| F missing | Drop / do not invent exhibit contents — G010 pass |

Graph must not silently upgrade C/D/E/F into A. G1 violated D. G2 does not.

---

## 3. Node Semantics

Nodes are entities/concepts (person, organization, document, event, fact, deadline, task). Existence of Mercer and a document named like a location is not an entry claim.

Fact nodes embed `label: value` in displayName, so an **approved fact node** can state a proposition independently of edges. That is inherited from frozen Facts, not invented in Graph extract.

---

## 4. Edge Semantics

| Type | Role |
| --- | --- |
| `supported_by` | Citation from approved intel to a document — factual linkage of provenance, auto-approved at materialize |
| `party_to`, `signed`, `mentioned_in` | Typically source-backed if AI cites chunks |
| `paid`, `attended`, `participated_in` | Inferential; stay proposed until review |
| `alleges`, `contradicts` | Safer for allegations/tension |
| `related_to` | Vague; G2 manual uses this as proposed |

Vague labels cannot hide `entered`; that type is not in the enum. `attended` + place-like names is treated as actor overclaim by the grader.

---

## 5. Actor Grounding

Badge ACCESS GRANTED ≠ named physical entry. G007/G008 passed: no persisted `entered` edge and no physical-entry overclaim pattern on V2-006.

---

## 6. Negation

G006: deposition denial did not persist as an `entered` / “physically entered the records room” fact.

---

## 7. Disputed / Alleged Facts

G009: no `failed_to_pay` / “never paid” established edges. `alleges` remains available.

---

## 8. Temporal Semantics

G003: no currently_controls / now-in-force graph fact. G011: no “exactly November 10” upgrade in persisted edges. Graph edges still lack a datePrecision column; temporal safety is currently “do not invent exact dates in type/label,” not a first-class temporal model.

---

## 9. Provenance

AI edges require validated chunk spans. G015 pass (no AI edge without chunk). G016 pass (no material type citing only informal email). Do not attach the first available chunk: `resolveValidatedSources` requires a supporting span. Arbitrary chunks without overlap are dropped.

---

## 10. Review Lifecycle

proposed → approved / edited_and_approved / rejected. G012/G013/G014 passed. AI cannot be approved without sources.

---

## 11. Manual Writes

G1: auto-approved unsourced `related_to`. **STORAGE = VERIFICATION.** Class H.

G2: `createManualGraphEdge` status `proposed`. Review still can approve without sources (human class B, not silent A).

---

## 12. Downstream Consumers

| Consumer | Path | Proposed leak? |
| --- | --- | --- |
| Draft | `loadVerifiedGraphContext` labeled “Verified relationships” | G012/D016: no |
| Ask Nyaya | same loader | no (same filter) |
| Research synthesize | same loader | no |
| Evidence Matrix | approved document links | not issue rows |
| Agents | `getGraphNeighborhood` | G1 default included proposed; G2 approved-only |

Draft D2 was **not** reopened. Label “Verified relationships” remains Graph formatter copy; it can overstate reviewed inferences. Not treated as a G1 critical.

---

## 13. Graph Benchmark Design

Mode: `npm run bench -- v2 run graph`. Overlay `datasets/v2/graph/catalog.json` (18 tasks, G001–G018). Hidden GT under `hidden_ground_truth/graph/` loaded only after persist. Grades `listGraph` + `loadVerifiedGraphContext` + optional neighborhood. V2 PDFs only. Production never sees GT.

G018 is an extra Agents-boundary class revealed by audit.

---

## 14. G1 Baseline

Unchanged production. Run `2026-08-19T15-33-02-742Z`.

| | |
| --- | --- |
| Tasks | 18 |
| Pass | 17 |
| Needs work | 0 |
| Fail | 1 (G017 critical) |
| Infrastructure | 0 |
| Critical | 1 |

Metrics: edgePrecision 1, actorAccuracy 1, provenanceAccuracy 1, proposed→verified leakage 0, rejected leakage 0, wrong-document rate 0.

True edge recall vs a complete relationship gold set was **not** measured. Completeness tasks (G001/G002) passed on document nodes and allowed types including `supported_by`. Prefer lower recall over unsafe edges.

---

## 15. Root Causes

| Task | Class | Product vs bench |
| --- | --- | --- |
| G017 | H trust/review lifecycle | Product: manual auto-approve |
| G018 G1 | I downstream (latent) | Neighborhood default included proposed; G1 passed vacuously if the center node had no proposed incident edges |
| Others | — | Pass on this overlay |

No A–G extraction criticals on V2-001/006 in G1.

---

## 16. Production Changes

Graph-only (`packages/intelligence/src/graph/index.ts`):

1. Manual edges persist as **proposed**, not approved.
2. `getGraphNeighborhood` default statuses are **approved** and **edited_and_approved** (matches the agent tool description).

Permissions integration test updated to review the manual edge before expecting a neighborhood (storage ≠ verification).

No Draft, Timeline, Facts, Research, or Agents reasoning changes. No SYNTH IDs in production. No prompt score-chasing.

---

## 17. Targeted Safety Gate

After G2: G017 pass; G012 still 0 proposed in verified; G007 still no actor overclaim; G014 rejected stay out; G015 provenance intact.

---

## 18. G2 Baseline

Run `2026-08-19T15-43-10-288Z`. **18/18 PASS**, 0 fail, 0 infra, 0 critical.

Same metrics as G1 safety rates, with G017 closed.

---

## 19. G1 → G2 Transitions

| Transition | Count |
| --- | --- |
| PASS → PASS | 17 |
| FAIL → PASS | 1 (G017) |
| PASS → FAIL / NEEDS WORK | 0 |

Regressions: **none**.

---

## 20. Critical Failures

G1: G017 only.

G2: **none**.

---

## 21. Remaining Weaknesses

- Draft still titles approved graph as “Verified relationships” — wording can overclaim class B inferences.
- Nodes auto-approve; fact-node displayNames can carry propositions from frozen Facts.
- Materialize auto-approves `supported_by` (acceptable only because sources are already-approved intel).
- No first-class datePrecision / currently_operative edge metadata.
- Rejected relationships can be re-proposed (dedupe ignores rejected).
- Extract uses at most 24 chunks; completeness can miss distant documents.
- Human review can still approve an unsafe `attended`/`paid` edge into Draft.
- Overlay recall is not a full gold graph; absence of forbidden edges ≠ complete legal graph.

---

## 22. Performance

G1 wall ~6.5 min for 18 overlay tasks (two V2 matters). G2 similar (~7 min). Example G001 after intel+graph: 45 nodes, 39 edges (37 approved, mostly materialize `supported_by`), 2 proposed, 2 model calls. Not a beta latency blocker. Reliability > speed; no Graph performance work this phase.

---

## 23. Draft Dependency Regression

Read-only D2 overlay tasks (Draft production untouched):

| Task | Result | Run |
| --- | --- | --- |
| D016 proposed graph not proven | PASS | `2026-08-19T15-50-34-172Z` |
| D002 current vs future amendment | PASS | `2026-08-19T15-51-03-569Z` |
| D007 badge ≠ physical entry | PASS | `2026-08-19T15-51-18-553Z` |

This is **not D3**. Draft remains frozen at D2 24/24.

---

## 24. Beta Assessment

Safe enough for **controlled beta with human review**: proposed AI and (after G2) manual edges do not enter verified Graph/Draft/Ask Nyaya; actor/allegation/silence/negation classes did not fire on this V2 overlay; humans must still refuse unsafe approvals.

---

## 25. Freeze Decision

**FREEZE GRAPH** at G2.

Conditions met: 0 critical; no unsafe actor inference on the overlay; 0 proposed→verified leakage; 0 fabricated AI provenance; 0 negation inversion; 0 future-as-current graph fact; provenance defensible for AI edges; remaining issues are completeness, label strength, and reviewer error — not silent false facts in verified context.

---

## 26. Exactly One Next Phase

**PHASE — RESEARCH RELIABILITY**

Do not start it in this change set. Research is the next professional dependency after Draft+Graph verified context.

---

## Beta questions

1. Can proposed Graph edges enter verified context? **No** (`loadVerifiedGraphContext` approved only; G012).
2. Can AI-generated edges auto-approve? **No** on extract. Materialize `supported_by` from already-approved intel is approved by design.
3. Can manual assertions become verified automatically? **G1 yes. G2 no.** Review can still approve without sources.
4. Can badge activity become named physical entry? **Not on G1/G2 persisted edges** (G007). Reviewer could still approve `attended`.
5. Can allegations become established facts? **Not observed** (G009).
6. Is negation preserved? **Yes on this overlay** (G006).
7. Are approximate dates preserved? **Not upgraded to exact in edges** (G011). No datePrecision field.
8. Can future amendments become current prematurely **through Graph**? **Not observed** (G003). Draft D002 still pass.
9. Is every material edge defensibly sourced? **AI: required. Manual: unsourced until review. Materialize: copies approved intel sources.**
10. Can arbitrary chunks become provenance? **No** — span validation; empty sources drop the AI edge.
11. Do rejected edges stay excluded? **Yes** from verified (G014). Re-proposal is possible.
12. Can Graph contaminate Draft with an unsupported fact? **Not via proposed/manual-after-G2.** Approved unsafe review still can. D016/D007 pass.
13. Can Graph contaminate Ask Nyaya? **Only approved graph**, same loader.
14. Can Graph contaminate Agents? **G1 neighborhood included proposed. G2 default excludes proposed.**
15. Duplicate/conflicting edges? Dedupe merges active same key; tension types exist; no automatic side-picking.
16. Remaining critical classes? **None on G2 overlay.** Residual: human approval of inferential types; Draft “Verified” wording.
17. Safe enough for controlled beta with human review? **Yes.**
18. Largest remaining Graph risk? **A reviewer (or a future prompt drift) approving inferential `attended`/`paid` edges that then flow into Draft as “Verified relationships.”**
