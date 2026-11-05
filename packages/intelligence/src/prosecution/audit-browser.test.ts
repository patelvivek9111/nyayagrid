import { describe, expect, it } from "vitest";
import {
  buildProsecutionAuditSafetyBanner,
  clampAuditPage,
  clampAuditPageSize,
  normalizeProsecutionAuditActionFilter,
  PROSECUTION_AUDIT_ACTION_PREFIX,
} from "./audit-browser";
import { ProsecutionError } from "./domain";

describe("prosecution audit browser helpers", () => {
  it("clamps page and page size", () => {
    expect(clampAuditPage(undefined)).toBe(1);
    expect(clampAuditPage(0)).toBe(1);
    expect(clampAuditPage(3.9)).toBe(3);
    expect(clampAuditPageSize(undefined)).toBe(25);
    expect(clampAuditPageSize(0)).toBe(1);
    expect(clampAuditPageSize(500)).toBe(100);
  });

  it("normalizes action filters inside prosecution.* only", () => {
    expect(normalizeProsecutionAuditActionFilter(null)).toBeNull();
    expect(normalizeProsecutionAuditActionFilter("case_created")).toBe(
      `${PROSECUTION_AUDIT_ACTION_PREFIX}case_created`,
    );
    expect(normalizeProsecutionAuditActionFilter("prosecution.case_created")).toBe(
      "prosecution.case_created",
    );
    expect(() => normalizeProsecutionAuditActionFilter("matters.create")).toThrow(ProsecutionError);
    expect(() => normalizeProsecutionAuditActionFilter("prosecution.%")).toThrow(ProsecutionError);
  });

  it("never surfaces outcome KPIs on the audit banner", () => {
    const safety = buildProsecutionAuditSafetyBanner();
    expect(safety.convictionRate).toBeNull();
    expect(safety.prosecutorPerformanceScore).toBeNull();
    expect(safety.guiltOutcomeKpi).toBeNull();
    expect(safety.inventedDeadlines).toBe(false);
  });
});
