import { describe, expect, it } from "vitest";
import {
  extractLegalCiteExpectedAnswer,
  LegalCiteBenchAdapter,
} from "../src/prosecution-external/adapters/legalcitebench.js";
import {
  loadLegalCiteBenchProsecutionSliceAsync,
  resolveLegalCiteBenchMount,
} from "../src/prosecution-external/suite.js";
import { getCacheDir } from "../src/paths.js";

describe("LegalCiteBench adapter + mount", () => {
  it("extracts ground_truth string / citation list / object / kv-pairs", () => {
    expect(
      extractLegalCiteExpectedAnswer({ ground_truth: "There is no error in the citation." }),
    ).toBe("There is no error in the citation.");
    expect(extractLegalCiteExpectedAnswer({ ground_truth: ["1 U.S. 1", "2 F.2d 3"] })).toEqual([
      "1 U.S. 1",
      "2 F.2d 3",
    ]);
    expect(
      extractLegalCiteExpectedAnswer({
        ground_truth: { case_name: "Foo v. Bar", citation: "1 F.Supp. 1" },
      }),
    ).toEqual({ case_name: "Foo v. Bar", citation: "1 F.Supp. 1" });
    expect(
      extractLegalCiteExpectedAnswer({
        ground_truth: [
          ["case_cite", "169 N.H. 783"],
          ["court", "New Hampshire Supreme Court"],
        ],
      }),
    ).toEqual({ case_cite: "169 N.H. 783", court: "New Hampshire Supreme Court" });
  });

  it("resolves local HF cache mount when present", () => {
    const mount = resolveLegalCiteBenchMount(getCacheDir());
    if (!mount) {
      // CI runners may not have the external cache; skip soft.
      expect(mount).toBeNull();
      return;
    }
    expect(mount).toMatch(/legalcitebench[/\\]/);
  });

  it("loads priority sample from cache when mounted", async () => {
    const mount = resolveLegalCiteBenchMount(getCacheDir());
    if (!mount) return;
    const loaded = await LegalCiteBenchAdapter.load(mount);
    expect(loaded.length).toBe(23646);
    expect(new Set(loaded.map((t) => t.taskId)).size).toBe(loaded.length);
    expect(loaded.every((t) => t.expectedAnswer != null)).toBe(true);
    expect(loaded.every((t) => typeof t.metadata?.legacyTaskId === "string")).toBe(true);
    const slice = await loadLegalCiteBenchProsecutionSliceAsync({
      fixtureFallback: false,
      count: 80,
    });
    expect(slice.mountStatus).toBe("CACHE");
    expect(slice.selectedCount).toBe(80);
    expect(slice.licenseClassification).toBe("PERMITTED");
  });
});
