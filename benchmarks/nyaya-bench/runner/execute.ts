import {
  NYAYA_PROMPT_VERSION,
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
} from "@nyayagrid/ai";
import type { Database } from "@nyayagrid/database";
import { PostgresHybridRetriever, askNyayaAboutMatter } from "@nyayagrid/search";
import type { BenchScenario, BenchTask } from "./catalog";
import { executeSubsystemTarget } from "./execute-subsystems";
import type { IngestedMatter } from "./ingest";
import type { PersistedAnswer, PersistedCitation } from "../graders/types";
import { executionTargetFor, type ExecutionMode, type ExecutionTarget } from "./routing";

export async function executeTask(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  executionMode?: ExecutionMode;
  executionTargetOverride?: ExecutionTarget;
}): Promise<PersistedAnswer> {
  const started = Date.now();
  const embeddings = createEmbeddingProviderFromEnv();
  const retriever = new PostgresHybridRetriever(params.db, embeddings);
  const ai = createAIProviderFromEnv();
  const mode = params.executionMode ?? "case-qa";
  const target = params.executionTargetOverride ?? executionTargetFor(params.task, mode);

  if (target === "not_applicable") {
    return {
      dataset: params.scenario.dataset,
      scenarioId: params.scenario.scenarioId,
      taskId: params.task.taskId,
      category: params.task.category,
      prompt: params.task.prompt,
      answer: "",
      evidenceState: "not_applicable",
      citations: [],
      assumptions: [],
      unresolvedQuestions: [],
      retrievedChunkIds: [],
      provider: ai.name,
      model: process.env.OPENAI_MODEL ?? "unknown",
      promptVersion: null,
      artifactId: null,
      conversationId: null,
      latencyMs: Date.now() - started,
      extras: { executionTarget: target, notApplicableToSubsystem: true },
      persistedAt: new Date().toISOString(),
    };
  }

  if (target !== "case_qa") {
    const subsystem = await executeSubsystemTarget({
      db: params.db,
      scenario: params.scenario,
      task: params.task,
      matter: params.matter,
      target,
      ai,
    });
    return {
      dataset: params.scenario.dataset,
      scenarioId: params.scenario.scenarioId,
      taskId: params.task.taskId,
      category: params.task.category,
      prompt: params.task.prompt,
      answer: subsystem.answer,
      evidenceState: "subsystem",
      citations: [],
      assumptions: [],
      unresolvedQuestions: [],
      retrievedChunkIds: [],
      provider: ai.name,
      model: process.env.OPENAI_MODEL ?? "unknown",
      promptVersion: null,
      artifactId: null,
      conversationId: null,
      latencyMs: Date.now() - started,
      extras: subsystem.extras,
      persistedAt: new Date().toISOString(),
    };
  }

  const result = await askNyayaAboutMatter({
    db: params.db,
    retriever,
    organizationId: params.matter.organizationId,
    matterId: params.matter.matterId,
    userId: params.matter.userId,
    question: params.task.prompt,
    ai,
    embeddings,
    includeLegalAuthority: false,
  });

  const citations: PersistedCitation[] = result.answer.sources.map((source) => {
    const uploaded = params.matter.documents.find(
      (doc) => doc.nyayaDocumentId === source.documentId,
    );
    return {
      chunkId: source.chunkId,
      documentId: source.documentId,
      documentVersionId: source.documentVersionId,
      originalFilename: uploaded?.filename ?? null,
      title: uploaded?.title ?? null,
      page: source.page ?? null,
      quote: source.quote,
    };
  });

  return {
    dataset: params.scenario.dataset,
    scenarioId: params.scenario.scenarioId,
    taskId: params.task.taskId,
    category: params.task.category,
    prompt: params.task.prompt,
    answer: result.answer.answer,
    evidenceState: result.answer.evidenceState,
    citations,
    assumptions: result.answer.assumptions,
    unresolvedQuestions: result.answer.unresolvedQuestions,
    retrievedChunkIds: result.retrieved.map((passage) => passage.chunkId),
    provider: result.artifact?.provider ?? ai.name,
    model: result.artifact?.model ?? "unknown",
    promptVersion: result.artifact?.promptVersion ?? NYAYA_PROMPT_VERSION,
    artifactId: result.artifact?.id ?? null,
    conversationId: result.conversationId,
    latencyMs: Date.now() - started,
    extras: {
      executionTarget: "case_qa",
      evidenceAssessmentStatus: result.artifact?.validation?.evidenceAssessmentStatus ?? null,
      premiseStatus: result.artifact?.validation?.premiseStatus ?? null,
      dateSensitive: result.artifact?.validation?.dateSensitive ?? null,
      assessmentModel: result.artifact?.validation?.assessmentModel ?? null,
      assessmentLatency: result.artifact?.validation?.assessmentLatency ?? null,
      assessmentFailure: result.artifact?.validation?.assessmentFailure ?? null,
      assessmentSource: result.artifact?.validation?.assessmentSource ?? null,
      assessmentTriggered: result.artifact?.validation?.assessmentTriggered ?? null,
    },
    persistedAt: new Date().toISOString(),
  };
}
