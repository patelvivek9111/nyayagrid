import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALERT_POLICIES,
  aggregateOpsHealth,
  classifyDependency,
  evaluateBackupFreshness,
  listPageSeverityAlerts,
  resolveBuildIdentity,
} from "./ops-health";

describe("WP-05 ops health", () => {
  it("classifies dependency states", () => {
    expect(classifyDependency({ ok: true })).toBe("HEALTHY");
    expect(classifyDependency({ ok: true, degraded: true })).toBe("DEGRADED");
    expect(classifyDependency({ ok: false })).toBe("UNAVAILABLE");
  });

  it("aggregates readiness — required unavailable fails ready", () => {
    const result = aggregateOpsHealth([
      { name: "database", status: "HEALTHY", requiredForReady: true },
      { name: "clamav", status: "UNAVAILABLE", requiredForReady: true },
      { name: "ocr", status: "DEGRADED", requiredForReady: false },
    ]);
    expect(result.ready).toBe(false);
    expect(result.status).toBe("UNAVAILABLE");
  });

  it("optional unavailable yields DEGRADED but still ready", () => {
    const result = aggregateOpsHealth([
      { name: "database", status: "HEALTHY", requiredForReady: true },
      { name: "ocr", status: "UNAVAILABLE", requiredForReady: false },
    ]);
    expect(result.ready).toBe(true);
    expect(result.status).toBe("DEGRADED");
  });

  it("exposes page-severity alert policies without destinations invented", () => {
    expect(DEFAULT_ALERT_POLICIES.length).toBeGreaterThanOrEqual(8);
    const pages = listPageSeverityAlerts();
    expect(pages.some((p) => p.id === "malware-scanner-down")).toBe(true);
    expect(pages.some((p) => p.id === "ready-probe-failing")).toBe(true);
    for (const p of DEFAULT_ALERT_POLICIES) {
      expect(p.signal.length).toBeGreaterThan(0);
      expect(JSON.stringify(p)).not.toMatch(/sk_live|password|DATABASE_URL=/i);
    }
  });

  it("resolves build identity without inventing SHA", () => {
    expect(resolveBuildIdentity({}).gitSha).toBeNull();
    expect(resolveBuildIdentity({ GIT_SHA: "abc123" }).gitSha).toBe("abc123");
  });

  it("evaluates backup freshness against interim 24h RPO", () => {
    const now = new Date("2026-11-04T12:00:00.000Z");
    expect(
      evaluateBackupFreshness({
        lastSuccessAt: "2026-11-04T10:00:00.000Z",
        now,
      }).fresh,
    ).toBe(true);
    expect(
      evaluateBackupFreshness({
        lastSuccessAt: "2026-11-02T12:00:00.000Z",
        now,
      }).fresh,
    ).toBe(false);
    expect(evaluateBackupFreshness({ lastSuccessAt: null, now }).fresh).toBe(false);
  });
});
