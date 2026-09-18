import { describe, expect, it } from "vitest";
import {
  applyHealthEvent,
  applyRefreshWrite,
  buildVersionDiff,
  contentHash,
  createInMemoryRefreshStore,
  deriveJobStatus,
  detectChange,
  deriveHealthStatus,
  nextEligibleAt,
  normalizeForHash,
  type RefreshCheckResult,
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

  it("recovers to healthy on success without retaining unavailable", () => {
    const failed = applyHealthEvent({
      consecutiveFailures: 5,
      lifetimeFailures: 5,
      event: "failure",
      httpStatus: 503,
    });
    expect(failed.status).toBe("unavailable");
    expect(failed.lifetimeFailures).toBe(6);
    const recovered = applyHealthEvent({
      consecutiveFailures: failed.consecutiveFailures,
      lifetimeFailures: failed.lifetimeFailures,
      event: "success",
    });
    expect(recovered.status).toBe("healthy");
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.lifetimeFailures).toBe(6);
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

describe("live refresh write path fixtures", () => {
  function seedV1(store = createInMemoryRefreshStore(), content = "official text v1") {
    const hash = contentHash(content);
    store.versions.set("auth-1", [
      {
        id: "ver_1",
        authorityId: "auth-1",
        versionNumber: 1,
        content,
        sha256: hash,
        validTo: null,
      },
    ]);
    return { store, hash };
  }

  it("A unchanged does not create version", () => {
    const { store, hash } = seedV1();
    const check: RefreshCheckResult = {
      sourceExternalId: "x",
      outcome: "unchanged",
      contentHash: hash,
      httpStatus: 200,
    };
    const out = applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check,
    });
    expect(out.action).toBe("unchanged_meta_only");
    expect(store.versions.get("auth-1")).toHaveLength(1);
  });

  it("B changed creates exactly one new version and retains prior", () => {
    const { store } = seedV1();
    const body = "official text v2 changed";
    const check: RefreshCheckResult = {
      sourceExternalId: "x",
      outcome: "changed",
      contentHash: contentHash(body),
      bodyText: body,
      httpStatus: 200,
    };
    const out = applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check,
    });
    expect(out.action).toBe("version_created");
    const versions = store.versions.get("auth-1")!;
    expect(versions).toHaveLength(2);
    expect(versions[0]?.validTo).not.toBeNull();
    expect(versions[1]?.validTo).toBeNull();
    expect(versions[0]?.content).toBe("official text v1");
    expect(versions[1]?.content).toBe(body);
    expect(out.diff?.textChanged).toBe(true);
    expect(out.diff?.previousVersionId).toBe("ver_1");
    expect(out.diff?.newVersionId).toBe(versions[1]?.id);
  });

  it("C metadata-only change with same hash is unchanged", () => {
    const { store, hash } = seedV1();
    const out = applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check: {
        sourceExternalId: "x",
        outcome: "unchanged",
        contentHash: hash,
        etag: '"new-etag"',
        httpStatus: 200,
      },
    });
    expect(out.action).toBe("unchanged_meta_only");
    expect(store.versions.get("auth-1")).toHaveLength(1);
  });

  it("D source unavailable preserves current", () => {
    const { store } = seedV1();
    const out = applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check: { sourceExternalId: "x", outcome: "unavailable", httpStatus: 404 },
    });
    expect(out.action).toBe("unavailable_preserved");
    expect(store.versions.get("auth-1")).toHaveLength(1);
    expect(store.versions.get("auth-1")?.[0]?.validTo).toBeNull();
  });

  it("E malformed / failed leaves current untouched", () => {
    const { store } = seedV1();
    const out = applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check: { sourceExternalId: "x", outcome: "failed", error: "malformed", httpStatus: 422 },
    });
    expect(out.action).toBe("failed_preserved");
    expect(store.versions.get("auth-1")).toHaveLength(1);
  });

  it("F transient 5xx degrades health without version write", () => {
    const { store } = seedV1();
    applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check: { sourceExternalId: "x", outcome: "failed", httpStatus: 503 },
    });
    const health = store.health.get("ecfr::US");
    expect(health?.status).toBe("degraded");
    expect(store.versions.get("auth-1")).toHaveLength(1);
  });

  it("G duplicate refresh is idempotent", () => {
    const { store } = seedV1();
    const body = "official text v2";
    const check: RefreshCheckResult = {
      sourceExternalId: "x",
      outcome: "changed",
      contentHash: contentHash(body),
      bodyText: body,
      httpStatus: 200,
    };
    const first = applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check,
      idempotencyKey: "job-1",
    });
    expect(first.action).toBe("version_created");
    const second = applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check: { ...check, outcome: "unchanged" },
      idempotencyKey: "job-1",
    });
    expect(second.action).toBe("unchanged_meta_only");
    expect(store.versions.get("auth-1")).toHaveLength(2);
  });

  it("H resume after interruption does not duplicate versions", () => {
    const { store } = seedV1();
    const body = "official text v2";
    const hash = contentHash(body);
    const first = applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check: {
        sourceExternalId: "x",
        outcome: "changed",
        contentHash: hash,
        bodyText: body,
        httpStatus: 200,
      },
    });
    const resumed = applyRefreshWrite({
      store,
      sourceKey: "ecfr",
      jurisdiction: "US",
      authorityId: "auth-1",
      check: {
        sourceExternalId: "x",
        outcome: "changed",
        contentHash: hash,
        bodyText: body,
        httpStatus: 200,
      },
      resumeCheckpoint: {
        authorityId: "auth-1",
        contentHash: hash,
        versionId: first.newVersionId!,
      },
    });
    expect(resumed.action).toBe("resumed_no_duplicate");
    expect(store.versions.get("auth-1")).toHaveLength(2);
  });
});

describe("version diff metadata", () => {
  it("records prior/new hashes and text-changed flag", () => {
    const diff = buildVersionDiff({
      priorHash: "aaa",
      newHash: "bbb",
      priorText: "alpha",
      newText: "beta",
      previousVersionId: "v1",
      newVersionId: "v2",
    });
    expect(diff.textChanged).toBe(true);
    expect(diff.previousVersionId).toBe("v1");
    expect(diff.newVersionId).toBe("v2");
    expect(diff.textDiffSummary).toContain("len");
  });
});

describe("refresh job status", () => {
  it("maps counters to durable statuses", () => {
    expect(deriveJobStatus({ attempted: 0, failed: 0, rateLimited: 0, changed: 0, unchanged: 0 })).toBe(
      "queued",
    );
    expect(deriveJobStatus({ attempted: 3, failed: 0, rateLimited: 0, changed: 1, unchanged: 2 })).toBe(
      "completed",
    );
    expect(deriveJobStatus({ attempted: 3, failed: 1, rateLimited: 0, changed: 1, unchanged: 1 })).toBe(
      "partial",
    );
    expect(deriveJobStatus({ attempted: 2, failed: 2, rateLimited: 0, changed: 0, unchanged: 0 })).toBe(
      "failed",
    );
    expect(deriveJobStatus({ attempted: 1, failed: 0, rateLimited: 1, changed: 0, unchanged: 0 })).toBe(
      "rate_limited",
    );
  });
});
