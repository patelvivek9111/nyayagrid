# PHASE 6S CLOSEOUT — Nyaya Jurisdiction

**Date:** 2026-08-19  
**Status:** **COMPLETE** (architecture + live verification)  
**Agents:** FEATURE_AGENTS remains **OFF** in staging/production  
**Certification:** 50-state certification is **not** complete (that is Phase 6T)

This report is the stop condition for Phase 6S. It records what was verified, not only what was wired.

## 1. Verdict

Phase 6S is complete. Structured Case jurisdiction is a shared trust boundary. Ask, Research, Draft, and Agent execution consume one resolver. J012 / J015 / J016 run through live package functions. Remaining work belongs in **6T**, not in another 6S architecture pass.

Do not claim nationwide coverage. Do not enable Agents. Do not reopen frozen 6R systems.

## 2. Migration

`npm run db:migrate` applied successfully.

`0012_phase6s_jurisdiction` is present in `drizzle.__drizzle_migrations`:

- hash `53bb900eca841ec91274fa51dccbb63aca79e58c021aa4e2b5580b54f2318d62` (matches `packages/database/drizzle/0012_phase6s_jurisdiction.sql`)
- `created_at` `1787000000000` matches the journal tag `0012_phase6s_jurisdiction`

Live schema checks after migrate:

- `matters.jurisdiction_mode`, `primary_state`, `court_id`, `as_of_date`, `governing_law_state` exist
- table `jurisdiction_coverage` exists

## 3. Live permission / isolation suite

Command:

```
RUN_DB_TESTS=1 npm test -w @nyayagrid/permissions -- src/phase6s.integration.test.ts
```

**8/8 PASS.**

| Gate | Result |
| --- | --- |
| View-only mutation denial | Lawyer with matter `read` is denied `minAccess: edit` + `matters.edit`; the same user can still `read` |
| Audit logging | `matter.updated` stores `governingLawState` and `courtId`, not document text |
| Cross-matter isolation | Org B / Matter B does not resolve to E.D. Pa.; Ask on Matter B does not receive Matter A forum fields |
| Cross-org isolation | `resolveMatterJurisdictionContext({ organizationId: orgB, matterId: matterA })` returns `null` |

## 4. Temporal ranking in Research

`isAuthorityTemporallyApplicable` now affects ranking, not only the helper’s unit tests.

- Corpus hits carry `effectiveStart` / `effectiveEnd` from `legal_authority_versions.effective_from` / `effective_to`, falling back to `legal_authorities.effective_date`
- `labelResearchHits` ranks through `rankAuthoritiesForMatter`
- Applicable windows get a small boost; inapplicable windows are downranked; missing windows stay **UNKNOWN** (not treated as currently applicable)
- Decision date alone remains UNKNOWN

Verified in `@nyayagrid/jurisdiction` (20/20) and `@nyayagrid/research` `jurisdiction-layer.test.ts` (2/2), plus the full research package **38/38**.

## 5. J1 is runnable and gradeable

Command: `npm run bench:j1`

Harness result: **PASS** (3/3 steps, 0 fail). Summary: `benchmarks/nyaya-bench/reports/runs/j1-closeout/summary.json`.

Live context paths (not “wired in code” only):

| Task | Live path | Assertion |
| --- | --- | --- |
| J012 | `askNyayaAboutMatter` | User prompt contains `USER CASE METADATA`, `primaryState=PA`, `asOfDate`, related `NJ`; does not set `governingLawState=NJ` |
| J015 | `generateDraft` | User prompt has USER CASE METADATA; system prompt forbids converting related jurisdictions into governing law |
| J016 | `executeAgentRun` | Runtime `caseJurisdictionContext` is PA + related NJ, governing law unset; `getFeatureFlags({ APP_ENV: "production" }).agents === false` (same for staging) |

Catalog: `benchmarks/nyaya-bench/datasets/j1/catalog.json`. J1 is still not a 50-state authority-quality score.

## 6. Regression reruns

| Suite | Result |
| --- | --- |
| `@nyayagrid/jurisdiction` | 20/20 PASS |
| `@nyayagrid/research` | 38/38 PASS |
| `@nyayagrid/ai` `research.test.ts` | 13/13 PASS |
| `@nyayagrid/search` | 3/3 PASS |
| `@nyayagrid/intelligence` `phase5-draft.test.ts` | 12/12 PASS |
| `@nyayagrid/agents` | 73/73 PASS |
| `phase6s.integration.test.ts` (`RUN_DB_TESTS=1`) | 8/8 PASS |
| `npm run bench:j1` | PASS |

Typecheck: jurisdiction, research, ai, permissions, intelligence, search, agents, nyaya-bench — clean.

## 7. Safety gates (reconfirmed)

- Wrong-state high court is not labeled controlling
- Forum is not auto-copied to governing law
- Unknown jurisdiction remains valid
- Coverage defaults UNVALIDATED; that label is not “certified”
- Invalid E.D. Pa. + 9th Circuit is rejected
- FEATURE_AGENTS production/staging default remains **off**
- 6R Draft source-limitation guard was not reopened

## 8. Still out of 6S (intentional)

- No populated 50-state coverage matrix
- Corpus metadata is still incomplete; many authorities only have free-text jurisdiction
- Intermediate appellate “controlling in this district” rules are not modeled
- Agent 2 still owns polished Case-create/settings UX
- Agents stay globally off
- No nationwide-support marketing claim

## 9. Exactly one next phase

**PHASE 6T — 50-STATE JURISDICTION BENCHMARK & CERTIFICATION**

6T may start. It should measure real coverage, authority quality, and abstention across states. It must not treat 6S architecture as certification.
