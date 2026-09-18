import { describe, expect, it } from "vitest";
import {
  contentHash,
  detectChange,
  deriveHealthStatus,
  nextEligibleAt,
  normalizeForHash,
} from "./index";

describe("corpus refresh change detection", () => {
  it("treats identical normalized text as unchanged", () => {
    const a = contentHash("Hello   world\n\n");
    const b = contentHash("Hello world\n");
    expect(a).toBe(b);
    expect(detectChange({ priorHash: a, newHash: b }).changed).toBe(false);
  });

  it("detects content hash change", () => {
    const prior = contentHash("version one");
    const next = contentHash("version two");
    const d = detectChange({ priorHash: prior, newHash: next });
    expect(d.changed).toBe(true);
    expect(d.signal).toBe("content_hash");
  });

  it("prefers etag over content hash", () => {
    const d = detectChange({
      priorHash: "aaa",
      newHash: "bbb",
      priorEtag: '"v1"',
      newEtag: '"v1"',
    });
    expect(d.changed).toBe(false);
    expect(d.signal).toBe("etag");
  });

  it("normalizeForHash collapses whitespace", () => {
    expect(normalizeForHash("a  b\n\n\nc")).toBe("a b\n\nc");
  });
});

describe("source health derivation", () => {
  it("marks blocked sources", () => {
    expect(deriveHealthStatus({ consecutiveFailures: 0, blocked: true })).toBe("blocked");
  });

  it("escalates consecutive failures", () => {
    expect(deriveHealthStatus({ consecutiveFailures: 2 })).toBe("degraded");
    expect(deriveHealthStatus({ consecutiveFailures: 5 })).toBe("unavailable");
  });
});

describe("cadence next eligible", () => {
  it("returns null for manual_only", () => {
    const policy = {
      classes: {
        regulatory_frequent: { intervalDays: 7, notes: "" },
        statute_periodic: { intervalDays: 90, notes: "" },
        court_rules_periodic: { intervalDays: 180, notes: "" },
        constitution_static: { intervalDays: 365, notes: "" },
        manual_only: { intervalDays: null, notes: "" },
      },
    } as const;
    expect(nextEligibleAt("manual_only", policy)).toBeNull();
    const next = nextEligibleAt("regulatory_frequent", policy, new Date("2026-01-01T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });
});
