import { describe, expect, it } from "vitest";
import {
  classifyUsageFeature,
  designPartnerPlanPresentation,
  formatByteSize,
  formatTokenCount,
  isSuccessfulCustomerUsageRow,
  summarizeAiEventRows,
  usagePeriodBounds,
} from "./usage-summary";

describe("usagePeriodBounds", () => {
  it("uses UTC calendar months", () => {
    const now = new Date("2026-09-15T18:00:00.000Z");
    const current = usagePeriodBounds("current", now);
    expect(current.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(current.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(current.label).toContain("Sep");
    const previous = usagePeriodBounds("previous", now);
    expect(previous.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(previous.end.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("classifyUsageFeature", () => {
  it("maps recorded capabilities without treating unknown work as Ask", () => {
    expect(classifyUsageFeature("qa", "nyaya.ask")).toBe("ask");
    expect(classifyUsageFeature("research", "research.query")).toBe("research");
    expect(classifyUsageFeature("draft", "draft.generate")).toBe("draft");
    expect(classifyUsageFeature("extraction", "analysis.compare")).toBe("compare");
    expect(classifyUsageFeature("extraction", "extraction.analysis")).toBe("analysis");
    expect(classifyUsageFeature("embeddings", "embedding")).toBe("processing");
    expect(classifyUsageFeature("qa", "document.processing")).toBe("processing");
    expect(classifyUsageFeature("guide", "guide.ask")).toBe("other");
  });
});

describe("summarizeAiEventRows", () => {
  it("counts one Ask action even when fallback metadata is present on a single audit", () => {
    const summary = summarizeAiEventRows([
      {
        capability: "qa",
        inputTokens: 100,
        outputTokens: 20,
        embeddingTokens: 0,
        usageActionId: "ua-ask-1",
        metadata: { feature: "nyaya.ask", fallbackCount: 1, finalStatus: "ok" },
      },
    ]);
    expect(summary.modelRequests).toBe(1);
    expect(summary.modelCalls).toBe(1);
    expect(summary.byFeature.ask).toBe(1);
  });

  it("counts one Research action across three model calls sharing usageActionId", () => {
    const usageActionId = "ua-research-multi";
    const summary = summarizeAiEventRows([
      {
        capability: "research",
        inputTokens: 10,
        outputTokens: 2,
        embeddingTokens: 0,
        usageActionId,
        metadata: { feature: "research.query", finalStatus: "ok" },
      },
      {
        capability: "research",
        inputTokens: 20,
        outputTokens: 4,
        embeddingTokens: 0,
        usageActionId,
        metadata: { feature: "research.query", finalStatus: "ok" },
      },
      {
        capability: "research",
        inputTokens: 200,
        outputTokens: 40,
        embeddingTokens: 5,
        usageActionId,
        metadata: { feature: "research.query", finalStatus: "ok", fallbackCount: 1 },
      },
    ]);
    expect(summary.modelRequests).toBe(1);
    expect(summary.modelCalls).toBe(3);
    expect(summary.byFeature.research).toBe(1);
    expect(summary.inputTokens).toBe(230);
    expect(summary.outputTokens).toBe(46);
    expect(summary.totalTokens).toBe(281);
  });

  it("counts one Draft action for nested calls under the same usageActionId", () => {
    const usageActionId = "ua-draft-1";
    const summary = summarizeAiEventRows([
      {
        capability: "draft",
        inputTokens: 50,
        outputTokens: 100,
        embeddingTokens: 0,
        usageActionId,
        metadata: { feature: "draft.generate", finalStatus: "ok" },
      },
      {
        capability: "draft",
        inputTokens: 10,
        outputTokens: 20,
        embeddingTokens: 0,
        usageActionId,
        metadata: { feature: "draft.generate", finalStatus: "ok" },
      },
    ]);
    expect(summary.modelRequests).toBe(1);
    expect(summary.byFeature.draft).toBe(1);
    expect(summary.inputTokens).toBe(60);
    expect(summary.outputTokens).toBe(120);
  });

  it("counts Analysis and Compare as distinct customer actions", () => {
    const summary = summarizeAiEventRows([
      {
        capability: "extraction",
        inputTokens: 30,
        outputTokens: 10,
        embeddingTokens: 0,
        usageActionId: "ua-analysis-1",
        metadata: { feature: "extraction.analysis", finalStatus: "ok" },
      },
      {
        capability: "extraction",
        inputTokens: 40,
        outputTokens: 12,
        embeddingTokens: 0,
        usageActionId: "ua-compare-1",
        metadata: { feature: "analysis.compare", finalStatus: "ok" },
      },
    ]);
    expect(summary.modelRequests).toBe(2);
    expect(summary.byFeature.analysis).toBe(1);
    expect(summary.byFeature.compare).toBe(1);
  });

  it("does not inflate customer actions for retry or fallback rows under one action", () => {
    const usageActionId = "ua-ask-retry";
    const summary = summarizeAiEventRows([
      {
        capability: "qa",
        inputTokens: 5,
        outputTokens: 0,
        embeddingTokens: 0,
        usageActionId,
        metadata: { feature: "nyaya.ask", success: false, finalStatus: "unavailable" },
      },
      {
        capability: "qa",
        inputTokens: 50,
        outputTokens: 10,
        embeddingTokens: 0,
        usageActionId,
        metadata: { feature: "nyaya.ask", success: true, finalStatus: "ok", fallbackCount: 2 },
      },
    ]);
    expect(summary.modelRequests).toBe(1);
    expect(summary.modelCalls).toBe(2);
    expect(summary.byFeature.ask).toBe(1);
    expect(summary.inputTokens).toBe(55);
  });

  it("excludes failed-only actions from customer counts while retaining tokens", () => {
    const summary = summarizeAiEventRows([
      {
        capability: "qa",
        inputTokens: 12,
        outputTokens: 0,
        embeddingTokens: 0,
        usageActionId: "ua-failed",
        metadata: { feature: "nyaya.ask", success: false, finalStatus: "unavailable" },
      },
    ]);
    expect(summary.modelRequests).toBe(0);
    expect(summary.modelCalls).toBe(1);
    expect(summary.byFeature.ask).toBe(0);
    expect(summary.inputTokens).toBe(12);
  });

  it("treats legacy rows without usageActionId as one action each", () => {
    const summary = summarizeAiEventRows([
      {
        capability: "qa",
        inputTokens: 100,
        outputTokens: 20,
        embeddingTokens: 0,
        metadata: { feature: "nyaya.ask" },
      },
      {
        capability: "qa",
        inputTokens: 50,
        outputTokens: 10,
        embeddingTokens: 0,
        metadata: { feature: "nyaya.ask" },
      },
      {
        capability: "research",
        inputTokens: 200,
        outputTokens: 40,
        embeddingTokens: 5,
        metadata: { feature: "research.query" },
      },
    ]);
    expect(summary.modelRequests).toBe(3);
    expect(summary.modelCalls).toBe(3);
    expect(summary.hasLegacyActions).toBe(true);
    expect(summary.byFeature.ask).toBe(2);
    expect(summary.byFeature.research).toBe(1);
    expect(summary.inputTokens).toBe(350);
    expect(summary.outputTokens).toBe(70);
    expect(summary.totalTokens).toBe(425);
    expect(summary).not.toHaveProperty("estimatedCostCents");
  });

  it("counts one document processing action per upload row", () => {
    const summary = summarizeAiEventRows([
      {
        capability: "qa",
        inputTokens: 0,
        outputTokens: 0,
        embeddingTokens: 0,
        usageActionId: "ua-doc-1",
        metadata: { feature: "document.processing", success: true },
      },
    ]);
    expect(summary.modelRequests).toBe(1);
    expect(summary.byFeature.processing).toBe(1);
  });

  it("does not treat missing tokens as a precise total", () => {
    const summary = summarizeAiEventRows([
      {
        capability: "qa",
        inputTokens: 0,
        outputTokens: 0,
        embeddingTokens: 0,
        usageActionId: "ua-ask-zero",
        metadata: { feature: "nyaya.ask" },
      },
    ]);
    expect(summary.modelRequests).toBe(1);
    expect(summary.totalTokens).toBe(0);
  });

  it("sums the five customer features once each for the verification matrix", () => {
    const summary = summarizeAiEventRows([
      {
        capability: "qa",
        inputTokens: 1,
        outputTokens: 1,
        embeddingTokens: 0,
        usageActionId: "ua-1",
        metadata: { feature: "nyaya.ask", finalStatus: "ok" },
      },
      {
        capability: "research",
        inputTokens: 1,
        outputTokens: 1,
        embeddingTokens: 0,
        usageActionId: "ua-2a",
        metadata: { feature: "research.query", finalStatus: "ok" },
      },
      {
        capability: "research",
        inputTokens: 9,
        outputTokens: 9,
        embeddingTokens: 0,
        usageActionId: "ua-2a",
        metadata: { feature: "research.query", finalStatus: "ok" },
      },
      {
        capability: "draft",
        inputTokens: 1,
        outputTokens: 1,
        embeddingTokens: 0,
        usageActionId: "ua-3",
        metadata: { feature: "draft.generate", finalStatus: "ok" },
      },
      {
        capability: "extraction",
        inputTokens: 1,
        outputTokens: 1,
        embeddingTokens: 0,
        usageActionId: "ua-4",
        metadata: { feature: "extraction.analysis", finalStatus: "ok" },
      },
      {
        capability: "extraction",
        inputTokens: 1,
        outputTokens: 1,
        embeddingTokens: 0,
        usageActionId: "ua-5",
        metadata: { feature: "analysis.compare", finalStatus: "ok" },
      },
    ]);
    expect(summary.modelRequests).toBe(5);
    expect(summary.modelCalls).toBe(6);
    expect(summary.byFeature.ask).toBe(1);
    expect(summary.byFeature.research).toBe(1);
    expect(summary.byFeature.draft).toBe(1);
    expect(summary.byFeature.analysis).toBe(1);
    expect(summary.byFeature.compare).toBe(1);
    expect(summary.inputTokens).toBe(14);
    expect(summary.outputTokens).toBe(14);
  });
});

describe("isSuccessfulCustomerUsageRow", () => {
  it("rejects unavailable and explicit failure rows", () => {
    expect(
      isSuccessfulCustomerUsageRow({
        capability: "qa",
        inputTokens: 0,
        outputTokens: 0,
        embeddingTokens: 0,
        metadata: { success: false },
      }),
    ).toBe(false);
    expect(
      isSuccessfulCustomerUsageRow({
        capability: "qa",
        inputTokens: 0,
        outputTokens: 0,
        embeddingTokens: 0,
        metadata: { finalStatus: "unavailable" },
      }),
    ).toBe(false);
    expect(
      isSuccessfulCustomerUsageRow({
        capability: "qa",
        inputTokens: 0,
        outputTokens: 0,
        embeddingTokens: 0,
        metadata: { finalStatus: "ok" },
      }),
    ).toBe(true);
  });
});

describe("display helpers", () => {
  it("formats compact token and storage labels", () => {
    expect(formatTokenCount(142)).toBe("142");
    expect(formatTokenCount(1_800_000)).toBe("1.8M");
    expect(formatByteSize(1.6 * 1024 * 1024 * 1024)).toBe("1.6 GB");
  });
});

describe("designPartnerPlanPresentation", () => {
  it("does not invent commercial prices or seat numbers", () => {
    const plan = designPartnerPlanPresentation();
    expect(plan.billingLive).toBe(false);
    expect(plan.name).toBe("Design Partner Beta");
    expect(JSON.stringify(plan)).not.toMatch(/\$|stripe/i);
    expect(plan.seats).not.toMatch(/^\d+$/);
  });
});
