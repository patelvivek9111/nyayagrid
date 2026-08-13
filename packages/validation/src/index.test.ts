import { describe, expect, it } from "vitest";
import {
  createManualNoteSchema,
  createOrganizationSchema,
  createTaskSchema,
  documentProcessingStateSchema,
  reviewMatterEntitySchema,
  updateDraftStatusSchema,
  updateTaskSchema,
} from "./index";

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

describe("reviewMatterEntitySchema", () => {
  it("accepts alias and role edits for inline People review", () => {
    const parsed = reviewMatterEntitySchema.parse({
      action: "edit_and_approve",
      edits: {
        displayName: "Jordan Lee",
        entityType: "person",
        roles: ["witness"],
        aliases: ["J. Lee"],
      },
    });
    expect(parsed.edits?.aliases).toEqual(["J. Lee"]);
    expect(parsed.edits?.roles).toEqual(["witness"]);
  });
});

describe("task schemas", () => {
  it("accepts create with priority and description", () => {
    const parsed = createTaskSchema.parse({
      title: "Review notice provision",
      description: "Check Section 12 against the lease.",
      priority: "high",
    });
    expect(parsed.priority).toBe("high");
    expect(parsed.description).toContain("Section 12");
  });

  it("accepts status transitions on patch", () => {
    expect(updateTaskSchema.parse({ status: "in_progress" }).status).toBe("in_progress");
    expect(updateTaskSchema.parse({ status: "cancelled" }).status).toBe("cancelled");
  });
});

describe("createManualNoteSchema", () => {
  it("requires title and content for a user-authored note", () => {
    const parsed = createManualNoteSchema.parse({
      title: "Call with client",
      content: "Discussed notice timing. Follow up Friday.",
    });
    expect(parsed.title).toBe("Call with client");
  });
});

describe("draft status schema", () => {
  it("allows attorney review without a send or file status", () => {
    expect(updateDraftStatusSchema.parse({ status: "in_review" }).status).toBe("in_review");
    expect(() => updateDraftStatusSchema.parse({ status: "final" })).toThrow();
  });
});
