import { describe, expect, it } from "vitest";
import { formatCoverageWarning, humanizeKey } from "./plain-labels";

describe("humanizeKey", () => {
  it("maps known keys to plain language", () => {
    expect(humanizeKey("verified_context")).toBe("Confirmed fact");
    expect(humanizeKey("awaiting_approval")).toBe("Needs your OK");
    expect(humanizeKey("related_to")).toBe("Related to");
    expect(humanizeKey("timeline_event")).toBe("Event");
  });

  it("maps prosecution and evidence enums without leaking raw codes", () => {
    expect(humanizeKey("NO_EVIDENCE_FOUND")).toBe("No evidence found");
    expect(humanizeKey("CONFLICTED")).toBe("Conflicted");
    expect(humanizeKey("REVIEW_REQUIRED")).toBe("Review required");
  });

  it("falls back to spaces instead of underscores", () => {
    expect(humanizeKey("custom_edge_type")).toBe("custom edge type");
  });
});

describe("formatCoverageWarning", () => {
  it("translates coverage codes to clear user text", () => {
    expect(formatCoverageWarning("CONTEXT_LIMIT_REACHED")).toContain("incomplete");
    expect(formatCoverageWarning("NO_BINDING_AUTHORITY_FOUND")).toContain("binding");
  });
});
