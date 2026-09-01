# Nyaya Jurisdiction (Phase 6S)

Structured U.S. Case jurisdiction is shared Case metadata. It is a trust boundary, not a prompt-only hint and not a Research-only filter.

## What is stored

Matters keep legacy free-text `jurisdiction` and `court` for compatibility.

Structured columns (user Case metadata, not verified law):

- `jurisdictionMode`: `state` | `federal` | `multi_jurisdiction` | `unknown`
- `forumType`, `primaryState`, `courtId`, `courtName`
- derived `federalDistrict`, `federalCircuit`
- `governingLawState`, `choiceOfLawStatus`
- `asOfDate`
- `relatedJurisdictions[]`

**Forum ≠ governing law ≠ related jurisdictions.** Selecting Pennsylvania as forum does not set governing law to Pennsylvania.

Unknown jurisdiction is valid. Nyaya must not invent a state to create or answer a Case.

## Shared resolver

`resolveMatterJurisdictionContext({ db, organizationId, matterId })` in `@nyayagrid/jurisdiction` is the only reconstruction path. Ask, Research, Draft, and Agents consume that object.

Organization id is required. A matter id from another org returns `null`.

## Registries

Version-controlled TypeScript registries cover:

- 50 states + DC
- U.S. Supreme Court, Courts of Appeals, District Courts
- Per-state high / intermediate / trial buckets (not every county court)

Federal district → circuit is derived. Conflicting circuit input is rejected.

Court aliases (`E.D. Pa.`, `EDPA`, full name) map only when unique.

## Authority relationship

`classifyAuthorityRelationship` is deterministic:

- SCOTUS → controlling on federal questions
- same circuit → controlling (subject to SCOTUS)
- other circuits → persuasive
- district courts → persuasive (not circuit precedent)
- state high court of governing/forum state → controlling for that state's law
- same-state intermediate/trial → persuasive (not automatically controlling)
- other-state high court → out_of_jurisdiction (never controlling)

Missing metadata → `unknown`, not a guess.

Temporal helper returns `unknown` unless effective start/end dates exist. Decision date is not treated as effective date. Research ranking (`labelResearchHits` / `rankAuthoritiesForMatter`) applies that helper: currently effective authority is boosted, expired windows are downranked, and missing windows stay UNKNOWN rather than being treated as applicable.

## Coverage

`jurisdiction_coverage` can store state + forum + practice area. Empty table / no row → **UNVALIDATED**. This is not 50-state certification.

## UI contract

`GET /api/v1/jurisdiction/options?organizationId=&state=&forumType=` returns states and filtered courts, including derived `federalCircuitLabel`. Agent 2 should not hardcode circuit logic.
