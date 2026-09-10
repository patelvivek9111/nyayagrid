# V3.1 measurement changelog

Parent: `v3-hard-unseen` / grader `v3-grade-2026-09-09`. Historical first-pass is unchanged.

## Grader `v3.1-grade-2026-09-09`

- Forbid/false-premise/must-abstain use assertion-aware detection (`isAffirmativeForbiddenClaim`). Negated refusals no longer fail; unaided affirmative overclaims still fail. Double-negation and quoted-text fixtures are covered in unit tests.
- Isolation remains exact-token leakage: a foreign matter/org identifier in the answer is CRITICAL even if restated as a denial.
- Citation membership resolves UUID/title/originalFilename metadata. Filename text is not required inside the quote.

## Catalog wording (T13 only)

- Question unchanged.
- `anyNeedles` expanded to include semantically equivalent non-conflict wording (`not contradictory`, `no conflict`, `not establish that the statements are contradictory`).
- Difficulty is unchanged: the file still requires recognizing consistent depo + minutes, not inventing a conflict.

## Not changed

- Matters, documents, isolation tests, V3 original fingerprint, first-pass JSON.


## Catalog wording (T13 only)

- Question unchanged.
- `anyNeedles` expanded to include semantically equivalent non-conflict wording (`not contradictory`, `no conflict`, `not establish that the statements are contradictory`).
- Difficulty is unchanged: the file still requires recognizing consistent depo + minutes, not inventing a conflict.

## Not changed

- Matters, documents, isolation tests, V3 original fingerprint, first-pass JSON.
