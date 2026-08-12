import { describe, expect, it, vi } from "vitest";
import type { Database } from "@nyayagrid/database";
import { inferCapabilityFromFeature, inferWorkspaceFromFeature, recordUsage } from "./ai-usage";

function fakeDb(behavior: { returning: () => unknown[] } | { throwOnValues: Error }): Database {
  const insert = vi.fn(() => {
    if ("throwOnValues" in behavior) {
      return {
        values: vi.fn(() => {
          throw behavior.throwOnValues;
        }),
      };
    }
    return {
      values: vi.fn(() => ({
        returning: vi.fn(async () => behavior.returning()),
      })),
    };
  });
  return { insert } as unknown as Database;
}

describe("inferWorkspaceFromFeature / inferCapabilityFromFeature", () => {
  it("maps guide.* to the public workspace and guide capability", () => {
    expect(inferWorkspaceFromFeature("guide.ask")).toBe("public");
    expect(inferCapabilityFromFeature("guide.ask")).toBe("guide");
  });

  it("maps agent.* to the agents capability regardless of workspace", () => {
    expect(inferCapabilityFromFeature("agent.draft")).toBe("agents");
  });

  it("maps a feature with an organization to the professional workspace", () => {
    expect(inferWorkspaceFromFeature("nyaya.ask", "org_1")).toBe("professional");
    expect(inferWorkspaceFromFeature("nyaya.ask", null)).toBe("public");
  });
});

describe("recordUsage", () => {
  it("inserts a usage row carrying feature/latency/success in metadata", async () => {
    let capturedValues: Record<string, unknown> | undefined;
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          capturedValues = values;
          return { returning: vi.fn(async () => [{ id: "evt_1", ...values }]) };
        }),
      })),
    } as unknown as Database;

    const result = await recordUsage(db, {
      organizationId: "org_1",
      userId: "user_1",
      matterId: null,
      feature: "nyaya.ask",
      provider: "mock",
      model: "mock-1",
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 42,
      success: true,
    });

    expect(result).toMatchObject({ id: "evt_1" });
    expect(capturedValues?.workspace).toBe("professional");
    expect(capturedValues?.capability).toBe("qa");
    expect((capturedValues?.metadata as Record<string, unknown>)?.feature).toBe("nyaya.ask");
    expect((capturedValues?.metadata as Record<string, unknown>)?.latencyMs).toBe(42);
  });

  it("returns null without inserting when userId is missing", async () => {
    const insert = vi.fn();
    const db = { insert } as unknown as Database;

    const result = await recordUsage(db, {
      feature: "guide.ask",
      provider: "mock",
      model: "mock-1",
    });

    expect(result).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it("swallows errors and returns null instead of throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = fakeDb({ throwOnValues: new Error("db unavailable") });

    const result = await recordUsage(db, {
      userId: "user_1",
      feature: "nyaya.ask",
      provider: "mock",
      model: "mock-1",
    });

    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
