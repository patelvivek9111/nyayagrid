import { describe, expect, it } from "vitest";
import {
  deterministicSelectTasks,
  stratifiedDeterministicSelect,
  hashSelectionManifest,
} from "../src/prosecution-external/sampling.js";
import { DETERMINISTIC_SEED } from "../src/prosecution-external/constants.js";
import type { NormalizedTask } from "../src/schema/normalized-task.js";

function task(id: string, stratum: string): NormalizedTask {
  return {
    benchmarkId: "legalbench",
    taskId: id,
    metadata: { stratum },
    expectedAnswer: stratum,
  };
}

describe("prosecution external sampling", () => {
  it("is deterministic for the same seed", () => {
    const pool = Array.from({ length: 20 }, (_, i) => task(`t-${i}`, i % 2 === 0 ? "A" : "B"));
    const a = deterministicSelectTasks(pool, 8, DETERMINISTIC_SEED);
    const b = deterministicSelectTasks(pool, 8, DETERMINISTIC_SEED);
    expect(a.map((t) => t.taskId)).toEqual(b.map((t) => t.taskId));
  });

  it("stratifies across labels and prefers hard keys", () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => task(`sup-${i}`, "Supported")),
      ...Array.from({ length: 10 }, (_, i) => task(`ref-${i}`, "Refuted")),
      ...Array.from({ length: 4 }, (_, i) => task(`ovr-${i}`, "Overruled")),
    ];
    const selected = stratifiedDeterministicSelect(
      pool,
      9,
      "stratum",
      `${DETERMINISTIC_SEED}:casefacts`,
      ["Overruled", "Refuted"],
    );
    expect(selected).toHaveLength(9);
    expect(selected.some((t) => t.metadata?.stratum === "Overruled")).toBe(true);
    expect(selected.some((t) => t.metadata?.stratum === "Refuted")).toBe(true);
  });

  it("hashes selection manifests stably", () => {
    const h1 = hashSelectionManifest(["a", "b"], DETERMINISTIC_SEED);
    const h2 = hashSelectionManifest(["a", "b"], DETERMINISTIC_SEED);
    expect(h1).toBe(h2);
    expect(hashSelectionManifest(["b", "a"], DETERMINISTIC_SEED)).not.toBe(h1);
  });
});
