# Wave 2C — Coverage classification criteria

Objective classes (not row-count alone):

## no_corpus
- 0 real primary-law authorities for the jurisdiction.

## seed_corpus
- ≤2 authorities, OR
- ≤2 statutes with no cases, regulations, or rules and ≤5 total authorities.
- Typical: single-statute token seeds.

## limited_corpus
Any of:
- ≥3 statutes, OR
- ≥1 statute and ≥1 case, OR
- ≥3 regulations, OR
- ≥3 court rules, OR
- ≥6 authorities
AND not meeting broader_corpus.

## broader_corpus
Requires **all** of:
- >100 authorities
- ≥15 statutes
- ≥20 cases
- ≥1 regulation **or** ≥1 rule
- ≥1 high-court **or** appellate case
- ≥80% with canonical URL
- ≥40% with known currentness/effective metadata

Broader is intentionally hard. Curated Wave 2C batches must not claim it.
