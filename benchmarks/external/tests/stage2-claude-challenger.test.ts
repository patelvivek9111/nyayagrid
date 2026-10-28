import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../src/paths.js";
import {
  buildStage2ClaudeChallengerRunId,
  SOURCE_STAGE2_CONFIG_HASH,
  SOURCE_STAGE2_FINALISTS_RUN_ID,
} from "../src/live/stage2-claude-challenger-manifest-builder.js";
import {
  STAGE2_CLAUDE_CHALLENGER_MODEL,
  STAGE2_RESPONSE_MODELS,
} from "../src/live/stage2-task-planner.js";
import { PROVIDER_UNKNOWN_CIRCUIT_BREAKER_THRESHOLD } from "../src/live/terminal-unknown.js";
import { stage2ResponseTimeoutMs } from "../src/live/provider-timeouts.js";

describe("stage2 claude challenger freeze config", () => {
  it("uses dedicated run id prefix and preserves finalist suite identity", () => {
    expect(buildStage2ClaudeChallengerRunId("2b7a350133874ffe330ff852e73433d1b467ce72")).toBe(
      "stage2-claude-challenger-v1-2b7a35013387",
    );
    expect(SOURCE_STAGE2_FINALISTS_RUN_ID).toBe("stage2-finalists-v1-044fb482d7bf");
    expect(SOURCE_STAGE2_CONFIG_HASH).toBe(
      "385d4c3f66f621ccd752b1de99d8ac2931d4e0948ce54d6e0e1f41127e9e5b0f",
    );
  });

  it("freezes Claude 8192/adaptive/high and does not alter finalist models", () => {
    const settings = JSON.parse(
      readFileSync(path.join(getRegistryDir(), "stage2-claude-challenger-settings.json"), "utf8"),
    ) as {
      response_model: string;
      settings: Record<
        string,
        { max_tokens?: number; thinking?: { type?: string }; effort?: string }
      >;
      do_not_dispatch: string[];
    };
    expect(settings.response_model).toBe(STAGE2_CLAUDE_CHALLENGER_MODEL);
    expect(settings.settings["claude-opus-5-5"]?.max_tokens).toBe(8192);
    expect(settings.settings["claude-opus-5-5"]?.thinking?.type).toBe("adaptive");
    expect(settings.settings["claude-opus-5-5"]?.effort).toBe("high");
    expect(settings.do_not_dispatch).toEqual(
      expect.arrayContaining(["gpt-6.1-sol", "grok-4.7", "gemini-4-argon"]),
    );
    expect([...STAGE2_RESPONSE_MODELS]).toEqual(["gpt-6.1-sol", "grok-4.7"]);
  });

  it("authorizes $95 hard cap with early recalc at $75", () => {
    const budget = JSON.parse(
      readFileSync(path.join(getRegistryDir(), "stage2-claude-challenger-budget.json"), "utf8"),
    ) as { total_max_usd: number; early_recalc_usd: number; auto_increase: boolean };
    expect(budget.total_max_usd).toBe(95);
    expect(budget.early_recalc_usd).toBe(75);
    expect(budget.auto_increase).toBe(false);
  });

  it("preserves certified circuit breaker threshold and Claude timeout", () => {
    expect(PROVIDER_UNKNOWN_CIRCUIT_BREAKER_THRESHOLD).toBe(3);
    expect(stage2ResponseTimeoutMs("anthropic")).toBe(180_000);
  });
});
