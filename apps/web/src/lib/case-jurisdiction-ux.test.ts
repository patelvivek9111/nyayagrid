import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compactJurisdictionHeaderLine,
  coverageMustNotSayCertified,
  coverageStatusLabel,
  filterSelectOptions,
  isJurisdictionUnset,
  stateSelectOptions,
} from "./case-jurisdiction";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("UX-JURIS-1 Case jurisdiction UX", () => {
  const chromeRoute = src("src/app/api/v1/matters/[matterId]/chrome/route.ts");
  const caseChrome = src("src/components/ux/case-chrome.tsx");
  const matterChrome = src("src/components/use-matter-chrome.tsx");
  const detailsPanel = src("src/components/ux/case-details-panel.tsx");
  const jurisdictionLib = src("src/lib/case-jurisdiction.ts");
  const optionsRoute = src("src/app/api/v1/jurisdiction/options/route.ts");
  const documentsPage = src("src/app/app/cases/[matterId]/documents/page.tsx");
  const reviewPage = src("src/app/app/cases/[matterId]/review/page.tsx");
  const newCase = src("src/app/app/cases/new/page.tsx");

  it("A. Case title appears in shared header", () => {
    expect(caseChrome).toContain("font-display text-2xl");
    expect(matterChrome).toContain("matterNumber");
  });

  it("B. Client appears in shared header", () => {
    expect(chromeRoute).toContain("clients.displayName");
    expect(caseChrome).toContain("clientDisplayName");
    expect(caseChrome).toContain("Client");
  });

  it("C/D. jurisdiction summary and missing jurisdiction handled", () => {
    expect(chromeRoute).toContain("uiJurisdictionContract");
    expect(caseChrome).toContain("compactJurisdictionHeaderLine");
    expect(caseChrome).toContain("Add jurisdiction");
    expect(isJurisdictionUnset({ summary: "Jurisdiction not set", jurisdictionMode: "unknown", primaryState: null, courtId: null, governingLawState: null, forumType: null } as never)).toBe(true);
  });

  it("E/F. state dropdown uses shared registry; court type narrows courts", () => {
    expect(detailsPanel).toContain("/api/v1/jurisdiction/options");
    expect(optionsRoute).toContain("listUsStates");
    expect(optionsRoute).toContain("listCourts");
    expect(detailsPanel).toContain("forumType");
    expect(newCase).toContain("forumType");
    expect(newCase).toContain("state: primaryState");
  });

  it("G. federal circuit derived from backend court metadata, not manual select", () => {
    expect(detailsPanel).toContain("federalCircuitLabel");
    expect(detailsPanel).toContain("Derived from selected court");
    expect(detailsPanel).not.toContain("Third Circuit");
    expect(jurisdictionLib).not.toContain("circuitShortName");
  });

  it("H. forum separate from governing law", () => {
    expect(detailsPanel).toContain("Governing / choice of law");
    expect(detailsPanel).toContain("Forum");
    expect(detailsPanel).toContain("choice-of-law provision is enforceable");
  });

  it("I/J. as-of date and related jurisdictions", () => {
    expect(detailsPanel).toContain("Law as of");
    expect(detailsPanel).toContain("relatedJurisdictions");
    expect(detailsPanel).toContain("Add another jurisdiction");
  });

  it("K. multi-jurisdiction summary stays compact", () => {
    const line = compactJurisdictionHeaderLine({
      summary: "DE law · E.D. Pa. forum",
      relatedJurisdictions: [{ stateCode: "NJ" }],
    } as never);
    expect(line).toContain("+1 related");
  });

  it("L. coverage UNVALIDATED not labeled Certified", () => {
    expect(coverageStatusLabel("unvalidated")).not.toMatch(/certified/i);
    expect(coverageMustNotSayCertified("unvalidated")).toBe(true);
    expect(detailsPanel).not.toContain("Coverage: Certified");
    expect(jurisdictionLib).not.toContain("Coverage: Certified");
  });

  it("M/N. view-only vs editable save", () => {
    expect(detailsPanel).toContain("View only");
    expect(detailsPanel).toContain("canEdit");
    expect(chromeRoute).toContain('matters.edit');
    expect(detailsPanel).toContain('method: "PATCH"');
  });

  it("O. failed Save shows error", () => {
    expect(detailsPanel).toContain("Save failed");
    expect(detailsPanel).toContain("setError");
  });

  it("P. legacy values preserved in panel", () => {
    expect(detailsPanel).toContain("legacyJurisdiction");
    expect(detailsPanel).toContain("Legacy recorded values");
  });

  it("Q/R. Documents and Review UX unchanged", () => {
    expect(documentsPage).toContain("Search by document name");
    expect(documentsPage).toContain("processingSummary");
    expect(reviewPage).toContain("Review");
    expect(documentsPage).not.toContain("Case details");
  });

  it("S. onboarding / new Case still works with optional jurisdiction", () => {
    expect(newCase).toContain("Create Case");
    expect(newCase).toContain("primaryState");
    expect(newCase).not.toContain('jurisdiction: jurisdiction');
  });

  it("T/U. no AI calls; no frontend legal hierarchy", () => {
    expect(detailsPanel).not.toContain("generateText");
    expect(caseChrome).not.toContain("openai");
    expect(jurisdictionLib).not.toContain("listCourts");
    expect(jurisdictionLib).not.toContain("deriveJurisdictionMode");
  });

  it("V. FEATURE_AGENTS unchanged", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
  });

  it("searchable state filter supports code aliases", () => {
    const options = stateSelectOptions([
      { code: "PA", name: "Pennsylvania" },
      { code: "NJ", name: "New Jersey" },
    ]);
    const penn = filterSelectOptions(options, "Penn");
    expect(penn[0]?.label).toBe("Pennsylvania");
    const nj = filterSelectOptions(options, "NJ");
    expect(nj[0]?.label).toBe("New Jersey");
  });
});
