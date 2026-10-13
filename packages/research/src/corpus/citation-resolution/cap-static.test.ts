import { describe, expect, it } from "vitest";
import {
  isCapAutoResolvable,
  lookupCapStatic,
  matchCapCases,
  nyayaReporterToCapSlug,
  parseCapCitationParts,
  type CapCaseMetadata,
} from "./cap-static.js";

const sampleCases: CapCaseMetadata[] = [
  {
    id: 9184172,
    name: "Allstate Insurance Co. v. Teel",
    name_abbreviation: "Allstate Insurance Co. v. Teel",
    decision_date: "2004-10-01",
    first_page: "2",
    last_page: "7",
    citations: [{ type: "official", cite: "100 P.3d 2" }],
    court: { name: "Alaska Supreme Court", name_abbreviation: "Alaska" },
  },
  {
    id: 99,
    name: "Other",
    first_page: "10",
    last_page: "15",
    citations: [{ type: "official", cite: "100 P.3d 10" }],
    court: { name: "Alaska Supreme Court" },
  },
];

describe("cap-static", () => {
  it("maps reporters to CAP slugs", () => {
    expect(nyayaReporterToCapSlug("p3d")).toBe("p3d");
    expect(nyayaReporterToCapSlug("fsupp3d")).toBe("f-supp-3d");
    expect(nyayaReporterToCapSlug("f4th")).toBe("f4th");
  });

  it("parses citations", () => {
    expect(parseCapCitationParts("100 P.3d 2")).toMatchObject({
      volume: 100,
      page: 2,
      capSlug: "p3d",
    });
  });

  it("exact citation match", () => {
    const m = matchCapCases(sampleCases, 100, 2, "100 P.3d 2");
    expect(m.matches).toHaveLength(1);
    expect(m.matches[0]?.id).toBe(9184172);
    expect(m.mode).toBe("citation");
  });

  it("normalized / first_page match", () => {
    const m = matchCapCases(sampleCases, 100, 2, "100 P.3d 2");
    expect(m.matches[0]?.id).toBe(9184172);
  });

  it("ambiguous multi-match refused", () => {
    const dup = [
      ...sampleCases,
      {
        id: 2,
        first_page: "2",
        last_page: "3",
        citations: [{ type: "official", cite: "100 P.3d 2" }],
      },
    ];
    const m = matchCapCases(dup, 100, 2, "100 P.3d 2");
    expect(m.matches.length).toBeGreaterThan(1);
  });

  it("lookup exact via fetch mock", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify(sampleCases), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const r = await lookupCapStatic("100 P.3d 2", { fetchImpl });
    expect(r.identityConfidence).toBe("PUBLIC_EXACT_MATCH");
    expect(r.providerCaseId).toBe("9184172");
    expect(r.caseName).toContain("Teel");
    expect(isCapAutoResolvable(r)).toBe(true);
  });

  it("not-found when page absent", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify(sampleCases), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const r = await lookupCapStatic("100 P.3d 999", { fetchImpl });
    expect(r.identityConfidence).toBe("PUBLIC_NOT_FOUND");
  });

  it("unsupported for F.4th", async () => {
    const r = await lookupCapStatic("175 F.4th 34", {
      fetchImpl: async () => new Response("[]", { status: 200 }),
    });
    expect(r.identityConfidence).toBe("PUBLIC_UNSUPPORTED");
  });

  it("volume missing → unsupported", async () => {
    const fetchImpl = async () => new Response("", { status: 404 });
    const r = await lookupCapStatic("900 P.3d 1", { fetchImpl });
    expect(r.identityConfidence).toBe("PUBLIC_UNSUPPORTED");
  });

  it("ambiguous result refused for auto-resolve", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify([
          { id: 1, first_page: "2", citations: [{ type: "official", cite: "100 P.3d 2" }] },
          { id: 2, first_page: "2", citations: [{ type: "official", cite: "100 P.3d 2" }] },
        ]),
        { status: 200 },
      );
    const r = await lookupCapStatic("100 P.3d 2", { fetchImpl });
    expect(r.identityConfidence).toBe("PUBLIC_AMBIGUOUS");
    expect(isCapAutoResolvable(r)).toBe(false);
  });
});
