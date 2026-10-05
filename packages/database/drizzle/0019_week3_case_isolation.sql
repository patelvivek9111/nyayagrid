-- Week 3 tenant and case relationship constraints.
-- Additive. Does not rewrite corpus rows.
-- Rejects a child row whose organization or case does not match its parent.

CREATE UNIQUE INDEX "criminal_cases_id_org_uidx" ON "criminal_cases" ("id", "organization_id");
CREATE UNIQUE INDEX "prosecution_defendants_id_case_uidx" ON "prosecution_defendants" ("id", "criminal_case_id");
CREATE UNIQUE INDEX "prosecution_charges_id_case_uidx" ON "prosecution_charges" ("id", "criminal_case_id");
CREATE UNIQUE INDEX "prosecution_evidence_items_id_case_uidx" ON "prosecution_evidence_items" ("id", "criminal_case_id");
CREATE UNIQUE INDEX "prosecution_witnesses_id_case_uidx" ON "prosecution_witnesses" ("id", "criminal_case_id");

ALTER TABLE "prosecution_defendants" ADD CONSTRAINT "prosecution_defendants_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_defendant_case_fk" FOREIGN KEY ("defendant_id", "criminal_case_id") REFERENCES "prosecution_defendants" ("id", "criminal_case_id") ON DELETE cascade;
ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_charge_case_fk" FOREIGN KEY ("charge_id", "criminal_case_id") REFERENCES "prosecution_charges" ("id", "criminal_case_id") ON DELETE cascade;
ALTER TABLE "prosecution_evidence_items" ADD CONSTRAINT "prosecution_evidence_items_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_evidence_case_fk" FOREIGN KEY ("evidence_id", "criminal_case_id") REFERENCES "prosecution_evidence_items" ("id", "criminal_case_id") ON DELETE cascade;
ALTER TABLE "prosecution_witnesses" ADD CONSTRAINT "prosecution_witnesses_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_witness_case_fk" FOREIGN KEY ("witness_id", "criminal_case_id") REFERENCES "prosecution_witnesses" ("id", "criminal_case_id") ON DELETE cascade;
ALTER TABLE "prosecution_discovery_items" ADD CONSTRAINT "prosecution_discovery_items_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_disclosure_candidates" ADD CONSTRAINT "prosecution_disclosure_candidates_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_procedure_issues" ADD CONSTRAINT "prosecution_procedure_issues_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_warrants" ADD CONSTRAINT "prosecution_warrants_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_motions" ADD CONSTRAINT "prosecution_motions_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_hearings" ADD CONSTRAINT "prosecution_hearings_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
ALTER TABLE "prosecution_officers" ADD CONSTRAINT "prosecution_officers_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
