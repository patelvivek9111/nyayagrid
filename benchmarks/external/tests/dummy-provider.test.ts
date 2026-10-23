import { describe, expect, it } from "vitest";
import { FakeProvider } from "../src/providers/dummy.js";

describe("FakeProvider", () => {
  it("returns deterministic prefilled content", () => {
    const provider = new FakeProvider();
    const first = provider.complete({
      benchmarkId: "prbench",
      taskId: "prbench-synth-001",
      messages: [{ role: "user", content: "hello" }],
    });
    const second = provider.complete({
      benchmarkId: "prbench",
      taskId: "prbench-synth-001",
      messages: [{ role: "user", content: "different prompt" }],
    });
    expect(first.content).toBe(second.content);
    expect(first.content).toContain("contractor");
  });
});
