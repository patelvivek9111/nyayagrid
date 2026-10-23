import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { invokeLlmJudge, scorePrefilledRubricResponse } from "../src/scorers/prbench-rubric.js";
import { parseNormalizedTasks } from "../src/schema/normalized-task.js";
import { getFixturesDir } from "../src/paths.js";

describe("prbench-rubric", () => {
  it("scores prefilled fixture response", () => {
    const raw = JSON.parse(
      readFileSync(path.join(getFixturesDir(), "prbench-like.json"), "utf8"),
    ) as { tasks: unknown; prefilledResponses: Record<string, string> };
    const tasks = parseNormalizedTasks(raw.tasks);
    const task = tasks[0]!;
    const response = raw.prefilledResponses[task.taskId]!;
    const result = scorePrefilledRubricResponse({ task, responseText: response });
    expect(result.weightedScore).toBeGreaterThan(0);
  });

  it("blocks LLM judge without paid auth", () => {
    expect(() => invokeLlmJudge()).toThrow(/EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS/);
  });
});
