import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadIntegrityManifest, verifyIntegrityManifest } from "../src/integrity/manifest.js";
import { getFixturesDir } from "../src/paths.js";

describe("integrity manifest", () => {
  it("verifies fixture manifest", () => {
    const manifestPath = path.join(getFixturesDir(), "integrity-manifest.json");
    const manifest = loadIntegrityManifest(manifestPath);
    const result = verifyIntegrityManifest(manifest, getFixturesDir());
    expect(result.ok).toBe(true);
  });
});
