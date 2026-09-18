import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * Append-only version contract (mirrors lean import / ingest behavior).
 * Same hash → skip; changed hash → new version number; prior retained.
 */
function sha(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function applyVersion(
  versions: Array<{ versionNumber: number; sha256: string; content: string; validTo: string | null }>,
  content: string,
): { action: "skipped" | "new_version"; versions: typeof versions } {
  const hash = sha(content);
  const latest = [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  if (latest && latest.sha256 === hash) {
    return { action: "skipped", versions };
  }
  const closed = versions.map((v) =>
    v.validTo == null ? { ...v, validTo: new Date().toISOString() } : v,
  );
  return {
    action: "new_version",
    versions: [
      ...closed,
      {
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        sha256: hash,
        content,
        validTo: null,
      },
    ],
  };
}

describe("append-only authority versions", () => {
  it("skips when content hash unchanged", () => {
    const v1 = [{ versionNumber: 1, sha256: sha("alpha"), content: "alpha", validTo: null }];
    const out = applyVersion(v1, "alpha");
    expect(out.action).toBe("skipped");
    expect(out.versions).toHaveLength(1);
  });

  it("creates new version and retains prior on hash change", () => {
    const v1 = [{ versionNumber: 1, sha256: sha("alpha"), content: "alpha", validTo: null }];
    const out = applyVersion(v1, "beta");
    expect(out.action).toBe("new_version");
    expect(out.versions).toHaveLength(2);
    expect(out.versions[0]?.validTo).not.toBeNull();
    expect(out.versions[1]?.content).toBe("beta");
    expect(out.versions[1]?.validTo).toBeNull();
    expect(out.versions[0]?.content).toBe("alpha");
  });

  it("does not invent effective dates", () => {
    const out = applyVersion([], "first");
    expect(out.versions[0]).not.toHaveProperty("effectiveFrom");
  });
});
