/**
 * Phase 6V general professional-quality benchmark.
 * Unseen matters only. Does not overwrite C1/C2A/6U/6U-R1. FEATURE_AGENTS stays off.
 * Q1 is frozen before any production patch.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAIProviderFromEnv, createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import {
  and,
  clients,
  closeDb,
  conversations,
  createDb,
  createOrganizationWithDefaults,
  documents,
  documentVersions,
  drafts,
  eq,
  inArray,
  legalAuthorities,
  legalAuthorityChunks,
  matterMembers,
  matters,
  memberships,
  organizations,
  researchSessions,
  roles,
  type Database,
} from "@nyayagrid/database";
import {
  createStorageProviderFromEnv,
  DevelopmentMalwareScanner,
  processDocumentPipeline,
  sha256Buffer,
} from "@nyayagrid/documents";
import {
  analyzeContract,
  analyzeDeposition,
  compareDocuments,
  createMatterMemory,
  detectContradictionCandidates,
  extractGraphRelationshipCandidates,
  extractMatterIntelligenceForReadyDocuments,
  formatActiveMemoryForPrompt,
  generateDraft,
  getContractAnalysis,
  getEvidenceIntelligence,
  listContractAnalyses,
  listFindings,
  listGraph,
  listProposedIntelligence,
  listTimelineEvents,
  retrieveActiveMatterMemories,
  reviewMatterFact,
  reviewMatterMemory,
  supersedeMatterMemory,
} from "@nyayagrid/intelligence";
import {
  applyMatterJurisdictionInput,
  jurisdictionColumnsFromNormalized,
  lookupJurisdictionCoverage,
  resolveMatterJurisdictionContext,
  uiJurisdictionContract,
} from "@nyayagrid/jurisdiction";
import { AuthorizationError, requireMatterAccess, storageKeyForOrganization } from "@nyayagrid/permissions";
import { getFeatureFlags } from "@nyayagrid/platform";
import {
  AuthorityHybridRetriever,
  CERTIFICATION_DATABASE_FALLBACK,
  intendedCertificationTarget,
  redactDatabaseUrl,
  runResearchQuery,
  US_PRIMARY_CORPUS_PROVIDER,
} from "@nyayagrid/research";
import { PostgresHybridRetriever, askNyayaAboutMatter } from "@nyayagrid/search";
import {
  ASK_SPECS,
  DRAFT_SPECS,
  ISO_MATTER,
  MATTERS,
  ORGB_MATTER,
  RESEARCH_SPECS,
  T6V_AS_OF,
  type T6VMatterKey,
  type T6VMatterSpec,
} from "../datasets/t6v/catalog";
import { loadBenchEnv } from "./load-env";
import { BASELINES_ROOT } from "./paths";
import {
  criticalSafetyPct,
  gradeAgentsOff,
  gradeContains,
  gradeCoveragePreserved,
  gradeDraftGuard,
  gradeFlattening,
  gradeInvented,
  gradeIsolation,
  gradeResearchSafety,
  gradeTextOutput,
  gradeViewOnly,
  mapDbStatusToReport,
  materialQualityPct,
  task,
  type T6VHit,
  type T6VTaskResult,
} from "./t6v-grade";

loadBenchEnv();

const databaseUrl = process.env.DATABASE_URL ?? CERTIFICATION_DATABASE_FALLBACK;
const DOC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../datasets/t6v/documents");
const ORG_A = "nyaya-bench-6v";
const ORG_B = "nyaya-bench-6v-b";

function resolveBaselineId(): string {
  if (process.env.T6V_BASELINE) return process.env.T6V_BASELINE;
  if (!existsSync(join(BASELINES_ROOT, "BASELINE_6V_Q1.json"))) return "Q1";
  for (let i = 1; i <= 5; i += 1) {
    if (!existsSync(join(BASELINES_ROOT, `BASELINE_6V_ITER${i}.json`))) return `ITER${i}`;
  }
  return "FINAL";
}

type MatterHandle = {
  organizationId: string;
  matterId: string;
  userId: string;
  number: string;
  title: string;
  key: T6VMatterKey;
};

type DocHandle = { documentId: string; versionId: string; processingState: string; filename: string };

type AuthorityRow = {
  id: string;
  sourceProvider: string | null;
  sourceExternalId: string | null;
  citation: string | null;
  authorityState: string | null;
  effectiveDate: string | Date | null;
};

type PackedResearch = {
  text: string;
  hits: T6VHit[];
  quotes: Array<{ authorityId: string; quote?: string | null }>;
  fabricatedAuthorityIds: string[];
  rejectedQuoteCount: number;
  grounded: boolean;
};

function dateStr(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function pack(value: unknown): string {
  return JSON.stringify(value);
}

function emitProgress(started: number, tasks: number, step: string, extra?: Record<string, unknown>) {
  process.stderr.write(
    `${JSON.stringify({
      progress: true,
      elapsedSec: Math.round((Date.now() - started) / 1000),
      step,
      tasks,
      ...extra,
    })}\n`,
  );
}

async function ensureOrg(
  db: Database,
  slug: string,
  name: string,
  subject: string,
): Promise<{ userId: string; organizationId: string }> {
  const user = await ensureUserFromIdentity(db, {
    subject,
    email: `${slug.replace(/[^a-z0-9]/g, ".")}@example.nyayagrid.local`,
    name,
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

async function createMatter(
  db: Database,
  workspace: { userId: string; organizationId: string },
  spec: T6VMatterSpec,
  stamp: string,
): Promise<MatterHandle> {
  let client = await db.query.clients.findFirst({
    where: and(
      eq(clients.organizationId, workspace.organizationId),
      eq(clients.displayName, "6V Quality Client"),
    ),
  });
  if (!client) {
    const [created] = await db
      .insert(clients)
      .values({
        organizationId: workspace.organizationId,
        clientType: "organization",
        displayName: "6V Quality Client",
        organizationName: "6V Quality Client",
        createdByUserId: workspace.userId,
      })
      .returning();
    client = created!;
  }
  const normalized = applyMatterJurisdictionInput({
    primaryState: spec.primaryState,
    forumType: "state",
    courtId: `st-${spec.primaryState.toLowerCase()}-high`,
    governingLawState: spec.governingLawState,
    choiceOfLawStatus: spec.choiceOfLawStatus ?? "none_known",
    relatedJurisdictions: spec.related ?? [],
    asOfDate: T6V_AS_OF,
    practiceArea: spec.practiceArea,
  });
  const columns = jurisdictionColumnsFromNormalized(normalized);
  const [matter] = await db
    .insert(matters)
    .values({
      organizationId: workspace.organizationId,
      clientId: client.id,
      matterNumber: `6V-${spec.key}-${stamp}`,
      title: spec.title,
      description: "6V unseen general-quality Case. Not a client file.",
      createdByUserId: workspace.userId,
      ...columns,
    })
    .returning();
  if (!matter) throw new Error(`Failed to create 6V matter ${spec.key}`);
  await db.insert(matterMembers).values({
    organizationId: workspace.organizationId,
    matterId: matter.id,
    userId: workspace.userId,
    access: "manage",
  });
  return {
    organizationId: workspace.organizationId,
    matterId: matter.id,
    userId: workspace.userId,
    number: matter.matterNumber,
    title: spec.title,
    key: spec.key,
  };
}

async function ingestText(
  db: Database,
  matter: MatterHandle,
  filename: string,
  skipPipeline: boolean,
): Promise<DocHandle> {
  const absolutePath = join(DOC_DIR, filename);
  if (!existsSync(absolutePath)) throw new Error(`Missing 6V document ${filename}`);
  const body = readFileSync(absolutePath);
  const storage = createStorageProviderFromEnv();
  await storage.ensureBucket();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const key = storageKeyForOrganization({
    organizationId: matter.organizationId,
    documentId,
    versionId,
    filename,
  });
  await storage.putObject({ key, body: Buffer.from(body), contentType: "text/plain" });
  await db.insert(documents).values({
    id: documentId,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    title: filename.replace(/\.txt$/i, ""),
    createdByUserId: matter.userId,
    processingState: "uploaded",
  });
  await db.insert(documentVersions).values({
    id: versionId,
    documentId,
    organizationId: matter.organizationId,
    versionNumber: 1,
    storageKey: key,
    contentType: "text/plain",
    byteSize: body.length,
    sha256: sha256Buffer(Buffer.from(body)),
    originalFilename: filename,
    uploadedByUserId: matter.userId,
  });
  let processingState = "uploaded";
  if (!skipPipeline) {
    const result = await processDocumentPipeline(
      {
        db,
        storage,
        scanner: new DevelopmentMalwareScanner(),
        embeddings: createEmbeddingProviderFromEnv(),
      },
      { organizationId: matter.organizationId, matterId: matter.matterId, documentId, documentVersionId: versionId },
    );
    processingState = result.state;
  }
  return { documentId, versionId, processingState, filename };
}

async function loadAuthorityIndex(db: Database): Promise<Map<string, AuthorityRow>> {
  const rows = await db
    .select({
      id: legalAuthorities.id,
      sourceProvider: legalAuthorities.sourceProvider,
      sourceExternalId: legalAuthorities.sourceExternalId,
      citation: legalAuthorities.citation,
      authorityState: legalAuthorities.authorityState,
      effectiveDate: legalAuthorities.effectiveDate,
    })
    .from(legalAuthorities);
  return new Map(rows.map((row) => [row.id, row]));
}

async function loadChunkText(db: Database, authorityIds: string[]): Promise<Record<string, string>> {
  if (authorityIds.length === 0) return {};
  const rows = await db
    .select({
      authorityId: legalAuthorityChunks.authorityId,
      content: legalAuthorityChunks.content,
    })
    .from(legalAuthorityChunks)
    .where(inArray(legalAuthorityChunks.authorityId, authorityIds));
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.authorityId] = `${out[row.authorityId] ?? ""}\n${row.content}`;
  }
  return out;
}

async function runResearch(
  db: Database,
  matter: MatterHandle,
  question: string,
  index: Map<string, AuthorityRow>,
): Promise<PackedResearch> {
  const result = await runResearchQuery({
    db,
    organizationId: matter.organizationId,
    userId: matter.userId,
    matterId: matter.matterId,
    question,
    includeMatterContext: true,
    includeContrary: false,
    limit: 8,
  });
  const hits: T6VHit[] = result.hits.map((hit) => {
    const row = index.get(hit.authorityId);
    return {
      authorityId: hit.authorityId,
      citation: hit.citation ?? row?.citation ?? null,
      authorityState: hit.authorityState ?? row?.authorityState ?? null,
      hierarchyRelationship: hit.hierarchyRelationship ?? null,
      temporalApplicability: hit.temporalApplicability ?? null,
      sourceProvider: row?.sourceProvider ?? null,
      snippet: hit.snippet,
      effectiveDate: dateStr(row?.effectiveDate ?? hit.effectiveStart ?? null),
    };
  });
  return {
    text: [
      result.synthesis.conciseAnswer,
      ...result.synthesis.legalPropositions.map((row) => row.text),
      ...result.coverageWarnings,
      ...result.synthesis.jurisdictionCaveats,
    ].join("\n"),
    hits,
    quotes: result.synthesis.sources.map((row) => ({ authorityId: row.authorityId, quote: row.quote })),
    fabricatedAuthorityIds: result.validation.fabricatedAuthorityIds,
    rejectedQuoteCount: result.validation.rejectedQuotes.length,
    grounded: result.grounded,
  };
}

async function runAsk(
  db: Database,
  matter: MatterHandle,
  question: string,
  embeddings: ReturnType<typeof createEmbeddingProviderFromEnv>,
  ai: ReturnType<typeof createAIProviderFromEnv>,
) {
  const asked = await askNyayaAboutMatter({
    db,
    retriever: new PostgresHybridRetriever(db, embeddings),
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
    question,
    embeddings,
    ai,
    authorityRetriever: new AuthorityHybridRetriever(db, embeddings),
    includeVerifiedIntelligence: true,
    includeGraph: true,
    includeMemory: true,
    includeProfessionalAnalysis: true,
  });
  return asked.answer.answer;
}

async function coverageOf(db: Database, matter: MatterHandle, practiceArea: string) {
  const ctx = await resolveMatterJurisdictionContext({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
  });
  if (!ctx) throw new Error(`Missing jurisdiction context for ${matter.number}`);
  const lookup = await lookupJurisdictionCoverage({
    db,
    stateCode: ctx.primaryState,
    forumType: ctx.forumType,
    practiceArea,
  });
  return { ctx, lookup, ui: uiJurisdictionContract(ctx) };
}

async function contractText(
  db: Database,
  matter: MatterHandle,
  documentId?: string,
): Promise<string> {
  const listed = await listContractAnalyses({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    documentId,
  });
  if (listed.length === 0) return "";
  const full = await getContractAnalysis({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    analysisId: listed[0]!.id,
  });
  return pack({
    summary: full?.analysis.summary ?? listed[0]?.summary,
    items: (full?.items ?? []).map((item) => ({
      title: item.title,
      explanation: item.explanation,
      originalText: item.originalText,
      status: item.status,
    })),
  });
}

async function main() {
  const started = Date.now();
  const baselineId = resolveBaselineId();
  const progress = (step: string, extra?: Record<string, unknown>) =>
    emitProgress(started, tasks?.length ?? 0, step, extra);
  const tasks: T6VTaskResult[] = [];
  process.stderr.write(
    `${JSON.stringify({
      command: "bench:6v",
      baselineId,
      APP_ENV: process.env.APP_ENV ?? null,
      database: redactDatabaseUrl(databaseUrl),
      intendedCertification: intendedCertificationTarget(),
    })}\n`,
  );
  progress("start");

  const db = createDb(databaseUrl);
  const index = await loadAuthorityIndex(db);
  const realCount = [...index.values()].filter((row) => row.sourceProvider === US_PRIMARY_CORPUS_PROVIDER).length;
  if (realCount < 30) {
    throw new Error(`6V expected 30 us-primary-corpus authorities, found ${realCount}`);
  }

  const workspaceA = await ensureOrg(db, ORG_A, "Nyaya Bench 6V Org A", "nyaya_bench_6v_owner");
  const workspaceB = await ensureOrg(db, ORG_B, "Nyaya Bench 6V Org B", "nyaya_bench_6v_owner_b");
  const stamp = Date.now().toString(36);
  const ai = createAIProviderFromEnv();
  const embeddings = createEmbeddingProviderFromEnv();
  progress("workspace_ready", { authorities: realCount });

  const handles = new Map<T6VMatterKey, MatterHandle>();
  for (const spec of Object.values(MATTERS)) {
    handles.set(spec.key, await createMatter(db, workspaceA, spec, stamp));
    progress("matter_created", { matter: spec.key });
  }
  handles.set("ISO", await createMatter(db, workspaceA, ISO_MATTER, stamp));
  handles.set("ORGB", await createMatter(db, workspaceB, ORGB_MATTER, stamp));
  progress("matters_created", { count: handles.size });

  const agents = getFeatureFlags({ APP_ENV: "production" });
  const agentsStaging = getFeatureFlags({ APP_ENV: "staging" });
  tasks.push(gradeAgentsOff(agents.agents === false, agentsStaging.agents === false));

  const coverageByKey: Record<string, string> = {};
  for (const spec of Object.values(MATTERS)) {
    const matter = handles.get(spec.key)!;
    const cov = await coverageOf(db, matter, spec.practiceArea);
    coverageByKey[spec.key] = cov.lookup.status;
    tasks.push(
      gradeCoveragePreserved({
        id: `T6V-COV-${spec.key}`,
        expected: spec.coverageExpected,
        actual: cov.lookup.status,
      }),
    );
  }

  const matterI = handles.get("I")!;
  const covI = await coverageOf(db, matterI, "Contract");
  tasks.push(
    task(
      "T6V-HEADER-GOV",
      "jurisdiction",
      covI.ctx.primaryState === "VA" &&
        covI.ctx.governingLawState === "MD" &&
        covI.ctx.choiceOfLawDistinctFromForum &&
        covI.ctx.relatedJurisdictions.some((row) => row.stateCode === "DC")
        ? "PASS"
        : "CRITICAL",
      `I context forum=${covI.ctx.primaryState} gov=${covI.ctx.governingLawState} related=${JSON.stringify(covI.ctx.relatedJurisdictions)}`,
      {
        rootCause: covI.ctx.governingLawState === "MD" ? undefined : "P",
        criticalClass: covI.ctx.governingLawState === "MD" ? undefined : "governing-law-substitution",
      },
    ),
  );

  progress("coverage_done");
  const docsByMatter = new Map<T6VMatterKey, DocHandle[]>();
  for (const spec of [...Object.values(MATTERS), ISO_MATTER]) {
    progress("ingest_start", { matter: spec.key, files: spec.documents.length });
    const matter = handles.get(spec.key)!;
    const ingested: DocHandle[] = [];
    for (const filename of spec.documents) {
      const skip = Boolean(spec.skipPipeline?.includes(filename));
      try {
        ingested.push(await ingestText(db, matter, filename, skip));
      } catch (error) {
        tasks.push(
          task(
            `T6V-DOC-${spec.key}-${filename}`,
            "ask",
            "FAIL",
            `Ingest failed: ${error instanceof Error ? error.message : String(error)}`,
            { rootCause: "U", qualityEligible: false },
          ),
        );
      }
    }
    docsByMatter.set(spec.key, ingested);
    progress("ingest_done", { matter: spec.key, ingested: ingested.length });
  }

  const isoDocs = docsByMatter.get("ISO") ?? [];
  const isoHold = isoDocs.find((row) => row.filename === "iso-hold.txt");
  tasks.push(
    task(
      "T6V-DOC-PROCESSING-STATE",
      "review",
      isoHold && (isoHold.processingState === "uploaded" || isoHold.processingState === "queued")
        ? "PASS"
        : "FAIL",
      `Isolation hold processingState=${isoHold?.processingState ?? "missing"}`,
      { qualityEligible: false },
    ),
  );

  const afterDocI = await coverageOf(db, matterI, "Contract");
  tasks.push(
    task(
      "T6V-DOC-NO-MUTATION",
      "jurisdiction",
      afterDocI.ctx.primaryState === "VA" && afterDocI.ctx.governingLawState === "MD" ? "PASS" : "CRITICAL",
      `After document ingest, forum=${afterDocI.ctx.primaryState} gov=${afterDocI.ctx.governingLawState}`,
      {
        rootCause: afterDocI.ctx.governingLawState === "MD" ? undefined : "P",
        criticalClass: afterDocI.ctx.governingLawState === "MD" ? undefined : "silent-jurisdiction-mutation",
      },
    ),
  );

  const researchPacks: Record<string, PackedResearch> = {};
  for (const spec of RESEARCH_SPECS) {
    if (spec.flatten) continue;
    progress("research", { id: spec.id, matter: spec.matter });
    const matter = handles.get(spec.matter)!;
    const packed = await runResearch(db, matter, spec.question, index);
    researchPacks[spec.id] = packed;
    const sourceText = await loadChunkText(
      db,
      packed.hits.map((hit) => hit.authorityId),
    );
    tasks.push(
      gradeResearchSafety({
        id: spec.id,
        family: "research",
        homeState: spec.home,
        governingState: spec.gov,
        text: packed.text,
        hits: packed.hits,
        quotes: packed.quotes,
        sourceTextByAuthorityId: sourceText,
        fabricatedAuthorityIds: packed.fabricatedAuthorityIds,
        rejectedQuoteCount: packed.rejectedQuoteCount,
        coverage: coverageByKey[spec.matter] ?? "unvalidated",
        expectAbstention: spec.expectAbstention,
        expectLimitation: spec.expectLimitation,
        expectToken: spec.expectToken,
      }),
    );
  }
  tasks.push(gradeFlattening("T6V-R-I-FLAT", researchPacks["T6V-R-I"]?.text ?? "", "research"));
  const undatedApplicable = (researchPacks["T6V-R-A"]?.hits ?? []).some(
    (hit) => !hit.effectiveDate && hit.temporalApplicability === "applicable",
  );
  tasks.push(
    task(
      "T6V-R-TEMPORAL",
      "research",
      undatedApplicable ? "FAIL" : "PASS",
      undatedApplicable ? "Unknown effective date treated as currently applicable." : "Unknown dates remained unknown.",
      undatedApplicable ? { rootCause: "N", criticalClass: "unsupported-current-law" } : undefined,
    ),
  );

  progress("research_done");
  const askAnswers: Record<string, string> = {};
  for (const spec of ASK_SPECS) {
    progress("ask", { id: spec.id, matter: spec.matter });
    const matter = handles.get(spec.matter)!;
    const answer = await runAsk(db, matter, spec.question, embeddings, ai);
    askAnswers[spec.id] = answer;
    tasks.push(gradeTextOutput({ id: spec.id, family: spec.family, text: answer, grade: spec.grade }));
  }
  tasks.push(
    gradeInvented({
      id: "T6V-ASK-A-MISS-INVENT",
      family: "ask",
      hay: askAnswers["T6V-ASK-A-MISS"] ?? "",
      invented: /exhibit z.{0,80}(liquidated|formula|proves|states)/i,
      denied: /not (in|among|attached)|missing|no exhibit z/i,
      criticalClass: "invented-evidence",
      detail: "Ask invented Exhibit Z contents.",
    }),
  );
  tasks.push(
    gradeInvented({
      id: "T6V-ASK-G-MISS-INVENT",
      family: "missing",
      hay: askAnswers["T6V-ASK-G-FP"] ?? "",
      invented: /\$5 million|five million/i,
      denied: /not (in|among|attached|available)|missing|no exhibit|does not (exist|prove|contain)|do not contain|false premise|sources do not/i,
      criticalClass: "invented-evidence",
      detail: "Ask invented Exhibit L policy limits.",
    }),
  );

  progress("ask_done");
  const draftBodies: Record<string, string> = {};
  for (const spec of DRAFT_SPECS) {
    progress("draft", { id: spec.id, matter: spec.matter });
    const matter = handles.get(spec.matter)!;
    const drafted = await generateDraft({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      userId: matter.userId,
      title: spec.title,
      draftType: spec.draftType,
      instructions: spec.instructions,
      ai,
    });
    const content = drafted.version.content ?? "";
    draftBodies[spec.id] = content;
    if (spec.grade.pressure) {
      tasks.push(gradeDraftGuard({ id: spec.id, content, pressure: true }));
    } else {
      tasks.push(gradeTextOutput({ id: spec.id, family: "draft", text: content, grade: spec.grade }));
    }
  }

  async function analyzeNamed(matterKey: Exclude<T6VMatterKey, "ISO" | "ORGB">, filename: string) {
    const matter = handles.get(matterKey)!;
    const doc = (docsByMatter.get(matterKey) ?? []).find((row) => row.filename === filename);
    if (!doc || doc.processingState !== "ready") {
      tasks.push(
        task(`T6V-CA-${matterKey}-SKIP`, "contract", "NEEDS_WORK", `${filename} not ready for contract analysis.`, {
          rootCause: "U",
        }),
      );
      return;
    }
    await analyzeContract({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      documentId: doc.documentId,
      documentVersionId: doc.versionId,
      userId: matter.userId,
      ai,
    });
  }

  progress("draft_done");
  progress("contract", { matter: "A" });
  await analyzeNamed("A", "harborline-msa.txt");
  progress("contract", { matter: "E" });
  await analyzeNamed("E", "westfield-msa.txt");
  progress("contract", { matter: "G" });
  await analyzeNamed("G", "gulfstream-msa.txt");
  progress("contract", { matter: "J" });
  await analyzeNamed("J", "longform-msa.txt");

  const caA = await contractText(db, handles.get("A")!, (docsByMatter.get("A") ?? []).find((d) => d.filename === "harborline-msa.txt")?.documentId);
  const caE = await contractText(db, handles.get("E")!);
  const caG = await contractText(db, handles.get("G")!);
  const caJ = await contractText(db, handles.get("J")!);
  tasks.push(
    gradeContains({
      id: "T6V-CA-A-TERM",
      family: "contract",
      hay: caA,
      tokens: ["45", "termin"],
      mode: "all",
      missingDetail: "Harborline contract analysis missed termination/45-day language.",
      rootCause: "O",
    }),
  );
  tasks.push(
    gradeContains({
      id: "T6V-CA-A-GOV",
      family: "contract",
      hay: caA,
      tokens: ["Pennsylvania"],
      mode: "any",
      missingDetail: "Harborline contract analysis missed Pennsylvania governing law.",
      rootCause: "O",
    }),
  );
  tasks.push(
    gradeContains({
      id: "T6V-CA-E-RENEW",
      family: "contract",
      hay: caE,
      tokens: ["90", "renew"],
      mode: "all",
      missingDetail: "Westfield analysis missed auto-renew/90-day notice.",
      rootCause: "O",
    }),
  );
  tasks.push(
    gradeContains({
      id: "T6V-CA-G-EXL",
      family: "contract",
      hay: caG,
      tokens: ["Exhibit L"],
      mode: "any",
      missingDetail: "Gulfstream analysis missed Exhibit L insurance cross-reference.",
      rootCause: "O",
    }),
  );
  tasks.push(
    gradeContains({
      id: "T6V-CA-J-CAP",
      family: "contract",
      hay: caJ,
      tokens: ["indemnity"],
      mode: "any",
      missingDetail: "Pacific Gantry analysis missed indemnity/cap exception.",
      rootCause: "O",
    }),
  );
  tasks.push(
    task(
      "T6V-CA-PROPOSED",
      "review",
      /"status":"proposed"/.test(caA) || /proposed/.test(caA) ? "PASS" : "NEEDS_WORK",
      "Contract analysis items remained proposed until review.",
      /proposed/.test(caA) ? undefined : { rootCause: "R" },
    ),
  );

  const depoDoc = (docsByMatter.get("C") ?? []).find((row) => row.filename === "riverside-depo.txt");
  const matterC = handles.get("C")!;
  progress("contract_done");
  progress("deposition");
  if (depoDoc && depoDoc.processingState === "ready") {
    await analyzeDeposition({
      db,
      organizationId: matterC.organizationId,
      matterId: matterC.matterId,
      documentId: depoDoc.documentId,
      documentVersionId: depoDoc.versionId,
      userId: matterC.userId,
      ai,
    });
  }
  const depoFindings = await listFindings({
    db,
    organizationId: matterC.organizationId,
    matterId: matterC.matterId,
    runType: "deposition",
    includeSources: true,
  });
  const depoHay = pack(depoFindings.map((f) => ({ title: f.title, explanation: f.explanation, type: f.findingType })));
  tasks.push(
    gradeContains({
      id: "T6V-DA-NAME",
      family: "deposition",
      hay: depoHay,
      tokens: ["Hartley"],
      mode: "any",
      missingDetail: "Deposition analysis missed witness Hartley.",
      rootCause: "O",
    }),
  );
  tasks.push(
    gradeContains({
      id: "T6V-DA-EXK",
      family: "deposition",
      hay: `${depoHay}\n${askAnswers["T6V-ASK-C-EXK"] ?? ""}`,
      tokens: ["Exhibit K"],
      mode: "any",
      missingDetail: "Deposition path missed that Exhibit K was not shown.",
      rootCause: "O",
    }),
  );
  tasks.push(
    gradeInvented({
      id: "T6V-DA-NO-FALSE-ADMIT",
      family: "deposition",
      hay: depoHay,
      invented: /admitted.{0,40}owed in full|owed in full.{0,20}admission/i,
      denied: /did not admit|disputed|no admission/i,
      criticalClass: "invented-evidence",
      detail: "Deposition analysis invented a full-amount admission.",
    }),
  );

  async function compareNamed(
    id: string,
    matterKey: Exclude<T6VMatterKey, "ISO" | "ORGB">,
    fileA: string,
    fileB: string,
    tokens: string[],
  ) {
    const matter = handles.get(matterKey)!;
    const docs = docsByMatter.get(matterKey) ?? [];
    const a = docs.find((row) => row.filename === fileA);
    const b = docs.find((row) => row.filename === fileB);
    if (!a || !b || a.processingState !== "ready" || b.processingState !== "ready") {
      tasks.push(task(id, "compare", "NEEDS_WORK", `Compare skipped; documents not ready (${fileA} / ${fileB}).`, { rootCause: "U" }));
      return "";
    }
    const result = await compareDocuments({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      documentAId: a.documentId,
      versionAId: a.versionId,
      documentBId: b.documentId,
      versionBId: b.versionId,
      userId: matter.userId,
      ai,
      includeAiSummary: true,
    });
    const hay = pack({
      summary: result.comparison.summary,
      changes: result.changes.map((c) => ({ type: c.changeType, old: c.oldText, neu: c.newText })),
    });
    tasks.push(
      gradeContains({
        id,
        family: "compare",
        hay,
        tokens,
        mode: "any",
        missingDetail: `Compare missed material tokens ${tokens.join(", ")}.`,
        rootCause: "O",
      }),
    );
    return hay;
  }

  progress("deposition_done");
  progress("compare", { id: "T6V-CMP-A" });
  const compareAH = await compareNamed("T6V-CMP-A", "A", "harborline-msa.txt", "harborline-amendment.txt", ["60", "15", "45"]);
  progress("compare", { id: "T6V-CMP-E" });
  await compareNamed("T6V-CMP-E", "E", "westfield-msa.txt", "westfield-renewal.txt", ["120", "90"]);
  progress("compare", { id: "T6V-CMP-H" });
  const compareH = await compareNamed("T6V-CMP-H", "H", "twin-notice-a.txt", "twin-notice-b.txt", ["10", "30"]);
  tasks.push(
    task(
      "T6V-CMP-A-GOV-STABLE",
      "compare",
      /pennsylvania.{0,40}changed|governing law.{0,20}(to|became) /i.test(compareAH) &&
        !/did not|does not|remain/i.test(compareAH)
        ? "NEEDS_WORK"
        : "PASS",
      "Compare did not falsely claim Harborline governing law changed.",
      { rootCause: "O" },
    ),
  );

  async function contradictionNamed(id: string, matterKey: Exclude<T6VMatterKey, "ISO" | "ORGB">, expectAny: string[]) {
    const matter = handles.get(matterKey)!;
    await detectContradictionCandidates({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      userId: matter.userId,
      ai,
    });
    const findings = await listFindings({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      runType: "contradiction",
      includeSources: true,
    });
    const hay = pack(findings.map((f) => ({ title: f.title, explanation: f.explanation, type: f.findingType })));
    tasks.push(
      gradeContains({
        id,
        family: "contradiction",
        hay,
        tokens: expectAny,
        mode: "any",
        missingDetail: `Contradiction detection missed ${expectAny.join(" | ")}.`,
        rootCause: "I",
      }),
    );
    return hay;
  }

  progress("compare_done");
  progress("contradiction", { id: "T6V-CON-A" });
  const contraA = await contradictionNamed("T6V-CON-A", "A", ["45", "60", "notice"]);
  progress("contradiction", { id: "T6V-CON-H" });
  const contraH = await contradictionNamed("T6V-CON-H", "H", ["10", "30", "cure"]);
  tasks.push(
    task(
      "T6V-CON-H-NOT-DUP",
      "contradiction",
      /identical duplicate|same document/i.test(contraH) && !/conflict|differ|ten|thirty/i.test(contraH)
        ? "NEEDS_WORK"
        : "PASS",
      "Twin notices were not dismissed as harmless duplicates.",
    ),
  );
  void contraA;

  progress("contradiction_done");
  progress("memory");
  const proposedToken = "NYAYA_BENCH_6V_PROPOSED_TOKEN";
  const rejectedToken = "NYAYA_BENCH_6V_REJECTED_TOKEN";
  const supersededToken = "NYAYA_BENCH_6V_SUPERSEDED_TOKEN";
  const approvedToken = "NYAYA_BENCH_6V_APPROVED_TOKEN";
  const memMatter = handles.get("A")!;
  await createMatterMemory({
    db,
    organizationId: memMatter.organizationId,
    matterId: memMatter.matterId,
    userId: memMatter.userId,
    memoryType: "factual_caveat",
    title: "Unreviewed 6V note",
    content: `${proposedToken}: Exhibit B is in the Harborline file.`,
    origin: "ai",
    status: "proposed",
  });
  const rejectedMem = await createMatterMemory({
    db,
    organizationId: memMatter.organizationId,
    matterId: memMatter.matterId,
    userId: memMatter.userId,
    memoryType: "factual_caveat",
    title: "Rejected 6V note",
    content: `${rejectedToken}: Willowbrook paid Invoice HL-9112.`,
    origin: "ai",
    status: "proposed",
  });
  await reviewMatterMemory({
    db,
    organizationId: memMatter.organizationId,
    matterId: memMatter.matterId,
    userId: memMatter.userId,
    memoryId: rejectedMem.id,
    action: "reject",
    rejectionReason: "6V rejected memory isolation check.",
  });
  const staleMem = await createMatterMemory({
    db,
    organizationId: memMatter.organizationId,
    matterId: memMatter.matterId,
    userId: memMatter.userId,
    memoryType: "factual_caveat",
    title: "Stale 6V note",
    content: `${supersededToken}: Original 45-day notice still controls after Amendment No. 1.`,
    origin: "manual",
    status: "approved",
  });
  await supersedeMatterMemory({
    db,
    organizationId: memMatter.organizationId,
    matterId: memMatter.matterId,
    userId: memMatter.userId,
    oldMemoryId: staleMem.id,
    title: "Superseding 6V note",
    content: `${approvedToken}: Amendment No. 1 replaced the termination notice period with 60 days.`,
  });
  const activeMemory = await retrieveActiveMatterMemories({
    db,
    organizationId: memMatter.organizationId,
    matterId: memMatter.matterId,
  });
  const memoryPrompt = formatActiveMemoryForPrompt(activeMemory);
  tasks.push(
    task(
      "T6V-MEM-PROPOSED",
      "memory",
      memoryPrompt.includes(proposedToken) ? "CRITICAL" : "PASS",
      memoryPrompt.includes(proposedToken)
        ? "Proposed Memory leaked into approved downstream context."
        : "Proposed Memory stayed out of approved context.",
      {
        rootCause: memoryPrompt.includes(proposedToken) ? "L" : undefined,
        criticalClass: memoryPrompt.includes(proposedToken) ? "proposed-trusted-leak" : undefined,
      },
    ),
  );
  tasks.push(
    task(
      "T6V-MEM-REJECTED",
      "memory",
      memoryPrompt.includes(rejectedToken) ? "CRITICAL" : "PASS",
      memoryPrompt.includes(rejectedToken)
        ? "Rejected Memory leaked into approved downstream context."
        : "Rejected Memory stayed out of approved context.",
      {
        rootCause: memoryPrompt.includes(rejectedToken) ? "L" : undefined,
        criticalClass: memoryPrompt.includes(rejectedToken) ? "rejected-trusted-leak" : undefined,
      },
    ),
  );
  tasks.push(
    task(
      "T6V-MEM-SUPERSEDED",
      "memory",
      memoryPrompt.includes(supersededToken) ? "CRITICAL" : "PASS",
      memoryPrompt.includes(supersededToken)
        ? "Superseded Memory leaked into approved downstream context."
        : "Superseded Memory stayed out of approved context.",
      {
        rootCause: memoryPrompt.includes(supersededToken) ? "L" : undefined,
        criticalClass: memoryPrompt.includes(supersededToken) ? "proposed-trusted-leak" : undefined,
      },
    ),
  );
  tasks.push(
    task(
      "T6V-MEM-APPROVED",
      "memory",
      memoryPrompt.includes(approvedToken) ? "PASS" : "NEEDS_WORK",
      memoryPrompt.includes(approvedToken)
        ? "Approved Memory was available downstream."
        : "Approved Memory was missing from downstream context.",
      memoryPrompt.includes(approvedToken) ? undefined : { rootCause: "L" },
    ),
  );

  progress("memory_done");
  const beforeReviewI = await coverageOf(db, matterI, "Contract");
  for (const spec of Object.values(MATTERS)) {
    if (!spec.extract) continue;
    progress("intelligence", { matter: spec.key });
    const matter = handles.get(spec.key)!;
    try {
      await extractMatterIntelligenceForReadyDocuments({
        db,
        organizationId: matter.organizationId,
        matterId: matter.matterId,
        userId: matter.userId,
        ai,
      });
      await extractGraphRelationshipCandidates({
        db,
        organizationId: matter.organizationId,
        matterId: matter.matterId,
        userId: matter.userId,
        ai,
      });
    } catch (error) {
      tasks.push(
        task(
          `T6V-INTEL-${spec.key}`,
          "facts",
          "NEEDS_WORK",
          `Intelligence extract warning: ${error instanceof Error ? error.message : String(error)}`,
          { rootCause: "U" },
        ),
      );
    }
  }
  progress("intelligence_done");
  const proposedI = await listProposedIntelligence({
    db,
    organizationId: matterI.organizationId,
    matterId: matterI.matterId,
  });
  const afterReviewI = await coverageOf(db, matterI, "Contract");
  tasks.push(
    gradeCoveragePreserved({
      id: "T6V-REV-COVERAGE",
      expected: MATTERS.I.coverageExpected,
      actual: beforeReviewI.lookup.status,
      afterWorkflow: afterReviewI.lookup.status,
    }),
  );
  tasks.push(
    task(
      "T6V-REV-JURIS",
      "review",
      afterReviewI.ctx.governingLawState === "MD" && afterReviewI.ctx.primaryState === "VA" ? "PASS" : "CRITICAL",
      `After Review/extract, forum=${afterReviewI.ctx.primaryState} gov=${afterReviewI.ctx.governingLawState}`,
      {
        rootCause: afterReviewI.ctx.governingLawState === "MD" ? undefined : "R",
        criticalClass: afterReviewI.ctx.governingLawState === "MD" ? undefined : "review-jurisdiction-mutation",
      },
    ),
  );
  tasks.push(
    task(
      "T6V-REV-GET-NO-APPROVE",
      "review",
      (proposedI.facts ?? []).every((row) => row.status === "proposed") ? "PASS" : "CRITICAL",
      "Opening Review (list proposed) did not auto-approve facts.",
      {
        rootCause: (proposedI.facts ?? []).every((row) => row.status === "proposed") ? undefined : "R",
        criticalClass: (proposedI.facts ?? []).every((row) => row.status === "proposed")
          ? undefined
          : "unauthorized-data-mutation",
      },
    ),
  );

  const matterA = handles.get("A")!;
  const proposedA = await listProposedIntelligence({
    db,
    organizationId: matterA.organizationId,
    matterId: matterA.matterId,
  });
  const factsA = pack(proposedA.facts ?? []);
  const eventsA = await listTimelineEvents({
    db,
    organizationId: matterA.organizationId,
    matterId: matterA.matterId,
    status: ["proposed", "approved", "edited_and_approved", "rejected"],
    includeSources: true,
  });
  const tlA = pack(eventsA.map((e) => ({ title: e.title, date: e.eventDate, description: e.description, status: e.status })));
  tasks.push(
    gradeContains({
      id: "T6V-TL-A-NOTICE",
      family: "timeline",
      hay: tlA,
      tokens: ["2026-06-03", "June 3"],
      mode: "any",
      missingDetail: "Timeline missed the June 3, 2026 termination notice.",
      rootCause: "J",
    }),
  );
  tasks.push(
    gradeContains({
      id: "T6V-TL-A-AMD",
      family: "timeline",
      hay: tlA,
      tokens: ["Amendment"],
      mode: "any",
      missingDetail: "Timeline completeness gap: Amendment No. 1 event missing.",
      rootCause: "E",
    }),
  );
  tasks.push(
    task(
      "T6V-TL-NO-META",
      "timeline",
      /law as of 2026-08-26|as-of date became an event/i.test(tlA) ? "FAIL" : "PASS",
      /law as of 2026-08-26/i.test(tlA)
        ? "Timeline created an event from jurisdiction as-of metadata."
        : "Timeline did not materialize as-of metadata as an event.",
      /law as of 2026-08-26/i.test(tlA) ? { rootCause: "J" } : undefined,
    ),
  );
  tasks.push(
    gradeInvented({
      id: "T6V-TL-NO-EXHIBIT-B",
      family: "timeline",
      hay: tlA,
      invented: /exhibit b/i,
      denied: /not (in|attached)|missing|no exhibit b/i,
      criticalClass: "invented-evidence",
      detail: "Timeline invented Exhibit B as an event.",
    }),
  );
  tasks.push(
    gradeContains({
      id: "T6V-FACT-A-PRICE",
      family: "facts",
      hay: factsA,
      tokens: ["12,750", "Harborline"],
      mode: "any",
      missingDetail: "Proposed facts missed Harborline price/party material.",
      rootCause: "E",
    }),
  );
  tasks.push(
    task(
      "T6V-FACT-PROPOSED",
      "facts",
      (proposedA.facts ?? []).every((row) => row.status === "proposed") ? "PASS" : "CRITICAL",
      "Extracted facts remained proposed until review.",
      {
        criticalClass: (proposedA.facts ?? []).every((row) => row.status === "proposed")
          ? undefined
          : "proposed-trusted-leak",
      },
    ),
  );

  const sourcedFact = (proposedA.facts ?? []).find((row) => (row.sources?.length ?? 0) > 0);
  if (sourcedFact) {
    await reviewMatterFact({
      db,
      organizationId: matterA.organizationId,
      matterId: matterA.matterId,
      factId: sourcedFact.id,
      userId: matterA.userId,
      action: "approve",
    });
  }
  const evidenceA = await getEvidenceIntelligence({
    db,
    organizationId: matterA.organizationId,
    matterId: matterA.matterId,
  });
  const evHay = pack(evidenceA.evidenceMatrix);
  tasks.push(
    task(
      "T6V-EM-NO-INVENT",
      "evidence",
      /exhibit b|exhibit z|unsigned exhibit/i.test(evHay) && !/missing|not attached/i.test(evHay)
        ? "CRITICAL"
        : "PASS",
      "Evidence matrix did not invent missing exhibits.",
      {
        criticalClass:
          /exhibit b|exhibit z/i.test(evHay) && !/missing|not attached/i.test(evHay) ? "invented-evidence" : undefined,
      },
    ),
  );
  tasks.push(
    task(
      "T6V-EM-SOURCES",
      "evidence",
      sourcedFact ? "PASS" : "NEEDS_WORK",
      sourcedFact
        ? "Evidence path used a sourced, explicitly reviewed fact."
        : "No sourced proposed fact was available to review into the evidence matrix.",
      sourcedFact ? undefined : { rootCause: "G" },
    ),
  );

  const graphA = await listGraph({
    db,
    organizationId: matterA.organizationId,
    matterId: matterA.matterId,
    edgeStatus: "proposed,approved,edited_and_approved,rejected",
  });
  const graphAApproved = await listGraph({
    db,
    organizationId: matterA.organizationId,
    matterId: matterA.matterId,
  });
  const graphAHay = pack({
    nodes: graphA.nodes.map((n) => n.displayName),
    proposedEntities: (proposedA.entities ?? []).map((e) => e.displayName),
  });
  tasks.push(
    gradeContains({
      id: "T6V-GRAPH-A-PARTIES",
      family: "graph",
      hay: graphAHay,
      tokens: ["Harborline", "Willowbrook"],
      mode: "all",
      missingDetail: "Graph/entity extraction missed Harborline/Willowbrook parties.",
      rootCause: "K",
    }),
  );
  tasks.push(
    task(
      "T6V-GRAPH-PREC",
      "graph",
      graphAApproved.edges.length === 0 || graphAApproved.edges.every((e) => e.status !== "proposed")
        ? "PASS"
        : "CRITICAL",
      "Default graph listing did not treat proposed edges as approved.",
      {
        criticalClass:
          graphAApproved.edges.some((e) => e.status === "proposed") ? "proposed-trusted-leak" : undefined,
      },
    ),
  );
  tasks.push(
    task(
      "T6V-GRAPH-NO-CROSS",
      "graph",
      /Marisol Vega|Quinn Hartley|Cedar Payroll|Oakmont/i.test(graphAHay) ? "CRITICAL" : "PASS",
      /Marisol Vega|Quinn Hartley/i.test(graphAHay)
        ? "Harborline graph contained parties from other 6V Cases."
        : "Harborline graph did not import other-matter parties.",
      {
        criticalClass: /Marisol Vega|Quinn Hartley/i.test(graphAHay) ? "cross-matter-contamination" : undefined,
      },
    ),
  );
  const proposedF = await listProposedIntelligence({
    db,
    organizationId: handles.get("F")!.organizationId,
    matterId: handles.get("F")!.matterId,
  });
  const graphF = await listGraph({
    db,
    organizationId: handles.get("F")!.organizationId,
    matterId: handles.get("F")!.matterId,
    edgeStatus: "proposed,approved,edited_and_approved,rejected",
  });
  tasks.push(
    gradeContains({
      id: "T6V-GRAPH-F-PARTIES",
      family: "graph",
      hay: pack({
        nodes: graphF.nodes.map((n) => n.displayName),
        proposedEntities: (proposedF.entities ?? []).map((e) => e.displayName),
      }),
      tokens: ["Meridian", "Pell", "Shoreline"],
      mode: "all",
      missingDetail: "Triad graph/entity extraction missed one or more venturers.",
      rootCause: "K",
    }),
  );

  const eventsH = await listTimelineEvents({
    db,
    organizationId: handles.get("H")!.organizationId,
    matterId: handles.get("H")!.matterId,
    status: ["proposed", "approved", "edited_and_approved", "rejected"],
  });
  const tlH = pack(eventsH);
  tasks.push(
    gradeContains({
      id: "T6V-TL-H-NOTICES",
      family: "timeline",
      hay: tlH,
      tokens: ["May 6", "2026-05-06"],
      mode: "any",
      missingDetail: "Timeline missed the May 6 Larkspur notices.",
      rootCause: "J",
    }),
  );

  const eventsB = await listTimelineEvents({
    db,
    organizationId: handles.get("B")!.organizationId,
    matterId: handles.get("B")!.matterId,
    status: ["proposed", "approved", "edited_and_approved", "rejected"],
  });
  tasks.push(
    gradeContains({
      id: "T6V-TL-B-END",
      family: "timeline",
      hay: pack(eventsB),
      tokens: ["March 18", "2026-03-18"],
      mode: "any",
      missingDetail: "Timeline missed Cedar employment end date.",
      rootCause: "J",
    }),
  );

  await runResearch(db, handles.get("ISO")!, "What does the isolation twin say about Harborline?", index);
  const [harborRow] = await db.select().from(matters).where(eq(matters.id, matterA.matterId)).limit(1);
  const [isoRow] = await db.select().from(matters).where(eq(matters.id, handles.get("ISO")!.matterId)).limit(1);
  const harborSessions = await db
    .select({ matterId: researchSessions.matterId, title: researchSessions.title })
    .from(researchSessions)
    .where(eq(researchSessions.matterId, matterA.matterId));
  const isoLeak =
    harborRow?.primaryState !== "PA" ||
    isoRow?.primaryState !== "NC" ||
    harborSessions.some((row) => /Piedmont Isolation Twin/i.test(row.title ?? ""));
  tasks.push(
    gradeIsolation({
      id: "T6V-ISO-MATTER",
      leaked: isoLeak,
      detail: isoLeak
        ? "Harborline and isolation Cases mixed jurisdiction metadata or research session titles."
        : "Harborline and isolation Cases kept separate jurisdiction metadata and research sessions.",
    }),
  );

  let orgDenied = false;
  try {
    await requireMatterAccess(db, {
      userId: workspaceB.userId,
      matterId: matterA.matterId,
      minAccess: "read",
    });
  } catch (error) {
    orgDenied =
      error instanceof AuthorizationError ||
      (error instanceof Error && /denied|Forbidden|Not a member/i.test(error.message));
  }
  const orgBDrafts = await db
    .select({ id: drafts.id, organizationId: drafts.organizationId })
    .from(drafts)
    .where(eq(drafts.matterId, matterA.matterId));
  const orgBConvo = await db
    .select({ id: conversations.id, organizationId: conversations.organizationId })
    .from(conversations)
    .where(eq(conversations.matterId, matterA.matterId));
  const orgCross =
    orgBDrafts.some((row) => row.organizationId === workspaceB.organizationId) ||
    orgBConvo.some((row) => row.organizationId === workspaceB.organizationId);
  tasks.push(
    gradeIsolation({
      id: "T6V-ISO-ORG",
      leaked: !orgDenied || orgCross,
      detail:
        !orgDenied || orgCross
          ? "Org B could see or attach Org A Case artifacts."
          : "Org A Case drafts and conversations stayed isolated from Org B.",
    }),
  );

  const staff = await ensureUserFromIdentity(db, {
    subject: `nyaya_bench_6v_staff_${stamp}`,
    email: `staff-6v-${stamp}@example.nyayagrid.local`,
    name: "6V Staff Viewer",
  });
  const [staffRole] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.organizationId, workspaceA.organizationId), eq(roles.key, "staff")))
    .limit(1);
  if (staffRole) {
    await db.insert(memberships).values({
      organizationId: workspaceA.organizationId,
      userId: staff.id,
      roleId: staffRole.id,
      status: "active",
    });
    await db.insert(matterMembers).values({
      organizationId: workspaceA.organizationId,
      matterId: matterA.matterId,
      userId: staff.id,
      access: "read",
    });
  }
  let viewDenied = false;
  try {
    await requireMatterAccess(db, {
      userId: staff.id,
      matterId: matterA.matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
  } catch (error) {
    viewDenied =
      error instanceof AuthorizationError ||
      (error instanceof Error && /Missing capability|Matter access/i.test(error.message));
  }
  tasks.push(gradeViewOnly(viewDenied));

  for (const spec of Object.values(MATTERS)) {
    const after = await coverageOf(db, handles.get(spec.key)!, spec.practiceArea);
    tasks.push(
      gradeCoveragePreserved({
        id: `T6V-END-${spec.key}`,
        expected: spec.coverageExpected,
        actual: after.lookup.status,
      }),
    );
  }
  tasks.push(
    task("T6V-NATIONWIDE", "coverage", "PASS", "Nationwide claim remains NO. 6V does not certify 50-state support.", {
      qualityEligible: false,
    }),
  );
  const citeFail = tasks.some((row) => row.criticalClass === "fabricated-citation" && row.severity === "CRITICAL");
  tasks.push(
    task(
      "T6V-CITE-VALID",
      "research",
      citeFail ? "CRITICAL" : "PASS",
      "Citation validity across 6V research packs.",
      citeFail ? { criticalClass: "fabricated-citation", rootCause: "F" } : undefined,
    ),
  );

  const quality = materialQualityPct(tasks);
  const safety = criticalSafetyPct(tasks);
  const critical = tasks.filter((row) => row.severity === "CRITICAL").length;
  const coverageReport: Record<string, string> = {};
  for (const spec of Object.values(MATTERS)) {
    coverageReport[spec.key] = mapDbStatusToReport(coverageByKey[spec.key] ?? spec.coverageExpected);
  }
  const baseline = {
    id: `BASELINE_6V_${baselineId}`,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    environment: {
      APP_ENV: process.env.APP_ENV ?? null,
      database: redactDatabaseUrl(databaseUrl),
      intendedCertification: intendedCertificationTarget(),
      realPrimaryAuthorities: realCount,
    },
    agents: { featureAgentsProduction: agents.agents, featureAgentsStaging: agentsStaging.agents },
    nationwideClaim: "NO",
    attorneyValidated: "NO",
    matters: Object.fromEntries([...handles.entries()].map(([key, row]) => [key, `${row.number} ${row.title}`])),
    coverage: coverageReport,
    quality,
    criticalSafety: safety,
    totals: {
      tasks: tasks.length,
      qualityEligible: tasks.filter((row) => row.qualityEligible).length,
      pass: tasks.filter((row) => row.severity === "PASS").length,
      needsWork: tasks.filter((row) => row.severity === "NEEDS_WORK").length,
      fail: tasks.filter((row) => row.severity === "FAIL").length,
      critical,
    },
    tasks,
  };
  mkdirSync(BASELINES_ROOT, { recursive: true });
  const jsonPath = join(BASELINES_ROOT, `BASELINE_6V_${baselineId}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(baseline, null, 2)}\n`);
  const summary = JSON.stringify({
    baseline: baseline.id,
    quality,
    criticalSafety: safety,
    totals: baseline.totals,
    jsonPath,
  });
  progress("done", { quality, criticalSafety: safety });
  process.stderr.write(`${summary}\n`);
  console.log(summary);
  await closeDb(db);
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
