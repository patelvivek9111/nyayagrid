import { describe, expect, it } from "vitest";
import { assessRetrievedEvidenceDeterministic } from "./evidence-assessment";
import type { AssessmentPassage } from "./evidence-assessment";

const NOW = new Date(Date.UTC(2026, 8, 10));

function passage(chunkId: string, quote: string): AssessmentPassage {
  return {
    chunkId,
    documentId: `doc_${chunkId}`,
    documentVersionId: `ver_${chunkId}`,
    quote,
  };
}

const CURRENT_NOTICE_Q =
  "As of 2026-09-10, how many days' written notice is currently operative for convenience termination?";

describe("amendment-chain operative notice", () => {
  it("original only: the base notice remains operative", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      CURRENT_NOTICE_Q,
      [
        passage(
          "chunk_base",
          "Section 7. Termination for convenience requires 40 days' written notice until a later effective amendment says otherwise.",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("established");
    expect(assessment?.operativeTerm).toBe("40 days");
  });

  it("one later-effective amendment: original outranks until the effective date", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      CURRENT_NOTICE_Q,
      [
        passage(
          "chunk_base",
          "Section 7. Termination for convenience requires 40 days' written notice until a later effective amendment says otherwise.",
        ),
        passage(
          "chunk_amd",
          "Amendment No. 1, signed 2026-06-15, effective 2026-10-15. Section 7 is amended: convenience notice becomes 25 days only on and after 2026-10-15.",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("established");
    expect(assessment?.operativeTerm).toBe("40 days");
    expect(assessment?.allowedClaim).toMatch(/not yet effective/i);
    expect(assessment?.allowedClaim).not.toMatch(/currently 25/i);
  });

  it("multiple amendments: later eligible amendment outranks, future one does not", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      CURRENT_NOTICE_Q,
      [
        passage(
          "chunk_base",
          "Section 7. Termination for convenience requires 60 days' written notice until a later effective amendment says otherwise.",
        ),
        passage(
          "chunk_amd1",
          "This amendment is signed and Section 7 is deleted and replaced: notice shall be thirty (30) days, effective immediately.",
        ),
        passage(
          "chunk_amd2",
          "Amendment No. 2 is signed and becomes effective 2026-10-15. On that effective date only, the notice period will become 12 days.",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("established");
    expect(assessment?.operativeTerm).toBe("30 days");
    expect(assessment?.allowedClaim).toMatch(/12 days/i);
    expect(assessment?.allowedClaim).toMatch(/not yet effective/i);
  });

  it("future-effective amendment is not treated as current", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      CURRENT_NOTICE_Q,
      [
        passage(
          "chunk_base",
          "Section 7. Termination for convenience requires 16 days' written notice until a later effective amendment says otherwise.",
        ),
        passage(
          "chunk_future",
          "Amendment No. 1 signed 2026-06-15 becomes effective 2026-10-15. Thereafter notice shall be 22 days.",
        ),
      ],
      NOW,
    );
    expect(assessment?.operativeTerm).toBe("16 days");
    expect(assessment?.limitations).toEqual(
      expect.arrayContaining([expect.stringMatching(/later-effective amendment is not yet operative/i)]),
    );
  });

  it("expired amendment is not treated as current", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      CURRENT_NOTICE_Q,
      [
        passage(
          "chunk_base",
          "Section 7. Termination for convenience requires 28 days' written notice until a later effective amendment says otherwise.",
        ),
        passage(
          "chunk_expired",
          "This amendment, signed 2025-01-15, becomes effective 2025-02-01. Formal notice now requires 9 days. This amendment expired on 2026-06-01.",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("established");
    expect(assessment?.operativeTerm).toBe("28 days");
    expect(assessment?.operativeTerm).not.toBe("9 days");
  });

  it("amendment that does not modify the queried provision is not inferred as supersession", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      CURRENT_NOTICE_Q,
      [
        passage(
          "chunk_base",
          "Section 7. Termination for convenience requires 33 days' written notice until a later effective amendment says otherwise.",
        ),
        passage(
          "chunk_unrelated",
          "Amendment No. 1 signed 2026-06-15, effective immediately. Section 9 liability cap is increased to $118,650. This amendment does not modify, change, amend, or alter the notice period.",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("established");
    expect(assessment?.operativeTerm).toBe("33 days");
  });

  it("unsigned draft amendment is not treated as operative", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      CURRENT_NOTICE_Q,
      [
        passage(
          "chunk_base",
          "Section 7. Termination for convenience requires 20 days' written notice until a later effective amendment says otherwise.",
        ),
        passage(
          "chunk_draft",
          "UNSIGNED AMENDMENT 2 DRAFT. Draft only. Not signed. Formal notice now requires 99 days if signed, which it was not.",
        ),
      ],
      NOW,
    );
    expect(assessment?.operativeTerm).toBe("20 days");
    expect(assessment?.operativeTerm).not.toBe("99 days");
  });
});

describe("meeting-date contradiction preservation", () => {
  it("keeps both meeting dates on a what-date question", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "On what date did the in-person file-review meeting occur?",
      [
        passage(
          "chunk_minutes",
          "Meeting minutes: in-person file-review meeting on 2026-02-19. Reed Anand attended.",
        ),
        passage(
          "chunk_witness",
          "Unsigned statement of a hallway observer: the meeting was on 2026-03-08, not 2026-02-19.",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).toBe("contradicted");
    expect(assessment?.allowedClaim).toMatch(/2026-02-19/);
    expect(assessment?.allowedClaim).toMatch(/2026-03-08/);
    expect(assessment?.allowedClaim).not.toMatch(/do not provide sufficient evidence to answer/i);
  });

  it("does not declare a contradiction when only one meeting date is retrieved", () => {
    const assessment = assessRetrievedEvidenceDeterministic(
      "On what date did the in-person file-review meeting occur?",
      [
        passage(
          "chunk_minutes",
          "Meeting minutes: in-person file-review meeting on 2026-02-19. Reed Anand attended.",
        ),
      ],
      NOW,
    );
    expect(assessment?.status).not.toBe("contradicted");
  });
});
