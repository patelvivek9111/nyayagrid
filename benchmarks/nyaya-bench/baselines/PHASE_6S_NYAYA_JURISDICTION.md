# PHASE 6S — NYAYA JURISDICTION

**Date:** 2026-08-19  
**Agents:** FEATURE_AGENTS remains **OFF**  
**Certification:** 50-state certification is **not** complete (Phase 6T)

## 1. Executive Summary

NyayaGrid now has a structured U.S. jurisdiction layer for Cases: forum, court, derived federal circuit, governing-law metadata, related jurisdictions, and as-of date. Ask, Research, Draft, and Agent context share one resolver. Authority hierarchy labels are deterministic. Coverage defaults to **UNVALIDATED**. This is architecture for safe routing, not nationwide legal coverage.

## 2. Existing Jurisdiction Architecture

Before 6S (verified in code, not old specs):

- `matters.jurisdiction`, `matters.court`, `matters.practiceArea` were free-text.
- Case create/update accepted those strings with no registry.
- `legal_authorities` stored `jurisdiction`, `court`, `decisionDate`, `effectiveDate`, `authorityType`, `treatmentStatus`, `hierarchyPath` JSON, and `sourceProvider`.
- Research filtered with `lower(a.jurisdiction) = lower(filter)` (hard string match).
- `classifyAuthorityWeight` used string equality and could not distinguish court hierarchy.
- Ask/Draft did not inject structured Case jurisdiction.
- Agents had an optional free-text `jurisdiction` tool argument.

## 3. New Structured Model

Added matter columns (legacy strings preserved) plus `jurisdiction_coverage`. User Case metadata is labeled as such. Forum is not copied into governing law.

## 4. State Registry

50 states + DC with stable two-letter codes and name aliases (`Pennsylvania` → `PA`).

## 5. Federal Court Registry

U.S. Supreme Court, numbered circuits + D.C. and Federal Circuits, and U.S. District Courts (including ED/MD/WD Pennsylvania → Third Circuit). Territories that already sit in federal districts are representable; they are not certified.

## 6. State Court Strategy

Each state has high, intermediate-appellate, and trial buckets. Extra records exist where names would otherwise be misleading (e.g. New York Supreme Court is trial; NY Court of Appeals is high). County courts are not enumerated.

## 7. Court Normalization

Unique aliases map to one `courtId`. Ambiguous strings (`Supreme Court`) stay unmapped. Historical free-text is kept on the matter.

## 8. Forum vs Governing Law

`primaryState` / `courtId` describe forum. `governingLawState` is optional and never auto-filled from forum.

## 9. Choice-of-Law Model

`choiceOfLawStatus`: `none_known` | `possible` | `stated` | `disputed` | `unknown`. A stated Delaware clause is metadata, not a holding that the clause is enforceable.

## 10. Multi-Jurisdiction Model

`relatedJurisdictions[]` plus distinct governing-law state yields `jurisdictionMode=multi_jurisdiction`. Single-state Cases remain `state` or `federal`.

## 11. As-of Date

New Cases default `asOfDate` to today (UTC date). Patches do not invent a date. Research/Ask/Draft/Agents receive it on the shared context object.

## 12. Authority Hierarchy

Encoded in court `level`: `scotus`, `circuit`, `district`, `state_high`, `state_appellate`, `state_trial`, `administrative`.

## 13. Authority Relationship Classifier

`classifyAuthorityRelationship` returns controlling / persuasive / out_of_jurisdiction / unknown. Wrong-state high courts cannot be controlling. LLM synthesis is instructed not to upgrade labels.

## 14. Temporal Compatibility

`isAuthorityTemporallyApplicable` is UNKNOWN without effective start/end. Decision date is not an effective date. Research ranking uses the helper: applicable windows are boosted, inapplicable windows are downranked, and UNKNOWN is neither treated as currently applicable nor excluded.

## 15. Research Integration

Matter jurisdiction is resolved before retrieval. Preferred states/circuits **boost** ranking; they are not a 50-state equal search. Hits are labeled and sorted (controlling above persuasive above out_of_jurisdiction, then temporal applicability when effective dates exist). Limited-corpus warning remains. Coverage UNVALIDATED is disclosed. Synthesis receives `CaseJurisdictionMetadata` plus `temporalApplicability` on authority chunks.

## 16. Ask Integration

`askNyayaAboutMatter` prepends the jurisdiction prompt block. Doctrine answers may disclose “Based on {state} law as recorded in Case metadata…”. Unknown + jurisdiction-sensitive questions abstain rather than guess a nationwide rule, unless the answer is already grounded in Case documents.

## 17. Draft Integration

Draft verified context includes the same USER CASE METADATA block. The 6R source-limitation guard is unchanged. Related jurisdiction is not treated as governing law.

## 18. Agent Integration

`caseJurisdictionContext` is loaded on agent run execution and passed to tools. Research tools use preferred ranking hints. **FEATURE_AGENTS stays off.** No per-agent jurisdiction flags.

## 19. Analysis Boundary

Contract analysis was **not** reopened. Choice-of-law clauses found by CA1 remain analysis findings, not automatic `governingLawState`.

## 20. Coverage Model

Rows can distinguish state + forum type + practice area (`PA` + `Contract` vs `PA` + `Employment`). No row → UNVALIDATED. Nothing is labeled “fully supported.”

## 21. Permissions / Audit

Jurisdiction mutations use existing `matters.edit` + matter `edit` access. View-only (`read`) cannot update. `matter.created` / `matter.updated` audit metadata includes court/state/governing-law ids, not document text.

## 22. Backward Compatibility

Legacy `jurisdiction`/`court` remain. Exact unique aliases may fill structured forum fields on read. They never become governing law. Ambiguous strings stay unknown structurally.

## 23. UI Contract

`GET /api/v1/jurisdiction/options` plus `jurisdictionContext` on GET/PATCH matter. Dependent dropdowns can filter courts by state + forum type. Circuit is derived.

## 24. J1 Benchmark

Catalog: `benchmarks/nyaya-bench/datasets/j1/catalog.json`. Runnable: `npm run bench:j1`. This is still not a 50-state live corpus score.

| Task | Where |
| --- | --- |
| J001–J009, J017, J020 | `@nyayagrid/jurisdiction` unit tests |
| J013–J014 + temporal ranking | `@nyayagrid/research` `jurisdiction-layer.test.ts` |
| J010, J011, J018, J019 | `phase6s.integration.test.ts` (`RUN_DB_TESTS=1`) |
| J012 | Live `askNyayaAboutMatter` prompt capture |
| J015 | Live `generateDraft` prompt capture |
| J016 | Live `executeAgentRun` + production/staging `FEATURE_AGENTS` default **off** |

## 25. Safety Gates

- Wrong-state labeled controlling: **0** (classifier + ranking tests)
- Cross-matter / cross-org leak: resolver requires `organizationId` + `matterId`
- View-only mutation: `matters.edit` + minAccess `edit`
- Fabricated jurisdiction / unknown forced to a state: unknown remains valid
- Inconsistent EDPA + 9th Circuit: `InvalidJurisdictionError`
- Forum silently promoted to governing law: **no**
- UNVALIDATED displayed as certified: **no** (`isCertifiedCoverageLabel`)

## 26. Remaining Weaknesses

- Corpus metadata is still incomplete; many authorities only have free-text jurisdiction.
- Intermediate appellate “controlling in this district” rules are not modeled (intentionally conservative).
- Issue-level Erie / claim-splitting is architecture-ready, not adjudicated.
- No populated coverage matrix.
- Agent 2 still owns polished Case-settings UX.
- J1 is not a live 50-state authority-quality score.

## 27. Controlled-Beta Assessment

6S is required before any broad U.S. support claim. It does **not** authorize “we support all 50 states.” FS2 full-system readiness from 6R is unchanged. Controlled beta still needs lawyer review. Do not deploy a nationwide-coverage marketing claim.

## 28. Exactly One Next Phase

**PHASE 6T — 50-STATE JURISDICTION BENCHMARK & CERTIFICATION**

6S closeout verification is recorded in `PHASE_6S_CLOSEOUT.md`. 6T may start.

---

## Explicit questions

1. Does each Case now have structured jurisdiction context? **Yes** (unknown is a valid structured state).
2. Can state and federal matters be distinguished? **Yes.**
3. Can federal district automatically determine federal circuit? **Yes.**
4. Is forum separate from governing law? **Yes.**
5. Can choice-of-law be represented without calling it legally verified? **Yes.**
6. Can multi-jurisdiction Cases be represented? **Yes.**
7. Is as-of date available to Research/Ask/Draft/Agents? **Yes**, on the shared context.
8. Can Nyaya distinguish controlling from persuasive authority? **Yes**, when metadata is sufficient.
9. Can wrong-state authority be prevented from being labeled controlling? **Yes.**
10. Can unknown jurisdiction remain unknown? **Yes.**
11. Does Nyaya abstain rather than guess when jurisdiction is required? **Yes**, for jurisdiction-sensitive questions.
12. Can coverage be marked UNVALIDATED/LIMITED instead of pretending support? **Yes.**
13. Can future coverage be tracked by state + practice area? **Yes.**
14. Is Research jurisdiction-aware before synthesis? **Yes.**
15. Does Ask receive structured jurisdiction context? **Yes.**
16. Does Draft receive jurisdiction without turning metadata into evidence? **Yes** (labeled USER CASE METADATA).
17. Do Agents receive jurisdiction while FEATURE_AGENTS remains OFF? **Yes** (live `executeAgentRun` context; production/staging flag default remains off).
18. Can view-only users alter jurisdiction? **No.**
19. Can Matter A’s jurisdiction contaminate Matter B? **No** (scoped resolver).
20. Can Org A’s jurisdiction contaminate Org B? **No.**
21. Are legacy matters handled safely? **Yes** (strings preserved; no ambiguous silent migration).
22. Are court mappings deterministic rather than LLM guessed? **Yes.**
23. Is 50-state certification complete? **NO — that is Phase 6T.**
