# Deepening Pass 3 — Civil Live DB Certification

**Date:** 2026-10-08  
**Branch:** `nyaya/full-completion-deepening-v2`  
**Classification:** `DEEPENING_PASS3_CIVIL_LIVE_DB_CERTIFICATION`  
**Result:** `CIVIL_LIVE_DB_CERTIFIED_WITH_FIXES`

## Runtime lock

- **Workstream:** DEEPENING PASS 3 CIVIL LIVE DB CERTIFICATION
- **Services:** local Postgres `localhost:5433/nyayagrid` only
- **Allowed mutations:** civil test fixtures / test rows / local transaction data
- **CourtListener:** NONE
- **Production Neon:** NONE

## Local DB

| Item | Result |
|------|--------|
| Target | `postgresql://nyayagrid:***@localhost:5433/nyayagrid` |
| Migration 0020 civil schema | PRESENT (all `civil_*` tables + `civil_claims_support_status_chk`) |
| Destructive reapply | NOT performed |

## Test command

```bash
RUN_DB_TESTS=1 DATABASE_URL=postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid \
  npm run test -w @nyayagrid/intelligence -- --run src/civil/civil.integration.test.ts
```

**Result:** 8/8 passed

## Security results

| Gate | Result |
|------|--------|
| Cross-org read denied | PASS |
| Cross-org mutation denied | PASS |
| Cross-matter claim/party relation denied | PASS |
| Cross-matter evidence link denied | PASS |
| Cross-matter fact link denied | PASS |
| Cross-matter legal issue link denied | PASS |
| Cross-matter / missing authority link denied | PASS |
| Cross-org standard link denied | PASS |
| Defense cannot target unrelated matter claim | PASS |
| client_guest mutation denied | PASS |
| Historical superseded pleading cannot be amended as current | PASS |
| Historical superseded claim cannot be re-amended as current | PASS |

## Functional results

| Gate | Result |
|------|--------|
| Claim / counterclaim / defense persistence | PASS |
| Elements, party roles, support + procedural status | PASS |
| Shared / claim-specific / contrary / missing evidence | PASS |
| Fact / legal issue / authority / standard relations | PASS |
| Defense-to-claim relation | PASS |
| Pleading history + supersession | PASS |
| Claim supersession + withdrawn/historical preservation | PASS |
| Current-only queries | PASS |
| D3 fixture persist → matrix / whole-matter reload | PASS |

## Multi-party isolation

River / Acme / Beta multi-defendant matter exercised. Cross-matter and foreign-entity relations denied. No cross-org leakage observed.

## Non-deciding safety

- DB check constraint rejects `LIABLE` support status
- Service/list assertions reject `WIN` / `LIABLE`
- Loaded review / matrix / whole-matter keep `liabilityConclusion` / `outcomeConclusion` null
- Allowed support statuses remain: `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONFLICTED`, `NO_EVIDENCE_FOUND`, `UNKNOWN`

## Fixes made (A-owned)

In `packages/intelligence/src/civil/postgres.ts`:

1. Require claim/element/defense targets to belong to the matter before relation inserts
2. Require legal issues to match org+matter for civil legal-issue and authority links
3. Require legal standards to match organization
4. Require authority row existence for civil authority links
5. Reject amendment of already-superseded pleadings and claims

Integration suite expanded to assert the Phase 4 security gates and issue/authority/standard persistence.

## Targeted regression after fixes

| Suite | Result |
|-------|--------|
| Civil unit / schema / certification tests | PASS |
| Civil Ask tests | PASS |
| Deepening (D1/D2/D3) | PASS (24/24) |
| Intelligence typecheck | PASS |
| Production web build | PASS (required because product service code changed) |

## Explicit non-goals

- Graph `claim` / `defense` enum migration: NOT implemented (separate shared change)
- CourtListener: unused
- Production Neon: unmodified

## Next action

SHARED GRAPH CLAIM/DEFENSE ENUM MIGRATION.
