import type { Database } from "@nyayagrid/database";
import { studentCaseComparisons } from "@nyayagrid/database";
import type {
  ExplanationLevel,
  StudentCaseComparison,
  StudentCaseComparisonContent,
  StudentComparisonField,
  StudentSourceRef,
} from "@nyayagrid/database";
import {
  STUDENT_CASE_COMPARISON_PROMPT_VERSION,
  buildCaseComparisonSystemPrompt,
  buildCaseComparisonUserPrompt,
  caseComparisonSchema,
  createAIProviderFromEnv,
  type AIProvider,
  type CaseComparison,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { assertStudentCaseOwnership } from "./auth";
import {
  getLatestStudentCaseVersion,
  loadStudentCasePassages,
  toProfessorCaseChunks,
  type StudentCasePassage,
} from "./cases";

export const COMPARISON_NO_CONFLICT_LIMITATION =
  "No conflict between these cases is asserted. The passages were compared as written; reconciling them as doctrine requires authority this comparison did not consult.";

export const COMPARISON_STUDY_AID_LIMITATION =
  "This comparison is a study aid built from the two uploaded texts only.";

const MAX_COMPARISON_CHUNKS = 24;

const COMPARISON_FIELDS = ["facts", "issue", "rule", "reasoning", "holding", "outcome"] as const;

export type CaseComparisonValidation = {
  comparison: StudentCaseComparisonContent;
  sources: StudentSourceRef[];
  droppedChunkIds: string[];
  /** Tensions removed because only one of the two cases actually supported them. */
  droppedTensionCount: number;
  schemaValid: boolean;
};

function emptyField(text: string): StudentComparisonField {
  return { text, caseAChunkIds: [], caseBChunkIds: [] };
}

function emptyComparison(limitations: string[]): StudentCaseComparisonContent {
  const blank = emptyField("Not available from the uploaded passages.");
  return {
    facts: blank,
    issue: blank,
    rule: blank,
    reasoning: blank,
    holding: blank,
    outcome: blank,
    tensions: [],
    limitations,
  };
}

/**
 * Validate a generated comparison.
 *
 * Each side's citations must come from that side's own case, and a stated tension survives only when
 * passages from BOTH cases support it. An unsupported difference is dropped rather than reported as
 * a split, because "these cases conflict" is a claim a student would carry into an exam answer.
 */
export function validateCaseComparison(
  raw: unknown,
  caseAPassages: StudentCasePassage[],
  caseBPassages: StudentCasePassage[],
): CaseComparisonValidation {
  const parsed = caseComparisonSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      comparison: emptyComparison([
        "The generated comparison did not match the required structure and was discarded.",
        COMPARISON_STUDY_AID_LIMITATION,
      ]),
      sources: [],
      droppedChunkIds: [],
      droppedTensionCount: 0,
      schemaValid: false,
    };
  }

  const generated: CaseComparison = parsed.data;
  const aById = new Map(caseAPassages.map((passage) => [passage.chunkId, passage]));
  const bById = new Map(caseBPassages.map((passage) => [passage.chunkId, passage]));
  const droppedChunkIds: string[] = [];
  const sources: StudentSourceRef[] = [];
  const seenSources = new Set<string>();

  const collect = (passage: StudentCasePassage) => {
    if (seenSources.has(passage.chunkId)) return;
    seenSources.add(passage.chunkId);
    sources.push({
      provenance: "UPLOADED_CASE",
      caseId: passage.caseId,
      caseVersionId: passage.caseVersionId,
      chunkId: passage.chunkId,
      page: passage.pageStart,
      opinionPart: passage.opinionPart,
    });
  };

  const sanitize = (field: CaseComparison["facts"]): StudentComparisonField => {
    const caseAChunkIds = field.caseAChunkIds.filter((chunkId) => {
      const passage = aById.get(chunkId);
      if (!passage) {
        droppedChunkIds.push(chunkId);
        return false;
      }
      collect(passage);
      return true;
    });
    const caseBChunkIds = field.caseBChunkIds.filter((chunkId) => {
      const passage = bById.get(chunkId);
      if (!passage) {
        droppedChunkIds.push(chunkId);
        return false;
      }
      collect(passage);
      return true;
    });
    return { text: field.text, caseAChunkIds, caseBChunkIds };
  };

  const fields = Object.fromEntries(
    COMPARISON_FIELDS.map((name) => [name, sanitize(generated[name])]),
  ) as Record<(typeof COMPARISON_FIELDS)[number], StudentComparisonField>;

  const tensions: StudentComparisonField[] = [];
  let droppedTensionCount = 0;
  for (const tension of generated.tensions) {
    const sanitized = sanitize(tension);
    if (sanitized.caseAChunkIds.length === 0 || sanitized.caseBChunkIds.length === 0) {
      droppedTensionCount += 1;
      continue;
    }
    tensions.push(sanitized);
  }

  const limitations = [...generated.limitations, COMPARISON_STUDY_AID_LIMITATION];
  if (tensions.length === 0) limitations.push(COMPARISON_NO_CONFLICT_LIMITATION);
  if (droppedTensionCount > 0) {
    limitations.push(
      `${droppedTensionCount} claimed difference(s) were removed because passages from both cases did not support them.`,
    );
  }
  if (droppedChunkIds.length > 0) {
    limitations.push(
      `${droppedChunkIds.length} citation(s) were removed because they did not belong to the case they were cited under.`,
    );
  }

  return {
    comparison: { ...fields, tensions, limitations: [...new Set(limitations)] },
    sources,
    droppedChunkIds,
    droppedTensionCount,
    schemaValid: true,
  };
}

export type CompareStudentCasesParams = {
  db: Database;
  userId: string;
  caseAId: string;
  caseBId: string;
  ai?: AIProvider;
  explanationLevel?: ExplanationLevel;
  maxChunksPerCase?: number;
};

export type CompareStudentCasesResult = {
  record: StudentCaseComparison;
  comparison: StudentCaseComparisonContent;
  sources: StudentSourceRef[];
  validation: Omit<CaseComparisonValidation, "comparison" | "sources">;
  provider: string;
  model: string;
};

/** Compare two cases the same student owns. Ownership is proven for both before anything is read. */
export async function compareStudentCases(
  params: CompareStudentCasesParams,
): Promise<CompareStudentCasesResult> {
  if (params.caseAId === params.caseBId) {
    throw new Error("Pick two different cases to compare");
  }
  const caseA = await assertStudentCaseOwnership(params.db, params.userId, params.caseAId);
  const caseB = await assertStudentCaseOwnership(params.db, params.userId, params.caseBId);

  const limit = params.maxChunksPerCase ?? MAX_COMPARISON_CHUNKS;
  const versionA = await getLatestStudentCaseVersion(params.db, params.userId, caseA.id);
  const versionB = await getLatestStudentCaseVersion(params.db, params.userId, caseB.id);
  const passagesA = await loadStudentCasePassages({
    db: params.db,
    userId: params.userId,
    caseVersionId: versionA.id,
    limit,
  });
  const passagesB = await loadStudentCasePassages({
    db: params.db,
    userId: params.userId,
    caseVersionId: versionB.id,
    limit,
  });
  if (passagesA.length === 0 || passagesB.length === 0) {
    throw new Error("Both cases need stored passages before they can be compared");
  }

  const ai = params.ai ?? createAIProviderFromEnv();
  const level = params.explanationLevel ?? "standard";
  const generation = await ai.generate({
    temperature: 0,
    schemaName: "student_case_comparison",
    messages: [
      { role: "system", content: buildCaseComparisonSystemPrompt(level) },
      {
        role: "user",
        content: buildCaseComparisonUserPrompt({
          caseAId: caseA.id,
          caseBId: caseB.id,
          caseATitle: caseA.title,
          caseBTitle: caseB.title,
          explanationLevel: level,
          caseChunks: [...toProfessorCaseChunks(passagesA), ...toProfessorCaseChunks(passagesB)],
        }),
      },
    ],
  });

  const validated = validateCaseComparison(parseJson(generation.text), passagesA, passagesB);

  const [record] = await params.db
    .insert(studentCaseComparisons)
    .values({
      userId: params.userId,
      caseAId: caseA.id,
      caseBId: caseB.id,
      comparison: validated.comparison,
      sources: validated.sources,
      provider: generation.provider,
      model: generation.model,
      promptVersion: STUDENT_CASE_COMPARISON_PROMPT_VERSION,
    })
    .returning();
  if (!record) throw new Error("Failed to persist the case comparison");

  await writeAuditEvent(params.db, {
    organizationId: null,
    actorUserId: params.userId,
    action: "student_case.comparison_generated",
    targetType: "student_case_comparison",
    targetId: record.id,
    metadata: {
      caseAId: caseA.id,
      caseBId: caseB.id,
      passageCountA: passagesA.length,
      passageCountB: passagesB.length,
      tensionCount: validated.comparison.tensions.length,
      droppedTensionCount: validated.droppedTensionCount,
      droppedChunkIdCount: validated.droppedChunkIds.length,
      provider: generation.provider,
      model: generation.model,
      promptVersion: STUDENT_CASE_COMPARISON_PROMPT_VERSION,
    },
  });

  const { comparison, sources, ...validationRest } = validated;
  return {
    record,
    comparison,
    sources,
    validation: validationRest,
    provider: generation.provider,
    model: generation.model,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
