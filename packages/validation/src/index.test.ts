import { describe, expect, it } from "vitest";
import { createOrganizationSchema, documentProcessingStateSchema } from "./index";

describe("createOrganizationSchema", () => {
  it("accepts valid firm input", () => {
    const result = createOrganizationSchema.parse({
      name: "Acme Law",
      type: "firm",
      slug: "acme-law",
    });
    expect(result.slug).toBe("acme-law");
  });

  it("rejects invalid slug", () => {
    expect(() =>
      createOrganizationSchema.parse({
        name: "Bad",
        slug: "Bad Slug",
      }),
    ).toThrow();
  });
});

describe("documentProcessingStateSchema", () => {
  it("includes unscanned_development and requires_ocr", () => {
    expect(documentProcessingStateSchema.parse("unscanned_development")).toBe(
      "unscanned_development",
    );
    expect(documentProcessingStateSchema.parse("requires_ocr")).toBe("requires_ocr");
  });
});
