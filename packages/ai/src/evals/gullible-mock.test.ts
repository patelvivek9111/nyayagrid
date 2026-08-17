import { describe, expect, it } from "vitest";
import { gradeCitedAnswer } from "./grade";
import { GRADED_CASES, gradedCaseToPrompt } from "./graded-cases";
import { contradictionCaseToPrompt } from "./graded-cases-contradiction";
import { gradeContradictionCase } from "./grade-contradiction";
import { GullibleMockProvider, decoyClaimPrompt, pickBaitPassages } from "./gullible-mock";
import { gradeGullibleDecoyClaim } from "./grade-gullible-decoy";
import {
  adversarialContradictionCases,
  adversarialQaCases,
  decoyContractCompareCases,
  evaluateStressHarness,
} from "./stress";
import { aggregateWorkflowRates } from "./metrics";

describe("GullibleMockProvider", () => {
  it("prefers the least-overlapping (decoy) passage", () => {
    const bait = pickBaitPassages("When does the lease term commence?", [
      {
        chunkId: "chunk_lease_term",
        documentId: "doc_lease",
        documentVersionId: "docv_lease_1",
        quote: "The lease term commences on January 1, 2024 and expires on December 31, 2026.",
      },
      {
        chunkId: "chunk_lease_rent",
        documentId: "doc_lease",
        documentVersionId: "docv_lease_1",
        quote: "Tenant shall pay Base Rent of four thousand dollars ($4,000) per month.",
      },
    ]);
    expect(bait.map((p) => p.chunkId)).toEqual(["chunk_lease_rent"]);
  });

  it("cites a forbidden decoy chunk on an existing graded case", async () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-lease-commencement");
    expect(testCase?.rubric.forbiddenChunkIds).toContain("chunk_lease_rent");
    const prompts = gradedCaseToPrompt(testCase!);
    const provider = new GullibleMockProvider();
    const result = await provider.generate({
      messages: [
        { role: "system", content: prompts.systemPrompt },
        { role: "user", content: prompts.userPrompt },
      ],
    });
    const grade = gradeCitedAnswer({
      caseId: testCase!.id,
      raw: JSON.parse(result.text),
      retrieved: testCase!.retrieved,
      rubric: testCase!.rubric,
      question: testCase!.question,
      shouldRefuse: testCase!.shouldRefuse,
      trapKind: testCase!.trapKind,
    });
    expect(grade.passed).toBe(false);
    expect(grade.dimensions.find((d) => d.name === "citation_relevance")?.passed).toBe(false);
    expect(grade.flags.citationRelevanceFailures).toBeGreaterThan(0);
  });

  it("emits a contradiction candidate on a one-sided reject fixture", async () => {
    const testCase = adversarialContradictionCases().find((c) => c.expectNoCandidates);
    expect(testCase).toBeDefined();
    const prompts = contradictionCaseToPrompt(testCase!);
    const provider = new GullibleMockProvider();
    const result = await provider.generate({
      messages: [
        { role: "system", content: prompts.systemPrompt },
        { role: "user", content: prompts.userPrompt },
      ],
    });
    const grade = gradeContradictionCase(testCase!, JSON.parse(result.text));
    expect(grade.passed).toBe(false);
    expect(grade.flags.falseConfidence).toBe(true);
  });

  it("treats contract-compare decoy needles as material high-attention changes", async () => {
    const testCase = decoyContractCompareCases()[0];
    expect(testCase).toBeDefined();
    const prompts = decoyClaimPrompt(
      testCase!.decoyNeedles ?? [],
      testCase!.original ?? "",
      testCase!.redline ?? "",
    );
    const provider = new GullibleMockProvider();
    const result = await provider.generate({
      messages: [
        { role: "system", content: prompts.systemPrompt },
        { role: "user", content: prompts.userPrompt },
      ],
    });
    const flags = gradeGullibleDecoyClaim(testCase!, result.text);
    expect(flags.passed).toBe(false);
    expect(flags.falseConfidence).toBe(true);
  });
});

describe("stress harness gate", () => {
  it("fails when all three bait rates are zero", () => {
    const result = evaluateStressHarness([
      aggregateWorkflowRates("case_qa", [
        {
          workflow: "case_qa",
          caseId: "a",
          passed: true,
          attemptedCites: 1,
          validCites: 1,
          fabricatedCites: 0,
          falseInsufficient: false,
          falseConfidence: false,
          citationRelevanceChecked: true,
          citationRelevanceFailures: 0,
        },
      ]),
      aggregateWorkflowRates("contradiction", []),
      aggregateWorkflowRates("contract_compare", [
        {
          workflow: "contract_compare",
          caseId: "cc-decoy-spelling-labelled",
          passed: true,
          attemptedCites: 1,
          validCites: 1,
          fabricatedCites: 0,
          falseInsufficient: false,
          falseConfidence: false,
        },
      ]),
    ]);
    expect(result.ok).toBe(false);
    expect(result.misses.length).toBeGreaterThanOrEqual(3);
  });

  it("the adversarial subset is large enough to exercise all three traps", () => {
    expect(adversarialQaCases().length).toBeGreaterThanOrEqual(8);
    expect(adversarialQaCases().some((c) => (c.rubric.forbiddenChunkIds?.length ?? 0) > 0)).toBe(
      true,
    );
    expect(adversarialContradictionCases().some((c) => c.expectNoCandidates)).toBe(true);
    expect(decoyContractCompareCases().length).toBeGreaterThanOrEqual(4);
  });
});
