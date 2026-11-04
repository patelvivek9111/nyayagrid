import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  buildLegalAcceptanceAuditAction,
  getCurrentLegalDocuments,
  isKnownLegalVersion,
} from "./legal-documents";

describe("WP-04 legal acceptance engineering", () => {
  it("exposes versioned drafts with pending attorney review", () => {
    const docs = getCurrentLegalDocuments();
    expect(docs.every((d) => d.attorneyReview === "PENDING")).toBe(true);
    expect(docs.some((d) => d.path === "/terms")).toBe(true);
    expect(docs.some((d) => d.path === "/privacy")).toBe(true);
  });

  it("rejects stale versions (reacceptance required on bump)", () => {
    expect(isKnownLegalVersion("terms", "0.0.0-stale")).toBe(false);
    expect(isKnownLegalVersion("terms", CURRENT_TERMS_VERSION)).toBe(true);
    expect(isKnownLegalVersion("privacy", CURRENT_PRIVACY_VERSION)).toBe(true);
  });

  it("audit actions are deterministic and kind-scoped", () => {
    expect(buildLegalAcceptanceAuditAction("terms")).toBe("legal.terms_accepted");
    expect(buildLegalAcceptanceAuditAction("privacy")).toBe("legal.privacy_accepted");
  });

  it("draft copy claims stay within implemented product (no invented certifications)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "..", "..", "apps", "web", "src", "app");
    // When run from packages/platform, apps/web is ../../apps/web
    const termsPath = path.join(root, "terms", "page.tsx");
    const privacyPath = path.join(root, "privacy", "page.tsx");
    const terms = await fs.readFile(termsPath, "utf8");
    const privacy = await fs.readFile(privacyPath, "utf8");
    for (const text of [terms, privacy]) {
      expect(text).toMatch(/pending attorney review/i);
      expect(text).not.toMatch(/SOC 2 certified/i);
      expect(text).not.toMatch(/CJIS[- ]ready/i);
      expect(text).not.toMatch(/guaranteed citation accuracy/i);
    }
    // Draft copy may wrap "Human" / "attorney" across JSX whitespace.
    expect(terms).toMatch(/Human\s+attorney/i);
    expect(terms).toMatch(/Nyaya Prosecution/);
    expect(privacy).toMatch(/Subprocessors|subprocessors/);
  });
});
