import { describe, expect, it } from "vitest";
import {
  classifyUsageFeature,
  designPartnerPlanPresentation,
  formatByteSize,
  formatTokenCount,
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
  it("counts one customer feature row per persisted model audit, including fallback metadata", () => {
    const summary = summarizeAiEventRows([
      {
        capability: "qa",
        inputTokens: 100,
        outputTokens: 20,
        embeddingTokens: 0,
        metadata: { feature: "nyaya.ask", fallbackCount: 1, finalStatus: "ok" },
      },
    ]);
    expect(summary.modelRequests).toBe(1);
    expect(summary.byFeature.ask).toBe(1);
  });

  it("counts model calls and tokens without inventing cost", () => {
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
    expect(summary.byFeature.ask).toBe(2);
    expect(summary.byFeature.research).toBe(1);
    expect(summary.inputTokens).toBe(350);
    expect(summary.outputTokens).toBe(70);
    expect(summary.totalTokens).toBe(425);
    expect(summary).not.toHaveProperty("estimatedCostCents");
  });

  it("does not treat missing tokens as a precise total", () => {
    const summary = summarizeAiEventRows([
      {
        capability: "qa",
        inputTokens: 0,
        outputTokens: 0,
        embeddingTokens: 0,
        metadata: { feature: "nyaya.ask" },
      },
    ]);
    expect(summary.modelRequests).toBe(1);
    expect(summary.totalTokens).toBe(0);
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
