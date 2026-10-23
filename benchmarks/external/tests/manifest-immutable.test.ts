import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import {
  freezeRunManifest,
  hashRunConfig,
  loadRunManifest,
  assertManifestImmutable,
} from "../src/live/manifest.js";
import { getCacheDir } from "../src/paths.js";

describe("manifest immutable", () => {
  it("refuses second freeze", () => {
    const runId = `test-immutable-${Date.now()}`;
    const config = { suite: "screening" };
    try {
      freezeRunManifest(runId, {
        runId,
        configHash: hashRunConfig(config),
        suite: config,
        models: [],
        budgetMaxUsd: 10,
      });
      expect(() =>
        freezeRunManifest(runId, {
          runId,
          configHash: hashRunConfig(config),
          suite: config,
          models: [],
          budgetMaxUsd: 10,
        }),
      ).toThrow(/already frozen/);
      const loaded = loadRunManifest(runId);
      expect(loaded.immutable).toBe(true);
      assertManifestImmutable(runId, hashRunConfig(config));
      expect(() => assertManifestImmutable(runId, hashRunConfig({ suite: "other" }))).toThrow(
        /Config hash mismatch/,
      );
    } finally {
      rmSync(path.join(getCacheDir(), "runs", runId), { recursive: true, force: true });
    }
  });
});
