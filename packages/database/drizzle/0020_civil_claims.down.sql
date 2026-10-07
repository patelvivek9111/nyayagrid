-- Rollback civil claims schema. Drops civil_* tables only.
-- Does not drop supporting unique indexes on matters/matter_entities/matter_facts
-- (safe to leave; other migrations may rely on them).

DROP TABLE IF EXISTS "civil_standard_relations" CASCADE;
DROP TABLE IF EXISTS "civil_authority_relations" CASCADE;
DROP TABLE IF EXISTS "civil_legal_issue_relations" CASCADE;
DROP TABLE IF EXISTS "civil_fact_relations" CASCADE;
DROP TABLE IF EXISTS "civil_evidence_relations" CASCADE;
DROP TABLE IF EXISTS "civil_evidence_items" CASCADE;
DROP TABLE IF EXISTS "civil_claim_elements" CASCADE;
DROP TABLE IF EXISTS "civil_defense_parties" CASCADE;
DROP TABLE IF EXISTS "civil_defense_claim_relations" CASCADE;
DROP TABLE IF EXISTS "civil_defenses" CASCADE;
DROP TABLE IF EXISTS "civil_claim_parties" CASCADE;
DROP TABLE IF EXISTS "civil_claims" CASCADE;
DROP TABLE IF EXISTS "civil_pleadings" CASCADE;
