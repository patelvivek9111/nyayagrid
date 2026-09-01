import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  C2A_STATE_ORDER,
  loadC2AStateProfiles,
  researchSpecsForState,
  type C2AResearchSpec,
} from "../datasets/t6t/c2a-catalog";
import {
  gradeC2ATask,
  labelPracticeArea,
  type C2AHit,
  type C2ASynthesis,
} from "../runner/t6t-c2a-grade";

const baselines = join(import.meta.dirname, "..", "baselines");

function spec(partial: Partial<C2AResearchSpec> = {}): C2AResearchSpec {
  return {
    id: "T6T-C2A-PA-01",
    state: "PA",
    kind: "contract-statute",
    practiceArea: "Contract",
    question: "Under Pennsylvania law, within what period must an action for breach of a contract for the sale of goods be commenced?",
    expectSourceExternalId: "pa-ucc-2725",
    expectCitationContains: "725",
    expectState: "PA",
    decoyState: "NJ",
    expectTokens: ["4 years"],
    expectAbstention: false,
    expectUnknownTemporal: false,
    expectLimitation: false,
    ...partial,
  };
}

function hit(partial: Partial<C2AHit> = {}): C2AHit {
  return {
    authorityId: "auth-pa",
    citation: "13 Pa.C.S. § 2725",
    title: "Statute of limitations in contracts for sale",
    authorityType: "statute",
    authorityState: "PA",
    court: null,
    courtId: null,
    courtLevel: null,
    hierarchyRelationship: "controlling",
    temporalApplicability: "unknown",
    sourceProvider: "us-primary-corpus",
    snippet: "An action for breach of any contract for sale must be commenced within 4 years after the cause of action has accrued.",
    canonicalSourceUrl: "https://www.legis.state.pa.us/example",
    effectiveDate: null,
    sourceExternalId: "pa-ucc-2725",
    ...partial,
  };
}

function synthesis(partial: Partial<C2ASynthesis> = {}): C2ASynthesis {
  return {
    conciseAnswer:
      "The imported Pennsylvania UCC text states that an action for breach of a contract for sale must be commenced within 4 years.",
    propositions: [
      {
        text: "An action must be commenced within 4 years.",
        authorityIds: ["auth-pa"],
        chunkIds: ["c1"],
      },
    ],
    sources: [{ authorityId: "auth-pa", chunkId: "c1", quote: "commenced within 4 years" }],
    coverageWarnings: [],
    jurisdictionCaveats: [],
    unresolvedIssues: [],
    fabricatedAuthorityIds: [],
    rejectedQuoteCount: 0,
    grounded: true,
    ...partial,
  };
}

const sourceText = {
  "auth-pa": "An action for breach of any contract for sale must be commenced within 4 years after the cause of action has accrued.",
};

describe("C2A graders", () => {
  it("treats synthetic controlling authority as CRITICAL", () => {
    const graded = gradeC2ATask({
      spec: spec(),
      hits: [
        hit({
          authorityId: "synth",
          sourceProvider: "synthetic-fixtures",
          hierarchyRelationship: "controlling",
          authorityState: "PA",
          sourceExternalId: "synth-1",
        }),
      ],
      synthesis: synthesis(),
      sourceTextByAuthorityId: sourceText,
    });
    expect(graded.severity).toBe("CRITICAL");
    expect(graded.rootCause).toBe("E");
  });

  it("treats foreign controlling authority as CRITICAL", () => {
    const graded = gradeC2ATask({
      spec: spec(),
      hits: [
        hit({
          authorityId: "auth-nj",
          authorityState: "NJ",
          citation: "N.J.S.A. 12A:2-725",
          sourceExternalId: "nj-ucc",
          hierarchyRelationship: "controlling",
        }),
      ],
      synthesis: synthesis({
        sources: [{ authorityId: "auth-nj", chunkId: "c1", quote: "commenced within 4 years" }],
      }),
      sourceTextByAuthorityId: {
        "auth-nj": "An action for breach of any contract for sale must be commenced within 4 years.",
      },
    });
    expect(graded.severity).toBe("CRITICAL");
    expect(graded.detail).toMatch(/Wrong-state/);
  });

  it("grounds the four-year UCC limitations token", () => {
    const graded = gradeC2ATask({
      spec: spec({ kind: "grounding", id: "T6T-C2A-PA-09" }),
      hits: [hit()],
      synthesis: synthesis(),
      sourceTextByAuthorityId: sourceText,
    });
    expect(graded.severity).toBe("PASS");
    expect(graded.qualityPass).toBe(true);
  });

  it("passes family-law abstention when coverage is warned", () => {
    const graded = gradeC2ATask({
      spec: spec({
        id: "T6T-C2A-PA-10",
        kind: "abstention",
        practiceArea: "Civil",
        question: "What is the waiting period for a no-fault divorce in Pennsylvania?",
        expectSourceExternalId: null,
        expectCitationContains: null,
        expectAbstention: true,
        expectLimitation: true,
        expectTokens: [],
      }),
      hits: [hit({ hierarchyRelationship: "persuasive" })],
      synthesis: synthesis({
        conciseAnswer: "The imported corpus does not contain a no-fault divorce waiting-period statute.",
        grounded: false,
        coverageWarnings: ["Search covered only the authorities imported into this NyayaGrid corpus."],
        sources: [],
        propositions: [],
      }),
      sourceTextByAuthorityId: sourceText,
    });
    expect(graded.severity).toBe("PASS");
  });

  it("fails current-law overclaim when effective dates are unknown", () => {
    const graded = gradeC2ATask({
      spec: spec({
        id: "T6T-C2A-PA-11",
        kind: "temporal-current-law",
        expectAbstention: false,
        expectLimitation: true,
        expectUnknownTemporal: true,
      }),
      hits: [hit({ effectiveDate: null, temporalApplicability: "unknown" })],
      synthesis: synthesis({
        conciseAnswer: "13 Pa.C.S. § 2725 is definitely the current law as of today, with no temporal uncertainty.",
        coverageWarnings: [],
        grounded: true,
      }),
      sourceTextByAuthorityId: sourceText,
    });
    expect(graded.severity).toBe("FAIL");
    expect(graded.rootCause).toBe("I");
  });

  it("keeps Civil LIMITED even when excerpt retrieval passes", () => {
    const labeled = labelPracticeArea({
      area: "Civil",
      tasks: [
        {
          id: "T6T-C2A-PA-03",
          state: "PA",
          kind: "high-court-case",
          practiceArea: "Civil",
          severity: "PASS",
          detail: "ok",
          qualityPass: true,
        },
      ],
    });
    expect(labeled.label).toBe("LIMITED");
    expect(labeled.dbStatus).toBe("limited");
  });

  it("keeps Criminal UNVALIDATED even if tasks pass", () => {
    const labeled = labelPracticeArea({
      area: "Criminal",
      tasks: [
        {
          id: "x",
          state: "DE",
          kind: "high-court-case",
          practiceArea: "Criminal",
          severity: "PASS",
          detail: "ok",
          qualityPass: true,
        },
      ],
    });
    expect(labeled.label).toBe("UNVALIDATED");
    expect(labeled.dbStatus).toBe("unvalidated");
  });
});

describe("C2A catalog", () => {
  it("builds 12 research specs for each of the 10 initial states", async () => {
    const profiles = await loadC2AStateProfiles();
    expect(profiles.map((row) => row.code)).toEqual([...C2A_STATE_ORDER]);
    for (const profile of profiles) {
      const specs = researchSpecsForState(profile);
      expect(specs).toHaveLength(12);
      expect(new Set(specs.map((row) => row.kind)).size).toBe(12);
      expect(specs.every((row) => row.state === profile.code)).toBe(true);
    }
  });
});

describe("C1 freeze still holds beside C2A", () => {
  it("does not overwrite historical C1", () => {
    const c1 = JSON.parse(readFileSync(join(baselines, "BASELINE_6T_C1_50_STATE.json"), "utf8"));
    expect(c1.id).toBe("BASELINE_6T_C1_50_STATE");
    expect(c1.corpus.totalAuthorities).toBe(7);
    expect(c1.corpus.statesWithMappedAuthorities).toBe(0);
    expect(c1.generatedAt).toBe("2026-08-20T02:34:08.812Z");
    expect(existsSync(join(baselines, "PHASE_6T_50_STATE_JURISDICTION_CERTIFICATION.md"))).toBe(true);
  });
});

describe("C2A baseline artifacts", () => {
  it("records the 10-state real-corpus run without nationwide claim", () => {
    const c2a = JSON.parse(readFileSync(join(baselines, "BASELINE_6T_C2A_REAL_STATE_BATCH.json"), "utf8"));
    expect(c2a.id).toBe("BASELINE_6T_C2A_REAL_STATE_BATCH");
    expect(c2a.nationwideClaim).toBe("NO");
    expect(c2a.statesEvaluated).toHaveLength(10);
    expect(c2a.environment.realPrimaryAuthorities).toBe(30);
    expect(c2a.totals.critical).toBe(0);
    expect(c2a.agents.certifiedByState).toBe(false);
    expect(existsSync(join(baselines, "PHASE_6T_C2A_INITIAL_STATE_CERTIFICATION.md"))).toBe(true);
  });
});
