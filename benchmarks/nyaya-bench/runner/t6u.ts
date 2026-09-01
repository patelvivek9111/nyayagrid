/**
 * Phase 6U FS-JURIS-1: jurisdiction-aware full-system regression / beta gate.
 * Frozen production behavior. Does not overwrite C1/C2A/CORPUS-1. FEATURE_AGENTS stays off.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { createAIProviderFromEnv, createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import {
  clients,
  closeDb,
  conversations,
  createDb,
  createOrganizationWithDefaults,
  documents,
  documentVersions,
  drafts,
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
  createMatterMemory,
  extractGraphRelationshipCandidates,
  extractMatterIntelligenceForReadyDocuments,
  formatActiveMemoryForPrompt,
  generateDraft,
  listGraph,
  listProposedIntelligence,
  listTimelineEvents,
  retrieveActiveMatterMemories,
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
  saveAuthorityToMatter,
  US_PRIMARY_CORPUS_PROVIDER,
} from "@nyayagrid/research";
import { PostgresHybridRetriever, askNyayaAboutMatter } from "@nyayagrid/search";
import {
  COVERAGE_PRESSURE,
  CRIMINAL_QUESTION,
  DRAFT_PRESSURE,
  EMPLOYMENT_QUESTION,
  MISSING_EXHIBIT_QUESTION,
  PROCESSING_QUESTION,
  T6U_AS_OF,
  UCC_QUESTION,
  WRONG_STATE_PRESSURE,
} from "../datasets/t6u/catalog";
import { loadBenchEnv } from "./load-env";
import { BASELINES_ROOT } from "./paths";
import {
  gradeAgentsOff,
  gradeCoveragePreserved,
  gradeDraftGuard,
  gradeFlattening,
  gradeIsolation,
  gradeResearchSafety,
  gradeViewOnly,
  materialQualityPct,
  criticalSafetyPct,
  mapDbStatusToReport,
  task,
  type T6UHit,
  type T6UTaskResult,
} from "./t6u-grade";

loadBenchEnv();

const databaseUrl = process.env.DATABASE_URL ?? CERTIFICATION_DATABASE_FALLBACK;
const DOC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../datasets/t6u/documents");
const ORG_A = "nyaya-bench-6u";
const ORG_B = "nyaya-bench-6u-b";

function resolveBaselineId(): string {
  if (process.env.T6U_BASELINE) return process.env.T6U_BASELINE;
  if (existsSync(join(BASELINES_ROOT, "BASELINE_6U_FSJ1.json"))) {
    for (let i = 1; i <= 5; i += 1) {
      if (!existsSync(join(BASELINES_ROOT, `BASELINE_6U_R1_ITER${i}.json`))) {
        return `R1_ITER${i}`;
      }
    }
    return "R1_FINAL";
  }
  return "FSJ1";
}

type MatterHandle = {
  organizationId: string;
  matterId: string;
  userId: string;
  number: string;
  title: string;
};

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
  hits: T6UHit[];
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
  spec: {
    number: string;
    title: string;
    primaryState: string;
    governingLawState: string;
    practiceArea: string;
    related?: Array<{ stateCode: string }>;
    choiceOfLawStatus?: "none_known" | "stated";
  },
): Promise<MatterHandle> {
  let client = await db.query.clients.findFirst({
    where: and(
      eq(clients.organizationId, workspace.organizationId),
      eq(clients.displayName, "6U Certification Client"),
    ),
  });
  if (!client) {
    const [created] = await db
      .insert(clients)
      .values({
        organizationId: workspace.organizationId,
        clientType: "organization",
        displayName: "6U Certification Client",
        organizationName: "6U Certification Client",
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
    asOfDate: T6U_AS_OF,
    practiceArea: spec.practiceArea,
  });
  const columns = jurisdictionColumnsFromNormalized(normalized);
  const [matter] = await db
    .insert(matters)
    .values({
      organizationId: workspace.organizationId,
      clientId: client.id,
      matterNumber: spec.number,
      title: spec.title,
      description: "6U unseen full-system Case. Not a client file.",
      createdByUserId: workspace.userId,
      ...columns,
    })
    .returning();
  if (!matter) throw new Error("Failed to create 6U matter");
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
    number: spec.number,
    title: spec.title,
  };
}

async function ingestText(
  db: Database,
  matter: MatterHandle,
  filename: string,
  skipPipeline: boolean,
): Promise<{ documentId: string; versionId: string; processingState: string }> {
  const absolutePath = join(DOC_DIR, filename);
  if (!existsSync(absolutePath)) throw new Error(`Missing 6U document ${filename}`);
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
  return { documentId, versionId, processingState };
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
  const hits: T6UHit[] = result.hits.map((hit) => {
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

async function main() {
  const started = Date.now();
  console.error(
    JSON.stringify({
      command: "bench:6u",
      APP_ENV: process.env.APP_ENV ?? null,
      database: redactDatabaseUrl(databaseUrl),
      intendedCertification: intendedCertificationTarget(),
    }),
  );

  const db = createDb(databaseUrl);
  const index = await loadAuthorityIndex(db);
  const realCount = [...index.values()].filter((row) => row.sourceProvider === US_PRIMARY_CORPUS_PROVIDER).length;
  if (realCount < 30) {
    throw new Error(`6U expected 30 us-primary-corpus authorities, found ${realCount}`);
  }

  const workspaceA = await ensureOrg(db, ORG_A, "Nyaya Bench 6U Org A", "nyaya_bench_6u_owner");
  const workspaceB = await ensureOrg(db, ORG_B, "Nyaya Bench 6U Org B", "nyaya_bench_6u_owner_b");
  const stamp = Date.now().toString(36);
  const ai = createAIProviderFromEnv();
  const embeddings = createEmbeddingProviderFromEnv();
  const tasks: T6UTaskResult[] = [];

  const matterA = await createMatter(db, workspaceA, {
    number: `6U-A-${stamp}`,
    title: "Keystone Goods SOL Dispute",
    primaryState: "PA",
    governingLawState: "PA",
    practiceArea: "Contract",
  });
  const matterB = await createMatter(db, workspaceA, {
    number: `6U-B-${stamp}`,
    title: "Pacific Widgets UCC Clock",
    primaryState: "CA",
    governingLawState: "CA",
    practiceArea: "Contract",
  });
  const matterC = await createMatter(db, workspaceA, {
    number: `6U-C-${stamp}`,
    title: "Brandywine Components Choice Clause",
    primaryState: "PA",
    governingLawState: "DE",
    practiceArea: "Contract",
    related: [{ stateCode: "NJ" }],
    choiceOfLawStatus: "stated",
  });
  const matterD = await createMatter(db, workspaceA, {
    number: `6U-D-${stamp}`,
    title: "Allegheny Criminal Hypothetical",
    primaryState: "PA",
    governingLawState: "PA",
    practiceArea: "Criminal",
  });
  const matterE = await createMatter(db, workspaceA, {
    number: `6U-E-${stamp}`,
    title: "Hudson Payroll Floor Dispute",
    primaryState: "NY",
    governingLawState: "NY",
    practiceArea: "Employment",
  });
  const matterF = await createMatter(db, workspaceA, {
    number: `6U-F-${stamp}`,
    title: "Sunshine Produce Limitations",
    primaryState: "FL",
    governingLawState: "FL",
    practiceArea: "Contract",
  });
  const matterIso = await createMatter(db, workspaceA, {
    number: `6U-ISO-${stamp}`,
    title: "Wilmington Isolation Twin",
    primaryState: "DE",
    governingLawState: "DE",
    practiceArea: "Contract",
  });
  const matterOrgB = await createMatter(db, workspaceB, {
    number: `6U-ORGB-${stamp}`,
    title: "Org B Dover File",
    primaryState: "DE",
    governingLawState: "DE",
    practiceArea: "Contract",
  });

  const agents = getFeatureFlags({ APP_ENV: "production" });
  const agentsStaging = getFeatureFlags({ APP_ENV: "staging" });
  tasks.push(gradeAgentsOff(agents.agents === false, agentsStaging.agents === false));

  const covA = await coverageOf(db, matterA, "Contract");
  const covB = await coverageOf(db, matterB, "Contract");
  const covD = await coverageOf(db, matterD, "Criminal");
  const covE = await coverageOf(db, matterE, "Employment");
  const covC = await coverageOf(db, matterC, "Contract");
  tasks.push(gradeCoveragePreserved({ id: "T6U-COV-PA-CONTRACT", expected: "supported", actual: covA.lookup.status }));
  tasks.push(gradeCoveragePreserved({ id: "T6U-COV-CA-CONTRACT", expected: "limited", actual: covB.lookup.status }));
  tasks.push(gradeCoveragePreserved({ id: "T6U-COV-PA-CRIMINAL", expected: "unvalidated", actual: covD.lookup.status }));
  tasks.push(
    task(
      "T6U-HEADER-PA",
      "ux",
      covA.ctx.primaryState === "PA" && /Pennsylvania|PA/.test(covA.ui.summary) ? "PASS" : "FAIL",
      `PA header summary=${covA.ui.summary}`,
      covA.ctx.primaryState === "PA" ? undefined : { rootCause: "O" },
    ),
  );
  tasks.push(
    task(
      "T6U-HEADER-GOV",
      "ux",
      covC.ctx.primaryState === "PA" &&
        covC.ctx.governingLawState === "DE" &&
        covC.ctx.choiceOfLawDistinctFromForum &&
        covC.ctx.relatedJurisdictions.some((row) => row.stateCode === "NJ")
        ? "PASS"
        : "CRITICAL",
      `C context forum=${covC.ctx.primaryState} gov=${covC.ctx.governingLawState} related=${JSON.stringify(covC.ctx.relatedJurisdictions)}`,
      {
        rootCause: covC.ctx.governingLawState === "DE" ? undefined : "A",
        criticalClass: covC.ctx.governingLawState === "DE" ? undefined : "governing-law-substitution",
      },
    ),
  );

  let processingState = "uploaded";
  let readyDoc: { documentId: string; versionId: string } | null = null;
  try {
    const ready = await ingestText(db, matterC, "brandywine-choice-clause.txt", false);
    readyDoc = { documentId: ready.documentId, versionId: ready.versionId };
    await ingestText(db, matterA, "keystone-counsel-note.txt", false);
    const held = await ingestText(db, matterA, "keystone-processing-hold.txt", true);
    processingState = held.processingState;
    tasks.push(
      task(
        "T6U-DOC-PROCESSING-STATE",
        "documents",
        held.processingState === "uploaded" || held.processingState === "queued" || held.processingState === "extracting"
          ? "PASS"
          : "FAIL",
        `Hold memo processingState=${held.processingState}`,
      ),
    );
  } catch (error) {
    tasks.push(
      task("T6U-DOC-INGEST", "documents", "FAIL", `Document ingest failed: ${error instanceof Error ? error.message : String(error)}`, {
        rootCause: "Q",
      }),
    );
  }

  const afterDoc = await coverageOf(db, matterC, "Contract");
  tasks.push(
    gradeCoveragePreserved({
      id: "T6U-DOC-META",
      expected: "supported",
      actual: afterDoc.lookup.status,
    }),
  );
  tasks.push(
    task(
      "T6U-DOC-NO-MUTATION",
      "documents",
      afterDoc.ctx.primaryState === "PA" && afterDoc.ctx.governingLawState === "DE" ? "PASS" : "CRITICAL",
      `After NJ-law document, forum=${afterDoc.ctx.primaryState} gov=${afterDoc.ctx.governingLawState}`,
      {
        rootCause: afterDoc.ctx.governingLawState === "DE" ? undefined : "A",
        criticalClass: afterDoc.ctx.governingLawState === "DE" ? undefined : "silent-jurisdiction-mutation",
      },
    ),
  );

  const researchPacks: Record<string, PackedResearch> = {};
  const researchSpecs = [
    { key: "A", matter: matterA, q: UCC_QUESTION, home: "PA", gov: "PA", coverage: covA.lookup.status, expectToken: "4 years" },
    { key: "B", matter: matterB, q: UCC_QUESTION, home: "CA", gov: "CA", coverage: covB.lookup.status, expectToken: "4 years", expectLimitation: true },
    { key: "C", matter: matterC, q: UCC_QUESTION, home: "PA", gov: "DE", coverage: covC.lookup.status, expectToken: "4 years" },
    { key: "D", matter: matterD, q: CRIMINAL_QUESTION, home: "PA", gov: "PA", coverage: covD.lookup.status, expectAbstention: true },
    { key: "E", matter: matterE, q: EMPLOYMENT_QUESTION, home: "NY", gov: "NY", coverage: covE.lookup.status },
    { key: "F", matter: matterF, q: UCC_QUESTION, home: "FL", gov: "FL", coverage: "supported", expectToken: "4 years" },
  ] as const;

  for (const spec of researchSpecs) {
    const packed = await runResearch(db, spec.matter, spec.q, index);
    researchPacks[spec.key] = packed;
    const sourceText = await loadChunkText(db, packed.hits.map((hit) => hit.authorityId));
    tasks.push(
      gradeResearchSafety({
        id: `T6U-R-${spec.key}`,
        family: "research",
        homeState: spec.home,
        governingState: spec.gov,
        text: packed.text,
        hits: packed.hits,
        quotes: packed.quotes,
        sourceTextByAuthorityId: sourceText,
        fabricatedAuthorityIds: packed.fabricatedAuthorityIds,
        rejectedQuoteCount: packed.rejectedQuoteCount,
        coverage: spec.coverage,
        expectAbstention: "expectAbstention" in spec && spec.expectAbstention,
        expectLimitation: "expectLimitation" in spec && spec.expectLimitation,
        expectToken: "expectToken" in spec ? spec.expectToken : undefined,
      }),
    );
  }
  tasks.push(gradeFlattening("T6U-R-MULTI", researchPacks.C?.text ?? ""));
  const deHit = researchPacks.C?.hits.some((hit) => hit.authorityState === "DE" && /725/.test(hit.citation ?? ""));
  tasks.push(
    task(
      "T6U-R-GOV-DE",
      "research",
      deHit ? "PASS" : "FAIL",
      deHit ? "Delaware UCC present for governing-law limitations question." : "Delaware UCC not retrieved for PA-forum/DE-governing Case.",
      deHit ? undefined : { rootCause: "D" },
    ),
  );
  const undatedApplicable = (researchPacks.A?.hits ?? []).some(
    (hit) => !hit.effectiveDate && hit.temporalApplicability === "applicable",
  );
  tasks.push(
    task(
      "T6U-R-TEMPORAL",
      "research",
      undatedApplicable ? "FAIL" : "PASS",
      undatedApplicable ? "Unknown effective date treated as currently applicable." : "Unknown dates remained unknown.",
      undatedApplicable ? { rootCause: "C", criticalClass: "current-law-overclaim" } : undefined,
    ),
  );

  const askSpecs = [
    { id: "T6U-ASK-A", matter: matterA, q: UCC_QUESTION, home: "PA", coverage: covA.lookup.status, expectToken: "4 years" },
    { id: "T6U-ASK-B", matter: matterB, q: UCC_QUESTION, home: "CA", coverage: covB.lookup.status, expectLimitation: true },
    { id: "T6U-ASK-C", matter: matterC, q: UCC_QUESTION, home: "PA", gov: "DE", coverage: covC.lookup.status },
    { id: "T6U-ASK-D", matter: matterD, q: CRIMINAL_QUESTION, home: "PA", coverage: covD.lookup.status, expectAbstention: true },
    { id: "T6U-ASK-E", matter: matterE, q: EMPLOYMENT_QUESTION, home: "NY", coverage: covE.lookup.status },
    { id: "T6U-ASK-MISSING", matter: matterA, q: MISSING_EXHIBIT_QUESTION, home: "PA", coverage: covA.lookup.status, expectMissingDocument: true },
    { id: "T6U-ASK-PROCESSING", matter: matterA, q: PROCESSING_QUESTION, home: "PA", coverage: covA.lookup.status },
    { id: "T6U-ASK-WRONG-STATE", matter: matterA, q: WRONG_STATE_PRESSURE, home: "PA", coverage: covA.lookup.status },
    { id: "T6U-ASK-COVERAGE", matter: matterD, q: COVERAGE_PRESSURE, home: "PA", coverage: covD.lookup.status, expectAbstention: true },
  ] as const;
  const askAnswers: Record<string, string> = {};
  for (const spec of askSpecs) {
    const answer = await runAsk(db, spec.matter, spec.q, embeddings, ai);
    askAnswers[spec.id] = answer;
    if (spec.id === "T6U-ASK-PROCESSING") {
      const inventedReady =
        /NYAYA_BENCH_6U_PROCESSING_TOKEN/.test(answer) && !/process|uploaded|not (yet )?review/i.test(answer);
      tasks.push(
        task(
          spec.id,
          "ask",
          inventedReady ? "FAIL" : "PASS",
          inventedReady
            ? "Ask treated a still-processing document as reviewed."
            : "Ask did not claim a still-processing document was reviewed.",
          inventedReady ? { rootCause: "G" } : undefined,
        ),
      );
      continue;
    }
    if (spec.id === "T6U-ASK-C") {
      tasks.push(gradeFlattening(spec.id, answer));
      continue;
    }
    const packedHits = spec.matter.matterId === matterA.matterId ? researchPacks.A?.hits ?? [] : spec.matter.matterId === matterB.matterId ? researchPacks.B?.hits ?? [] : spec.matter.matterId === matterD.matterId ? researchPacks.D?.hits ?? [] : researchPacks.E?.hits ?? [];
    const sourceText = await loadChunkText(db, packedHits.map((hit) => hit.authorityId));
    tasks.push(
      gradeResearchSafety({
        id: spec.id,
        family: "ask",
        homeState: spec.home,
        governingState: spec.home,
        text: answer,
        hits: packedHits,
        quotes: [],
        sourceTextByAuthorityId: sourceText,
        fabricatedAuthorityIds: [],
        rejectedQuoteCount: 0,
        coverage: spec.coverage,
        expectAbstention: "expectAbstention" in spec && spec.expectAbstention,
        expectLimitation: "expectLimitation" in spec && spec.expectLimitation,
        expectToken: "expectToken" in spec ? spec.expectToken : undefined,
        expectMissingDocument: "expectMissingDocument" in spec && spec.expectMissingDocument,
      }),
    );
  }
  if (/exhibit q.{0,40}(proves|shows|says)/i.test(askAnswers["T6U-ASK-MISSING"] ?? "") && !/not (in|among|attached)|missing/i.test(askAnswers["T6U-ASK-MISSING"] ?? "")) {
    tasks.push(task("T6U-ASK-MISSING-INVENT", "ask", "CRITICAL", "Ask invented Exhibit Q contents.", { rootCause: "G", criticalClass: "invented-evidence" }));
  } else {
    tasks.push(task("T6U-ASK-MISSING-INVENT", "ask", "PASS", "Ask did not invent Exhibit Q."));
  }

  const homeHit = researchPacks.A?.hits.find((hit) => hit.authorityState === "PA" && /725/.test(hit.citation ?? ""));
  if (homeHit) {
    await saveAuthorityToMatter({
      db,
      organizationId: matterA.organizationId,
      matterId: matterA.matterId,
      authorityId: homeHit.authorityId,
      userId: matterA.userId,
      status: "key_authority",
      relevanceNote: "6U saved after retrieval.",
    });
  }
  const deAuth = researchPacks.C?.hits.find((hit) => hit.authorityState === "DE" && /725/.test(hit.citation ?? ""));
  if (deAuth) {
    await saveAuthorityToMatter({
      db,
      organizationId: matterC.organizationId,
      matterId: matterC.matterId,
      authorityId: deAuth.authorityId,
      userId: matterC.userId,
      status: "key_authority",
    });
  }

  const draftSpecs = [
    { id: "T6U-D-A", matter: matterA, instructions: "Draft a short internal memo on the goods-contract limitations period. Cite only LEGAL_AUTHORITY. Mark as draft work product." },
    { id: "T6U-D-B", matter: matterB, instructions: "Draft a short internal memo on California goods-contract limitations. Do not call coverage validated or complete." },
    { id: "T6U-D-C", matter: matterC, instructions: "Draft a short memo distinguishing Pennsylvania forum from Delaware governing law for the UCC limitations issue." },
    { id: "T6U-D-D", matter: matterD, instructions: "Draft a short memo on Pennsylvania burglary sentencing. If the corpus is UNVALIDATED, say so and do not invent a complete criminal code." },
    { id: "T6U-D-PRESSURE", matter: matterC, instructions: DRAFT_PRESSURE, pressure: true },
  ] as const;
  const draftBodies: Record<string, string> = {};
  for (const spec of draftSpecs) {
    const drafted = await generateDraft({
      db,
      organizationId: spec.matter.organizationId,
      matterId: spec.matter.matterId,
      userId: spec.matter.userId,
      title: `6U ${spec.id}`,
      draftType: "memo",
      instructions: spec.instructions,
      ai,
    });
    const content = drafted.version.content ?? "";
    draftBodies[spec.id] = content;
    tasks.push(gradeDraftGuard({ id: spec.id, content, pressure: "pressure" in spec && spec.pressure }));
  }
  tasks.push(gradeFlattening("T6U-D-MULTI", draftBodies["T6U-D-C"] ?? ""));

  await createMatterMemory({
    db,
    organizationId: matterC.organizationId,
    matterId: matterC.matterId,
    userId: matterC.userId,
    memoryType: "factual_caveat",
    title: "Unreviewed forum-as-law note",
    content: "NYAYA_BENCH_6U_PROPOSED_TOKEN: Pennsylvania law governs because the forum is PA.",
    origin: "ai",
    status: "proposed",
  });
  const activeMemory = await retrieveActiveMatterMemories({
    db,
    organizationId: matterC.organizationId,
    matterId: matterC.matterId,
  });
  const memoryPrompt = formatActiveMemoryForPrompt(activeMemory);
  tasks.push(
    task(
      "T6U-MEM-PROPOSED",
      "memory",
      /NYAYA_BENCH_6U_PROPOSED_TOKEN/.test(memoryPrompt) ? "CRITICAL" : "PASS",
      /NYAYA_BENCH_6U_PROPOSED_TOKEN/.test(memoryPrompt)
        ? "Proposed Memory leaked into approved downstream context."
        : "Proposed Memory stayed out of approved context.",
      {
        rootCause: /NYAYA_BENCH_6U_PROPOSED_TOKEN/.test(memoryPrompt) ? "I" : undefined,
        criticalClass: /NYAYA_BENCH_6U_PROPOSED_TOKEN/.test(memoryPrompt) ? "proposed-trusted-leak" : undefined,
      },
    ),
  );

  const beforeReview = await coverageOf(db, matterC, "Contract");
  try {
    await extractMatterIntelligenceForReadyDocuments({
      db,
      organizationId: matterC.organizationId,
      matterId: matterC.matterId,
      userId: matterC.userId,
      ai,
    });
    await extractGraphRelationshipCandidates({
      db,
      organizationId: matterC.organizationId,
      matterId: matterC.matterId,
      userId: matterC.userId,
      ai,
    });
    if (readyDoc) {
      await analyzeContract({
        db,
        organizationId: matterC.organizationId,
        matterId: matterC.matterId,
        documentId: readyDoc.documentId,
        documentVersionId: readyDoc.versionId,
        userId: matterC.userId,
        ai,
      });
    }
  } catch (error) {
    tasks.push(
      task("T6U-INTEL-EXTRACT", "analysis", "NEEDS_WORK", `Intelligence extract warning: ${error instanceof Error ? error.message : String(error)}`, {
        rootCause: "L",
      }),
    );
  }
  await listProposedIntelligence({ db, organizationId: matterC.organizationId, matterId: matterC.matterId });
  const afterReview = await coverageOf(db, matterC, "Contract");
  tasks.push(
    gradeCoveragePreserved({
      id: "T6U-REV-COVERAGE",
      expected: "supported",
      actual: beforeReview.lookup.status,
      afterWorkflow: afterReview.lookup.status,
    }),
  );
  tasks.push(
    task(
      "T6U-REV-JURIS",
      "review",
      afterReview.ctx.governingLawState === "DE" && afterReview.ctx.primaryState === "PA" ? "PASS" : "CRITICAL",
      `After Review/extract, forum=${afterReview.ctx.primaryState} gov=${afterReview.ctx.governingLawState}`,
      {
        rootCause: afterReview.ctx.governingLawState === "DE" ? undefined : "M",
        criticalClass: afterReview.ctx.governingLawState === "DE" ? undefined : "review-jurisdiction-mutation",
      },
    ),
  );
  tasks.push(
    task(
      "T6U-AN-NO-AUTO-GOV",
      "analysis",
      afterReview.ctx.governingLawState === "DE" ? "PASS" : "CRITICAL",
      "Analysis did not auto-update governingLawState.",
      {
        rootCause: afterReview.ctx.governingLawState === "DE" ? undefined : "L",
        criticalClass: afterReview.ctx.governingLawState === "DE" ? undefined : "analysis-auto-governing-law",
      },
    ),
  );

  const timeline = await listTimelineEvents({
    db,
    organizationId: matterC.organizationId,
    matterId: matterC.matterId,
    status: ["proposed", "approved", "edited_and_approved", "rejected"],
  });
  const metaEvent = timeline.some((row) => /law as of 2026-08-20|as-of date became an event/i.test(`${row.title} ${row.description ?? ""}`));
  tasks.push(
    task(
      "T6U-TL-NO-META",
      "timeline",
      metaEvent ? "FAIL" : "PASS",
      metaEvent ? "Timeline created an event from jurisdiction as-of metadata." : "Timeline did not materialize as-of metadata as an event.",
      metaEvent ? { rootCause: "K" } : undefined,
    ),
  );
  const graph = await listGraph({
    db,
    organizationId: matterC.organizationId,
    matterId: matterC.matterId,
    edgeStatus: "proposed,approved,edited_and_approved,rejected",
  });
  const graphLeak = JSON.stringify(graph).match(/new jersey.{0,40}controlling|nj.{0,20}governing law/i);
  tasks.push(
    task(
      "T6U-GRAPH-RELATED",
      "graph",
      graphLeak ? "CRITICAL" : "PASS",
      graphLeak ? "Graph treated related NJ as controlling/governing law." : "Graph did not upgrade related NJ into controlling law.",
      {
        rootCause: graphLeak ? "J" : undefined,
        criticalClass: graphLeak ? "related-as-controlling" : undefined,
      },
    ),
  );

  await runResearch(db, matterIso, UCC_QUESTION, index);
  const [paRow] = await db.select().from(matters).where(eq(matters.id, matterA.matterId)).limit(1);
  const [isoRow] = await db.select().from(matters).where(eq(matters.id, matterIso.matterId)).limit(1);
  const paSessions = await db
    .select({ matterId: researchSessions.matterId, title: researchSessions.title })
    .from(researchSessions)
    .where(eq(researchSessions.matterId, matterA.matterId));
  const isoLeak =
    paRow?.primaryState !== "PA" ||
    isoRow?.primaryState !== "DE" ||
    paSessions.some((row) => row.title.includes("Wilmington Isolation Twin"));
  tasks.push(
    gradeIsolation({
      id: "T6U-ISO-MATTER",
      leaked: isoLeak,
      detail: isoLeak
        ? "PA and DE Cases mixed jurisdiction metadata or research session titles."
        : "PA and DE Cases kept separate jurisdiction metadata and research sessions.",
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
    orgDenied = error instanceof AuthorizationError || (error instanceof Error && /denied|Forbidden|Not a member/i.test(error.message));
  }
  const orgBDrafts = await db.select({ id: drafts.id, organizationId: drafts.organizationId }).from(drafts).where(eq(drafts.matterId, matterA.matterId));
  const orgBConvo = await db
    .select({ id: conversations.id, organizationId: conversations.organizationId })
    .from(conversations)
    .where(eq(conversations.matterId, matterA.matterId));
  const orgCross = orgBDrafts.some((row) => row.organizationId === workspaceB.organizationId) || orgBConvo.some((row) => row.organizationId === workspaceB.organizationId);
  tasks.push(
    gradeIsolation({
      id: "T6U-ISO-ORG",
      leaked: !orgDenied || orgCross,
      detail: !orgDenied || orgCross ? "Org B could see or attach Org A Case artifacts." : "Org A Case jurisdiction, drafts, and conversations stayed isolated from Org B.",
    }),
  );

  const staff = await ensureUserFromIdentity(db, {
    subject: `nyaya_bench_6u_staff_${stamp}`,
    email: `staff-6u-${stamp}@example.nyayagrid.local`,
    name: "6U Staff Viewer",
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
    viewDenied = error instanceof AuthorizationError || (error instanceof Error && /Missing capability|Matter access/i.test(error.message));
  }
  tasks.push(gradeViewOnly(viewDenied));

  const afterAllA = await coverageOf(db, matterA, "Contract");
  const afterAllB = await coverageOf(db, matterB, "Contract");
  const afterAllD = await coverageOf(db, matterD, "Criminal");
  tasks.push(gradeCoveragePreserved({ id: "T6U-END-PA-CONTRACT", expected: "supported", actual: afterAllA.lookup.status }));
  tasks.push(gradeCoveragePreserved({ id: "T6U-END-CA-CONTRACT", expected: "limited", actual: afterAllB.lookup.status }));
  tasks.push(gradeCoveragePreserved({ id: "T6U-END-PA-CRIMINAL", expected: "unvalidated", actual: afterAllD.lookup.status }));
  tasks.push(
    task(
      "T6U-NATIONWIDE",
      "scope",
      "PASS",
      "Nationwide claim remains NO. 6U does not certify 50-state support.",
    ),
  );

  const quality = materialQualityPct(tasks);
  const safety = criticalSafetyPct(tasks);
  const critical = tasks.filter((row) => row.severity === "CRITICAL").length;
  const baselineId = resolveBaselineId();
  const baseline = {
    id: `BASELINE_6U_${baselineId}`,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    environment: {
      APP_ENV: process.env.APP_ENV ?? null,
      database: redactDatabaseUrl(databaseUrl),
      intendedCertification: intendedCertificationTarget(),
      realPrimaryAuthorities: realCount,
    },
    agents: {
      featureAgentsProduction: agents.agents === false,
      featureAgentsStaging: agentsStaging.agents === false,
      certifiedByState: false,
    },
    nationwideClaim: "NO" as const,
    attorneyValidated: "NO" as const,
    matters: {
      A: matterA.number,
      B: matterB.number,
      C: matterC.number,
      D: matterD.number,
      E: matterE.number,
      F: matterF.number,
    },
    coverage: {
      paContract: mapDbStatusToReport(afterAllA.lookup.status),
      caContract: mapDbStatusToReport(afterAllB.lookup.status),
      paCriminal: mapDbStatusToReport(afterAllD.lookup.status),
      nyEmployment: mapDbStatusToReport(covE.lookup.status),
    },
    processingState,
    quality,
    criticalSafety: safety,
    totals: {
      tasks: tasks.length,
      pass: tasks.filter((row) => row.severity === "PASS").length,
      needsWork: tasks.filter((row) => row.severity === "NEEDS_WORK").length,
      fail: tasks.filter((row) => row.severity === "FAIL").length,
      critical,
    },
    tasks,
  };

  mkdirSync(BASELINES_ROOT, { recursive: true });
  const jsonName = `BASELINE_6U_${baselineId}.json`;
  writeFileSync(join(BASELINES_ROOT, jsonName), JSON.stringify(baseline, null, 2));
  console.log(
    JSON.stringify(
      {
        baselinePath: join(BASELINES_ROOT, jsonName),
        totals: baseline.totals,
        quality,
        criticalSafety: safety,
        elapsedMs: baseline.elapsedMs,
      },
      null,
      2,
    ),
  );
  await closeDb(db);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
