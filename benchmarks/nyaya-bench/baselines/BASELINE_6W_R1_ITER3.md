# BASELINE 6W-R1 ITER 3

Deposition DA1 in the sequential frozen harness reported **3 criticalFails** (DA003, DA004, DA006): compatible/tension evidence was persisted as `inconsistency`. 6W had one non-critical DA004 tension-recall miss and **0** deposition criticals.

Root cause: deposition analysis stored the model’s `findingType` without the contradiction engine’s deterministic relation. Testimony versus badge/access-log/login activity is **tension**, not a direct contradiction of two sworn propositions. Prompt text already said so; the model still emitted `inconsistency`.

Production change: `refineDepositionFindingClass` in `packages/ai/src/contradiction-semantics.ts`, applied in `parseDepositionAnalysis`. Anti-overfit cases use vault/swipe, Texas login, and Ohio warehouse wording — not original DA1 names. Two sworn physical-entry statements remain `inconsistency`.

Narrow live gate after the change (`v2 run --mode deposition`, run `2026-08-27T11-02-57-563Z`): **15 PASS, 1 FAIL (DA002 quote span, major, not critical), 0 criticalFails**. DA003, DA004, and DA006 passed. DA004 now identifies tension rather than inventing a sworn contradiction.
