import { describe, expect, it } from "vitest";
import { resolveAskModelRouting, sanitizeAskClientModelId } from "./ask-routing.js";

describe("resolveAskModelRouting", () => {
  it("classifies linked criminal case as prosecution high-stakes", () => {
    const d = resolveAskModelRouting({
      linkedCriminalCaseId: "case-1",
      workspaceType: "professional", // client cannot downgrade
    });
    expect(d.workspaceType).toBe("prosecution");
    expect(d.subsystem).toBe("prosecution");
    expect(d.highStakesLegal).toBe(true);
    expect(d.classificationSource).toBe("LINKED_CRIMINAL_CASE");
  });

  it("classifies professional Ask as high-stakes ask subsystem", () => {
    const d = resolveAskModelRouting({});
    expect(d.workspaceType).toBe("professional");
    expect(d.subsystem).toBe("ask");
    expect(d.highStakesLegal).toBe(true);
  });

  it("uses research subsystem for professional research/web Ask", () => {
    const d = resolveAskModelRouting({ useResearchPrompt: true });
    expect(d.subsystem).toBe("research");
    expect(d.highStakesLegal).toBe(true);
  });

  it("keeps prosecution subsystem even when research prompt is set", () => {
    const d = resolveAskModelRouting({
      linkedCriminalCaseId: "case-1",
      useResearchPrompt: true,
    });
    expect(d.subsystem).toBe("prosecution");
  });
});

describe("sanitizeAskClientModelId", () => {
  it("strips client modelId for high-stakes when router v2 is on", () => {
    expect(
      sanitizeAskClientModelId({
        modelId: "openai:gpt-6.1-sol",
        highStakesLegal: true,
        routerV2Enabled: true,
      }),
    ).toBeUndefined();
  });

  it("preserves modelId when router v2 is off", () => {
    expect(
      sanitizeAskClientModelId({
        modelId: "openai:gpt-6.1-sol",
        highStakesLegal: true,
        routerV2Enabled: false,
      }),
    ).toBe("openai:gpt-6.1-sol");
  });
});
