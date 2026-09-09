import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  accessReportHasNoSecrets,
  applyDotEnvFile,
  loadCanonicalLocalEnv,
  parseDotEnvKeyStates,
  redactEnvSecrets,
  shouldLoadDeveloperDotenv,
} from "./load-local-env";

function tempRoot(name: string): string {
  const dir = join(tmpdir(), `nyaya-env-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "apps/web"), { recursive: true });
  mkdirSync(join(dir, "benchmarks/nyaya-bench"), { recursive: true });
  return dir;
}

describe("canonical local env loading", () => {
  it("loads non-empty keys and skips comments and empty assignments", () => {
    const root = tempRoot("skip-empty");
    try {
      writeFileSync(
        join(root, ".env"),
        [
          "DATABASE_URL=postgres://local/db",
          "# OPENAI_API_KEY=",
          "ANTHROPIC_API_KEY=",
          "XAI_API_KEY=xai-present-value-not-for-reports",
          "",
        ].join("\n"),
        "utf8",
      );
      const env: Record<string, string | undefined> = { APP_ENV: "development" };
      loadCanonicalLocalEnv({ repoRoot: root, env });
      expect(env.DATABASE_URL).toBe("postgres://local/db");
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.XAI_API_KEY).toBe("xai-present-value-not-for-reports");
      const states = parseDotEnvKeyStates(join(root, ".env"));
      expect(states.OPENAI_API_KEY).toBe("COMMENTED_EMPTY");
      expect(states.ANTHROPIC_API_KEY).toBe("EMPTY");
      expect(states.XAI_API_KEY).toBe("PRESENT");
      expect(states.DATABASE_URL).toBe("PRESENT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not override process-owned values and does not leak secrets in reports", () => {
    const root = tempRoot("no-override");
    try {
      writeFileSync(join(root, ".env"), "OPENAI_API_KEY=sk-from-file-must-not-win\n", "utf8");
      const env: Record<string, string | undefined> = {
        APP_ENV: "development",
        OPENAI_API_KEY: "sk-already-in-process",
      };
      loadCanonicalLocalEnv({ repoRoot: root, env });
      expect(env.OPENAI_API_KEY).toBe("sk-already-in-process");
      const report = { openai: "PRESENT", files: { ".env": "EXISTS" } };
      expect(accessReportHasNoSecrets(report, env)).toBe(true);
      expect(JSON.stringify(report)).not.toContain("sk-already-in-process");
      expect(redactEnvSecrets("Authorization Bearer sk-already-in-process", env)).not.toContain(
        "sk-already-in-process",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets .env.local fill a key left empty in .env", () => {
    const root = tempRoot("local-fills");
    try {
      writeFileSync(join(root, ".env"), "OPENAI_API_KEY=\nDATABASE_URL=postgres://root\n", "utf8");
      writeFileSync(join(root, ".env.local"), "OPENAI_API_KEY=sk-from-local-file\n", "utf8");
      const env: Record<string, string | undefined> = { APP_ENV: "development" };
      loadCanonicalLocalEnv({ repoRoot: root, env });
      expect(env.OPENAI_API_KEY).toBe("sk-from-local-file");
      expect(env.DATABASE_URL).toBe("postgres://root");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not load developer files in production or staging", () => {
    const root = tempRoot("prod-skip");
    try {
      writeFileSync(join(root, ".env"), "OPENAI_API_KEY=sk-must-not-load\n", "utf8");
      const prod: Record<string, string | undefined> = { APP_ENV: "production" };
      loadCanonicalLocalEnv({ repoRoot: root, env: prod });
      expect(prod.OPENAI_API_KEY).toBeUndefined();
      const staging: Record<string, string | undefined> = { APP_ENV: "staging" };
      loadCanonicalLocalEnv({ repoRoot: root, env: staging });
      expect(staging.OPENAI_API_KEY).toBeUndefined();
      expect(shouldLoadDeveloperDotenv({ APP_ENV: "development" })).toBe(true);
      expect(shouldLoadDeveloperDotenv({ APP_ENV: "production" })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applyDotEnvFile ignores commented lines", () => {
    const root = tempRoot("comment");
    try {
      const file = join(root, ".env");
      writeFileSync(file, "# GOOGLE_API_KEY=sk-commented\nGOOGLE_API_KEY=\n", "utf8");
      const env: Record<string, string | undefined> = {};
      applyDotEnvFile(file, env);
      expect(env.GOOGLE_API_KEY).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
