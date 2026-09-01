import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

describe("ground-truth load is gated", () => {
  it("keeps catalog, ingest, and execute free of hidden-key reads", () => {
    expect(source("runner/catalog.ts")).not.toMatch(/loadGroundTruth/);
    expect(source("runner/ingest.ts")).not.toMatch(/loadGroundTruth/);
    expect(source("runner/execute.ts")).not.toMatch(/loadGroundTruth/);
    expect(source("runner/execute-subsystems.ts")).not.toMatch(/loadGroundTruth/);
    expect(source("runner/adapt-structured.ts")).not.toMatch(/loadGroundTruth/);
    expect(source("runner/execute-subsystems.ts")).not.toMatch(/hidden_ground_truth/);
    expect(source("runner/execute-memory.ts")).not.toMatch(/loadGroundTruth|hidden_ground_truth/);
    expect(source("runner/execute-analysis.ts")).not.toMatch(/loadGroundTruth|hidden_ground_truth/);
    expect(source("runner/execute-evidence.ts")).not.toMatch(/loadGroundTruth|hidden_ground_truth/);
    expect(source("runner/execute-draft.ts")).not.toMatch(/loadGroundTruth|hidden_ground_truth/);
    expect(source("runner/execute-graph.ts")).not.toMatch(/loadGroundTruth|hidden_ground_truth/);
    expect(source("runner/execute-research.ts")).not.toMatch(/loadGroundTruth|hidden_ground_truth/);
    expect(source("runner/execute-agents.ts")).not.toMatch(/loadGroundTruth|hidden_ground_truth/);
    expect(source("runner/execute-full-system.ts")).not.toMatch(/loadGroundTruth|hidden_ground_truth/);
    expect(source("runner/adapt-structured.ts")).not.toMatch(/SYNTH-V2/);
  });

  it("keeps production Compare and Contradiction engines free of benchmark graders", () => {
    const compare = source("../../packages/intelligence/src/analysis/compare.ts");
    const contradiction = source("../../packages/intelligence/src/analysis/deposition.ts");
    expect(compare).not.toMatch(/loadGroundTruth|nyaya-bench|SYNTH-V2/);
    expect(contradiction).not.toMatch(/loadGroundTruth|nyaya-bench|SYNTH-V2/);
  });

  it("loads keys only from graders after persist asserts the answer file", () => {
    const run = source("runner/run.ts");
    expect(run).toMatch(/persistAnswer\(runDir, persisted\)/);
    expect(run).toMatch(/assertAnswerPersisted/);
    expect(run.indexOf("persistAnswer(runDir, persisted)")).toBeLessThan(
      run.indexOf("gradePersistedTask", run.indexOf("persistAnswer(runDir, persisted)")),
    );
    const gate = source("runner/run.ts").slice(
      source("runner/run.ts").indexOf("function gradePersistedTask"),
    );
    expect(gate.indexOf("assertAnswerPersisted")).toBeLessThan(gate.indexOf("loadGroundTruth"));
  });
});
