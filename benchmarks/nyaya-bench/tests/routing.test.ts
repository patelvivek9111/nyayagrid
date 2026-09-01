import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executionTargetFor, targetForCategory } from "../runner/routing";

const executeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../runner/execute-subsystems.ts"),
  "utf8",
);

describe("subsystem routing", () => {
  it("maps compare and contradiction categories in full-system mode", () => {
    expect(targetForCategory("contract_compare")).toBe("contract_compare");
    expect(targetForCategory("false_contradiction")).toBe("contradiction");
    expect(targetForCategory("timeline")).toBe("timeline");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "contract_compare",
          difficulty: "hard",
          prompt: "compare",
        },
        "case-qa",
      ),
    ).toBe("case_qa");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "contract_compare",
          difficulty: "hard",
          prompt: "compare",
        },
        "full-system",
      ),
    ).toBe("contract_compare");
  });

  it("maps compare-contradiction without scoring Case Q&A", () => {
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "contract_compare",
          difficulty: "hard",
          prompt: "compare",
        },
        "compare-contradiction",
      ),
    ).toBe("contract_compare");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "false_contradiction",
          difficulty: "hard",
          prompt: "dates",
        },
        "compare-contradiction",
      ),
    ).toBe("contradiction");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "case_qa",
          difficulty: "easy",
          prompt: "rent",
        },
        "compare-contradiction",
      ),
    ).toBe("not_applicable");
  });

  it("marks unmapped subsystem filters as not_applicable", () => {
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "case_qa",
          difficulty: "easy",
          prompt: "rent",
        },
        "graph",
      ),
    ).toBe("not_applicable");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "memory",
          difficulty: "hard",
          prompt: "memory",
        },
        "memory",
      ),
    ).toBe("memory");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "memory",
          difficulty: "hard",
          prompt: "memory",
        },
        "case-qa",
      ),
    ).toBe("case_qa");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "analysis",
          difficulty: "hard",
          prompt: "analyze",
        },
        "analysis",
      ),
    ).toBe("professional_analysis");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "case_qa",
          difficulty: "easy",
          prompt: "rent",
        },
        "analysis",
      ),
    ).toBe("not_applicable");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "deposition",
          difficulty: "hard",
          prompt: "analyze deposition",
        },
        "deposition",
      ),
    ).toBe("professional_analysis");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "analysis",
          difficulty: "hard",
          prompt: "analyze",
        },
        "deposition",
      ),
    ).toBe("not_applicable");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "contract",
          difficulty: "hard",
          prompt: "analyze contract",
        },
        "contract",
      ),
    ).toBe("professional_analysis");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "deposition",
          difficulty: "hard",
          prompt: "analyze deposition",
        },
        "contract",
      ),
    ).toBe("not_applicable");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "evidence",
          difficulty: "hard",
          prompt: "matrix",
        },
        "evidence",
      ),
    ).toBe("professional_analysis");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "analysis",
          difficulty: "hard",
          prompt: "analyze",
        },
        "evidence",
      ),
    ).toBe("not_applicable");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "draft",
          difficulty: "hard",
          prompt: "draft",
        },
        "draft",
      ),
    ).toBe("draft");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "analysis",
          difficulty: "hard",
          prompt: "analyze",
        },
        "draft",
      ),
    ).toBe("not_applicable");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "graph",
          difficulty: "hard",
          prompt: "graph",
        },
        "graph",
      ),
    ).toBe("graph");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "draft",
          difficulty: "hard",
          prompt: "draft",
        },
        "graph",
      ),
    ).toBe("not_applicable");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "research",
          difficulty: "hard",
          prompt: "research",
        },
        "research",
      ),
    ).toBe("research");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "agent",
          difficulty: "hard",
          prompt: "analyze",
        },
        "agents",
      ),
    ).toBe("agent");
    expect(
      executionTargetFor(
        {
          taskId: "x",
          scenarioId: "s",
          category: "full_system",
          difficulty: "hard",
          prompt: "workflow",
        },
        "full-system-fs",
      ),
    ).toBe("full_system");
  });
});

describe("analysis routing", () => {
  it("does not stand in generateDraft for analysis", () => {
    expect(executeSource).not.toMatch(/target === "draft" \|\| target === "analysis"/);
    expect(executeSource).toMatch(/is not a single production engine/);
  });
});
