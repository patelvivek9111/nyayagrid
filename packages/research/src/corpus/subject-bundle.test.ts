import { describe, expect, it } from "vitest";
import {
  BROADER_CORPUS_CRITERIA,
  classifyGapDependency,
  classifyWithBroaderGate,
  evaluateBroaderCorpusRequirements,
  meetsBroaderCorpus,
} from "./broader-criteria";
import {
  buildSubjectCoverage,
  classifyStatuteAuthority,
  classifyStatuteTopic,
  MINIMUM_SUBJECT_BUNDLE_TARGET,
} from "./subject-bundle";
import { classifyJurisdictionCoverage } from "./inventory";

describe("statute subject classification", () => {
  it("maps known topics to subject families", () => {
    expect(classifyStatuteTopic("statute_of_limitations")).toBe("limitations");
    expect(classifyStatuteTopic("ucc_merchantability")).toBe("contracts_commercial");
    expect(classifyStatuteTopic("director_duties")).toBe("corporations_business");
    expect(classifyStatuteTopic("wage_payment")).toBe("employment");
    expect(classifyStatuteTopic("consumer_protection")).toBe("consumer_protection");
    expect(classifyStatuteTopic("landlord_tenant")).toBe("property_landlord_tenant");
    expect(classifyStatuteTopic("personal_jurisdiction")).toBe("civil_procedure_jurisdiction");
    expect(classifyStatuteTopic("evidence_exclusion")).toBe("evidence");
    expect(classifyStatuteTopic("data_breach")).toBe("privacy_data");
    expect(classifyStatuteTopic("administrative_procedure")).toBe("licensing_admin_procedure");
  });

  it("classifies from practice areas when topic missing", () => {
    expect(
      classifyStatuteAuthority({ practiceAreas: ["employment"], citation: "X § 1" }),
    ).toBe("employment");
  });

  it("builds subject coverage and minimum bundle gate", () => {
    const cov = buildSubjectCoverage({
      jurisdiction: "AL",
      familyHits: {
        limitations: 1,
        contracts_commercial: 2,
        corporations_business: 1,
        employment: 1,
        consumer_protection: 1,
        property_landlord_tenant: 1,
      },
    });
    expect(cov.meetsMinimumBundle).toBe(true);
    expect(cov.families.privacy_data).toBe("absent");
    expect(MINIMUM_SUBJECT_BUNDLE_TARGET).toBe(6);
  });
});

describe("broader_corpus hard gate", () => {
  const base = {
    authorityCount: 120,
    statuteCount: 20,
    caseCount: 25,
    regulationCount: 2,
    ruleCount: 3,
    highCourtCaseCount: 2,
    appellateCaseCount: 5,
    withCanonicalUrlPercent: 90,
    currentnessKnownPercent: 50,
    statuteSubjectFamilyCount: 7,
  };

  it("requires every critical criterion — statutes alone cannot pass", () => {
    expect(meetsBroaderCorpus({ ...base, caseCount: 0 })).toBe(false);
    const reqs = evaluateBroaderCorpusRequirements({ ...base, caseCount: 0 });
    expect(reqs.find((r) => r.key === "case_count")?.satisfied).toBe(false);
    expect(classifyGapDependency({ missingRequirement: "case_count" })).toBe(
      "B_requires_courtlistener",
    );
  });

  it("passes only when all hard criteria satisfied", () => {
    expect(meetsBroaderCorpus(base)).toBe(true);
    expect(classifyWithBroaderGate(base).coverageClass).toBe("broader_corpus");
  });

  it("inventory classifier also requires subject breadth for broader", () => {
    expect(
      classifyJurisdictionCoverage({
        authorityCount: 120,
        statuteCount: 20,
        caseCount: 25,
        regulationCount: 2,
        ruleCount: 3,
        highCourtCaseCount: 2,
        appellateCaseCount: 5,
        withCanonicalUrlPercent: 90,
        currentnessKnownPercent: 50,
        statuteSubjectFamilyCount: 2,
      }),
    ).toBe("limited_corpus");
    expect(
      classifyJurisdictionCoverage({
        authorityCount: 120,
        statuteCount: 20,
        caseCount: 25,
        regulationCount: 2,
        ruleCount: 3,
        highCourtCaseCount: 2,
        appellateCaseCount: 5,
        withCanonicalUrlPercent: 90,
        currentnessKnownPercent: 50,
        statuteSubjectFamilyCount: 6,
      }),
    ).toBe("broader_corpus");
  });

  it("exposes criteria constants", () => {
    expect(BROADER_CORPUS_CRITERIA.minCases).toBe(20);
    expect(BROADER_CORPUS_CRITERIA.minStatuteSubjectFamilies).toBe(6);
  });
});
