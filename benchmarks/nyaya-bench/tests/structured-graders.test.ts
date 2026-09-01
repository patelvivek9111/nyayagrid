import { describe, expect, it } from "vitest";
import { gradeAnswer } from "../graders/grade";
import { loadGroundTruth } from "../graders/load-ground-truth";
import {
  expectedSemanticClass,
  infersPhysicalActorFromSystemActivity,
  isBadgeVersusTestimonyPair,
  isImpreciseDateVersusExactPair,
  mapFindingToSemanticClass,
} from "../graders/semantic-map";
import type {
  CanonicalCompareOutput,
  CanonicalContradictionOutput,
} from "../graders/structured-schemas";
import type { PersistedAnswer } from "../graders/types";

function answer(overrides: Partial<PersistedAnswer>): PersistedAnswer {
  return {
    dataset: "v2",
    scenarioId: "SYNTH-V2-001",
    taskId: "SYNTH-V2-001-T007",
    category: "contract_compare",
    prompt: "Identify the substantive changes made by Amendment 1.",
    answer: "{}",
    evidenceState: "subsystem",
    citations: [],
    assumptions: [],
    unresolvedQuestions: [],
    retrievedChunkIds: [],
    provider: "mock",
    model: "mock",
    promptVersion: null,
    artifactId: null,
    conversationId: null,
    latencyMs: 1,
    persistedAt: new Date().toISOString(),
    extras: { executionTarget: "contract_compare" },
    ...overrides,
  };
}

function compareOutput(overrides: Partial<CanonicalCompareOutput> = {}): CanonicalCompareOutput {
  return {
    taskId: "SYNTH-V2-001-T007",
    comparisonId: "cmp-1",
    leftDocumentId: "doc-a",
    rightDocumentId: "doc-b",
    leftFilename: "01_Main_Agreement.pdf",
    rightFilename: "02_Amendment_1.pdf",
    changes: [
      {
        before: "Written notice of 45 days is required.",
        after: "Written notice of 30 days is required.",
        changeType: "changed",
        materiality: "review",
        locationA: "paragraph 4",
        locationB: "paragraph 4",
        sourceReferences: [
          {
            documentId: "doc-a",
            documentVersionId: "v-a",
            filename: "01_Main_Agreement.pdf",
            location: "paragraph 4",
          },
          {
            documentId: "doc-b",
            documentVersionId: "v-b",
            filename: "02_Amendment_1.pdf",
            location: "paragraph 4",
          },
        ],
      },
      {
        before: "Liability is capped at $255,000.",
        after: "Liability is capped at $510,000.",
        changeType: "changed",
        materiality: "high_attention",
        locationA: "paragraph 9",
        locationB: "paragraph 9",
        sourceReferences: [
          {
            documentId: "doc-a",
            documentVersionId: "v-a",
            filename: "01_Main_Agreement.pdf",
            location: "paragraph 9",
          },
          {
            documentId: "doc-b",
            documentVersionId: "v-b",
            filename: "02_Amendment_1.pdf",
            location: "paragraph 9",
          },
        ],
      },
    ],
    summary:
      "Notice period changed from 45 to 30 days. Liability cap changed from $255,000 to $510,000.",
    citations: [
      {
        documentId: "doc-a",
        documentVersionId: "v-a",
        filename: "01_Main_Agreement.pdf",
        location: null,
      },
      {
        documentId: "doc-b",
        documentVersionId: "v-b",
        filename: "02_Amendment_1.pdf",
        location: null,
      },
    ],
    summaryAlignment: "aligned",
    summaryUnsupportedClaimCount: 0,
    ...overrides,
  };
}

function contradictionOutput(
  findings: CanonicalContradictionOutput["findings"] = [],
): CanonicalContradictionOutput {
  return { taskId: "SYNTH-V2-001-T010", findings };
}

describe("structured Compare grader", () => {
  const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T007")!;
  const decoyGt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T008")!;
  const typoGt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T009")!;

  it("grades structured change rows, not chat needles in serialized JSON", () => {
    const structured = compareOutput();
    const result = gradeAnswer(
      answer({
        extras: {
          executionTarget: "contract_compare",
          structuredKind: "compare",
          structuredOutput: structured,
        },
      }),
      gt,
    );
    expect(result.graderKind).toBe("compare");
    expect(result.verdict).toBe("pass");
    expect(result.needlesRequired).toEqual([]);
  });

  it("fails when before/after values are reversed", () => {
    const structured = compareOutput({
      changes: [
        {
          before: "Liability is capped at $510,000.",
          after: "Liability is capped at $255,000.",
          changeType: "changed",
          materiality: "high_attention",
          locationA: "paragraph 9",
          locationB: "paragraph 9",
          sourceReferences: [
            {
              documentId: "doc-a",
              documentVersionId: "v-a",
              filename: "01_Main_Agreement.pdf",
              location: "paragraph 9",
            },
            {
              documentId: "doc-b",
              documentVersionId: "v-b",
              filename: "02_Amendment_1.pdf",
              location: "paragraph 9",
            },
          ],
        },
      ],
    });
    const result = gradeAnswer(
      answer({
        extras: {
          executionTarget: "contract_compare",
          structuredKind: "compare",
          structuredOutput: structured,
        },
      }),
      gt,
    );
    expect(result.verdict).toBe("fail");
    expect(result.criticalFailure).toBe(true);
    expect(result.failureTaxonomy).toBe("numeric extraction");
  });

  it("does not treat a negated administrative summary as decoy promotion", () => {
    const structured = compareOutput({
      leftFilename: "01_Main_Agreement.pdf",
      rightFilename: "02_Amendment_1.pdf",
      changes: [
        {
          before: "Exhibit A",
          after: "Exhibit B — administrative and non-substantive renumbering",
          changeType: "changed",
          materiality: "informational",
          locationA: "paragraph 12",
          locationB: "paragraph 12",
          sourceReferences: [
            {
              documentId: "doc-a",
              documentVersionId: "v-a",
              filename: "01_Main_Agreement.pdf",
              location: "paragraph 12",
            },
            {
              documentId: "doc-b",
              documentVersionId: "v-b",
              filename: "02_Amendment_1.pdf",
              location: "paragraph 12",
            },
          ],
        },
      ],
      summary:
        "Added administrative changes including renumbering. No substantive changes to obligations or agreements.",
    });
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T008",
        category: "contract_decoy",
        prompt:
          "Did Amendment 1 materially change the agreement by renumbering Exhibit A to Exhibit B?",
        extras: {
          executionTarget: "contract_compare",
          structuredKind: "compare",
          structuredOutput: structured,
        },
      }),
      decoyGt,
    );
    expect(result.verdict).toBe("pass");
  });

  it("does not promote exhibit renumbering as material", () => {
    const structured = compareOutput({
      leftFilename: "01_Main_Agreement.pdf",
      rightFilename: "02_Amendment_1.pdf",
      changes: [
        {
          before: "Exhibit A",
          after: "Exhibit B — administrative and non-substantive renumbering",
          changeType: "changed",
          materiality: "informational",
          locationA: "paragraph 12",
          locationB: "paragraph 12",
          sourceReferences: [
            {
              documentId: "doc-a",
              documentVersionId: "v-a",
              filename: "01_Main_Agreement.pdf",
              location: "paragraph 12",
            },
            {
              documentId: "doc-b",
              documentVersionId: "v-b",
              filename: "02_Amendment_1.pdf",
              location: "paragraph 12",
            },
          ],
        },
      ],
      summary: "Exhibit identifier was renumbered as an administrative correction.",
    });
    const pass = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T008",
        category: "contract_decoy",
        prompt:
          "Did Amendment 1 materially change the agreement by renumbering Exhibit A to Exhibit B?",
        extras: {
          executionTarget: "contract_compare",
          structuredKind: "compare",
          structuredOutput: structured,
        },
      }),
      decoyGt,
    );
    expect(pass.verdict).toBe("pass");

    const promoted = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T008",
        category: "contract_decoy",
        prompt:
          "Did Amendment 1 materially change the agreement by renumbering Exhibit A to Exhibit B?",
        extras: {
          executionTarget: "contract_compare",
          structuredKind: "compare",
          structuredOutput: {
            ...structured,
            changes: structured.changes.map((row) => ({ ...row, materiality: "high_attention" })),
          },
        },
      }),
      decoyGt,
    );
    expect(promoted.verdict).toBe("fail");
    expect(promoted.criticalFailure).toBe(true);
    expect(promoted.failureTaxonomy).toBe("decoy promotion");
  });

  it("does not treat a typo correction as a substantive amendment", () => {
    const structured = compareOutput({
      changes: [
        {
          before: "Party shall recieve notices",
          after: "Party shall receive notices",
          changeType: "changed",
          materiality: "informational",
          locationA: "paragraph 2",
          locationB: "paragraph 2",
          sourceReferences: [
            {
              documentId: "doc-a",
              documentVersionId: "v-a",
              filename: "01_Main_Agreement.pdf",
              location: "paragraph 2",
            },
            {
              documentId: "doc-b",
              documentVersionId: "v-b",
              filename: "02_Amendment_1.pdf",
              location: "paragraph 2",
            },
          ],
        },
      ],
      summary: "Spelling of receive was corrected.",
    });
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T009",
        category: "contract_decoy",
        prompt: "Is correcting recieve to receive a substantive contractual change?",
        extras: {
          executionTarget: "contract_compare",
          structuredKind: "compare",
          structuredOutput: structured,
        },
      }),
      typoGt,
    );
    expect(result.verdict).toBe("pass");
  });

  it("fails when the compared filenames are the wrong pair", () => {
    const structured = compareOutput({
      leftFilename: "05_Deposition_Mercer.pdf",
      rightFilename: "06_Access_Log.pdf",
    });
    const result = gradeAnswer(
      answer({
        extras: {
          executionTarget: "contract_compare",
          structuredKind: "compare",
          structuredOutput: structured,
        },
      }),
      gt,
    );
    expect(result.verdict).toBe("fail");
    expect(result.failureTaxonomy).toBe("wrong version/document pair");
    expect(result.criticalFailure).toBe(true);
  });
});

describe("structured Contradiction grader", () => {
  const tensionGt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T010")!;
  const compatibleGt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T011")!;

  const tensionFinding = {
    findingId: "f1",
    productionFindingType: "contradiction",
    semanticClass: "contradiction" as const,
    statementA: "I never entered the records room.",
    statementB: "ACCESS GRANTED for assigned badge.",
    sourceA: [
      {
        documentId: "dep",
        documentVersionId: "v1",
        filename: "05_Deposition_Mercer.pdf",
        chunkId: "c1",
        supportingText: "I never entered the records room.",
        side: "A",
      },
    ],
    sourceB: [
      {
        documentId: "log",
        documentVersionId: "v1",
        filename: "06_Access_Log.pdf",
        chunkId: "c2",
        supportingText:
          "ACCESS GRANTED. Badge activity does not independently prove who carried the badge.",
        side: "B",
      },
    ],
    status: "proposed",
    title: "Testimony versus access log",
    explanation: "Evidentiary tension; the log does not prove who carried the badge.",
  };

  it("maps production cross-document contradiction to semantic tension for badge vs testimony", () => {
    expect(expectedSemanticClass(tensionGt)).toBe("tension");
    expect(
      isBadgeVersusTestimonyPair(`${tensionFinding.statementA} ${tensionFinding.statementB}`),
    ).toBe(true);
    expect(mapFindingToSemanticClass(tensionFinding)).toBe("tension");
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T010",
        category: "contradiction",
        prompt: "Does testimony about entering the records room conflict with other evidence?",
        extras: {
          executionTarget: "contradiction",
          structuredKind: "contradiction",
          structuredOutput: contradictionOutput([tensionFinding]),
        },
      }),
      tensionGt,
    );
    expect(result.graderKind).toBe("contradiction");
    expect(result.verdict).toBe("pass");
  });

  it("passes compatible approximate vs exact dates when no finding is raised", () => {
    expect(expectedSemanticClass(compatibleGt)).toBe("compatible");
    expect(isImpreciseDateVersusExactPair("near the middle of November versus 2026-11-10")).toBe(
      true,
    );
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T011",
        category: "false_contradiction",
        prompt: "Is near the middle of November inconsistent with 2026-11-10?",
        extras: {
          executionTarget: "contradiction",
          structuredKind: "contradiction",
          structuredOutput: contradictionOutput([]),
        },
      }),
      compatibleGt,
    );
    expect(result.verdict).toBe("pass");
  });

  it("fails when compatible dates are classified as a contradiction", () => {
    const finding = {
      ...tensionFinding,
      findingId: "f-date",
      statementA: "near the middle of November",
      statementB: "The meeting occurred on 2026-11-10.",
      sourceA: [
        {
          documentId: "dep",
          documentVersionId: "v1",
          filename: "05_Deposition_Mercer.pdf",
          chunkId: "c1",
          supportingText: "I think it was near the middle of November.",
          side: "A",
        },
      ],
      sourceB: [
        {
          documentId: "min",
          documentVersionId: "v1",
          filename: "08_Meeting_Minutes.pdf",
          chunkId: "c3",
          supportingText: "Meeting date 2026-11-10.",
          side: "B",
        },
      ],
      title: "Date contradiction",
      explanation: "These dates contradict.",
    };
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T011",
        category: "false_contradiction",
        extras: {
          executionTarget: "contradiction",
          structuredKind: "contradiction",
          structuredOutput: contradictionOutput([finding]),
        },
      }),
      compatibleGt,
    );
    expect(result.verdict).toBe("fail");
    expect(result.criticalFailure).toBe(true);
  });

  it("fails actor inference that turns badge activity into physical entry", () => {
    expect(
      infersPhysicalActorFromSystemActivity(
        "ACCESS GRANTED therefore the witness physically entered the records room.",
      ),
    ).toBe(true);
    const finding = {
      ...tensionFinding,
      explanation: "ACCESS GRANTED proves the witness physically entered the records room.",
      statementB: "ACCESS GRANTED. The assigned badge proves Mercer physically entered.",
    };
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T010",
        category: "contradiction",
        extras: {
          executionTarget: "contradiction",
          structuredKind: "contradiction",
          structuredOutput: contradictionOutput([finding]),
        },
      }),
      tensionGt,
    );
    expect(result.verdict).toBe("fail");
    expect(result.failureTaxonomy).toBe("actor inference");
    expect(result.criticalFailure).toBe(true);
  });

  it("does not treat leaked deposition/log chunks on an unrelated finding as tension", () => {
    const leaked = {
      ...tensionFinding,
      findingId: "f-notice",
      statementA:
        "Amendment 1 states that the formal notice period is now 60 days.\nACCESS GRANTED.\nI never entered the records room.",
      statementB: "The original agreement states that the notice period is 30 days unless amended.",
      sourceA: [
        ...tensionFinding.sourceA,
        {
          documentId: "amd",
          documentVersionId: "v1",
          filename: "02_Amendment_1.pdf",
          chunkId: "c-notice",
          supportingText: "Amendment 1 states that the formal notice period is now 60 days.",
          side: "A",
        },
      ],
      title: "Notice Period Discrepancy",
      explanation:
        "One source states that the notice period is currently 60 days due to Amendment 1, while another source indicates a 30-day notice period.",
    };
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T010",
        category: "contradiction",
        extras: {
          executionTarget: "contradiction",
          structuredKind: "contradiction",
          structuredOutput: contradictionOutput([leaked]),
        },
      }),
      tensionGt,
    );
    expect(result.verdict).toBe("fail");
    expect(result.failureTaxonomy).toBe("missed contradiction");
    expect(result.criticalFailure).toBe(false);
  });

  it("fails when structured output is missing after persistence", () => {
    const result = gradeAnswer(
      answer({
        extras: { executionTarget: "contradiction" },
      }),
      tensionGt,
    );
    expect(result.failureTaxonomy).toBe("infrastructure");
  });
});

describe("chat Case Q&A grader remains unchanged for case_qa targets", () => {
  it("still needle-grades Case Q&A answers", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T001")!;
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T001",
        category: "case_qa",
        extras: { executionTarget: "case_qa" },
        evidenceState: "grounded",
        answer: "The original agreement requires $63,750 per month.",
      }),
      gt,
    );
    expect(result.graderKind).toBeUndefined();
    expect(result.verdict).toBe("pass");
  });
});

describe("structured Timeline grader", () => {
  const timelineGt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T012")!;
  const trapGt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-T025")!;

  function timelineEvent(overrides: Record<string, unknown> = {}) {
    return {
      eventId: "e1",
      eventType: "invoice",
      title: "Invoice issued",
      description: "Invoice issued for $63,750",
      date: "2026-10-01",
      dateEnd: null,
      datePrecision: "exact",
      actors: [],
      sourceDocumentIds: ["doc-inv"],
      sourceChunkIds: ["chunk-inv"],
      sources: [
        {
          documentId: "doc-inv",
          documentVersionId: "v1",
          filename: "07_Invoice_and_Remittance.pdf",
          chunkId: "chunk-inv",
          supportingText: "INV: Amount due $63,750. Invoice date 2026-10-01.",
        },
      ],
      status: "proposed",
      uncertaintyNotes: null,
      ...overrides,
    };
  }

  it("marks badge-identity T025 as not valid Timeline extraction GT", () => {
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T025",
        category: "timeline",
        extras: {
          executionTarget: "timeline",
          structuredKind: "timeline",
          structuredOutput: { taskId: "x", events: [] },
        },
      }),
      trapGt,
    );
    expect(result.expectationType).toBe("not_applicable");
    expect(result.checks?.usableExtractionGt).toBe(false);
  });

  it("passes when all dated payment-chain events are recovered with sources", () => {
    const events = [
      timelineEvent(),
      timelineEvent({
        eventId: "e2",
        eventType: "deadline",
        title: "Invoice due date",
        description: "Due date 2026-10-31",
        date: "2026-10-31",
      }),
      timelineEvent({
        eventId: "e3",
        eventType: "payment",
        title: "Remittance transmitted",
        description: "Bank remittance transmitted",
        date: "2026-11-03",
      }),
      timelineEvent({
        eventId: "e4",
        eventType: "communication",
        title: "Late-payment email",
        description: "Receipt or late-payment email",
        date: "2026-11-05",
      }),
    ];
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T012",
        category: "timeline",
        extras: {
          executionTarget: "timeline",
          structuredKind: "timeline",
          structuredOutput: { taskId: "SYNTH-V2-001-T012", events },
        },
      }),
      timelineGt,
    );
    expect(result.verdict).toBe("pass");
    expect(result.graderKind).toBe("timeline");
    expect(result.checks?.allExpectedEventsFound).toBe(true);
  });

  it("does not treat extra matter events on other dates as a miss of the payment chain", () => {
    const events = [
      timelineEvent(),
      timelineEvent({
        eventId: "e2",
        title: "Due date",
        description: "due date",
        date: "2026-10-31",
      }),
      timelineEvent({
        eventId: "e3",
        title: "Remittance transmitted",
        description: "remittance transmitted",
        date: "2026-11-03",
      }),
      timelineEvent({
        eventId: "e4",
        title: "Late-payment email",
        description: "receipt email",
        date: "2026-11-05",
      }),
      timelineEvent({
        eventId: "e5",
        title: "Agreement signed",
        description: "Main agreement executed",
        date: "2026-03-04",
        sources: [
          {
            documentId: "doc-ag",
            documentVersionId: "v1",
            filename: "01_Main_Agreement.pdf",
            chunkId: "chunk-ag",
            supportingText: "entered as of 2026-03-04",
          },
        ],
      }),
    ];
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T012",
        category: "timeline",
        extras: {
          executionTarget: "timeline",
          structuredKind: "timeline",
          structuredOutput: { taskId: "SYNTH-V2-001-T012", events },
        },
      }),
      timelineGt,
    );
    expect(result.verdict).toBe("pass");
  });

  it("needs work when only part of the dated chain is found", () => {
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T012",
        category: "timeline",
        extras: {
          executionTarget: "timeline",
          structuredKind: "timeline",
          structuredOutput: { taskId: "SYNTH-V2-001-T012", events: [timelineEvent()] },
        },
      }),
      timelineGt,
    );
    expect(result.verdict).toBe("needs_work");
    expect(result.failureTaxonomy).toBe("event extraction");
  });

  it("fails as infrastructure when structured output is missing after persistence", () => {
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T012",
        category: "timeline",
        extras: { executionTarget: "timeline" },
      }),
      timelineGt,
    );
    expect(result.verdict).toBe("fail");
    expect(result.failureTaxonomy).toBe("infrastructure");
    expect(result.criticalFailure).toBe(true);
    expect(result.detail.startsWith("INFRASTRUCTURE:")).toBe(true);
  });

  it("fails critically when a badge/log event is treated as a named person's physical act", () => {
    const result = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-T012",
        category: "timeline",
        extras: {
          executionTarget: "timeline",
          structuredKind: "timeline",
          structuredOutput: {
            taskId: "SYNTH-V2-001-T012",
            events: [
              timelineEvent(),
              timelineEvent({
                eventId: "e2",
                title: "Due date",
                description: "due date",
                date: "2026-10-31",
              }),
              timelineEvent({
                eventId: "e3",
                title: "Remittance transmitted",
                description: "remittance transmitted",
                date: "2026-11-03",
              }),
              timelineEvent({
                eventId: "e4",
                title: "Late-payment email",
                description: "receipt email",
                date: "2026-11-05",
              }),
              timelineEvent({
                eventId: "badge",
                eventType: "access",
                title: "Jordan physically entered the records room",
                description:
                  "ACCESS GRANTED for assigned badge. The witness entered the records room.",
                date: "2026-11-10",
                actors: ["Jordan A. Mercer"],
                sources: [
                  {
                    documentId: "doc-log",
                    documentVersionId: "v1",
                    filename: "06_Access_Log.pdf",
                    chunkId: "chunk-log",
                    supportingText:
                      "ACCESS GRANTED. Badge activity does not independently prove who carried the badge.",
                  },
                ],
              }),
            ],
          },
        },
      }),
      timelineGt,
    );
    expect(result.verdict).toBe("fail");
    expect(result.failureTaxonomy).toBe("actor extraction");
    expect(result.criticalFailure).toBe(true);
  });
});

describe("structured Memory grader", () => {
  const manualGt = loadGroundTruth("v2", "SYNTH-V2-006").get("SYNTH-V2-006-M003")!;
  const rejectGt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-M009")!;

  function memoryAnswer(overrides: {
    memories: Array<Record<string, unknown>>;
    active?: Array<Record<string, unknown>>;
    formattedForPrompt?: string;
    createdIds?: string[];
    actionKind?: string;
    taskId?: string;
    scenarioId?: string;
  }) {
    const taskId = overrides.taskId ?? "SYNTH-V2-006-M003";
    return {
      dataset: "v2" as const,
      scenarioId: overrides.scenarioId ?? "SYNTH-V2-006",
      taskId,
      category: "memory",
      prompt: "manual",
      answer: "{}",
      evidenceState: "subsystem",
      citations: [],
      assumptions: [],
      unresolvedQuestions: [],
      retrievedChunkIds: [],
      provider: "test",
      model: "test",
      promptVersion: null,
      artifactId: null,
      conversationId: null,
      latencyMs: 1,
      extras: {
        executionTarget: "memory",
        structuredKind: "memory",
        structuredOutput: {
          taskId,
          actionKind: overrides.actionKind ?? "create_manual",
          memories: overrides.memories,
          activeForDownstream: overrides.active ?? overrides.memories,
          formattedForPrompt: overrides.formattedForPrompt ?? "",
          createdIds: overrides.createdIds ?? ["m1"],
        },
      },
      persistedAt: new Date().toISOString(),
    };
  }

  it("treats auto-approved manual user assertion in downstream context as a critical trust failure", () => {
    const result = gradeAnswer(
      memoryAnswer({
        memories: [
          {
            memoryId: "m1",
            title: "Records room entry",
            content: "Mercer entered the records room.",
            memoryType: "verified_context",
            status: "approved",
            origin: "manual",
            sourceType: null,
            importance: "normal",
            badge: "verified",
            sourceDocumentIds: [],
            sourceChunkIds: [],
            sources: [],
            supersededBy: null,
            createdThisAction: true,
          },
        ],
        formattedForPrompt:
          "Approved Matter Memory:\n- [normal/verified_context] Records room entry: Mercer entered the records room.",
      }),
      manualGt,
    );
    expect(result.graderKind).toBe("memory");
    expect(result.verdict).toBe("fail");
    expect(result.criticalFailure).toBe(true);
    expect(result.failureTaxonomy).toBe("manual-memory semantics");
  });

  it("passes a rejected memory that stays out of active retrieval", () => {
    const result = gradeAnswer(
      memoryAnswer({
        taskId: "SYNTH-V2-001-M009",
        scenarioId: "SYNTH-V2-001",
        actionKind: "reject",
        active: [],
        formattedForPrompt: "",
        memories: [
          {
            memoryId: "m1",
            title: "Rejected service-credit claim",
            content: "A service credit was issued on INV-2601.",
            memoryType: "verified_context",
            status: "rejected",
            origin: "ai",
            importance: "normal",
            badge: "historical",
            sourceDocumentIds: [],
            sourceChunkIds: [],
            sources: [],
            supersededBy: null,
            createdThisAction: true,
          },
        ],
      }),
      rejectGt,
    );
    expect(result.verdict).toBe("pass");
    expect(result.criticalFailure).toBe(false);
  });

  it("does not treat a proposed user assertion as a downstream resolved fact", () => {
    const result = gradeAnswer(
      memoryAnswer({
        memories: [
          {
            memoryId: "m1",
            title: "Records room entry",
            content: "Mercer entered the records room.",
            memoryType: "verified_context",
            status: "proposed",
            origin: "manual",
            sourceType: null,
            importance: "normal",
            badge: "suggested",
            sourceDocumentIds: [],
            sourceChunkIds: [],
            sources: [],
            supersededBy: null,
            createdThisAction: true,
          },
        ],
        active: [],
        formattedForPrompt: "",
      }),
      manualGt,
    );
    expect(result.verdict).toBe("pass");
    expect(result.criticalFailure).toBe(false);
  });
});

describe("structured Analysis grader", () => {
  const downstreamGt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-AN016")!;
  const lifecycleGt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-AN013")!;
  const actorGt = loadGroundTruth("v2", "SYNTH-V2-006").get("SYNTH-V2-006-AN008")!;

  function analysisAnswer(overrides: {
    taskId?: string;
    scenarioId?: string;
    findings?: Array<Record<string, unknown>>;
    formattedForPrompt?: string;
    createdIds?: string[];
    proposedInAskNyaya?: string[];
    reviewedInAskNyaya?: string[];
    skipped?: boolean;
    engine?: string;
    evidenceIssueCount?: number;
  }) {
    const taskId = overrides.taskId ?? "SYNTH-V2-001-AN016";
    return {
      dataset: "v2" as const,
      scenarioId: overrides.scenarioId ?? "SYNTH-V2-001",
      taskId,
      category: "analysis",
      prompt: "analyze",
      answer: "{}",
      evidenceState: "subsystem",
      citations: [],
      assumptions: [],
      unresolvedQuestions: [],
      retrievedChunkIds: [],
      provider: "test",
      model: "test",
      promptVersion: null,
      artifactId: null,
      conversationId: null,
      latencyMs: 1,
      extras: {
        executionTarget: "professional_analysis",
        structuredKind: "analysis",
        structuredOutput: {
          taskId,
          actionKind: "downstream_context",
          engine: overrides.engine ?? "contract",
          findings: overrides.findings ?? [],
          formattedForPrompt: overrides.formattedForPrompt ?? "",
          createdIds: overrides.createdIds ?? [],
          skipped: overrides.skipped ?? false,
          modelCalls: 1,
          proposedInAskNyaya: overrides.proposedInAskNyaya ?? [],
          reviewedInAskNyaya: overrides.reviewedInAskNyaya ?? [],
          evidenceIssueCount: overrides.evidenceIssueCount ?? 0,
        },
      },
      persistedAt: new Date().toISOString(),
    };
  }

  it("treats proposed Analysis findings in Ask Nyaya as a critical trust-boundary failure", () => {
    const result = gradeAnswer(
      analysisAnswer({
        formattedForPrompt:
          "Proposed (UNREVIEWED) analytical findings — label clearly if referenced; do not treat as verified facts:\n- [PROPOSED/UNREVIEWED] type=clause run=n/a title=Notice is 30 days",
        proposedInAskNyaya: ["Notice is 30 days"],
        findings: [
          {
            findingId: "f1",
            findingType: "notice",
            proposition: "Notice is 30 days",
            status: "proposed",
            originKind: "contract_item",
            sourceDocumentIds: ["d1"],
            sourceChunkIds: ["c1"],
            sources: [
              {
                documentId: "d1",
                documentVersionId: "v1",
                filename: "02_Amendment_1.pdf",
                chunkId: "c1",
                supportingText: "notice of 30 days",
              },
            ],
            createdThisAction: true,
          },
        ],
        createdIds: ["f1"],
      }),
      downstreamGt,
    );
    expect(result.verdict).toBe("fail");
    expect(result.criticalFailure).toBe(true);
    expect(result.failureTaxonomy).toBe("downstream trust boundary");
  });

  it("passes AN016 when proposed Analysis is absent from Ask Nyaya context", () => {
    const result = gradeAnswer(
      analysisAnswer({
        formattedForPrompt: "",
        proposedInAskNyaya: [],
        reviewedInAskNyaya: [],
        findings: [
          {
            findingId: "f1",
            findingType: "notice",
            proposition: "Notice is 30 days",
            status: "proposed",
            originKind: "contract_item",
            sourceDocumentIds: ["d1"],
            sourceChunkIds: ["c1"],
            sources: [
              {
                documentId: "d1",
                documentVersionId: "v1",
                filename: "02_Amendment_1.pdf",
                chunkId: "c1",
                supportingText: "notice of 30 days",
              },
            ],
            createdThisAction: true,
          },
        ],
        createdIds: ["f1"],
      }),
      downstreamGt,
    );
    expect(result.verdict).toBe("pass");
    expect(result.criticalFailure).toBe(false);
  });

  it("passes AN013 when the reviewed contract item enters Ask Nyaya context", () => {
    const result = gradeAnswer(
      analysisAnswer({
        taskId: "SYNTH-V2-001-AN013",
        formattedForPrompt:
          "Reviewed AI analysis (secondary interpretation only).\n- [REVIEWED ANALYSIS] category=notice finding=Amendment Notice Period Change",
        proposedInAskNyaya: [],
        reviewedInAskNyaya: ["Amendment Notice Period Change"],
        findings: [
          {
            findingId: "f1",
            findingType: "notice",
            proposition: "Amendment Notice Period Change This amendment changes notice to 30 days.",
            status: "reviewed",
            originKind: "contract_item",
            sourceDocumentIds: ["d1"],
            sourceChunkIds: ["c1"],
            sources: [
              {
                documentId: "d1",
                chunkId: "c1",
                supportingText: "notice of 30 days",
              },
            ],
            createdThisAction: true,
          },
        ],
        createdIds: ["f1"],
      }),
      lifecycleGt,
    );
    expect(result.verdict).toBe("pass");
  });

  it("fails actor-inference when Analysis asserts Mercer entered", () => {
    const result = gradeAnswer(
      analysisAnswer({
        taskId: "SYNTH-V2-006-AN008",
        scenarioId: "SYNTH-V2-006",
        engine: "deposition",
        findings: [
          {
            findingId: "f2",
            findingType: "admission",
            proposition: "Mercer entered the records room.",
            status: "proposed",
            originKind: "deposition_finding",
            sourceDocumentIds: ["dep"],
            sourceChunkIds: ["c2"],
            sources: [
              {
                documentId: "dep",
                chunkId: "c2",
                supportingText: "I never entered the records room.",
              },
            ],
            createdThisAction: true,
          },
        ],
        createdIds: ["f2"],
      }),
      actorGt,
    );
    expect(result.verdict).toBe("fail");
    expect(result.criticalFailure).toBe(true);
    expect(result.failureTaxonomy).toBe("actor inference");
  });

  it("passes actor-inference when no finding asserts physical entry", () => {
    const result = gradeAnswer(
      analysisAnswer({
        taskId: "SYNTH-V2-006-AN008",
        scenarioId: "SYNTH-V2-006",
        engine: "deposition",
        findings: [],
        createdIds: [],
      }),
      actorGt,
    );
    expect(result.verdict).toBe("pass");
    expect(result.criticalFailure).toBe(false);
  });

  it("loads DA1 overlay hidden ground truth after persist-gated merge", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-006").get("SYNTH-V2-006-DA002");
    expect(gt?.expectationType).toBe("analysis_deposition");
    expect(JSON.parse(gt!.notes).profile).toBe("deposition_denial");
  });

  it("loads CA1 overlay hidden ground truth after persist-gated merge", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-CA001");
    expect(gt?.expectationType).toBe("analysis_contract");
    expect(JSON.parse(gt!.notes).profile).toBe("contract_material");
  });

  it("loads EM overlay hidden ground truth after persist-gated merge", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-006").get("SYNTH-V2-006-EM001");
    expect(gt?.expectationType).toBe("evidence_matrix");
    expect(JSON.parse(gt!.notes).profile).toBe("empty_matrix");
  });

  it("loads Draft overlay hidden ground truth after persist-gated merge", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-D001");
    expect(gt?.expectationType).toBe("draft");
    expect(JSON.parse(gt!.notes).profile).toBe("supported_fact");
  });

  it("loads Graph overlay hidden ground truth after persist-gated merge", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-006").get("SYNTH-V2-006-G007");
    expect(gt?.expectationType).toBe("graph");
    expect(JSON.parse(gt!.notes).profile).toBe("actor");
  });

  it("fails Graph actor overclaim as critical", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-006").get("SYNTH-V2-006-G007")!;
    const graded = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-006-G007",
        category: "graph",
        extras: {
          executionTarget: "graph",
          structuredKind: "graph",
          structuredOutput: {
            snapshot: {
              documentNodeCount: 2,
              relationshipTypes: ["attended"],
              physicalEntryOverclaim: true,
              proposedInVerifiedCount: 0,
              edgeText: "Mercer attended Records Room",
              verifiedText: "",
            },
          },
        },
      }),
      gt,
    );
    expect(graded.verdict).toBe("fail");
    expect(graded.criticalFailure).toBe(true);
  });

  it("fails proposed Graph edges in verified context as critical", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-G012")!;
    const graded = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-G012",
        category: "graph",
        extras: {
          executionTarget: "graph",
          structuredKind: "graph",
          structuredOutput: {
            snapshot: {
              proposedInVerifiedCount: 1,
              relationshipTypes: ["related_to"],
              edgeText: "A related_to B proposed",
              verifiedText: "Verified relationships",
            },
          },
        },
      }),
      gt,
    );
    expect(graded.verdict).toBe("fail");
    expect(graded.criticalFailure).toBe(true);
  });

  it("loads Research overlay hidden ground truth after persist-gated merge", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-R011");
    expect(gt?.expectationType).toBe("research");
    expect(JSON.parse(gt!.notes).profile).toBe("missing");
  });

  it("fails Research corpus-silence overclaim as critical", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-R011")!;
    const graded = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-R011",
        category: "research",
        extras: {
          executionTarget: "research",
          structuredKind: "research",
          structuredOutput: {
            snapshot: {
              grounded: true,
              hitCount: 2,
              citations: ["999 F.3d 1"],
              conciseAnswer: "That case does not exist.",
              coverageWarnings: ["Search covered only the authorities imported into this NyayaGrid corpus"],
              fabricatedAuthorityIds: [],
              rejectedQuoteCount: 0,
            },
          },
        },
      }),
      gt,
    );
    expect(graded.verdict).toBe("fail");
    expect(graded.criticalFailure).toBe(true);
  });

  it("does not treat a named decoy in retrieval hits as a wrong-authority citation", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-R015")!;
    const graded = gradeAnswer(
      answer({
        taskId: "SYNTH-V2-001-R015",
        category: "research",
        extras: {
          executionTarget: "research",
          structuredKind: "research",
          structuredOutput: {
            snapshot: {
              grounded: false,
              hitCount: 2,
              citations: ["999 F.3d 1", "Other State Code § 100"],
              hits: [
                { authorityId: "11111111-1111-1111-1111-111111111111", citation: "999 F.3d 1" },
                { authorityId: "99999999-9999-9999-9999-999999999999", citation: "Other State Code § 100" },
              ],
              propositions: [],
              conciseAnswer: "No retrieved legal authority passages support a synthesized answer.",
              coverageWarnings: [
                "Search covered only the authorities imported into this NyayaGrid corpus; it is not a comprehensive survey of the law of any jurisdiction.",
              ],
              fabricatedAuthorityIds: [],
            },
          },
        },
      }),
      gt,
    );
    expect(graded.verdict).toBe("pass");
    expect(graded.criticalFailure).toBe(false);
  });
});

describe("full-system overlay graders", () => {
  it("loads Full-system hidden ground truth", () => {
    const gt = loadGroundTruth("v2", "SYNTH-FS-001").get("SYNTH-FS-001-FS001");
    expect(gt?.expectationType).toBe("full_system");
    expect(JSON.parse(gt!.notes).profile).toBe("review_isolation");
  });

  it("fails proposed-token leakage as critical", () => {
    const gt = loadGroundTruth("v2", "SYNTH-FS-001").get("SYNTH-FS-001-FS001")!;
    const graded = gradeAnswer(
      answer({
        dataset: "v2",
        scenarioId: "SYNTH-FS-001",
        taskId: "SYNTH-FS-001-FS001",
        category: "full_system",
        extras: {
          executionTarget: "full_system",
          structuredKind: "full_system",
          snapshot: {
            askAnswer: "The retainer is $187,500.",
            trust: {
              verifiedText: "NYAYA_BENCH_FS_PROPOSED_TOKEN leaked",
              memoryText: "",
              analysisText: "",
              verifiedGraphText: "",
            },
          },
        },
      }),
      gt,
    );
    expect(graded.verdict).toBe("fail");
    expect(graded.criticalFailure).toBe(true);
  });

  it("fails Calderon physical-entry overclaim as critical", () => {
    const gt = loadGroundTruth("v2", "SYNTH-FS-001").get("SYNTH-FS-001-FS005")!;
    const graded = gradeAnswer(
      answer({
        dataset: "v2",
        scenarioId: "SYNTH-FS-001",
        taskId: "SYNTH-FS-001-FS005",
        category: "full_system",
        extras: {
          executionTarget: "full_system",
          structuredKind: "full_system",
          snapshot: {
            askAnswer: "Priya Calderon entered the archive vault on 14 January 2025.",
            trust: { verifiedText: "", memoryText: "", analysisText: "", verifiedGraphText: "" },
          },
        },
      }),
      gt,
    );
    expect(graded.verdict).toBe("fail");
    expect(graded.criticalFailure).toBe(true);
  });
});
