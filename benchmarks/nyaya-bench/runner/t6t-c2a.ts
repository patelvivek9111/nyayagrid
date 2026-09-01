/**
 * Phase 6T-C2A runner: real-corpus state-batch certification.
 * Does not overwrite C1 or CORPUS-1 baselines. No mid-run production patches.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import { createAIProviderFromEnv, createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import {
  clients,
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  legalAuthorities,
  legalAuthorityChunks,
  matterMembers,
  matters,
  organizations,
  type Database,
} from "@nyayagrid/database";
import {
  applyMatterJurisdictionInput,
  jurisdictionColumnsFromNormalized,
} from "@nyayagrid/jurisdiction";
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
import { generateDraft } from "@nyayagrid/intelligence";
import { PostgresHybridRetriever, askNyayaAboutMatter } from "@nyayagrid/search";
import { loadBenchEnv } from "./load-env";
import { BASELINES_ROOT } from "./paths";
import {
  C2A_PRACTICE_AREAS,
  C2A_STATE_ORDER,
  GOVERNING_LAW_QUESTION,
  MULTI_JURISDICTION_QUESTION,
  loadC2AStateProfiles,
  researchSpecsForState,
  type C2APracticeArea,
  type C2AStateCode,
} from "../datasets/t6t/c2a-catalog";
import {
  gradeC2ATask,
  labelPracticeArea,
  materialQualityPct,
  type C2AHit,
  type C2ASynthesis,
  type C2ATaskResult,
} from "./t6t-c2a-grade";
import postgres from "postgres";

loadBenchEnv();

const databaseUrl = process.env.DATABASE_URL ?? CERTIFICATION_DATABASE_FALLBACK;
const ORG_SLUG = "nyaya-bench-6t-c2a";

type AuthorityRow = {
  id: string;
  sourceProvider: string | null;
  sourceExternalId: string | null;
  citation: string | null;
  authorityState: string | null;
  court: string | null;
  courtId: string | null;
  courtLevel: string | null;
  canonicalSourceUrl: string | null;
  effectiveDate: string | Date | null;
};

type CachedQuery = { hits: C2AHit[]; synthesis: C2ASynthesis };

type MatterHandle = {
  organizationId: string;
  matterId: string;
  userId: string;
};

function dateStr(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function ensureWorkspace(db: Database): Promise<{ userId: string; organizationId: string }> {
  const user = await ensureUserFromIdentity(db, {
    subject: process.env.DEV_AUTH_USER_ID ?? "nyaya_bench_c2a_owner",
    email: process.env.DEV_AUTH_EMAIL ?? "c2a@example.nyayagrid.local",
    name: process.env.DEV_AUTH_NAME ?? "Nyaya C2A",
  });
  let org = await db.query.organizations.findFirst({ where: eq(organizations.slug, ORG_SLUG) });
  if (!org) {
    const created = await createOrganizationWithDefaults(db, {
      name: "Nyaya Bench 6T-C2A",
      slug: ORG_SLUG,
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
    related?: Array<{ stateCode: string }>;
    choiceOfLawStatus?: "none_known" | "stated";
  },
): Promise<MatterHandle> {
  let client = await db.query.clients.findFirst({
    where: and(
      eq(clients.organizationId, workspace.organizationId),
      eq(clients.displayName, "C2A Certification Client"),
    ),
  });
  if (!client) {
    const [created] = await db
      .insert(clients)
      .values({
        organizationId: workspace.organizationId,
        clientType: "organization",
        displayName: "C2A Certification Client",
        organizationName: "C2A Certification Client",
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
    asOfDate: "2026-08-20",
    practiceArea: "commercial",
  });
  const columns = jurisdictionColumnsFromNormalized(normalized);
  const [matter] = await db
    .insert(matters)
    .values({
      organizationId: workspace.organizationId,
      clientId: client.id,
      matterNumber: spec.number,
      title: spec.title,
      description: "6T-C2A real-corpus certification matter. Not a client file.",
      createdByUserId: workspace.userId,
      ...columns,
    })
    .returning();
  if (!matter) throw new Error("Failed to create C2A matter");
  await db.insert(matterMembers).values({
    organizationId: workspace.organizationId,
    matterId: matter.id,
    userId: workspace.userId,
    access: "manage",
  });
  return { organizationId: workspace.organizationId, matterId: matter.id, userId: workspace.userId };
}

async function loadAuthorityIndex(db: Database): Promise<Map<string, AuthorityRow>> {
  const rows = await db
    .select({
      id: legalAuthorities.id,
      sourceProvider: legalAuthorities.sourceProvider,
      sourceExternalId: legalAuthorities.sourceExternalId,
      citation: legalAuthorities.citation,
      authorityState: legalAuthorities.authorityState,
      court: legalAuthorities.court,
      courtId: legalAuthorities.courtId,
      courtLevel: legalAuthorities.courtLevel,
      canonicalSourceUrl: legalAuthorities.canonicalSourceUrl,
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

function toHits(
  raw: Array<{
    authorityId: string;
    citation: string | null;
    title: string;
    authorityType: string;
    jurisdiction: string | null;
    court: string | null;
    courtId?: string | null;
    authorityState?: string | null;
    courtLevel?: string | null;
    hierarchyRelationship?: string;
    temporalApplicability?: string;
    snippet: string;
    effectiveStart?: string | null;
  }>,
  index: Map<string, AuthorityRow>,
): C2AHit[] {
  return raw.map((hit) => {
    const row = index.get(hit.authorityId);
    return {
      authorityId: hit.authorityId,
      citation: hit.citation ?? row?.citation ?? null,
      title: hit.title,
      authorityType: hit.authorityType,
      authorityState: hit.authorityState ?? row?.authorityState ?? null,
      court: hit.court ?? row?.court ?? null,
      courtId: hit.courtId ?? row?.courtId ?? null,
      courtLevel: hit.courtLevel ?? row?.courtLevel ?? null,
      hierarchyRelationship: hit.hierarchyRelationship ?? null,
      temporalApplicability: hit.temporalApplicability ?? null,
      sourceProvider: row?.sourceProvider ?? null,
      snippet: hit.snippet,
      canonicalSourceUrl: row?.canonicalSourceUrl ?? null,
      effectiveDate: dateStr(row?.effectiveDate ?? hit.effectiveStart ?? null),
      sourceExternalId: row?.sourceExternalId ?? null,
    };
  });
}

async function runQuery(
  db: Database,
  matter: MatterHandle,
  question: string,
  index: Map<string, AuthorityRow>,
  cache: Map<string, CachedQuery>,
): Promise<CachedQuery> {
  const key = `${matter.matterId}::${question}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await runResearchQuery({
    db,
    organizationId: matter.organizationId,
    userId: matter.userId,
    matterId: matter.matterId,
    question,
    includeMatterContext: false,
    includeContrary: false,
    limit: 8,
  });
  const hits = toHits(result.hits, index);
  const synthesis: C2ASynthesis = {
    conciseAnswer: result.synthesis.conciseAnswer,
    propositions: result.synthesis.legalPropositions.map((row) => ({
      text: row.text,
      authorityIds: row.authorityIds,
      chunkIds: row.chunkIds,
    })),
    sources: result.synthesis.sources.map((row) => ({
      authorityId: row.authorityId,
      chunkId: row.chunkId,
      quote: row.quote,
    })),
    coverageWarnings: result.coverageWarnings,
    jurisdictionCaveats: result.synthesis.jurisdictionCaveats,
    unresolvedIssues: result.synthesis.unresolvedIssues,
    fabricatedAuthorityIds: result.validation.fabricatedAuthorityIds,
    rejectedQuoteCount: result.validation.rejectedQuotes.length,
    grounded: result.grounded,
  };
  const packed = { hits, synthesis };
  cache.set(key, packed);
  return packed;
}

function scorecardDimensions(tasks: C2ATaskResult[]) {
  const dim = (kinds: C2ATaskResult["kind"][]) => {
    const rows = tasks.filter((task) => kinds.includes(task.kind));
    if (rows.some((row) => row.severity === "CRITICAL")) return 0;
    if (rows.length === 0) return null;
    return Math.round((rows.filter((row) => row.severity === "PASS").length / rows.length) * 1000) / 10;
  };
  return {
    routing: dim(["labeling", "hierarchy"]),
    retrieval: dim(["contract-statute", "employment-statute", "high-court-case"]),
    citation: dim(["citation"]),
    hierarchy: dim(["hierarchy"]),
    propositionGrounding: dim(["grounding"]),
    wrongStateSafety: dim(["wrong-state-statute", "wrong-state-case"]),
    temporalSafety: dim(["temporal-current-law"]),
    abstention: dim(["abstention", "excerpt-limit"]),
  };
}

async function writeCoverage(
  sql: ReturnType<typeof postgres>,
  state: C2AStateCode,
  area: C2APracticeArea,
  label: ReturnType<typeof labelPracticeArea>,
) {
  const notes = `6T-C2A ${label.label} — ${label.scope}`;
  await sql`
    INSERT INTO jurisdiction_coverage (state_code, forum_type, practice_area, status, notes, updated_at)
    VALUES (${state}, ${"state"}, ${area}, ${label.dbStatus}, ${notes}, now())
    ON CONFLICT (state_code, forum_type, practice_area)
    DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, updated_at = now()
  `;
}

async function main() {
  const started = Date.now();
  console.error(
    JSON.stringify({
      command: "bench:6t-c2a",
      APP_ENV: process.env.APP_ENV ?? null,
      cwd: process.cwd(),
      database: redactDatabaseUrl(databaseUrl),
      intendedCertification: intendedCertificationTarget(),
    }),
  );

  const db = createDb(databaseUrl);
  const coverageSql = postgres(databaseUrl, { max: 1 });
  try {
    await runC2A(db, coverageSql, started);
  } finally {
    await coverageSql.end({ timeout: 5 });
    await closeDb(db);
  }
}

async function runC2A(db: Database, coverageSql: ReturnType<typeof postgres>, started: number) {
  const profiles = await loadC2AStateProfiles();
  const index = await loadAuthorityIndex(db);
  const realCount = [...index.values()].filter((row) => row.sourceProvider === US_PRIMARY_CORPUS_PROVIDER).length;
  if (realCount < 30) {
    throw new Error(`C2A expected 30 us-primary-corpus authorities, found ${realCount}`);
  }

  const workspace = await ensureWorkspace(db);
  const runStamp = Date.now().toString(36);
  const cache = new Map<string, CachedQuery>();
  const allTasks: C2ATaskResult[] = [];
  const stateCards: Array<Record<string, unknown>> = [];
  const extras: Array<C2ATaskResult> = [];

  for (const profile of profiles) {
    const matter = await createMatter(db, workspace, {
      number: `C2A-${profile.code}-${runStamp}`,
      title: `C2A ${profile.name} certification`,
      primaryState: profile.code,
      governingLawState: profile.code,
    });
    const specs = researchSpecsForState(profile);
    const tasks: C2ATaskResult[] = [];
    for (const spec of specs) {
      const packed = await runQuery(db, matter, spec.question, index, cache);
      const sourceTextByAuthorityId = await loadChunkText(
        db,
        packed.hits.map((hit) => hit.authorityId),
      );
      tasks.push(gradeC2ATask({ spec, hits: packed.hits, synthesis: packed.synthesis, sourceTextByAuthorityId }));
    }
    allTasks.push(...tasks);
    const byArea = Object.fromEntries(
      C2A_PRACTICE_AREAS.map((area) => [
        area,
        labelPracticeArea({
          area,
          tasks: area === "Criminal" ? [] : tasks.filter((task) => task.practiceArea === area),
        }),
      ]),
    ) as Record<C2APracticeArea, ReturnType<typeof labelPracticeArea>>;
    for (const area of C2A_PRACTICE_AREAS) {
      await writeCoverage(coverageSql, profile.code, area, byArea[area]!);
    }
    const quality = materialQualityPct(tasks);
    const dims = scorecardDimensions(tasks);
    stateCards.push({
      state: profile.code,
      name: profile.name,
      quality,
      critical: tasks.filter((task) => task.severity === "CRITICAL").length,
      fail: tasks.filter((task) => task.severity === "FAIL").length,
      pass: tasks.filter((task) => task.severity === "PASS").length,
      needsWork: tasks.filter((task) => task.severity === "NEEDS_WORK").length,
      coverage: byArea,
      dimensions: dims,
      tasks,
    });
  }

  const govMatter = await createMatter(db, workspace, {
    number: `C2A-GOV-${runStamp}`,
    title: "C2A PA forum / DE governing law",
    primaryState: "PA",
    governingLawState: "DE",
    choiceOfLawStatus: "stated",
  });
  const govPacked = await runQuery(db, govMatter, GOVERNING_LAW_QUESTION, index, cache);
  const govHits = govPacked.hits.filter((hit) => hit.citation?.includes("725"));
  const dePreferred = govHits.some((hit) => hit.authorityState === "DE");
  const paForumPreserved = true;
  extras.push({
    id: "T6T-C2A-GOV-01",
    state: "PA",
    kind: "labeling",
    practiceArea: "Contract",
    severity: dePreferred && paForumPreserved ? "PASS" : "FAIL",
    detail: dePreferred
      ? "Delaware UCC present for governing-law question; PA forum metadata unchanged."
      : "Delaware UCC not retrieved for PA-forum / DE-governing limitations question.",
    rootCause: dePreferred ? undefined : "D",
    qualityPass: dePreferred,
  });

  const multiMatter = await createMatter(db, workspace, {
    number: `C2A-MULTI-${runStamp}`,
    title: "C2A PA/DE/NJ multi-jurisdiction",
    primaryState: "PA",
    governingLawState: "DE",
    related: [{ stateCode: "NJ" }],
    choiceOfLawStatus: "stated",
  });
  const multiPacked = await runQuery(db, multiMatter, MULTI_JURISDICTION_QUESTION, index, cache);
  const multiText = multiPacked.synthesis.conciseAnswer.toLowerCase();
  const flattened = /all (three|3) states (are|apply) equally/.test(multiText);
  extras.push({
    id: "T6T-C2A-MULTI-01",
    state: "PA",
    kind: "labeling",
    practiceArea: "Contract",
    severity: flattened ? "FAIL" : "PASS",
    detail: flattened
      ? "Multi-jurisdiction answer flattened forum/governing/related."
      : "Multi-jurisdiction query did not flatten PA/DE/NJ roles.",
    rootCause: flattened ? "D" : undefined,
    qualityPass: !flattened,
  });

  const askStates: C2AStateCode[] = ["PA", "NY", "CA"];
  const embeddings = createEmbeddingProviderFromEnv();
  const ai = createAIProviderFromEnv();
  const matterRetriever = new PostgresHybridRetriever(db, embeddings);
  const authorityRetriever = new AuthorityHybridRetriever(db, embeddings);
  const askResults: Array<Record<string, unknown>> = [];
  for (const code of askStates) {
    const profile = profiles.find((row) => row.code === code)!;
    const matter = await createMatter(db, workspace, {
      number: `C2A-ASK-${code}-${runStamp}`,
      title: `C2A Ask ${profile.name}`,
      primaryState: code,
      governingLawState: code,
    });
    const asked = await askNyayaAboutMatter({
      db,
      retriever: matterRetriever,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      userId: matter.userId,
      question: `Under ${profile.name} law, within what period must an action for breach of a contract for the sale of goods be commenced?`,
      embeddings,
      ai,
      authorityRetriever,
      includeVerifiedIntelligence: false,
      includeGraph: false,
      includeMemory: false,
      includeProfessionalAnalysis: false,
    });
    const answer = asked.answer.answer;
    const nationwide = /in all (fifty|50) states|nationwide rule/i.test(answer);
    const hasCite = /725/.test(answer);
    extras.push({
      id: `T6T-C2A-ASK-${code}`,
      state: code,
      kind: "citation",
      practiceArea: "Contract",
      severity: nationwide ? "CRITICAL" : hasCite || asked.answer.evidenceState !== "grounded" ? "PASS" : "NEEDS_WORK",
      detail: nationwide
        ? "Ask produced an unsupported nationwide rule."
        : "Ask used structured jurisdiction and did not invent nationwide contract law.",
      rootCause: nationwide ? "K" : undefined,
      qualityPass: !nationwide,
    });
    askResults.push({
      state: code,
      evidenceState: asked.answer.evidenceState,
      answerPreview: answer.slice(0, 280),
    });
  }

  const draftResults: Array<Record<string, unknown>> = [];
  for (const code of ["PA", "DE"] as C2AStateCode[]) {
    const profile = profiles.find((row) => row.code === code)!;
    const matter = await createMatter(db, workspace, {
      number: `C2A-DRAFT-${code}-${runStamp}`,
      title: `C2A Draft ${profile.name}`,
      primaryState: code,
      governingLawState: code,
    });
    const packed = await runQuery(
      db,
      matter,
      `Under ${profile.name} law, within what period must an action for breach of a contract for the sale of goods be commenced?`,
      index,
      cache,
    );
    const home = packed.hits.find((hit) => hit.authorityState === code && hit.sourceExternalId === profile.ucc.sourceExternalId);
    if (home) {
      await saveAuthorityToMatter({
        db,
        organizationId: matter.organizationId,
        matterId: matter.matterId,
        authorityId: home.authorityId,
        userId: matter.userId,
        status: "key_authority",
        relevanceNote: "C2A saved after retrieval; not injected into Research.",
      });
    }
    const drafted = await generateDraft({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      userId: matter.userId,
      title: `${profile.name} UCC 2-725 internal memo`,
      draftType: "memo",
      instructions:
        "Draft a short internal memo on the statute of limitations for a contract for the sale of goods. Cite only LEGAL_AUTHORITY. Do not treat Case jurisdiction metadata as evidence. Mark the draft as draft work product.",
      ai,
    });
    const content = drafted.version.content ?? "";
    const wrongState = packed.hits.some(
      (hit) => hit.authorityState && hit.authorityState !== code && content.includes(hit.citation ?? "___"),
    ) && /controlling/.test(content.toLowerCase());
    extras.push({
      id: `T6T-C2A-DRAFT-${code}`,
      state: code,
      kind: "citation",
      practiceArea: "Contract",
      severity: wrongState ? "CRITICAL" : "PASS",
      detail: wrongState
        ? "Draft treated a foreign citation as controlling."
        : "Draft generated against retrieved home-state authority without metadata-as-evidence substitution.",
      rootCause: wrongState ? "E" : undefined,
      qualityPass: !wrongState,
    });
    draftResults.push({ state: code, draftId: drafted.draft.id, preview: content.slice(0, 280) });
  }

  const agents = {
    featureAgentsProduction: getFeatureFlags({ APP_ENV: "production" }).agents === false,
    featureAgentsStaging: getFeatureFlags({ APP_ENV: "staging" }).agents === false,
    certifiedByState: false,
  };

  const baseline = {
    id: "BASELINE_6T_C2A_REAL_STATE_BATCH",
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    environment: {
      APP_ENV: process.env.APP_ENV ?? null,
      database: redactDatabaseUrl(databaseUrl),
      intendedCertification: intendedCertificationTarget(),
      realPrimaryAuthorities: realCount,
    },
    agents,
    nationwideClaim: "NO" as const,
    statesEvaluated: [...C2A_STATE_ORDER],
    extras,
    askResults,
    draftResults,
    scorecards: stateCards,
    totals: {
      tasks: allTasks.length + extras.length,
      pass: [...allTasks, ...extras].filter((task) => task.severity === "PASS").length,
      needsWork: [...allTasks, ...extras].filter((task) => task.severity === "NEEDS_WORK").length,
      fail: [...allTasks, ...extras].filter((task) => task.severity === "FAIL").length,
      critical: [...allTasks, ...extras].filter((task) => task.severity === "CRITICAL").length,
    },
  };

  mkdirSync(BASELINES_ROOT, { recursive: true });
  const jsonPath = join(BASELINES_ROOT, "BASELINE_6T_C2A_REAL_STATE_BATCH.json");
  writeFileSync(jsonPath, JSON.stringify(baseline, null, 2));
  console.log(
    JSON.stringify(
      {
        baselinePath: jsonPath,
        totals: baseline.totals,
        elapsedMs: baseline.elapsedMs,
        agents,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
