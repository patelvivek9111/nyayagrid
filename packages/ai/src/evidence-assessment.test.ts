import { describe, expect, it } from "vitest";
import {
  assessRetrievedEvidence,
  assessRetrievedEvidenceDeterministic,
  constrainCitedAnswer,
  parseEvidenceAssessment,
  type AssessmentPassage,
} from "./evidence-assessment";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function passage(chunkId: string, quote: string, documentId = `doc_${chunkId}`): AssessmentPassage {
  return {
    chunkId,
    documentId,
    documentVersionId: `${documentId}_v1`,
    quote,
  };
}

describe("structured evidence assessment", () => {
  it("establishes a direct stated amount", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "What is the purchase price?",
      [passage("chunk_price", "The purchase price is $100,000.")],
      NOW,
    );
    expect(assessment?.status).toBe("established");
    expect(assessment?.allowedClaim).toContain("$100,000");
  });

  it("does not establish a named person physically acted from an activity record", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "At what time did Morgan Hale physically enter the records room?",
      [
        passage(
          "chunk_log",
          "Credential assigned to Morgan Hale — ACCESS GRANTED at 11:03. This log records credential activity.",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("not_established");
    expect(assessment?.premiseStatus).toBe("unsupported");
    expect(assessment?.prohibitedOverclaims).toEqual(
      expect.arrayContaining(["physically entered"]),
    );
    expect(assessment?.allowedClaim).toMatch(/ACCESS GRANTED|logged system/i);
    expect(assessment?.allowedClaim.toLowerCase()).toMatch(/does not independently prove who/);
    expect(assessment?.allowedClaim.toLowerCase()).not.toMatch(/physically entered/);
  });

  it("may support an actor claim when independent evidence corroborates the activity record", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "Did Morgan Hale personally use the credential at the records room?",
      [
        passage("chunk_log", "Credential assigned to Morgan Hale — ACCESS GRANTED at 11:03."),
        passage(
          "chunk_video",
          "Camera footage shows Morgan Hale used the credential at the records room at 11:03.",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("supported");
    expect(assessment?.allowedClaim).toMatch(/Morgan Hale used the credential/i);
  });

  it("marks a retroactivity premise contradicted by a later effective date", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "Why did the parties make the second amendment retroactive to March 1, 2024?",
      [passage("chunk_amend", "This amendment becomes effective January 1, 2027.")],
      NOW,
    );
    expect(assessment?.premiseStatus).toBe("contradicted");
    expect(assessment?.allowedClaim).toMatch(/do not support that premise/i);
    expect(assessment?.allowedClaim).toMatch(/not retroactive/i);
    expect(assessment?.allowedClaim).toMatch(/January 1, 2027|2027-01-01/);
  });

  it("returns the future operative term when the question date is after the effective date", () => {
    const passages = [
      passage("chunk_base", "Notice shall be sixty (60) days."),
      passage(
        "chunk_future",
        "This amendment is signed and becomes effective January 1, 2027; thereafter notice shall be forty-five (45) days. Beginning 2027-01-01, a party may terminate for convenience on ninety (90) days written notice.",
      ),
    ];
    const assessment = assessRetrievedEvidenceDeterministic(
      "What notice period will apply on January 2, 2027?",
      passages,
      NOW,
    );
    expect(assessment?.status).toBe("established");
    expect(assessment?.operativeTerm).toBe("45 days");
    expect(assessment?.allowedClaim).toMatch(/forty-five \(45\)/i);
    expect(assessment?.operativeTerm).not.toBe("90 days");
  });

  it("returns the current operative term before a future-effective amendment", () => {
    const passages = [
      passage("chunk_base", "Notice shall be sixty (60) days."),
      passage(
        "chunk_now",
        "Section 4 is deleted and replaced: notice shall be thirty (30) days, effective immediately.",
      ),
      passage(
        "chunk_future",
        "This amendment is signed and becomes effective January 1, 2027; thereafter notice shall be forty-five (45) days.",
      ),
    ];
    const assessment = assessRetrievedEvidenceDeterministic(
      "What notice period currently applies as of November 2026?",
      passages,
      NOW,
    );
    expect(assessment?.status).toBe("established");
    expect(assessment?.operativeTerm).toBe("30 days");
    expect(assessment?.allowedClaim).toMatch(/not yet effective/i);
    expect(assessment?.allowedClaim).not.toMatch(/currently forty-five/i);
  });

  it("treats document silence as local absence, not a universal negative", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "Did the vendor ever issue a service credit?",
      [passage("chunk_invoice", "This invoice does not reflect any service credit.")],
      NOW,
    );
    expect(assessment?.status).toBe("not_established");
    expect(assessment?.premiseStatus).toBe("unsupported");
    expect(assessment?.prohibitedOverclaims).toEqual(
      expect.arrayContaining(["never issued", "no credit was ever"]),
    );
    expect(assessment?.allowedClaim).toMatch(/this invoice does not reflect/i);
    expect(assessment?.allowedClaim).not.toMatch(/never issued/i);
  });

  it("reports genuine date conflict as contradicted", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "The memo and the email appear to contradict each other on the payment date. Which date controls?",
      [
        passage("chunk_memo", "Payment was posted on 2026-03-01."),
        passage("chunk_email", "Payment was posted on 2026-03-15."),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("contradicted");
    expect(assessment?.allowedClaim).toMatch(/2026-03-01 vs 2026-03-15/);
  });

  it("keeps approximate timing instead of converting it to an exact date", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "When did delivery occur?",
      [passage("chunk_note", "Delivery occurred near the middle of November.")],
      NOW,
    );
    expect(assessment?.status).toBe("supported");
    expect(assessment?.prohibitedOverclaims).toEqual(expect.arrayContaining(["exactly"]));
    expect(assessment?.allowedClaim).toMatch(/near the middle of November/i);
    expect(assessment?.allowedClaim).not.toMatch(/November 15/);
  });

  it("rejects malformed LLM assessments", () => {
    expect(parseEvidenceAssessment({ status: "maybe" })).toBeNull();
    expect(parseEvidenceAssessment({ proposition: "", status: "established" })).toBeNull();
  });

  it("falls back without inventing an answer when the assessor throws", async () => {
    const result = await assessRetrievedEvidence({
      question: "Who physically entered the records room?",
      passages: [passage("chunk_a", "The filing is discussed without a date.")],
      ai: {
        generate: async () => {
          throw new Error("assessment timeout");
        },
      },
      now: NOW,
    });
    expect(result.failure).toBe("assessment timeout");
    expect(result.source).toBe("failed");
    expect(result.assessment).toBeNull();
  });

  it("does not treat an informal email question as a current-term duration lookup", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "An internal email says the contract still says 45 days. Should that be treated as the current contractual requirement?",
      [
        passage("chunk_email", "I think the contract still says 45 days."),
        passage(
          "chunk_signed",
          "Section 4 is deleted and replaced: notice shall be thirty (30) days, effective immediately.",
        ),
        passage(
          "chunk_future",
          "Beginning 2027-01-01, a party may terminate for convenience on ninety (90) days.",
        ),
      ],
      NOW,
    );
    expect(assessment?.allowedClaim).toMatch(/thirty \(30\)/);
    expect(assessment?.operativeTerm).toBe("30 days");
    expect(assessment?.operativeTerm).not.toBe("90 days");
  });

  it("treats signed days-written-notice language as the notice period", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "What notice period does the signed agreement require?",
      [
        passage("chunk_email", "I think the notice period is 60 days."),
        passage(
          "chunk_signed",
          "Section 4 is amended to require thirty (30) days' written notice, effective immediately.",
        ),
      ],
      NOW,
    );
    expect(assessment?.operativeTerm).toBe("30 days");
  });

  it("does not treat an unamended original amount as the outstanding balance", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "What was the outstanding principal balance on August 3, 2026?",
      [
        passage("chunk_mod", "Principal. No change to original principal amount."),
        passage("chunk_note", "Original principal amount: $2,500,000."),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("not_established");
    expect(assessment?.prohibitedOverclaims.join(" ")).toMatch(/original principal/i);
  });

  it("rewrites a prohibited overclaim to the allowed claim", () => {
    const passages = [
      passage("chunk_log", "Credential assigned to Morgan Hale — ACCESS GRANTED at 11:03."),
    ];
    const assessment = assessRetrievedEvidenceDeterministic(
      "When did Morgan Hale physically enter?",
      passages,
      NOW,
    );
    expect(assessment).toBeTruthy();
    const constrained = constrainCitedAnswer(
      {
        answer: "Morgan Hale physically entered at 11:03.",
        evidenceState: "grounded" as const,
        sources: [],
      },
      assessment!,
      passages,
    );
    expect(constrained.answer.toLowerCase()).not.toContain("physically entered");
    expect(constrained.evidenceState).toBe("partial");
  });

  it("keeps a supported numeric term through constrainCitedAnswer", () => {
    const passages = [
      passage("chunk_base", "Notice shall be sixty (60) days."),
      passage(
        "chunk_now",
        "Section 4 is deleted and replaced: notice shall be thirty (30) days, effective immediately.",
      ),
      passage("chunk_email", "I think the contract still says 60 days."),
    ];
    const assessment = assessRetrievedEvidenceDeterministic(
      "What notice period currently applies as of November 2026?",
      passages,
      NOW,
    );
    expect(assessment?.operativeTerm).toBe("30 days");
    const constrained = constrainCitedAnswer(
      {
        answer:
          "The signed or amended instrument controls. Informal recollection does not override it.",
        evidenceState: "grounded" as const,
        sources: [
          {
            documentId: "doc_chunk_now",
            documentVersionId: "doc_chunk_now_v1",
            chunkId: "chunk_now",
            quote: "notice shall be thirty (30) days, effective immediately.",
          },
        ],
      },
      assessment!,
      passages,
    );
    expect(constrained.answer).toMatch(/30 days/);
    expect(constrained.answer.toLowerCase()).not.toMatch(
      /^the signed or amended instrument controls/,
    );
    expect(constrained.sources[0]?.chunkId).toBe("chunk_now");
  });

  it("does not treat approximate mid-month language as contradicting an exact date in that month", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      'Is "near the middle of November" inconsistent with the meeting date 2026-11-10?',
      [
        passage(
          "chunk_depo",
          "Q. When was the pricing issue discussed? A. Near the middle of November, at the review meeting.",
        ),
        passage("chunk_minutes", "The review meeting was held on 2026-11-10."),
      ],
      NOW,
    );
    expect(assessment?.status).not.toBe("contradicted");
    expect(assessment?.allowedClaim.toLowerCase()).toMatch(/compatible|precision/);
    expect(assessment?.prohibitedOverclaims.join(" ")).toMatch(/inconsistent/);
  });

  it("does not turn a missing named exhibit into a dollar determination", () => {
    const passages = [passage("chunk_inv", "Invoice INV-2606: Amount due $132,500.")];
    const assessment = assessRetrievedEvidenceDeterministic(
      "What exact amount appears in Exhibit Z - Cost Reconciliation?",
      passages,
      NOW,
    );
    expect(assessment?.status).toBe("not_established");
    const constrained = constrainCitedAnswer(
      {
        answer: "$132,500",
        evidenceState: "grounded" as const,
        sources: [],
      },
      assessment!,
      passages,
    );
    expect(constrained.answer).not.toMatch(/^\$132,500$/);
    expect(constrained.answer.toLowerCase()).toMatch(/not established|do not include/);
    expect(constrained.evidenceState).not.toBe("grounded");
  });

  it("preserves the supporting citation when injecting an omitted operative term", () => {
    const passages = [
      passage(
        "chunk_signed",
        "Section 4 is deleted and replaced: notice shall be thirty (30) days, effective immediately.",
      ),
      passage("chunk_email", "I think the contract still says 60 days."),
    ];
    const assessment = assessRetrievedEvidenceDeterministic(
      "An internal email says the contract still says 60 days. Should that be treated as the current contractual requirement?",
      passages,
      NOW,
    );
    expect(assessment?.operativeTerm).toBe("30 days");
    const constrained = constrainCitedAnswer(
      {
        answer: "The email is informal and the signed amendment controls.",
        evidenceState: "grounded" as const,
        sources: [
          {
            chunkId: "chunk_signed",
            documentId: "doc_chunk_signed",
            documentVersionId: "doc_chunk_signed_v1",
            quote: "notice shall be thirty (30) days, effective immediately.",
          },
        ],
      },
      assessment!,
      passages,
    );
    expect(constrained.answer).toMatch(/30 days/);
    expect(constrained.sources.some((s) => s.chunkId === "chunk_signed")).toBe(true);
  });

  it("selects the same duration given the same passages (reproducible assessment)", () => {
    const passages = [
      passage("chunk_base", "Notice shall be sixty (60) days."),
      passage(
        "chunk_now",
        "Section 4 is deleted and replaced: notice shall be thirty (30) days, effective immediately.",
      ),
      passage(
        "chunk_future",
        "This amendment is signed and becomes effective January 1, 2027; thereafter notice shall be forty-five (45) days.",
      ),
    ];
    const first = assessRetrievedEvidenceDeterministic(
      "As of November 2026, what formal notice period currently applies?",
      passages,
      NOW,
    );
    const second = assessRetrievedEvidenceDeterministic(
      "As of November 2026, what formal notice period currently applies?",
      passages,
      NOW,
    );
    expect(first).toEqual(second);
    expect(first?.operativeTerm).toBe("30 days");
  });

  it("treats testimony denial vs badge access as tension, not date-precision compatibility", () => {
    const passages = [
      passage(
        "chunk_depo",
        "Q. When was the pricing issue discussed? A. Near the middle of November, at the review meeting. Q. Did you enter the records room that day? A. No. I never entered the records room on 2026-11-10.",
      ),
      passage(
        "chunk_log",
        "2026-11-10 14:47 - Badge JM-001 assigned to Jordan A. Mercer - Records Room - ACCESS GRANTED.",
      ),
    ];
    const assessment = assessRetrievedEvidenceDeterministic(
      "Does Jordan A. Mercer's testimony about entering the records room conflict with other supplied evidence?",
      passages,
      NOW,
    );
    expect(assessment?.operativeTerm).toBe("tension");
    expect(assessment?.allowedClaim.toLowerCase()).toMatch(/evidentiary tension/);
    expect(assessment?.allowedClaim.toLowerCase()).toMatch(/does not conclusively prove who/);
    expect(assessment?.allowedClaim.toLowerCase()).not.toMatch(/difference of precision/);
  });

  it("keeps approximate vs exact meeting-date questions compatible", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      'Is "near the middle of November" inconsistent with the meeting date 2026-11-10?',
      [
        passage(
          "chunk_depo",
          "Q. When was the pricing issue discussed? A. Near the middle of November, at the review meeting. Q. Did you enter the records room that day? A. No. I never entered the records room on 2026-11-10.",
        ),
        passage("chunk_minutes", "The review meeting was held on 2026-11-10."),
        passage(
          "chunk_log",
          "2026-11-10 14:47 - Badge JM-001 assigned to Jordan A. Mercer - Records Room - ACCESS GRANTED.",
        ),
      ],
      NOW,
    );
    expect(assessment?.operativeTerm).toBe("compatible");
  });

  it("does not treat convenience-termination days as the current notice period", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "An internal email says the contract still says 45 days. Should that be treated as the current contractual requirement?",
      [
        passage("chunk_email", "I think the contract still says 45 days."),
        passage(
          "chunk_original",
          "Except where a later amendment expressly provides otherwise, formal notice requires 45 days.",
        ),
        passage(
          "chunk_amend1",
          "Effective 2026-09-11, Section 4 is deleted and replaced. Formal notice now requires 30 days.",
        ),
        passage(
          "chunk_amend2",
          "Signed 2026-10-06. The amendment becomes effective 2027-01-01. On that effective date only, the notice period in Section 4 will become 45 days. Beginning 2027-01-01, Party A may terminate for convenience on 90 days written notice.",
        ),
        passage(
          "chunk_minutes",
          "Review meeting held 2026-11-10. Amendment 1 changed the current notice period to 30 days.",
        ),
      ],
      NOW,
    );
    expect(assessment?.operativeTerm).toBe("45 days");
    expect(assessment?.operativeTerm).not.toBe("90 days");
    expect(assessment?.allowedClaim).toMatch(/30 days/);
    expect(assessment?.allowedClaim).toMatch(/2026-09-11/);
  });

  it("does not treat invoice silence as proof that a credit was actually issued or paid", () => {
    const passages = [
      passage(
        "chunk_invoice",
        "Monthly service fee billed: $68,000. No service credits reflected on this invoice.",
      ),
    ];
    const assessment = assessRetrievedEvidenceDeterministic(
      "Did Pioneer actually issue or pay a service credit for August?",
      passages,
      NOW,
    );
    expect(assessment?.status).toBe("not_established");
    expect(assessment?.prohibitedOverclaims.join(" ")).toMatch(/did not issue or pay/i);
    const constrained = constrainCitedAnswer(
      {
        answer:
          "Pioneer did not issue or pay a service credit for August. The invoice shows $68,000 with no credits.",
        evidenceState: "partial" as const,
        sources: [],
      },
      assessment!,
      passages,
    );
    expect(constrained.answer.toLowerCase()).not.toMatch(/did not issue or pay a service credit/);
    expect(constrained.answer.toLowerCase()).toMatch(/does not prove|absence from this document/);
  });

  it("treats a named instrument that is not in retrieval as insufficient, not lease-guessable", () => {
    const passages = [
      passage("chunk_lease_term", "The lease term commences on January 1, 2024.", "doc_lease"),
    ];
    const assessment = assessRetrievedEvidenceDeterministic(
      "How does the amendment change the indemnity obligation?",
      passages,
      NOW,
    );
    expect(assessment?.status).toBe("insufficient");
    expect(assessment?.allowedClaim).toMatch(/do not include/i);
    const constrained = constrainCitedAnswer(
      {
        answer: "The lease does not change indemnity; Section 9 still applies from the original term.",
        evidenceState: "grounded" as const,
        sources: [],
      },
      assessment!,
      passages,
    );
    expect(constrained.evidenceState).toBe("insufficient");
    expect(constrained.answer.toLowerCase()).toMatch(/do not include/);
    const partialConstrained = constrainCitedAnswer(
      {
        answer: "The lease still governs indemnity in relevant part.",
        evidenceState: "partial" as const,
        sources: [],
      },
      assessment!,
      passages,
    );
    expect(partialConstrained.evidenceState).toBe("insufficient");
  });

  it("does not flag a missing amendment when the amendment document is retrieved", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "How does the amendment change the indemnity obligation?",
      [
        passage(
          "chunk_amend_indemnity",
          "Section 9 (Indemnity) is deleted in its entirety and replaced with: Tenant shall indemnify Landlord only for third-party claims arising from Tenant's negligence.",
          "doc_amendment",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).not.toBe("insufficient");
  });
});
