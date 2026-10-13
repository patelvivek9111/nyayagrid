import { describe, expect, it } from "vitest";
import {
  govInfoUsReportsIds,
  isGovInfoAutoResolvable,
  lookupGovInfoUsReports,
  parseUsReportsCitation,
} from "./govinfo-usreports.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("govinfo-usreports", () => {
  it("parses exact and spaced U.S. citations", () => {
    expect(parseUsReportsCitation("573 U.S. 373")).toEqual({
      volume: 573,
      page: 373,
      normalized: "573 U.S. 373",
    });
    expect(parseUsReportsCitation("573 U. S. 373")?.normalized).toBe("573 U.S. 373");
    expect(parseUsReportsCitation("175 F.4th 34")).toBeNull();
  });

  it("builds deterministic granule ids", () => {
    const ids = govInfoUsReportsIds(573, 373);
    expect(ids.granuleId).toBe("USREPORTS-573-373");
    expect(ids.pdfUrl).toContain("/USREPORTS-573/pdf/USREPORTS-573-373.pdf");
  });

  it("exact official citation match via summary", async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toContain("USREPORTS-573-373");
      return jsonResponse({
        granuleId: "USREPORTS-573-373",
        granuleClass: "CASE",
        usCitation: "573 U.S. 373",
        fullCitation: "573 U.S. 373 (2013)",
        title: "Riley v. California, 573 U.S. 373 (2013)",
        decisionDate: { date: "2014-06-25" },
      });
    };
    const r = await lookupGovInfoUsReports("573 U.S. 373", { apiKey: "TEST", fetchImpl });
    expect(r.identityConfidence).toBe("OFFICIAL_EXACT_MATCH");
    expect(r.providerCaseId).toBe("USREPORTS-573-373");
    expect(r.caseName).toContain("Riley");
    expect(isGovInfoAutoResolvable(r)).toBe(true);
  });

  it("normalized official citation match", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        granuleId: "USREPORTS-573-373",
        granuleClass: "CASE",
        usCitation: "573 U.S. 373",
        title: "Riley v. California, 573 U.S. 373 (2013)",
        decisionDate: { date: "2014-06-25" },
      });
    const r = await lookupGovInfoUsReports("573 U. S. 373", { apiKey: "TEST", fetchImpl });
    expect(r.identityConfidence).toBe("OFFICIAL_NORMALIZED_MATCH");
    expect(isGovInfoAutoResolvable(r)).toBe(true);
  });

  it("refuses non-CASE granules as ambiguous", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        granuleId: "USREPORTS-573-FrontMatter-1",
        granuleClass: "FRONTMATTER",
        usCitation: "",
        title: "Front Matter",
      });
    const r = await lookupGovInfoUsReports("573 U.S. 1", { apiKey: "TEST", fetchImpl });
    expect(r.identityConfidence).toBe("OFFICIAL_AMBIGUOUS");
    expect(isGovInfoAutoResolvable(r)).toBe(false);
  });

  it("not-found on 404", async () => {
    const fetchImpl = async () => new Response("", { status: 404 });
    const r = await lookupGovInfoUsReports("999 U.S. 1", { apiKey: "TEST", fetchImpl });
    expect(r.identityConfidence).toBe("OFFICIAL_NOT_FOUND");
  });

  it("unsupported for non-US reporters", async () => {
    const r = await lookupGovInfoUsReports("175 F.4th 34", { apiKey: "TEST", fetchImpl: async () => jsonResponse({}) });
    expect(r.identityConfidence).toBe("OFFICIAL_UNSUPPORTED");
  });

  it("HEAD-only without API key stays non-auto when requireCaseClass", async () => {
    const fetchImpl = async () =>
      new Response("", {
        status: 200,
        headers: { "Content-Length": "385279", "Content-Type": "application/pdf" },
      });
    const r = await lookupGovInfoUsReports("573 U.S. 373", { fetchImpl, requireCaseClass: true });
    expect(r.identityConfidence).toBe("OFFICIAL_AMBIGUOUS");
    expect(isGovInfoAutoResolvable(r)).toBe(false);
  });

  it("HEAD soft-404 HTML is not-found", async () => {
    const fetchImpl = async () =>
      new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
    const r = await lookupGovInfoUsReports("226 U.S. 649", { fetchImpl, requireCaseClass: true });
    expect(r.identityConfidence).toBe("OFFICIAL_NOT_FOUND");
  });

  it("citation mismatch refused", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        granuleId: "USREPORTS-573-373",
        granuleClass: "CASE",
        usCitation: "573 U.S. 999",
        title: "Wrong",
      });
    const r = await lookupGovInfoUsReports("573 U.S. 373", { apiKey: "TEST", fetchImpl });
    expect(r.identityConfidence).toBe("OFFICIAL_AMBIGUOUS");
  });
});
