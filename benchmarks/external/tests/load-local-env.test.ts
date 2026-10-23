import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDotEnvFile,
  loadExternalBenchLocalEnv,
  providerKeyPresenceFromEnv,
  shouldLoadDeveloperDotenv,
} from "../src/live/load-local-env.js";

describe("external-bench load-local-env", () => {
  it("loads nonempty keys from .env.local without returning values", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ext-bench-env-"));
    writeFileSync(
      path.join(root, ".env.local"),
      "OPENAI_API_KEY=sk-test-openai\nGOOGLE_API_KEY=gk-test\n",
    );
    const env: Record<string, string | undefined> = { APP_ENV: "development" };
    loadExternalBenchLocalEnv(env, root);
    expect(env.OPENAI_API_KEY).toBe("sk-test-openai");
    expect(env.GOOGLE_API_KEY).toBe("gk-test");
    const presence = providerKeyPresenceFromEnv(env);
    expect(presence.OPENAI_API_KEY).toBe("PRESENT");
    expect(presence.GOOGLE_API_KEY).toBe("PRESENT");
    expect(JSON.stringify(presence)).not.toContain("sk-test-openai");
    expect(JSON.stringify(presence)).not.toContain("gk-test");
  });

  it("does not override existing process env", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ext-bench-env-"));
    writeFileSync(path.join(root, ".env.local"), "OPENAI_API_KEY=from-file\n");
    const env: Record<string, string | undefined> = {
      APP_ENV: "development",
      OPENAI_API_KEY: "from-process",
    };
    loadExternalBenchLocalEnv(env, root);
    expect(env.OPENAI_API_KEY).toBe("from-process");
  });

  it("skips empty assignments so later file can fill", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ext-bench-env-"));
    writeFileSync(path.join(root, ".env"), "OPENAI_API_KEY=\n");
    writeFileSync(path.join(root, ".env.local"), "OPENAI_API_KEY=filled\n");
    const env: Record<string, string | undefined> = { APP_ENV: "development" };
    loadExternalBenchLocalEnv(env, root);
    expect(env.OPENAI_API_KEY).toBe("filled");
  });

  it("does not load developer dotenv in production/staging", () => {
    expect(shouldLoadDeveloperDotenv({ APP_ENV: "production" })).toBe(false);
    expect(shouldLoadDeveloperDotenv({ APP_ENV: "staging" })).toBe(false);
    const root = mkdtempSync(path.join(tmpdir(), "ext-bench-env-"));
    writeFileSync(path.join(root, ".env.local"), "OPENAI_API_KEY=should-not-load\n");
    const env: Record<string, string | undefined> = { APP_ENV: "production" };
    loadExternalBenchLocalEnv(env, root);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("applyDotEnvFile ignores comments", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ext-bench-env-"));
    const file = path.join(root, ".env.local");
    mkdirSync(root, { recursive: true });
    writeFileSync(file, "# OPENAI_API_KEY=commented\nXAI_API_KEY=live\n");
    const env: Record<string, string | undefined> = {};
    applyDotEnvFile(file, env);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.XAI_API_KEY).toBe("live");
  });
});
