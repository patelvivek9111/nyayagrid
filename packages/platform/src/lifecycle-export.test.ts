import { describe, expect, it } from "vitest";
import { sanitizeUsageMetadata } from "./usage";
import { sanitizeAuditMetadata } from "./lifecycle";

describe("sanitizeUsageMetadata", () => {
  it("drops keys that look like prompts or document text", () => {
    expect(
      sanitizeUsageMetadata({
        feature: "nyaya.ask",
        prompt: "secret lease clause",
        completion: "model text",
        documentId: "should-drop-because-document",
        latencyMs: 12,
      }),
    ).toEqual({ feature: "nyaya.ask", latencyMs: 12 });
  });
});

describe("sanitizeAuditMetadata", () => {
  it("strips content-bearing keys from audit JSON exports", () => {
    expect(
      sanitizeAuditMetadata({
        filename: "lease.txt",
        quote: "Rent is $40,000",
        sha256: "abc",
      }),
    ).toEqual({ filename: "lease.txt", sha256: "abc" });
  });
});
