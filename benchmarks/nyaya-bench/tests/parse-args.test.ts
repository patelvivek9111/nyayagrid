import { describe, expect, it } from "vitest";
import { parseArgs } from "../runner/run";

describe("parseArgs", () => {
  it("lists by default", () => {
    expect(parseArgs(["v1"]).listOnly).toBe(true);
    expect(parseArgs(["v1", "list"]).dataset).toBe("v1");
  });

  it("parses a single-task run", () => {
    const options = parseArgs(["v1", "run", "SYNTH-001", "SYNTH-001-Q001"]);
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v1");
    expect(options.scenarioId).toBe("SYNTH-001");
    expect(options.taskId).toBe("SYNTH-001-Q001");
  });

  it("parses replay", () => {
    expect(parseArgs(["replay", "reports/runs/abc"]).replayRunDir).toBe("reports/runs/abc");
  });

  it("parses regrade of persisted runs", () => {
    const options = parseArgs(["regrade", "2026-08-18T03-14-16-862Z", "2026-08-18T03-20-13-556Z"]);
    expect(options.regradeRunDirs).toEqual([
      "2026-08-18T03-14-16-862Z",
      "2026-08-18T03-20-13-556Z",
    ]);
    expect(options.listOnly).toBe(false);
  });

  it("parses compare-contradiction as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "compare-contradiction"]);
    expect(options.executionMode).toBe("compare-contradiction");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
    expect(options.scenarioId).toBeUndefined();
  });

  it("parses smoke-subsystems", () => {
    const options = parseArgs(["smoke-subsystems"]);
    expect(options.smokeSubsystems).toBe(true);
    expect(options.listOnly).toBe(false);
  });

  it("parses graph-only subsystem smoke", () => {
    const fromFlag = parseArgs(["smoke-subsystems", "--smoke-target", "graph"]);
    expect(fromFlag.smokeSubsystems).toBe(true);
    expect(fromFlag.smokeTarget).toBe("graph");
    expect(fromFlag.scenarioId).toBe("SYNTH-001");

    const fromPositional = parseArgs(["smoke-subsystems", "graph"]);
    expect(fromPositional.smokeSubsystems).toBe(true);
    expect(fromPositional.smokeTarget).toBe("graph");
    expect(fromPositional.scenarioId).toBe("SYNTH-001");
  });

  it("parses analysis as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "analysis"]);
    expect(options.executionMode).toBe("analysis");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
    expect(options.scenarioId).toBeUndefined();
    expect(options.extractIntelligence).toBeFalsy();
  });

  it("parses deposition as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "deposition"]);
    expect(options.executionMode).toBe("deposition");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
    expect(options.extractIntelligence).toBeFalsy();
  });

  it("parses contract as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "contract"]);
    expect(options.executionMode).toBe("contract");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
    expect(options.extractIntelligence).toBeFalsy();
  });

  it("parses evidence as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "evidence"]);
    expect(options.executionMode).toBe("evidence");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
  });

  it("parses draft as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "draft"]);
    expect(options.executionMode).toBe("draft");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
  });

  it("parses graph as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "graph"]);
    expect(options.executionMode).toBe("graph");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
    expect(options.extractIntelligence).toBeFalsy();
  });

  it("parses research as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "research"]);
    expect(options.executionMode).toBe("research");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
    expect(options.extractIntelligence).toBeFalsy();
  });

  it("parses agents as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "agents"]);
    expect(options.executionMode).toBe("agents");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
  });

  it("parses full-system-fs as a positional mode after run", () => {
    const options = parseArgs(["v2", "run", "full-system-fs"]);
    expect(options.executionMode).toBe("full-system-fs");
    expect(options.listOnly).toBe(false);
    expect(options.dataset).toBe("v2");
  });
});
