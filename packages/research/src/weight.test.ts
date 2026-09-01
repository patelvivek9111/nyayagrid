import { describe, expect, it } from "vitest";
import { rewriteUnsupportedControllingClaims } from "./weight";

describe("rewriteUnsupportedControllingClaims", () => {
  it("demotes a retrieved out-of-jurisdiction statute that the model called controlling", () => {
    const text = rewriteUnsupportedControllingClaims({
      text: "Other State Code § 100 is controlling for this preliminary-injunction question.",
      hits: [
        {
          citation: "Other State Code § 100",
          title: "Emergency Stays",
          jurisdiction: "Other State",
          hierarchyRelationship: "out_of_jurisdiction",
        },
      ],
      queryJurisdiction: "Synthetic Federal",
    });
    expect(text.toLowerCase()).not.toContain("other state code § 100 is controlling");
    expect(text.toLowerCase()).toContain("other state code § 100 is not controlling");
  });

  it("demotes NY/NJ, TX/CA, and PA-forum/DE-governing with unrelated OH without using original bench wording", () => {
    const ny = rewriteUnsupportedControllingClaims({
      text: "N.J. Stat. § 12A is controlling on this New York contract.",
      hits: [
        {
          citation: "N.J. Stat. § 12A",
          jurisdiction: "New Jersey",
          hierarchyRelationship: "out_of_jurisdiction",
        },
      ],
      queryJurisdiction: "New York",
      forumLabels: ["NY", "New York"],
    });
    expect(ny.toLowerCase()).toContain("is not controlling");

    const tx = rewriteUnsupportedControllingClaims({
      text: "Cal. Civ. Code § 1624 is controlling in Texas.",
      hits: [
        {
          citation: "Cal. Civ. Code § 1624",
          jurisdiction: "California",
          hierarchyRelationship: "out_of_jurisdiction",
        },
      ],
      queryJurisdiction: "Texas",
      forumLabels: ["TX", "Texas"],
    });
    expect(tx.toLowerCase()).toContain("is not controlling");

    const oh = rewriteUnsupportedControllingClaims({
      text: "Ohio Rev. Code § 1302 is controlling despite Delaware governing law.",
      hits: [
        {
          citation: "Ohio Rev. Code § 1302",
          jurisdiction: "Ohio",
          hierarchyRelationship: "out_of_jurisdiction",
        },
      ],
      queryJurisdiction: "Delaware",
      forumLabels: ["PA", "DE", "Pennsylvania", "Delaware"],
    });
    expect(oh.toLowerCase()).toContain("is not controlling");
  });

  it("does not rewrite a same-forum citation that was labeled controlling", () => {
    const text = rewriteUnsupportedControllingClaims({
      text: "Synthetic Jurisdiction Code § 100 is controlling on the irreparable-harm element.",
      hits: [
        {
          citation: "Synthetic Jurisdiction Code § 100",
          jurisdiction: "Synthetic Jurisdiction",
          hierarchyRelationship: "controlling",
        },
      ],
      queryJurisdiction: "Synthetic Jurisdiction",
    });
    expect(text).toContain("Synthetic Jurisdiction Code § 100 is controlling");
  });
});
