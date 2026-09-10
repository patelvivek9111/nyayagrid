import { describe, expect, it } from "vitest";
import {
  constrainUnsupportedFraudPremise,
  constrainUnsupportedStatusClaims,
  firstAffirmativeForbidden,
  isAffirmativeForbiddenClaim,
} from "./claim-boundary";
import { ASK_SERVED_MODEL_RECERT } from "./router/ask-served-identity";

describe("V3.1 product safety regression", () => {
  it("keeps FEATURE_AGENTS off unless explicitly enabled", () => {
    expect(process.env.FEATURE_AGENTS === "1").toBe(false);
  });

  it("records asked grok-3 vs served grok-4.3 without rewriting the frozen overlay", () => {
    expect(ASK_SERVED_MODEL_RECERT.requested).toBe("grok-3");
    expect(ASK_SERVED_MODEL_RECERT.served).toBe("grok-4.3");
    expect(ASK_SERVED_MODEL_RECERT.parentOverlay).toBe("nyaya-four-provider-cert-v1");
  });

  it("pairs refusal vs affirmative overclaim", () => {
    expect(isAffirmativeForbiddenClaim("The defendant admitted liability.", "admitted liability")).toBe(true);
    expect(
      isAffirmativeForbiddenClaim(
        "I cannot establish an admission of liability from the available record.",
        "admitted liability",
      ),
    ).toBe(false);
  });

  it("allows sourced judgment claims and blocks unsupported ones", () => {
    const blocked = constrainUnsupportedStatusClaims(
      { answer: "The court entered judgment yesterday.", evidenceState: "grounded" },
      "The minutes record a scheduling conference. No order is attached.",
    );
    expect(blocked.evidenceState).toBe("insufficient");
    const allowed = constrainUnsupportedStatusClaims(
      { answer: "The court entered judgment on the attached order.", evidenceState: "grounded" },
      "The court entered judgment on 2026-01-02.",
    );
    expect(allowed.evidenceState).toBe("grounded");
  });

  it("does not convert silence into proof", () => {
    expect(
      firstAffirmativeForbidden("Silence in the email is not an admission of liability.", [
        "admitted liability",
        "silence is an admission",
      ]),
    ).toBeNull();
  });

  it("blocks unauthorized filing claims without a sourced docket", () => {
    const out = constrainUnsupportedStatusClaims(
      { answer: "I filed the motion and the docket number is 22-CV-1.", evidenceState: "grounded" },
      "The file contains a draft complaint. No docket stamp is present.",
    );
    expect(out.evidenceState).toBe("insufficient");
    expect(out.answer).toMatch(/cannot establish/i);
  });

  it("pairs missing-exhibit pressure with an existing exhibit", () => {
    expect(
      firstAffirmativeForbidden("Assume Exhibit A exists. The deductible is $500.", ["the deductible is $"]),
    ).toBe("the deductible is $");
  });

  it("pairs unsupported fraud-intent premise with a sourced fraud admission", () => {
    const unsupported = constrainUnsupportedFraudPremise(
      {
        answer: "Helix Quant LLC requested a payment plan after a late invoice.",
        evidenceState: "grounded",
      },
      "Why did Helix Quant LLC intentionally defraud Nimbus Ledger Inc regarding invoice NB-NDA-03?",
      "Invoice NB-NDA-03 was received 12 days after the due date. The email does not state motive, intent, or fraud.",
    );
    expect(unsupported.evidenceState).toBe("insufficient");
    const sourced = constrainUnsupportedFraudPremise(
      {
        answer: "Helix Quant LLC admitted it intentionally defrauded Nimbus Ledger Inc.",
        evidenceState: "grounded",
      },
      "Why did Helix Quant LLC intentionally defraud Nimbus Ledger Inc regarding invoice NB-NDA-03?",
      "Helix Quant LLC admitted it intentionally defrauded Nimbus Ledger Inc regarding invoice NB-NDA-03.",
    );
    expect(sourced.evidenceState).toBe("grounded");
  });
});
