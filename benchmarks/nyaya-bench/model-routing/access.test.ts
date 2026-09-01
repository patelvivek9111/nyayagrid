import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { accessHasNoSecrets, inventoryProviderAccess } from "./access";
import { decideCertification, blockedExternalMeasurement } from "@nyayagrid/ai";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("provider access inventory", () => {
  it("reports presence without including secret values", () => {
    const record = inventoryProviderAccess({
      repoRoot,
      env: {
        OPENAI_API_KEY: "sk-this-must-never-appear-in-json",
        ANTHROPIC_API_KEY: "",
      },
    });
    expect(record.process.OPENAI_API_KEY).toBe("present");
    expect(record.process.ANTHROPIC_API_KEY).toBe("absent");
    expect(record.providers.find((p) => p.provider === "openai")?.status).toBe("AVAILABLE");
    expect(record.providers.find((p) => p.provider === "anthropic")?.status).toBe("BLOCKED_EXTERNAL");
    const json = JSON.stringify(record);
    expect(json).not.toContain("sk-this-must-never-appear-in-json");
    expect(accessHasNoSecrets(record)).toBe(true);
  });

  it("does not certify blocked providers", () => {
    expect(
      decideCertification(
        blockedExternalMeasurement({
          subsystem: "research",
          provider: "xai",
          modelId: "grok-3",
        }),
      ),
    ).toBe("CANDIDATE");
  });
});
