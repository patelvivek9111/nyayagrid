import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const control = readFileSync(
  resolve(__dirname, "../components/ux/execution-strategy-control.tsx"),
  "utf8",
);
const nyaya = readFileSync(resolve(__dirname, "../app/app/cases/[matterId]/nyaya/page.tsx"), "utf8");
const research = readFileSync(resolve(__dirname, "../app/app/research/page.tsx"), "utf8");
const draft = readFileSync(resolve(__dirname, "../app/app/cases/[matterId]/draft/page.tsx"), "utf8");
const askRoute = readFileSync(
  resolve(__dirname, "../app/api/v1/matters/[matterId]/ask/route.ts"),
  "utf8",
);

describe("execution strategy UX", () => {
  it("defaults to Auto with Fast and Deep Review, and does not claim multi-AI accuracy", () => {
    expect(control).toContain('"Auto"');
    expect(control).toContain('"Fast"');
    expect(control).toContain('"Deep Review"');
    expect(control).toContain("Nyaya selects a validated model and verification strategy for this task.");
    expect(control).toContain("Uses additional verification for higher-stakes work and may take longer.");
    expect(control).not.toContain("multiple AIs guarantee");
    expect(control).toContain("Advanced");
  });

  it("wires Ask, Research, and Draft through the control and server-enforced fields", () => {
    expect(nyaya).toContain("ExecutionStrategyControl");
    expect(nyaya).toContain("executionStrategy");
    expect(research).toContain("ExecutionStrategyControl");
    expect(draft).toContain("ExecutionStrategyControl");
    expect(askRoute).toContain("body.executionStrategy");
    expect(askRoute).toContain("body.modelId");
  });
});
