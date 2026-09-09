import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accessHasNoSecrets, inventoryProviderAccess } from "./access";
import { scenarioIdForSubsystem } from "./scenario";
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

  it("routes deposition overlay to frozen SYNTH-V2-006", () => {
    expect(scenarioIdForSubsystem("deposition")).toBe("SYNTH-V2-006");
    expect(scenarioIdForSubsystem("research")).toBe("SYNTH-V2-001");
    expect(scenarioIdForSubsystem("ask")).toBe("SYNTH-V2-001");
  });

  it("treats commented-empty dotenv keys as absent and never returns values", () => {
    const record = inventoryProviderAccess({
      repoRoot,
      env: {
        OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: "   ",
      },
    });
    expect(record.process.OPENAI_API_KEY).toBe("absent");
    expect(record.process.ANTHROPIC_API_KEY).toBe("absent");
    const json = JSON.stringify(record);
    expect(json).not.toMatch(/sk-/);
    expect(json).not.toMatch(/Bearer /);
  });

  it("does not expose provider keys on NEXT_PUBLIC names in the example env", () => {
    const example = readFileSync(resolve(repoRoot, ".env.example"), "utf8");
    expect(example).not.toMatch(/NEXT_PUBLIC_OPENAI_API_KEY/);
    expect(example).not.toMatch(/NEXT_PUBLIC_ANTHROPIC_API_KEY/);
    expect(example).not.toMatch(/NEXT_PUBLIC_XAI_API_KEY/);
    expect(example).not.toMatch(/NEXT_PUBLIC_GOOGLE/);
  });
});
