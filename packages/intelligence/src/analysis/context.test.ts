import { describe, expect, it } from "vitest";
import {
  askNyayaAnalysisTitles,
  buildProfessionalAnalysisContext,
  formatProfessionalAnalysisForPrompt,
  hasUsableAnalysisProvenance,
} from "./context";

const sourced = {
  documentId: "doc-1",
  documentVersionId: "ver-1",
  chunkId: "chunk-1",
  page: 2,
  segmentRef: "p2",
  supportingText: "Written notice of 45 days is required.",
};

function contractItem(overrides: {
  id: string;
  status: string;
  title: string;
  explanation?: string | null;
  category?: string;
  analysisId?: string;
}) {
  return {
    id: overrides.id,
    analysisId: overrides.analysisId ?? "analysis-1",
    category: overrides.category ?? "notice",
    title: overrides.title,
    explanation: overrides.explanation ?? null,
    status: overrides.status,
    reviewedAt: overrides.status === "reviewed" ? new Date("2026-08-19T12:00:00.000Z") : null,
  };
}

function finding(overrides: {
  id: string;
  status: string;
  title: string;
  explanation?: string | null;
  findingType?: string;
  analysisRunId?: string;
}) {
  return {
    id: overrides.id,
    analysisRunId: overrides.analysisRunId ?? "run-1",
    findingType: overrides.findingType ?? "admission",
    title: overrides.title,
    explanation: overrides.explanation ?? null,
    attention: "review",
    status: overrides.status,
    reviewedAt: overrides.status === "reviewed" ? new Date("2026-08-19T12:00:00.000Z") : null,
  };
}

function sourceForItem(analysisItemId: string, extra: Partial<typeof sourced> = {}) {
  return { analysisItemId, ...sourced, ...extra };
}

function sourceForFinding(findingId: string, extra: Partial<typeof sourced> = {}) {
  return { findingId, ...sourced, ...extra };
}

describe("Analysis Ask Nyaya trust boundary", () => {
  it("A. proposed contract analysis is absent from Ask Nyaya Analysis context", () => {
    const ctx = buildProfessionalAnalysisContext({
      contractItems: [
        contractItem({
          id: "p1",
          status: "proposed",
          title: "Mercer entered the records room.",
        }),
      ],
      contractItemSources: [sourceForItem("p1")],
    });
    expect(ctx.reviewedContractItems).toEqual([]);
    expect(formatProfessionalAnalysisForPrompt(ctx)).not.toContain("Mercer entered");
    expect(askNyayaAnalysisTitles(ctx).proposed).toEqual([]);
  });

  it("B. proposed contract summary never enters, even if mixed with reviewed items", () => {
    const ctx = buildProfessionalAnalysisContext({
      contractItems: [
        contractItem({
          id: "r1",
          status: "reviewed",
          title: "Formal notice requires 45 days.",
        }),
        contractItem({
          id: "p1",
          status: "proposed",
          title: "Amendment 1 applied retroactively.",
        }),
      ],
      contractItemSources: [sourceForItem("r1"), sourceForItem("p1")],
    });
    const text = formatProfessionalAnalysisForPrompt(ctx);
    expect(text).not.toContain("applied retroactively");
    expect(text).not.toMatch(/Reviewed\/available contract analyses/i);
    expect(text).not.toMatch(/proposedItems=/i);
    expect(text).not.toContain("summary=");
  });

  it("C. proposed contract item is absent", () => {
    const ctx = buildProfessionalAnalysisContext({
      contractItems: [
        contractItem({ id: "p1", status: "proposed", title: "The client paid the invoice." }),
      ],
      contractItemSources: [sourceForItem("p1")],
    });
    expect(formatProfessionalAnalysisForPrompt(ctx)).not.toContain("paid the invoice");
  });

  it("D. reviewed contract item is present and labeled as reviewed Analysis", () => {
    const ctx = buildProfessionalAnalysisContext({
      contractItems: [
        contractItem({
          id: "r1",
          status: "reviewed",
          title: "Formal notice requires 45 days.",
          explanation: "Section 4 of the agreement.",
          category: "notice",
        }),
      ],
      contractItemSources: [sourceForItem("r1")],
    });
    const text = formatProfessionalAnalysisForPrompt(ctx);
    expect(text).toContain("[REVIEWED ANALYSIS]");
    expect(text).toContain("category=notice");
    expect(text).toContain("Formal notice requires 45 days.");
    expect(text).toContain("secondary interpretation");
    expect(text).not.toMatch(/verified evidence/i);
    expect(text).not.toMatch(/established fact/i);
    expect(askNyayaAnalysisTitles(ctx).reviewed).toEqual(["Formal notice requires 45 days."]);
  });

  it("E. mixed analysis: only the reviewed item of 25 enters", () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      contractItem({
        id: `item-${index}`,
        status: index === 0 ? "reviewed" : "proposed",
        title:
          index === 0
            ? "Formal notice requires 45 days."
            : `Proposed claim ${index}: The liability cap is $510,000.`,
        explanation:
          index === 0 ? "Reviewed notice term." : `Unreviewed summary fragment ${index}.`,
      }),
    );
    const ctx = buildProfessionalAnalysisContext({
      contractItems: items,
      contractItemSources: items.map((item) => sourceForItem(item.id)),
    });
    expect(ctx.reviewedContractItems).toHaveLength(1);
    expect(ctx.reviewedContractItems[0]?.id).toBe("item-0");
    const text = formatProfessionalAnalysisForPrompt(ctx);
    expect(text).toContain("Formal notice requires 45 days.");
    expect(text).not.toContain("$510,000");
    expect(text).not.toContain("Unreviewed summary fragment");
    expect(askNyayaAnalysisTitles(ctx).reviewed).toHaveLength(1);
  });

  it("F. dismissed contract item is absent", () => {
    const ctx = buildProfessionalAnalysisContext({
      contractItems: [
        contractItem({
          id: "d1",
          status: "dismissed",
          title: "No service credit was ever issued.",
        }),
      ],
      contractItemSources: [sourceForItem("d1")],
    });
    expect(formatProfessionalAnalysisForPrompt(ctx)).not.toContain("service credit");
  });

  it("G. proposed analysis_finding is absent", () => {
    const ctx = buildProfessionalAnalysisContext({
      findings: [finding({ id: "f1", status: "proposed", title: "Mercer entered the records room." })],
      findingSources: [sourceForFinding("f1")],
      findingRuns: [{ id: "run-1", runType: "deposition" }],
    });
    expect(ctx.reviewedFindings).toEqual([]);
    expect(formatProfessionalAnalysisForPrompt(ctx)).not.toContain("Mercer entered");
    expect(formatProfessionalAnalysisForPrompt(ctx)).not.toContain("[PROPOSED/UNREVIEWED]");
  });

  it("H. reviewed analysis_finding is present", () => {
    const ctx = buildProfessionalAnalysisContext({
      findings: [
        finding({
          id: "f1",
          status: "reviewed",
          title: "Witness denied entering the records room.",
        }),
      ],
      findingSources: [sourceForFinding("f1")],
      findingRuns: [{ id: "run-1", runType: "deposition" }],
    });
    const text = formatProfessionalAnalysisForPrompt(ctx);
    expect(ctx.reviewedFindings).toHaveLength(1);
    expect(text).toContain("[REVIEWED ANALYSIS]");
    expect(text).toContain("Witness denied entering the records room.");
    expect(text).not.toMatch(/verified evidence/i);
  });

  it("I. dismissed analysis_finding is absent", () => {
    const ctx = buildProfessionalAnalysisContext({
      findings: [
        finding({ id: "f1", status: "dismissed", title: "The client paid the invoice." }),
      ],
      findingSources: [sourceForFinding("f1")],
    });
    expect(formatProfessionalAnalysisForPrompt(ctx)).not.toContain("paid the invoice");
  });

  it("J. reviewed item provenance is preserved", () => {
    const ctx = buildProfessionalAnalysisContext({
      contractItems: [
        contractItem({ id: "r1", status: "reviewed", title: "Formal notice requires 45 days." }),
      ],
      contractItemSources: [sourceForItem("r1")],
    });
    const text = formatProfessionalAnalysisForPrompt(ctx);
    expect(text).toContain("documentId=doc-1");
    expect(text).toContain("documentVersionId=ver-1");
    expect(text).toContain("chunkId=chunk-1");
    expect(text).toContain("page=2");
    expect(text).toContain("segmentRef=p2");
    expect(text).toContain("Written notice of 45 days is required.");
    expect(ctx.reviewedContractItems[0]?.sources[0]).toMatchObject({
      documentId: "doc-1",
      chunkId: "chunk-1",
      page: 2,
    });
  });

  it("K. proposed summary containing a dangerous claim is absent from formatted context", () => {
    const ctx = buildProfessionalAnalysisContext({
      contractItems: [
        contractItem({
          id: "p1",
          status: "proposed",
          title: "Notice",
          explanation: "Mercer entered the records room. Amendment 1 applied retroactively.",
        }),
      ],
      contractItemSources: [sourceForItem("p1")],
    });
    const text = formatProfessionalAnalysisForPrompt(ctx);
    expect(text).not.toContain("Mercer entered the records room.");
    expect(text).not.toContain("applied retroactively");
    expect(text).not.toContain("The liability cap is $510,000.");
  });

  it("L. zero reviewed items yields no contract Analysis factual context", () => {
    const ctx = buildProfessionalAnalysisContext({
      contractItems: Array.from({ length: 8 }, (_, index) =>
        contractItem({
          id: `p${index}`,
          status: "proposed",
          title: `Proposed item ${index}: The client paid the invoice.`,
        }),
      ),
      contractItemSources: Array.from({ length: 8 }, (_, index) => sourceForItem(`p${index}`)),
    });
    const text = formatProfessionalAnalysisForPrompt(ctx);
    expect(text).toBe("");
    expect(text).not.toContain("[REVIEWED ANALYSIS]");
    expect(text).not.toContain("paid the invoice");
  });

  it("excludes reviewed items that lack usable provenance", () => {
    expect(
      hasUsableAnalysisProvenance({
        documentId: "doc-1",
        documentVersionId: null,
        chunkId: null,
        page: null,
        segmentRef: null,
        supportingText: "no chunk",
      }),
    ).toBe(false);
    const ctx = buildProfessionalAnalysisContext({
      contractItems: [
        contractItem({ id: "r1", status: "reviewed", title: "No service credit was ever issued." }),
      ],
      contractItemSources: [
        {
          analysisItemId: "r1",
          documentId: "",
          chunkId: null,
          supportingText: "No service credit was ever issued.",
        },
      ],
    });
    expect(ctx.reviewedContractItems).toEqual([]);
    expect(formatProfessionalAnalysisForPrompt(ctx)).not.toContain("service credit");
  });

  it("lifecycle: proposed then reviewed then dismissed", () => {
    const proposed = buildProfessionalAnalysisContext({
      contractItems: [contractItem({ id: "x", status: "proposed", title: "The client paid the invoice." })],
      contractItemSources: [sourceForItem("x")],
    });
    expect(formatProfessionalAnalysisForPrompt(proposed)).not.toContain("paid the invoice");

    const reviewed = buildProfessionalAnalysisContext({
      contractItems: [contractItem({ id: "x", status: "reviewed", title: "The client paid the invoice." })],
      contractItemSources: [sourceForItem("x")],
    });
    expect(formatProfessionalAnalysisForPrompt(reviewed)).toContain("The client paid the invoice.");

    const dismissed = buildProfessionalAnalysisContext({
      contractItems: [contractItem({ id: "x", status: "dismissed", title: "The client paid the invoice." })],
      contractItemSources: [sourceForItem("x")],
    });
    expect(formatProfessionalAnalysisForPrompt(dismissed)).not.toContain("paid the invoice");
  });

  it("reviewed item A is present while proposed item B is absent", () => {
    const ctx = buildProfessionalAnalysisContext({
      contractItems: [
        contractItem({ id: "a", status: "reviewed", title: "Formal notice requires 45 days." }),
        contractItem({ id: "b", status: "proposed", title: "Amendment 1 applied retroactively." }),
      ],
      contractItemSources: [sourceForItem("a"), sourceForItem("b")],
    });
    const text = formatProfessionalAnalysisForPrompt(ctx);
    expect(text).toContain("Formal notice requires 45 days.");
    expect(text).not.toContain("applied retroactively");
  });
});
