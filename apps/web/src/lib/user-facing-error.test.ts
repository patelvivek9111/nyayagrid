import { describe, expect, it } from "vitest";
import {
  USER_FACING_ASK_ERROR,
  sanitizeUserFacingError,
} from "./user-facing-error";

describe("sanitizeUserFacingError", () => {
  it("keeps a professional product message", () => {
    expect(sanitizeUserFacingError("You do not have permission to perform this action.")).toBe(
      "You do not have permission to perform this action.",
    );
  });

  it("does not surface provider or database internals", () => {
    expect(sanitizeUserFacingError("ECONNRESET from openai")).toBe(
      "NyayaGrid could not complete this request. Your case data is unchanged. Try again.",
    );
    expect(sanitizeUserFacingError("TypeError: Cannot read properties of undefined")).toContain(
      "could not complete",
    );
    expect(sanitizeUserFacingError("Ask failed")).toBe(USER_FACING_ASK_ERROR);
    expect(sanitizeUserFacingError("Failed to load drafts")).toBe(
      "We couldn't load drafts. Try again.",
    );
    expect(sanitizeUserFacingError("Request failed")).toContain("could not complete");
    expect(sanitizeUserFacingError("Matter is not in this organization")).toBe(
      "That case is not in this firm.",
    );
  });

  it("uses the Ask fallback when empty", () => {
    expect(sanitizeUserFacingError("", USER_FACING_ASK_ERROR)).toBe(USER_FACING_ASK_ERROR);
  });
});
