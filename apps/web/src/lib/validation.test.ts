import { describe, expect, it } from "vitest";
import { createOrganizationSchema } from "@nyayagrid/validation";

describe("web validation wiring", () => {
  it("parses organization create payload", () => {
    const parsed = createOrganizationSchema.parse({
      name: "North River Law",
      slug: "north-river-law",
      type: "solo",
    });
    expect(parsed.type).toBe("solo");
  });
});
