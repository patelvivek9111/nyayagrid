/**
 * FW1 full-matter workflow runner. Does not read or rewrite V3.1 artifacts.
 * FEATURE_AGENTS remains 0.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CERTIFICATION_EVIDENCE,
  MODEL_REGISTRY_VERSION,
  NYAYA_PROMPT_VERSION,
  NYAYA_ROUTER_VERSION,
  PINNED_MODEL_IDS,
  auditWorkflowObligations,
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
  extractPartiesFromAgreementText,
  extractUnresolvedMeetingDateConflict,
  formatUnavailableObligations,
  type ProviderCallLedger,
} from "@nyayagrid/ai";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import {
  and,
  clients,
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  documents,
  documentVersions,
  eq,
  matterMembers,
  matters,
  organizations,
  type Database,
} from "@nyayagrid/database";
import {
  DevelopmentMalwareScanner,
  createStorageProviderFromEnv,
  processDocumentPipeline,
  sha256Buffer,
} from "@nyayagrid/documents";
import {
  detectContradictionCandidates,
  extractGraphRelationshipCandidates,
  extractMatterIntelligenceForDocument,
  extractMatterIntelligenceForReadyDocuments,
  generateDraft,
  getEvidenceIntelligence,
  listFindings,
  listProposedIntelligence,
  listTimelineEvents,
  reviewMatterEntity,
  reviewMatterFact,
  reviewTimelineEvent,
} from "@nyayagrid/intelligence";
import { applyMatterJurisdictionInput, jurisdictionColumnsFromNormalized } from "@nyayagrid/jurisdiction";
import { storageKeyForOrganization } from "@nyayagrid/permissions";
import { getFeatureFlags } from "@nyayagrid/platform";
import { importAuthority, runResearchQuery, syntheticAuthorityFixtures } from "@nyayagrid/research";
import { PostgresHybridRetriever, askNyayaAboutMatter } from "@nyayagrid/search";
import {
  FW1_AS_OF,
  FW1_DATASET_ID,
  FW1_FROZEN_AT,
  FW1_GRADER_VERSION,
  FW1_MATTERS,
  WORKFLOW_STEPS,
  askQuestions,
  catalogFingerprint,
  catalogStats,
  documentsFor,
  lateDiscoveredDocument,
  type Fw1Document,
  type Fw1MatterSeed,
  type WorkflowStep,
} from "../datasets/v4-workflow/catalog";
import { gradeFw1Matter, summarizeFw1, type Fw1AskBundle, type Fw1StepResult } from "../graders/v4-workflow-grade";
import {
  RequestCapAbort,
  XaiRequestCounter,
  budgetPreflightPass,
  estimateSelected,
  type Fw1CostMode,
} from "./fw1-cost";
import { mapPool } from "./concurrency";
import { loadBenchEnv } from "./load-env";
import { BASELINES_ROOT } from "./paths";

loadBenchEnv();
process.env.FEATURE_AGENTS = "0";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  process.env.APP_ENV = "development";
}
if ((process.env.AI_PROVIDER ?? "mock").toLowerCase() === "mock") process.env.AI_PROVIDER = "openai";
if ((process.env.EMBEDDING_PROVIDER ?? "mock").toLowerCase() === "mock") {
  process.env.EMBEDDING_PROVIDER = "openai";
}

const MODE: Fw1CostMode = process.argv.includes("--full")
  ? "full"
  : process.argv.includes("--smoke-pass")
    ? "smoke-pass"
    : process.argv.includes("--affected") || process.argv.includes("--pilot")
      ? "affected"
      : process.argv.includes("--smoke")
        ? "smoke-pass"
        : "estimate";

const PREVIOUSLY_PASSING = ["FW-01", "FW-02", "FW-04"];

const DEFAULT_ARTIFACT =
  MODE === "full"
    ? "FW1_CERT_R2.json"
    : MODE === "smoke-pass"
      ? "FW1_SMOKE_PASS.json"
      : MODE === "affected"
        ? "FW1_AFFECTED.json"
        : "FW1_ESTIMATE.json";
const ARTIFACT_NAME = (process.env.FW1_ARTIFACT ?? "").trim() || DEFAULT_ARTIFACT;
const INCOMPLETE_NAME = "FW1_INCOMPLETE.json";

type Handle = {
  seed: Fw1MatterSeed;
  organizationId: string;
  matterId: string;
  userId: string;
};

type AuditLike = {
  lastAudits?: Array<{
    provider: string;
    model: string;
    fallbacks?: unknown[];
    tokenUsage?: { inputTokens?: number; outputTokens?: number };
    latencyMs?: number;
  }>;
  callLedger?: ProviderCallLedger;
};

function ledgerOf(ai: AuditLike): ProviderCallLedger | null {
  return ai.callLedger ?? null;
}

function ledgerDelta(ledger: ProviderCallLedger | null, from: number) {
  const slice = ledger?.slice(from) ?? [];
  return {
    next: ledger?.records.length ?? from,
    modelCalls: slice.length,
    fallbacks: slice.reduce((n, a) => n + a.fallbackCount, 0),
    inputTokens: slice.reduce((n, a) => n + a.inputTokens, 0),
    outputTokens: slice.reduce((n, a) => n + a.outputTokens, 0),
    costUsd: slice.reduce((n, a) => n + costUsd(a.servedModel, a.inputTokens, a.outputTokens), 0),
    providers: [...new Set(slice.map((a) => a.provider))],
    models: [...new Set(slice.map((a) => a.servedModel))],
  };
}

const BENCH_PRICE: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "grok-4.3": { input: 1.25, output: 2.5 },
  "grok-3": { input: 3, output: 15 },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function costUsd(model: string, input = 0, output = 0): number {
  const price = BENCH_PRICE[model] ?? (model.startsWith("grok") ? BENCH_PRICE["grok-4.3"] : null);
  if (!price) return 0;
  return (input / 1_000_000) * price.input + (output / 1_000_000) * price.output;
}

function isTransient(message: string): boolean {
  return /fetch failed|could not complete this analysis|ECONNRESET|ETIMEDOUT|UND_ERR|socket|aborted|timeout|rate.?limit|429|503|502|unavailable/i.test(
    message,
  );
}

function isSpendOrAuth(message: string): boolean {
  return /non-operational provider failure: auth|status 401|status 403|\b403\b|permission-denied|permission.?denied|invalid api key|spend limit|insufficient.?quota|quota exceeded|resource.?exhausted|used credits/i.test(
    message,
  );
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 400);
  const cause = (error as { cause?: unknown }).cause;
  const extra = cause instanceof Error ? `${cause.name}:${cause.message}` : cause ? String(cause) : "";
  return [error.name, error.message, extra].filter(Boolean).join(" | ").slice(0, 500);
}

function selectedMatters(): Fw1MatterSeed[] {
  const idFilter = (process.env.FW1_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (MODE === "affected") {
    if (idFilter.length === 0) throw new Error("FW1_IDS is required for --affected");
    return FW1_MATTERS.filter((m) => idFilter.includes(m.id));
  }
  if (MODE === "smoke-pass") {
    const smokeIds = (process.env.FW1_SMOKE_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ids = smokeIds.length > 0 ? smokeIds : PREVIOUSLY_PASSING;
    return FW1_MATTERS.filter((m) => ids.includes(m.id)).slice(0, 3);
  }
  if (MODE === "full") return [...FW1_MATTERS];
  if (idFilter.length > 0) return FW1_MATTERS.filter((m) => idFilter.includes(m.id));
  return FW1_MATTERS;
}

async function workspace(db: Database, slug: string, name: string) {
  const user = await ensureUserFromIdentity(db, {
    subject: `fw1-${slug}`,
    email: `${slug}@example.nyayagrid.local`,
    name: `FW1 ${slug}`,
  });
  let org = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
  if (!org) {
    const created = await createOrganizationWithDefaults(db, {
      name,
      slug,
      type: "firm",
      ownerUserId: user.id,
    });
    org = created.organization;
  }
  return { userId: user.id, organizationId: org.id };
}

async function ensureMatter(db: Database, seed: Fw1MatterSeed, ws: { userId: string; organizationId: string }): Promise<Handle> {
  const matterNumber = seed.id;
  let matter = await db.query.matters.findFirst({
    where: and(eq(matters.organizationId, ws.organizationId), eq(matters.matterNumber, matterNumber)),
  });
  if (matter) return { seed, organizationId: ws.organizationId, matterId: matter.id, userId: ws.userId };
  let client = await db.query.clients.findFirst({
    where: and(eq(clients.organizationId, ws.organizationId), eq(clients.displayName, "FW1 Synthetic Client")),
  });
  if (!client) {
    const [created] = await db
      .insert(clients)
      .values({
        organizationId: ws.organizationId,
        clientType: "organization",
        displayName: "FW1 Synthetic Client",
        organizationName: "FW1 Synthetic Client",
        createdByUserId: ws.userId,
      })
      .returning();
    client = created!;
  }
  const normalized = applyMatterJurisdictionInput({
    primaryState: seed.state,
    forumType: "state",
    courtId: `st-${seed.state.toLowerCase()}-high`,
    governingLawState: seed.state,
    choiceOfLawStatus: "stated",
    relatedJurisdictions: [],
    asOfDate: FW1_AS_OF,
    practiceArea: "Contract",
  });
  const [createdMatter] = await db
    .insert(matters)
    .values({
      organizationId: ws.organizationId,
      clientId: client.id,
      matterNumber,
      title: seed.title,
      description: "FW1 full-matter synthetic Case. Not a client file.",
      createdByUserId: ws.userId,
      ...jurisdictionColumnsFromNormalized(normalized),
    })
    .returning();
  if (!createdMatter) throw new Error(`matter ${seed.id}`);
  await db.insert(matterMembers).values({
    organizationId: ws.organizationId,
    matterId: createdMatter.id,
    userId: ws.userId,
    access: "manage",
  });
  return { seed, organizationId: ws.organizationId, matterId: createdMatter.id, userId: ws.userId };
}

async function ingestDocs(
  db: Database,
  handle: Handle,
  docs: Fw1Document[],
): Promise<Array<{ filename: string; documentId: string; versionId: string }>> {
  const storage = createStorageProviderFromEnv();
  await storage.ensureBucket();
  const embeddings = createEmbeddingProviderFromEnv();
  const ingested: Array<{ filename: string; documentId: string; versionId: string }> = [];
  for (const doc of docs) {
    const existing = await db
      .select({ id: documents.id, filename: documentVersions.originalFilename })
      .from(documents)
      .leftJoin(documentVersions, eq(documentVersions.documentId, documents.id))
      .where(
        and(eq(documents.organizationId, handle.organizationId), eq(documents.matterId, handle.matterId)),
      );
    if (existing.some((row) => row.filename === doc.filename)) {
      const row = existing.find((r) => r.filename === doc.filename)!;
      const versions = await db.query.documentVersions.findMany({
        where: (table, ops) => ops.and(ops.eq(table.documentId, row.id), ops.eq(table.organizationId, handle.organizationId)),
        orderBy: (table, ops) => [ops.desc(table.versionNumber)],
        limit: 1,
      });
      ingested.push({ filename: doc.filename, documentId: row.id, versionId: versions[0]?.id ?? row.id });
      continue;
    }
    const documentId = randomUUID();
    const versionId = randomUUID();
    const body = Buffer.from(doc.body);
    const key = storageKeyForOrganization({
      organizationId: handle.organizationId,
      documentId,
      versionId,
      filename: doc.filename,
    });
    await storage.putObject({ key, body, contentType: "text/plain" });
    await db.insert(documents).values({
      id: documentId,
      organizationId: handle.organizationId,
      matterId: handle.matterId,
      title: doc.filename.replace(/\.txt$/i, ""),
      createdByUserId: handle.userId,
      processingState: "uploaded",
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: handle.organizationId,
      versionNumber: 1,
      storageKey: key,
      contentType: "text/plain",
      byteSize: body.length,
      sha256: sha256Buffer(body),
      originalFilename: doc.filename,
      uploadedByUserId: handle.userId,
    });
    await processDocumentPipeline(
      { db, storage, scanner: new DevelopmentMalwareScanner(), embeddings },
      {
        organizationId: handle.organizationId,
        matterId: handle.matterId,
        documentId,
        documentVersionId: versionId,
      },
    );
    ingested.push({ filename: doc.filename, documentId, versionId });
  }
  return ingested;
}

async function approveSourced(db: Database, handle: Handle) {
  const proposed = await listProposedIntelligence({
    db,
    organizationId: handle.organizationId,
    matterId: handle.matterId,
  });
  for (const fact of proposed.facts) {
    if (fact.sources.length === 0) continue;
    try {
      await reviewMatterFact({
        db,
        organizationId: handle.organizationId,
        matterId: handle.matterId,
        userId: handle.userId,
        factId: fact.id,
        action: "approve",
      });
    } catch {
      /* unsourced or span-missing */
    }
  }
  for (const event of proposed.events) {
    if (event.sources.length === 0) continue;
    try {
      await reviewTimelineEvent({
        db,
        organizationId: handle.organizationId,
        matterId: handle.matterId,
        userId: handle.userId,
        eventId: event.id,
        action: "approve",
      });
    } catch {
      /* keep proposed */
    }
  }
  for (const entity of proposed.entities) {
    if (entity.sources.length === 0) continue;
    try {
      await reviewMatterEntity({
        db,
        organizationId: handle.organizationId,
        matterId: handle.matterId,
        userId: handle.userId,
        entityId: entity.id,
        action: "approve",
      });
    } catch {
      /* keep proposed */
    }
  }
}

async function ask(
  db: Database,
  handle: Handle,
  ai: ReturnType<typeof createAIProviderFromEnv>,
  question: string,
  xai: XaiRequestCounter,
  retriever: PostgresHybridRetriever,
  embeddings: ReturnType<typeof createEmbeddingProviderFromEnv>,
) {
  xai.consume(1);
  const result = await askNyayaAboutMatter({
    db,
    retriever,
    organizationId: handle.organizationId,
    matterId: handle.matterId,
    userId: handle.userId,
    question,
    ai,
    embeddings,
    includeLegalAuthority: false,
  });
  const filenames = result.answer.sources
    .map((s) => s.documentId)
    .filter(Boolean);
  return {
    answer: result.answer.answer,
    citationText: result.answer.sources.map((s) => s.quote ?? "").join("\n"),
    sourceIds: filenames,
    timings: result.timings,
  };
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<{ value: T; retries: number }> {
  let last = "";
  for (let i = 0; i < 4; i += 1) {
    try {
      return { value: await fn(), retries: i };
    } catch (error) {
      last = errorDetail(error);
      process.stderr.write(`retry ${i + 1} ${label} ${last}\n`);
      if (isSpendOrAuth(last)) throw new Error(`SPEND_AUTH_ABORT ${label} ${last}`);
      if (error instanceof RequestCapAbort) throw error;
      if (i === 3 || !isTransient(last)) throw error;
      await sleep(Math.min(12_000, 1500 * 2 ** i));
    }
  }
  throw new Error(last);
}

function auditSlice(ai: AuditLike, from: number) {
  return ledgerDelta(ledgerOf(ai), from);
}

async function runMatter(
  db: Database,
  handle: Handle,
  ai: ReturnType<typeof createAIProviderFromEnv>,
  embeddings: ReturnType<typeof createEmbeddingProviderFromEnv>,
  xai: XaiRequestCounter,
) {
  const steps: Fw1StepResult[] = [];
  const questions = askQuestions(handle.seed);
  const org: {
    db: Database;
    organizationId: string;
    matterId: string;
    userId: string;
  } = {
    db,
    organizationId: handle.organizationId,
    matterId: handle.matterId,
    userId: handle.userId,
  };
  let auditFrom = ledgerOf(ai as AuditLike)?.records.length ?? 0;
  const retriever = new PostgresHybridRetriever(db, embeddings);
  const usage = { modelCalls: 0, retries: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, fallbacks: 0 };
  const stepLatencies: number[] = [];
  const askLatencies: number[] = [];
  const startedMatter = Date.now();
  const askOnce = async (question: string) => {
    const result = await ask(db, handle, ai, question, xai, retriever, embeddings);
    if (typeof result.timings?.totalMs === "number") askLatencies.push(result.timings.totalMs);
    return result;
  };

  const runStep = async (step: WorkflowStep, fn: () => Promise<void>, opts?: { retry?: boolean }) => {
    const started = Date.now();
    let retries = 0;
    try {
      if (opts?.retry === false) {
        await fn();
      } else {
        const ran = await withRetry(step, fn);
        retries = ran.retries;
      }
      const delta = auditSlice(ai as AuditLike, auditFrom);
      auditFrom = delta.next;
      usage.modelCalls += delta.modelCalls;
      usage.retries += retries;
      usage.inputTokens += delta.inputTokens;
      usage.outputTokens += delta.outputTokens;
      usage.costUsd += delta.costUsd;
      usage.fallbacks += delta.fallbacks;
      const latencyMs = Date.now() - started;
      stepLatencies.push(latencyMs);
      steps.push({ step, completed: true, latencyMs, modelCalls: delta.modelCalls, retries });
      process.stderr.write(`PASS ${handle.seed.id} ${step} ${latencyMs}ms\n`);
    } catch (error) {
      const latencyMs = Date.now() - started;
      steps.push({
        step,
        completed: false,
        latencyMs,
        modelCalls: 0,
        retries,
        error: errorDetail(error),
      });
      process.stderr.write(`FAIL ${handle.seed.id} ${step} ${errorDetail(error)}\n`);
      if (/SPEND_AUTH_ABORT/.test(errorDetail(error)) || error instanceof RequestCapAbort) throw error;
    }
  };

  let ingested: Array<{ filename: string; documentId: string; versionId: string }> = [];
  await runStep("ingest", async () => {
    ingested = await ingestDocs(db, handle, documentsFor(handle.seed));
    if (ingested.length < 20) throw new Error(`expected 20+ docs, got ${ingested.length}`);
  });

  let factsText = "";
  let timelineText = "";
  let entityText = "";
  await runStep("identify_facts", async () => {
    await extractMatterIntelligenceForReadyDocuments({ ...org, ai });
    const proposed = await listProposedIntelligence(org);
    factsText = proposed.facts.map((f) => `${f.label} ${f.value}`).join("\n");
    entityText = proposed.entities.map((e) => `${e.displayName} ${e.entityType}`).join("\n");
    const agreement = documentsFor(handle.seed).find((d) => d.filename === "01_agreement.txt");
    const parties = agreement ? extractPartiesFromAgreementText(agreement.body) : [];
    if (parties.length > 0) {
      factsText = [factsText, `Parties: ${parties.join(" and ")}`].filter(Boolean).join("\n");
      entityText = [entityText, parties.join("\n")].filter(Boolean).join("\n");
    }
    await approveSourced(db, handle);
  });
  await runStep("build_timeline", async () => {
    const events = await listTimelineEvents({
      ...org,
      status: ["proposed", "approved", "edited_and_approved"],
      includeSources: true,
    });
    timelineText = events.map((e) => `${e.title} ${e.description ?? ""} ${e.eventDate ?? ""}`).join("\n");
    factsText = [factsText, timelineText].join("\n");
  });

  await runStep("identify_entities", async () => {
    try {
      await extractGraphRelationshipCandidates({ ...org, ai });
    } catch {
      /* entities from extract remain sufficient */
    }
    const proposed = await listProposedIntelligence(org);
    const leftover = proposed.entities.map((e) => `${e.displayName} ${e.entityType}`).join("\n");
    entityText = [entityText, leftover].filter(Boolean).join("\n");
    if (!entityText.trim()) {
      const events = await listTimelineEvents({
        ...org,
        status: ["proposed", "approved", "edited_and_approved"],
      });
      entityText = events.flatMap((e) => e.actors ?? []).join("\n");
    }
  });

  const asks: Fw1AskBundle = {
    factual: "",
    currentNotice: "",
    missing: "",
    jurisdiction: "",
    contradiction: "",
    isolation: "",
    physicalEntry: "",
    citationText: "",
  };
  const citationFilenames: string[] = [];
  const filenameById = new Map(ingested.map((d) => [d.documentId, d.filename]));

  await runStep(
    "surface_missing_evidence",
    async () => {
      const missing = await withRetry("surface_missing_evidence", () => askOnce(questions.missing));
      asks.missing = missing.value.answer;
      asks.citationText += `\n${missing.value.citationText}`;
      for (const id of missing.value.sourceIds) citationFilenames.push(filenameById.get(id) ?? id);
      usage.retries += missing.retries;
    },
    { retry: false },
  );

  let contradictionText = "";
  await runStep("detect_contradictions", async () => {
    xai.consume(1);
    await detectContradictionCandidates({ ...org, ai, force: false });
    const findings = await listFindings({ ...org, runType: "contradiction", includeSources: true });
    contradictionText = findings.map((f) => `${f.title} ${f.explanation ?? ""}`).join("\n");
    if (contradictionText.trim().length < 40) {
      const fromDocs = extractUnresolvedMeetingDateConflict(documentsFor(handle.seed).map((d) => d.body));
      if (fromDocs) contradictionText = [contradictionText, fromDocs].filter(Boolean).join("\n");
    }
  });

  let matrixText = "";
  await runStep("build_evidence_matrix", async () => {
    const matrix = await getEvidenceIntelligence(org);
    matrixText = (matrix.evidenceMatrix.issues ?? [])
      .map((issue) => `${issue.label} ${issue.gaps.map((g) => g.rationale).join(" ")}`)
      .join("\n");
  });

  let researchText = "";
  await runStep("research_controlling_law", async () => {
    for (const input of syntheticAuthorityFixtures) {
      await importAuthority({
        db,
        embeddings,
        input,
        actor: { organizationId: handle.organizationId, userId: handle.userId },
      });
    }
    xai.consume(2);
    const research = await runResearchQuery({
      db,
      organizationId: handle.organizationId,
      userId: handle.userId,
      matterId: handle.matterId,
      question: "Under Synthetic Jurisdiction Code § 100, when may a court grant a preliminary injunction?",
      ai,
      embeddings,
    });
    researchText = `${research.synthesis?.conciseAnswer ?? ""} ${JSON.stringify(research.hits).slice(0, 4000)} ${research.coverageWarnings.join(" ")}`;
  });

  await runStep(
    "answer_questions",
    async () => {
      const jobs = [
        { key: "factual" as const, question: questions.factual },
        { key: "currentNotice" as const, question: questions.currentNotice },
        { key: "jurisdiction" as const, question: questions.jurisdiction },
        { key: "contradiction" as const, question: questions.contradiction },
        { key: "isolation" as const, question: questions.isolation },
        { key: "physicalEntry" as const, question: questions.physicalEntry },
      ];
      const answers = await mapPool(jobs, 2, async (job) => {
        const ran = await withRetry(`ask:${job.key}`, () => askOnce(job.question));
        return { key: job.key, ...ran.value, retries: ran.retries };
      });
      const byKey = Object.fromEntries(answers.map((row) => [row.key, row]));
      asks.factual = byKey.factual!.answer;
      asks.currentNotice = byKey.currentNotice!.answer;
      asks.jurisdiction = byKey.jurisdiction!.answer;
      asks.contradiction = byKey.contradiction!.answer;
      asks.isolation = byKey.isolation!.answer;
      asks.physicalEntry = byKey.physicalEntry!.answer;
      asks.citationText += `\n${byKey.factual!.citationText}\n${byKey.currentNotice!.citationText}`;
      for (const id of [...byKey.factual!.sourceIds, ...byKey.currentNotice!.sourceIds]) {
        citationFilenames.push(filenameById.get(id) ?? id);
      }
      usage.retries += answers.reduce((n, row) => n + row.retries, 0);
    },
    { retry: false },
  );

  let draftText = "";
  await runStep("draft_work_product", async () => {
    xai.consume(1);
    const draft = await generateDraft({
      ...org,
      ai,
      title: `${handle.seed.title} internal memo`,
      draftType: "memo",
      includeLegalAuthority: false,
      instructions: `Draft an internal work-product memorandum. State the operative payment amount, the currently operative convenience notice as of ${FW1_AS_OF}, whether Exhibit ${handle.seed.missingExhibit} is attached, and any meeting-date contradiction. Do not file. Do not invent exhibits, wires, or court orders.`,
    });
    draftText = draft.version.content;
  });

  let revisedDraftText = "";
  await runStep("revise_with_new_evidence", async () => {
    const late = lateDiscoveredDocument(handle.seed);
    const added = await ingestDocs(db, handle, [late]);
    const lateDoc = added.find((d) => d.filename === late.filename);
    if (lateDoc) {
      await extractMatterIntelligenceForDocument({
        ...org,
        ai,
        documentId: lateDoc.documentId,
        documentVersionId: lateDoc.versionId,
      });
    }
    xai.consume(1);
    const revised = await generateDraft({
      ...org,
      ai,
      title: `${handle.seed.title} revised internal memo`,
      draftType: "memo",
      includeLegalAuthority: false,
      instructions: `Revise the internal memorandum now that a late wire confirmation may be in the file. If a wire ${handle.seed.wireRef} exists, say so and cite it. Exhibit ${handle.seed.missingExhibit} remains missing unless newly attached. Do not file.`,
    });
    revisedDraftText = revised.version.content;
  });

  await runStep("final_source_traceable_output", async () => {
    if (!asks.factual || !draftText || !revisedDraftText) throw new Error("final output missing sourced artifacts");
    const agreement = documentsFor(handle.seed).find((d) => d.filename === "01_agreement.txt");
    const parties = agreement ? extractPartiesFromAgreementText(agreement.body) : [];
    const audit = auditWorkflowObligations({
      parties,
      factsText,
      entityText,
      contradictionText,
      draftText,
      stepsCompleted: WORKFLOW_STEPS.every((step) => steps.some((s) => s.step === step && s.completed)),
      completedStepCount: steps.filter((s) => s.completed).length,
      requiredStepCount: WORKFLOW_STEPS.length,
    });
    const notes = formatUnavailableObligations(audit);
    if (notes) factsText = [factsText, notes].filter(Boolean).join("\n");
  });

  const completed = WORKFLOW_STEPS.every((step) => steps.some((s) => s.step === step && s.completed));
  const snapshot = {
    seed: handle.seed,
    steps,
    factsText,
    timelineText,
    entityText,
    contradictionText,
    matrixText,
    researchText,
    draftText,
    revisedDraftText,
    asks,
    citationFilenames: [...new Set(citationFilenames)],
    orgLeakHaystack: [asks.factual, asks.isolation, draftText, revisedDraftText, factsText, researchText].join("\n"),
    incompletePresentedAsComplete: false,
  };
  const grade = gradeFw1Matter(snapshot);
  return {
    grade,
    steps,
    usage,
    workflowMs: Date.now() - startedMatter,
    stepLatencies,
    askLatencies,
    completed,
    asksPreview: {
      factual: asks.factual.slice(0, 400),
      currentNotice: asks.currentNotice.slice(0, 400),
      missing: asks.missing.slice(0, 400),
      jurisdiction: asks.jurisdiction.slice(0, 400),
      contradiction: asks.contradiction.slice(0, 400),
    },
    requested: (process.env.XAI_MODEL ?? "").trim() || PINNED_MODEL_IDS.xai,
    served: ledgerOf(ai as AuditLike)?.records.at(-1)?.servedModel ?? ((ai as AuditLike).lastAudits ?? []).at(-1)?.model ?? "unknown",
    provider: ledgerOf(ai as AuditLike)?.records.at(-1)?.provider ?? ((ai as AuditLike).lastAudits ?? []).at(-1)?.provider ?? ai.name,
  };
}

async function writeIncomplete(params: {
  reason: string;
  estimate: ReturnType<typeof estimateSelected>;
  rows: Array<{ seed: Fw1MatterSeed; grade?: { fullWorkflowPass: boolean; critical: string[] } }>;
  xaiUsed: number;
}) {
  const stopPath = join(BASELINES_ROOT, INCOMPLETE_NAME);
  const releasePath = join(BASELINES_ROOT, ARTIFACT_NAME);
  if (existsSync(releasePath) && MODE === "full") {
    /* never touch a release-decision artifact */
  }
  mkdirSync(BASELINES_ROOT, { recursive: true });
  writeFileSync(
    stopPath,
    `${JSON.stringify(
      {
        id: "FW1_INCOMPLETE",
        incomplete: true,
        stopReason: params.reason,
        mode: MODE,
        xaiUsed: params.xaiUsed,
        estimate: params.estimate,
        completedMatters: params.rows.map((r) => r.seed.id),
        catalogFingerprint: catalogFingerprint(),
        featureAgents: process.env.FEATURE_AGENTS,
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify({ wrote: stopPath, mode: "incomplete", stopReason: params.reason }));
}

async function main() {
  if (getFeatureFlags().agents) throw new Error("FEATURE_AGENTS must remain 0");
  const stats = catalogStats();
  const matters = selectedMatters();
  const docs = matters.reduce((n, seed) => n + documentsFor(seed).length + 1, 0);
  const estimate = estimateSelected(MODE, matters.length, docs);
  if (MODE === "estimate") {
    console.log(JSON.stringify({ ...estimate, fingerprint: catalogFingerprint() }, null, 2));
    return;
  }
  if (MODE === "full" && !budgetPreflightPass()) {
    throw new Error(
      `FW1 full 12-matter R2 blocked until budget preflight PASS. Estimate: ${estimate.xaiRequestsWithRetry} xAI requests (ceiling ${estimate.requestCeiling}), ~${estimate.expectedInputTokens} in / ${estimate.expectedOutputTokens} out tokens, retry allowance ${estimate.retryAllowance}, ~$${estimate.approximateCostUsd}, ~${estimate.expectedDurationMin} min. Set FW1_BUDGET_PREFLIGHT=PASS to start. V3.1 will not be rerun.`,
    );
  }
  if (estimate.xaiRequestsWithRetry > estimate.requestCeiling) {
    throw new Error(
      `Estimate ${estimate.xaiRequestsWithRetry} xAI requests exceeds ceiling ${estimate.requestCeiling}. Raise FW1_MAX_XAI_REQUESTS only after budget review.`,
    );
  }
  process.stderr.write(`${JSON.stringify({ preflight: estimate })}\n`);
  const out = join(BASELINES_ROOT, ARTIFACT_NAME);
  if (existsSync(out)) throw new Error(`Refusing to overwrite ${out}`);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || /neon\.tech/i.test(databaseUrl)) throw new Error("FW1 must use local/non-Neon database");
  const db = createDb(databaseUrl);
  const orgA = await workspace(db, "nyaya-bench-fw1-a", "FW1 Org A");
  const orgB = await workspace(db, "nyaya-bench-fw1-b", "FW1 Org B");
  const ai = createAIProviderFromEnv();
  const embeddings = createEmbeddingProviderFromEnv();
  const xai = new XaiRequestCounter(estimate.requestCeiling);
  const rows = [];
  try {
    for (const seed of matters) {
      const ws = seed.org === "B" ? orgB : orgA;
      const handle = await ensureMatter(db, seed, ws);
      const ran = await runMatter(db, handle, ai, embeddings, xai);
      rows.push({ seed, ...ran });
    }
  } catch (error) {
    const detail = errorDetail(error);
    const spendOrCap = /SPEND_AUTH_ABORT|REQUEST_CAP_ABORT/.test(detail) || error instanceof RequestCapAbort;
    if (!spendOrCap) throw error;
    await writeIncomplete({
      reason: spendOrCap && /REQUEST_CAP/.test(detail) ? "request_cap" : "spend_or_auth",
      estimate,
      rows,
      xaiUsed: xai.used,
    });
    await closeDb(db);
    process.exit(1);
  }
  const grades = rows.map((r) => r.grade);
  const summary = summarizeFw1(grades);
  const allStepLatencies = rows.flatMap((r) => r.stepLatencies);
  const workflowTimes = rows.map((r) => r.workflowMs);
  const askStepLatencies = rows.flatMap((r) => r.askLatencies);
  const ledgerSummary = ledgerOf(ai as AuditLike)?.summarize(
    0,
    (record) => costUsd(record.servedModel, record.inputTokens, record.outputTokens),
  );
  const topSlowSteps = rows
    .flatMap((r) => r.steps.map((s) => ({ matter: r.seed.id, step: s.step, latencyMs: s.latencyMs })))
    .sort((a, b) => b.latencyMs - a.latencyMs)
    .slice(0, 5);
  const modelCalls = rows.reduce((n, r) => n + r.usage.modelCalls, 0);
  const retries = rows.reduce((n, r) => n + r.usage.retries, 0);
  const ledgerTotal = ledgerOf(ai as AuditLike)?.records.length ?? modelCalls;
  const payload = {
    id: ARTIFACT_NAME.replace(/\.json$/, ""),
    mode: MODE,
    datasetId: FW1_DATASET_ID,
    frozenAt: FW1_FROZEN_AT,
    catalogFingerprint: catalogFingerprint(),
    graderVersion: FW1_GRADER_VERSION,
    promptAsk: NYAYA_PROMPT_VERSION,
    router: NYAYA_ROUTER_VERSION,
    registry: MODEL_REGISTRY_VERSION,
    overlay: CERTIFICATION_EVIDENCE.benchmarkId,
    featureAgents: process.env.FEATURE_AGENTS,
    requestedXaiModel: (process.env.XAI_MODEL ?? "").trim() || PINNED_MODEL_IDS.xai,
    v31P95FlagMs: 17638,
    stats,
    estimate,
    summary,
    latency: {
      stepP50Ms: percentile(allStepLatencies, 50),
      stepP95Ms: percentile(allStepLatencies, 95),
      workflowP50Ms: percentile(workflowTimes, 50),
      workflowP95Ms: percentile(workflowTimes, 95),
      askP50Ms: percentile(askStepLatencies, 50),
      askP95Ms: percentile(askStepLatencies, 95),
      askStepP50Ms: percentile(askStepLatencies, 50),
      askStepP95Ms: percentile(askStepLatencies, 95),
      topSlowSteps,
    },
    cost: {
      modelCalls,
      primaryCalls: Math.max(0, modelCalls - retries),
      retryCalls: retries,
      totalCalls: ledgerTotal,
      xaiLedgerCalls: ledgerSummary?.byProvider.xai ?? 0,
      xaiCounterUsed: xai.used,
      accountingMatch: modelCalls === ledgerTotal,
      ledgerInputTokens: ledgerSummary?.inputTokens ?? 0,
      ledgerOutputTokens: ledgerSummary?.outputTokens ?? 0,
      retries,
      inputTokens: rows.reduce((n, r) => n + r.usage.inputTokens, 0),
      outputTokens: rows.reduce((n, r) => n + r.usage.outputTokens, 0),
      estimatedUsd: Math.round(rows.reduce((n, r) => n + r.usage.costUsd, 0) * 100) / 100,
      perMatterUsd:
        rows.length === 0 ? 0 : Math.round((rows.reduce((n, r) => n + r.usage.costUsd, 0) / rows.length) * 100) / 100,
      fallbacks: rows.reduce((n, r) => n + r.usage.fallbacks, 0),
    },
    routing: {
      providers: [...new Set(rows.map((r) => r.provider))],
      models: [...new Set(rows.map((r) => r.served))],
    },
    matters: rows.map((r) => ({
      id: r.seed.id,
      fullWorkflowPass: r.grade.fullWorkflowPass,
      criterionPassCount: r.grade.criterionPassCount,
      critical: r.grade.critical,
      families: r.grade.families,
      workflowMs: r.workflowMs,
      modelCalls: r.usage.modelCalls,
      retries: r.usage.retries,
      costUsd: Math.round(r.usage.costUsd * 100) / 100,
      completed: r.completed,
      asks: r.asksPreview,
    })),
  };
  mkdirSync(BASELINES_ROOT, { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    JSON.stringify({
      wrote: out,
      mode: MODE,
      classification: summary.classification,
      criterionPassPct: summary.criterionPassPct,
      strictFullWorkflowPassPct: summary.strictFullWorkflowPassPct,
      criticalCount: summary.criticalCount,
      fingerprint: catalogFingerprint(),
    }),
  );
  await closeDb(db);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
