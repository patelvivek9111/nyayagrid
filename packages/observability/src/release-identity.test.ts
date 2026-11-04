import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { releaseIdentityMissingInDeployedEnv, resolveBuildIdentity } from "./release-identity";

describe("WP-05 release identity", () => {
  it("reads GIT_SHA from env without inventing values", () => {
    const id = resolveBuildIdentity(
      { GIT_SHA: "da36d0b67c452f34fb3596a3bd10b8ba0086c45c", APP_ENV: "staging" },
      { readFile: false },
    );
    expect(id.gitSha).toBe("da36d0b67c452f34fb3596a3bd10b8ba0086c45c");
    expect(id.source).toBe("env");
  });

  it("rejects non-sha env noise such as fly image refs", () => {
    const id = resolveBuildIdentity(
      { FLY_IMAGE_REF: "registry.fly.io/nyayagrid-staging:deployment-abc", APP_ENV: "staging" },
      { readFile: false },
    );
    expect(id.gitSha).toBeNull();
  });

  it("falls back to baked release-identity.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "nyaya-rel-"));
    const path = join(dir, "release-identity.json");
    writeFileSync(
      path,
      JSON.stringify({
        gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        buildId: "build-1",
        builtAt: "2026-11-04T00:00:00.000Z",
      }),
    );
    const id = resolveBuildIdentity({ APP_ENV: "staging" }, { identityFilePath: path });
    expect(id.gitSha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(id.buildId).toBe("build-1");
    expect(id.source).toBe("file");
    rmSync(dir, { recursive: true, force: true });
  });

  it("flags missing identity in staging", () => {
    expect(
      releaseIdentityMissingInDeployedEnv({
        gitSha: null,
        buildId: null,
        appEnv: "staging",
        source: "none",
      }),
    ).toBe(true);
    expect(
      releaseIdentityMissingInDeployedEnv({
        gitSha: "abc1234",
        buildId: null,
        appEnv: "staging",
        source: "env",
      }),
    ).toBe(false);
  });
});
