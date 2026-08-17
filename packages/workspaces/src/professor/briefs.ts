import { and, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { studentCaseBriefs, studentCases } from "@nyayagrid/database";
import type {
  ExplanationLevel,
  StudentCaseBrief,
  StudentCaseBriefContent,
  StudentSectionSources,
} from "@nyayagrid/database";
import {
  STUDENT_CASE_BRIEF_PROMPT_VERSION,
  buildCaseBriefSystemPrompt,
  buildCaseBriefUserPrompt,
  caseBriefSchema,
  createAIProviderFromEnv,
  type AIProvider,
  type BriefSection,
  type CaseBrief,
} from "@nyayagrid/ai";
import { validateQuoteAgainstText } from "@nyayagrid/research";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { StudentAccessError, assertStudentCaseOwnership } from "./auth";
import {
  getLatestStudentCaseVersion,
  loadStudentCasePassages,
  toProfessorCaseChunks,
  type StudentCasePassage,
} from "./cases";

export const BRIEF_STUDY_AID_LIMITATION =
  "This brief was generated from the uploaded text and is a study aid; compare it against the opinion before relying on it.";

export const BRIEF_NO_SEPARATE_OPINIONS_LIMITATION =
  "No concurrence or dissent was labelled in the uploaded text, so no separate opinion is reported.";

const MAX_BRIEF_CHUNKS = 40;
const SECTION_EXCERPT_CHARS = 280;

/** Sections whose claims must rest on the majority opinion rather than a separate opinion. */
const MAJORITY_ONLY_SECTIONS = [
  "materialFacts",
  "issue",
  "rule",
  "holding",
  "reasoning",
  "judgment",
  "proceduralPosture",
  "parties",
] as const;

const ALL_SECTIONS = [
  "proceduralPosture",
  "parties",
  "materialFacts",
  "issue",
  "rule",
  "holding",
  "reasoning",
  "judgment",
  "concurrence",
  "dissent",
  "importance",
] as const;

type SectionName = (typeof ALL_SECTIONS)[number];

/** A verbatim leading excerpt of a passage, cut at a word boundary so it still matches the source. */
export function verbatimExcerpt(text: string, maxChars = SECTION_EXCERPT_CHARS): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  const cut = normalized.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
}

export type CaseBriefValidation = {
  brief: StudentCaseBriefContent;
  sectionSources: StudentSectionSources;
  droppedChunkIds: string[];
  rejectedQuotes: Array<{ chunkId: string; reason: string }>;
  /** Sections dropped because they cited the wrong opinion part or nothing at all. */
  droppedSections: string[];
  schemaValid: boolean;
};

function emptyBriefContent(caseName: string, limitations: string[]): StudentCaseBriefContent {
  const blank = { text: "Not available from the uploaded text.", chunkIds: [] };
  return {
    caseName,
    court: null,
    year: null,
    proceduralPosture: null,
    parties: null,
    materialFacts: blank,
    issue: blank,
    rule: blank,
    holding: blank,
    reasoning: blank,
    judgment: null,
    concurrence: null,
    dissent: null,
    keyQuotations: [],
    importance: null,
    openQuestions: [],
    limitations,
  };
}

/**
 * Validate a generated brief against the case's own passages.
 *
 * Three things are enforced here. Citations must name a chunk of this case version. Quotations must
 * appear verbatim in the chunk they cite. And a section that reports the majority's work may not
 * cite a passage labelled as a concurrence or dissent — a dissent presented as a holding is the
 * failure mode that would most mislead a student.
 */
export function validateCaseBrief(
  raw: unknown,
  passages: StudentCasePassage[],
  fallbackCaseName: string,
): CaseBriefValidation {
  const parsed = caseBriefSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      brief: emptyBriefContent(fallbackCaseName, [
        "The generated brief did not match the required structure and was discarded.",
        BRIEF_STUDY_AID_LIMITATION,
      ]),
      sectionSources: {},
      droppedChunkIds: [],
      rejectedQuotes: [],
      droppedSections: [...ALL_SECTIONS],
      schemaValid: false,
    };
  }

  const generated: CaseBrief = parsed.data;
  const byChunkId = new Map(passages.map((passage) => [passage.chunkId, passage]));
  const labelledParts = new Set(
    passages
      .map((passage) => passage.opinionPart)
      .filter((part): part is "majority" | "concurrence" | "dissent" => Boolean(part)),
  );

  const droppedChunkIds: string[] = [];
  const droppedSections: string[] = [];
  const rejectedQuotes: Array<{ chunkId: string; reason: string }> = [];
  const sectionSources: StudentSectionSources = {};

  const sanitize = (
    name: SectionName,
    section: BriefSection | null | undefined,
  ): BriefSection | null => {
    if (!section) return null;
    const allowedParts: Array<"majority" | "concurrence" | "dissent" | null> =
      name === "concurrence"
        ? ["concurrence"]
        : name === "dissent"
          ? ["dissent"]
          : (MAJORITY_ONLY_SECTIONS as readonly string[]).includes(name)
            ? ["majority", null]
            : ["majority", "concurrence", "dissent", null];

    const chunkIds = section.chunkIds.filter((chunkId) => {
      const passage = byChunkId.get(chunkId);
      if (!passage) {
        droppedChunkIds.push(chunkId);
        return false;
      }
      if (!allowedParts.includes(passage.opinionPart)) {
        droppedChunkIds.push(chunkId);
        return false;
      }
      return true;
    });

    if ((name === "concurrence" || name === "dissent") && chunkIds.length === 0) {
      droppedSections.push(name);
      return null;
    }

    sectionSources[name] = chunkIds.map((chunkId) => {
      const passage = byChunkId.get(chunkId)!;
      const quoted = generated.keyQuotations.find((quotation) => quotation.chunkId === chunkId);
      const candidate = quoted?.quote?.trim();
      const verified =
        candidate && validateQuoteAgainstText(candidate, passage.content).valid
          ? candidate
          : verbatimExcerpt(passage.content);
      return { chunkId, quote: verified, page: passage.pageStart };
    });

    return { text: section.text, chunkIds };
  };

  const keyQuotations: StudentCaseBriefContent["keyQuotations"] = [];
  for (const quotation of generated.keyQuotations) {
    const passage = byChunkId.get(quotation.chunkId);
    if (!passage) {
      droppedChunkIds.push(quotation.chunkId);
      continue;
    }
    const result = validateQuoteAgainstText(quotation.quote, passage.content);
    if (!result.valid) {
      rejectedQuotes.push({
        chunkId: quotation.chunkId,
        reason: result.reason ?? "Quote could not be verified against the uploaded passage.",
      });
      continue;
    }
    keyQuotations.push({
      quote: result.normalizedQuote ?? quotation.quote,
      chunkId: quotation.chunkId,
      page: passage.pageStart,
    });
  }

  const limitations = [...generated.limitations, BRIEF_STUDY_AID_LIMITATION];
  if (labelledParts.size === 0) limitations.push(BRIEF_NO_SEPARATE_OPINIONS_LIMITATION);
  if (droppedChunkIds.length > 0) {
    limitations.push(
      `${droppedChunkIds.length} citation(s) were removed because they did not match a passage of this case version, or cited a separate opinion for a majority section.`,
    );
  }
  if (rejectedQuotes.length > 0) {
    limitations.push(
      `${rejectedQuotes.length} quotation(s) were removed because they could not be verified verbatim against the uploaded text.`,
    );
  }

  const brief: StudentCaseBriefContent = {
    caseName: generated.caseName || fallbackCaseName,
    court: generated.court ?? null,
    year: generated.year ?? null,
    proceduralPosture: sanitize("proceduralPosture", generated.proceduralPosture),
    parties: sanitize("parties", generated.parties),
    materialFacts: sanitize("materialFacts", generated.materialFacts) ?? {
      text: generated.materialFacts.text,
      chunkIds: [],
    },
    issue: sanitize("issue", generated.issue) ?? { text: generated.issue.text, chunkIds: [] },
    rule: sanitize("rule", generated.rule) ?? { text: generated.rule.text, chunkIds: [] },
    holding: sanitize("holding", generated.holding) ?? {
      text: generated.holding.text,
      chunkIds: [],
    },
    reasoning: sanitize("reasoning", generated.reasoning) ?? {
      text: generated.reasoning.text,
      chunkIds: [],
    },
    judgment: sanitize("judgment", generated.judgment),
    concurrence: sanitize("concurrence", generated.concurrence),
    dissent: sanitize("dissent", generated.dissent),
    keyQuotations,
    importance: sanitize("importance", generated.importance),
    openQuestions: generated.openQuestions,
    limitations: [...new Set(limitations)],
  };

  return {
    brief,
    sectionSources,
    droppedChunkIds,
    rejectedQuotes,
    droppedSections,
    schemaValid: true,
  };
}

export type GenerateCaseBriefParams = {
  db: Database;
  userId: string;
  caseId: string;
  ai?: AIProvider;
  explanationLevel?: ExplanationLevel;
  maxChunks?: number;
};

export type GenerateCaseBriefResult = {
  record: StudentCaseBrief;
  brief: StudentCaseBriefContent;
  sectionSources: StudentSectionSources;
  validation: Omit<CaseBriefValidation, "brief" | "sectionSources">;
  passageCount: number;
  provider: string;
  model: string;
};

/**
 * Generate and persist a case brief for a case the student owns.
 *
 * The brief is built from that case version's own passages: nothing else is retrieved, and the
 * stored `sectionSources` map records which passage backs each section so the UI can show the
 * student where a claim came from.
 */
export async function generateCaseBrief(
  params: GenerateCaseBriefParams,
): Promise<GenerateCaseBriefResult> {
  const studentCase = await assertStudentCaseOwnership(params.db, params.userId, params.caseId);
  const version = await getLatestStudentCaseVersion(params.db, params.userId, studentCase.id);
  const passages = await loadStudentCasePassages({
    db: params.db,
    userId: params.userId,
    caseVersionId: version.id,
    limit: params.maxChunks ?? MAX_BRIEF_CHUNKS,
  });
  if (passages.length === 0) {
    throw new Error("This case has no stored passages to brief");
  }

  const ai = params.ai ?? createAIProviderFromEnv();
  const level = params.explanationLevel ?? "standard";
  const generation = await ai.generate({
    temperature: 0,
    schemaName: "student_case_brief",
    messages: [
      { role: "system", content: buildCaseBriefSystemPrompt(level) },
      {
        role: "user",
        content: buildCaseBriefUserPrompt({
          caseTitle: studentCase.title,
          citation: studentCase.citation,
          court: studentCase.court,
          decisionDate: studentCase.decisionDate,
          explanationLevel: level,
          caseChunks: toProfessorCaseChunks(passages),
        }),
      },
    ],
  });

  const validated = validateCaseBrief(parseJson(generation.text), passages, studentCase.title);

  const values = {
    userId: params.userId,
    caseId: studentCase.id,
    caseVersionId: version.id,
    brief: validated.brief,
    sectionSources: validated.sectionSources,
    provider: generation.provider,
    model: generation.model,
    promptVersion: STUDENT_CASE_BRIEF_PROMPT_VERSION,
  };

  const [record] = await params.db
    .insert(studentCaseBriefs)
    .values(values)
    .onConflictDoUpdate({
      target: studentCaseBriefs.caseVersionId,
      set: {
        brief: values.brief,
        sectionSources: values.sectionSources,
        provider: values.provider,
        model: values.model,
        promptVersion: values.promptVersion,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!record) throw new Error("Failed to persist the case brief");

  await writeAuditEvent(params.db, {
    organizationId: null,
    actorUserId: params.userId,
    action: "student_case.brief_generated",
    targetType: "student_case",
    targetId: studentCase.id,
    metadata: {
      briefId: record.id,
      caseVersionId: version.id,
      passageCount: passages.length,
      citedSectionCount: Object.keys(validated.sectionSources).length,
      droppedChunkIdCount: validated.droppedChunkIds.length,
      rejectedQuoteCount: validated.rejectedQuotes.length,
      provider: generation.provider,
      model: generation.model,
      promptVersion: STUDENT_CASE_BRIEF_PROMPT_VERSION,
    },
  });

  const { brief, sectionSources, ...validationRest } = validated;
  return {
    record,
    brief,
    sectionSources,
    validation: validationRest,
    passageCount: passages.length,
    provider: generation.provider,
    model: generation.model,
  };
}

export async function getCaseBrief(
  db: Database,
  userId: string,
  caseId: string,
): Promise<StudentCaseBrief | null> {
  const [row] = await db
    .select()
    .from(studentCaseBriefs)
    .where(and(eq(studentCaseBriefs.caseId, caseId), eq(studentCaseBriefs.userId, userId)))
    .limit(1);
  return row ?? null;
}

export type StudentBriefLibraryItem = {
  briefId: string;
  caseId: string;
  title: string;
  court: string | null;
  citation: string | null;
  decisionDate: string | null;
  year: string | null;
  courseLabel: string | null;
  updatedAt: Date;
};

export async function listStudentBriefs(
  db: Database,
  userId: string,
): Promise<StudentBriefLibraryItem[]> {
  if (!userId) throw new StudentAccessError("userId is required");
  const rows = await db
    .select({
      briefId: studentCaseBriefs.id,
      caseId: studentCases.id,
      title: studentCases.title,
      court: studentCases.court,
      citation: studentCases.citation,
      decisionDate: studentCases.decisionDate,
      courseLabel: studentCases.courseLabel,
      updatedAt: studentCaseBriefs.updatedAt,
      brief: studentCaseBriefs.brief,
    })
    .from(studentCaseBriefs)
    .innerJoin(
      studentCases,
      and(eq(studentCases.id, studentCaseBriefs.caseId), eq(studentCases.userId, userId)),
    )
    .where(eq(studentCaseBriefs.userId, userId))
    .orderBy(desc(studentCaseBriefs.updatedAt));

  return rows.map((row) => ({
    briefId: row.briefId,
    caseId: row.caseId,
    title: row.title,
    court: row.court,
    citation: row.citation,
    decisionDate: row.decisionDate ? String(row.decisionDate) : null,
    year: row.brief.year ?? (row.decisionDate ? String(row.decisionDate).slice(0, 4) : null),
    courseLabel: row.courseLabel,
    updatedAt: row.updatedAt,
  }));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
