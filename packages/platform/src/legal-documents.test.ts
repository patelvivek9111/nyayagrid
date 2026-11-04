import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  buildLegalAcceptanceAuditAction,
  getCurrentLegalDocuments,
  isKnownLegalVersion,
} from "./legal-documents";

describe("legal document versions", () => {
  it("exposes draft status and pending attorney review", () => {
    const docs = getCurrentLegalDocuments();
    expect(docs).toHaveLength(2);
    for (const doc of docs) {
      expect(doc.attorneyReview).toBe("PENDING");
      expect(doc.status).toContain("PENDING_ATTORNEY_REVIEW");
    }
  });

  it("recognizes only current versions", () => {
    expect(isKnownLegalVersion("terms", CURRENT_TERMS_VERSION)).toBe(true);
    expect(isKnownLegalVersion("privacy", CURRENT_PRIVACY_VERSION)).toBe(true);
    expect(isKnownLegalVersion("terms", "ancient")).toBe(false);
  });

  it("maps acceptance audit actions", () => {
    expect(buildLegalAcceptanceAuditAction("terms")).toBe("legal.terms_accepted");
    expect(buildLegalAcceptanceAuditAction("privacy")).toBe("legal.privacy_accepted");
  });
});
