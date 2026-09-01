import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { loadBenchEnv } from "./load-env";
import { BASELINES_ROOT, RUNS_ROOT } from "./paths";
import { shouldPreserveHistoricalC1, HISTORICAL_C1_JSON } from "./c1-freeze";
import {
  applyMatterJurisdictionInput,
  classifyAuthorityRelationship,
  deriveCircuitFromCourtId,
  formatJurisdictionPromptBlock,
  isAuthorityTemporallyApplicable,
  listFederalDistrictsForState,
  listUsStates,
  rankAuthoritiesForMatter,
  shouldAbstainForUnknownJurisdiction,
  type MatterJurisdictionContext,
} from "@nyayagrid/jurisdiction";
import { labelResearchHits } from "@nyayagrid/research";
import { getFeatureFlags } from "@nyayagrid/platform";
import { buildDraftGenerationSystemPrompt } from "@nyayagrid/ai";
import {
  BENCHMARK_VERSION,
  EXPECTED_HOME_CIRCUIT,
  PRACTICE_AREAS,
} from "../datasets/t6t/hidden_ground_truth/expected-circuits";

loadBenchEnv();

if (shouldPreserveHistoricalC1()) {
  const historical = JSON.parse(readFileSync(HISTORICAL_C1_JSON, "utf8")) as {
    generatedAt: string;
    corpus: Record<string, unknown>;
    totals: Record<string, unknown>;
  };
  let liveInventory: Record<string, unknown> | null = null;
  try {
    liveInventory = JSON.parse(
      readFileSync(join(BASELINES_ROOT, "BASELINE_6T_CORPUS_INVENTORY.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    liveInventory = null;
  }
  console.log(
    JSON.stringify(
      {
        frozen: true,
        reason:
          "BASELINE_6T_C1_50_STATE.* is the historical empty-corpus snapshot. Recertification is PHASE 6T-C2A.",
        historicalC1: {
          generatedAt: historical.generatedAt,
          corpus: historical.corpus,
          totals: historical.totals,
        },
        liveInventory: liveInventory
          ? {
              generatedAt: liveInventory.generatedAt,
              totalAuthorities: liveInventory.totalAuthorities,
              realPrimaryAuthorities: liveInventory.realPrimaryAuthorities,
              syntheticAuthorities: liveInventory.syntheticAuthorities,
              statesWithRealAuthorities: liveInventory.statesWithRealAuthorities,
              realStatuteCount: liveInventory.realStatuteCount,
              realCaseCount: liveInventory.realCaseCount,
            }
          : null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

type Severity = "PASS" | "NEEDS_WORK" | "FAIL" | "CRITICAL";
type CoverageLabel = "supported" | "limited" | "unvalidated";

type TaskResult = {
  id: string;
  state: string;
  class:
    | "correct-state"
    | "wrong-state"
    | "hierarchy"
    | "lower-court"
    | "federal-circuit"
    | "other-circuit"
    | "scotus"
    | "temporal"
    | "abstention"
    | "choice-of-law"
    | "multi-jurisdiction"
    | "corpus"
    | "draft-metadata"
    | "agents-flag";
  severity: Severity;
  detail: string;
  rootCause?: string;
};

function matterForState(code: string): Pick<
  MatterJurisdictionContext,
  | "jurisdictionMode"
  | "forumType"
  | "primaryState"
  | "governingLawState"
  | "federalCircuit"
  | "relatedJurisdictions"
  | "courtId"
  | "asOfDate"
> {
  return {
    jurisdictionMode: "state",
    forumType: "state",
    primaryState: code,
    governingLawState: code,
    federalCircuit: null,
    relatedJurisdictions: [],
    courtId: `st-${code.toLowerCase()}-high`,
    asOfDate: "2026-08-19",
  };
}

function unknownMatter(): MatterJurisdictionContext {
  return {
    matterId: "unknown",
    organizationId: "unknown",
    jurisdictionMode: "unknown",
    forumType: null,
    primaryState: null,
    courtId: null,
    courtName: null,
    federalDistrict: null,
    federalCircuit: null,
    practiceArea: null,
    asOfDate: "2026-08-19",
    governingLawState: null,
    choiceOfLawStatus: "unknown",
    relatedJurisdictions: [],
    source: "user_metadata",
    legacyJurisdiction: null,
    legacyCourt: null,
    coverage: "unvalidated",
    coverageByPracticeArea: false,
    choiceOfLawDistinctFromForum: false,
    summary: "Jurisdiction not set",
    promptBlock: "",
  };
}

function decoyState(code: string, all: string[]): string {
  const index = all.indexOf(code);
  return all[(index + 1) % all.length]!;
}

function otherCircuit(home: string): string {
  return home === "9" ? "3" : "9";
}

function record(
  tasks: TaskResult[],
  partial: Omit<TaskResult, "severity"> & { ok: boolean; critical?: boolean },
) {
  tasks.push({
    id: partial.id,
    state: partial.state,
    class: partial.class,
    severity: partial.ok ? "PASS" : partial.critical ? "CRITICAL" : "FAIL",
    detail: partial.detail,
    rootCause: partial.rootCause,
  });
}

const started = Date.now();
const states = listUsStates().map((row) => row.code);
const tasks: TaskResult[] = [];

for (const code of states) {
  const expectedCircuit = EXPECTED_HOME_CIRCUIT[code];
  if (!expectedCircuit) {
    record(tasks, {
      id: `T6T-${code}-04`,
      state: code,
      class: "federal-circuit",
      ok: false,
      critical: true,
      detail: "Missing hidden-GT home circuit for this state.",
      rootCause: "M",
    });
    continue;
  }

  const ctx = matterForState(code);
  const high = classifyAuthorityRelationship(ctx, {
    courtId: `st-${code.toLowerCase()}-high`,
    authorityState: code,
    authorityType: "case",
  });
  record(tasks, {
    id: `T6T-${code}-01`,
    state: code,
    class: "correct-state",
    ok: high.relationship === "controlling",
    critical: high.relationship === "out_of_jurisdiction",
    detail: `Own high court classified ${high.relationship}.`,
    rootCause: high.relationship === "controlling" ? undefined : "D",
  });

  const decoy = decoyState(code, states);
  const wrong = classifyAuthorityRelationship(ctx, {
    courtId: `st-${decoy.toLowerCase()}-high`,
    authorityState: decoy,
    authorityType: "case",
  });
  record(tasks, {
    id: `T6T-${code}-02`,
    state: code,
    class: "wrong-state",
    ok: wrong.relationship !== "controlling" && wrong.relationship === "out_of_jurisdiction",
    critical: wrong.relationship === "controlling",
    detail: `Decoy ${decoy} high court classified ${wrong.relationship}.`,
    rootCause: wrong.relationship === "controlling" ? "H" : undefined,
  });

  const trial = classifyAuthorityRelationship(ctx, {
    courtId: `st-${code.toLowerCase()}-trial`,
    authorityState: code,
    authorityType: "case",
  });
  record(tasks, {
    id: `T6T-${code}-03`,
    state: code,
    class: "lower-court",
    ok: trial.relationship === "persuasive",
    detail: `Same-state trial court classified ${trial.relationship}.`,
    rootCause: trial.relationship === "persuasive" ? undefined : "D",
  });

  const districts = listFederalDistrictsForState(code);
  const circuitOk =
    districts.length > 0 &&
    districts.every((district) => deriveCircuitFromCourtId(district.id) === expectedCircuit);
  record(tasks, {
    id: `T6T-${code}-04`,
    state: code,
    class: "federal-circuit",
    ok: circuitOk,
    critical: !circuitOk,
    detail:
      districts.length === 0
        ? "No federal districts registered for this state."
        : `${districts.length} district(s) map to circuit ${[
            ...new Set(districts.map((district) => deriveCircuitFromCourtId(district.id))),
          ].join(",")}; expected ${expectedCircuit}.`,
    rootCause: circuitOk ? undefined : "E",
  });

  const federalCtx = {
    ...ctx,
    jurisdictionMode: "federal" as const,
    forumType: "federal" as const,
    federalCircuit: expectedCircuit,
    courtId: districts[0]?.id ?? null,
    governingLawState: null,
  };
  const foreign = classifyAuthorityRelationship(federalCtx, {
    courtId: `us-ca-${otherCircuit(expectedCircuit)}`,
    courtLevel: "circuit",
    federalCircuit: otherCircuit(expectedCircuit),
    authorityType: "case",
  });
  record(tasks, {
    id: `T6T-${code}-05`,
    state: code,
    class: "other-circuit",
    ok: foreign.relationship === "persuasive",
    critical: foreign.relationship === "controlling",
    detail: `Foreign circuit ${otherCircuit(expectedCircuit)} classified ${foreign.relationship}.`,
    rootCause: foreign.relationship === "controlling" ? "E" : undefined,
  });

  const scotus = classifyAuthorityRelationship(federalCtx, {
    courtId: "us-scotus",
    courtLevel: "scotus",
    authorityType: "case",
  });
  record(tasks, {
    id: `T6T-${code}-06`,
    state: code,
    class: "scotus",
    ok: scotus.relationship === "controlling",
    detail: `SCOTUS classified ${scotus.relationship}.`,
    rootCause: scotus.relationship === "controlling" ? undefined : "D",
  });

  const expired = isAuthorityTemporallyApplicable(
    { effectiveStart: "2010-01-01", effectiveEnd: "2020-12-31" },
    "2026-08-19",
  );
  const current = isAuthorityTemporallyApplicable({ effectiveStart: "2021-01-01" }, "2026-08-19");
  const undated = isAuthorityTemporallyApplicable({ decisionDate: "2018-06-01" }, "2026-08-19");
  const ranked = rankAuthoritiesForMatter(ctx, [
    {
      courtId: `st-${code.toLowerCase()}-high`,
      authorityState: code,
      effectiveStart: "2010-01-01",
      effectiveEnd: "2020-12-31",
    },
    { courtId: `st-${code.toLowerCase()}-high`, authorityState: code, effectiveStart: "2021-01-01" },
  ]);
  const temporalOk =
    expired === "inapplicable" &&
    current === "applicable" &&
    undated === "unknown" &&
    ranked[0]?.temporalApplicability === "applicable";
  record(tasks, {
    id: `T6T-${code}-07`,
    state: code,
    class: "temporal",
    ok: temporalOk,
    critical: current === "inapplicable" || expired === "applicable" || undated === "applicable",
    detail: `expired=${expired} current=${current} undated=${undated}; ranked-first=${ranked[0]?.temporalApplicability}.`,
    rootCause: temporalOk ? undefined : "F",
  });

  const abstain = shouldAbstainForUnknownJurisdiction(
    "What is the statute of limitations for this claim?",
    unknownMatter(),
  );
  record(tasks, {
    id: `T6T-${code}-08`,
    state: code,
    class: "abstention",
    ok: abstain,
    critical: !abstain,
    detail: abstain
      ? "Unknown jurisdiction abstains on a limitations question."
      : "Unknown jurisdiction failed to abstain.",
    rootCause: abstain ? undefined : "L",
  });

  const decoyHits = labelResearchHits(
    {
      ...unknownMatter(),
      ...ctx,
      coverage: "unvalidated",
      promptBlock: "",
      summary: code,
      organizationId: "o",
      matterId: "m",
      source: "user_metadata",
      legacyJurisdiction: null,
      legacyCourt: null,
      coverageByPracticeArea: false,
      choiceOfLawDistinctFromForum: false,
      courtName: null,
      federalDistrict: null,
      practiceArea: "Contract",
      choiceOfLawStatus: "none_known",
    },
    [
      {
        authorityId: "11111111-1111-4111-8111-111111111111",
        authorityVersionId: "22222222-2222-4222-8222-222222222222",
        chunkId: "decoy",
        title: "Decoy",
        citation: "1 Decoy 1",
        authorityType: "case",
        jurisdiction: decoy,
        court: null,
        decisionDate: null,
        courtId: `st-${decoy.toLowerCase()}-high`,
        authorityState: decoy,
        score: 0.99,
        snippet: "decoy",
      },
      {
        authorityId: "11111111-1111-4111-8111-111111111112",
        authorityVersionId: "22222222-2222-4222-8222-222222222223",
        chunkId: "home",
        title: "Home",
        citation: "1 Home 1",
        authorityType: "case",
        jurisdiction: code,
        court: null,
        decisionDate: null,
        courtId: `st-${code.toLowerCase()}-high`,
        authorityState: code,
        score: 0.2,
        snippet: "home",
      },
    ],
  );
  const rankingOk =
    decoyHits[0]?.chunkId === "home" &&
    decoyHits[0]?.hierarchyRelationship === "controlling" &&
    !decoyHits.some((hit) => hit.hierarchyRelationship === "controlling" && hit.chunkId === "decoy");
  record(tasks, {
    id: `T6T-${code}-09`,
    state: code,
    class: "hierarchy",
    ok: rankingOk,
    critical: decoyHits.some((hit) => hit.hierarchyRelationship === "controlling" && hit.chunkId === "decoy"),
    detail: rankingOk
      ? "Research ranking placed home-state high court above the decoy."
      : `Research ranking order=${decoyHits.map((hit) => `${hit.chunkId}:${hit.hierarchyRelationship}`).join(",")}`,
    rootCause: rankingOk ? undefined : "G",
  });

  record(tasks, {
    id: `T6T-${code}-10`,
    state: code,
    class: "corpus",
    ok: true,
    detail:
      "Local corpus has 0 mapped US-state authorities. Statute/case/regulation retrieval is not graded as FAIL; coverage stays UNVALIDATED.",
    rootCause: "A",
  });
  tasks[tasks.length - 1]!.severity = "NEEDS_WORK";
}

const choice = applyMatterJurisdictionInput({
  courtId: "us-d-pa-ed",
  governingLawState: "DE",
  choiceOfLawStatus: "stated",
  relatedJurisdictions: [{ stateCode: "NJ" }],
  asOfDate: "2026-08-19",
});
const choiceCtx = {
  jurisdictionMode: choice.jurisdictionMode,
  forumType: choice.forumType,
  primaryState: choice.primaryState,
  governingLawState: choice.governingLawState,
  federalCircuit: choice.federalCircuit,
  relatedJurisdictions: choice.relatedJurisdictions,
  courtId: choice.courtId,
  asOfDate: choice.asOfDate,
};
const deHigh = classifyAuthorityRelationship(choiceCtx, {
  courtId: "st-de-high",
  authorityState: "DE",
  authorityType: "case",
});
const paHigh = classifyAuthorityRelationship(choiceCtx, {
  courtId: "st-pa-high",
  authorityState: "PA",
  authorityType: "case",
});
const njHigh = classifyAuthorityRelationship(choiceCtx, {
  courtId: "st-nj-high",
  authorityState: "NJ",
  authorityType: "case",
});
record(tasks, {
  id: "T6T-REP-16",
  state: "PA",
  class: "choice-of-law",
  ok:
    choice.primaryState === "PA" &&
    choice.governingLawState === "DE" &&
    choice.federalCircuit === "3" &&
    deHigh.relationship === "controlling" &&
    paHigh.relationship !== "controlling",
  critical: choice.governingLawState === "PA" || deHigh.relationship !== "controlling",
  detail: `forum=${choice.primaryState} governing=${choice.governingLawState} DE=${deHigh.relationship} PA=${paHigh.relationship}.`,
  rootCause: undefined,
});
record(tasks, {
  id: "T6T-REP-17",
  state: "PA",
  class: "multi-jurisdiction",
  ok:
    choice.jurisdictionMode === "multi_jurisdiction" &&
    njHigh.relationship === "persuasive",
  critical: njHigh.relationship === "controlling",
  detail: `mode=${choice.jurisdictionMode} NJ=${njHigh.relationship}.`,
});

const prompt = formatJurisdictionPromptBlock({
  ...unknownMatter(),
  ...choiceCtx,
  matterId: "m",
  organizationId: "o",
  courtName: choice.courtName,
  federalDistrict: choice.federalDistrict,
  practiceArea: "Contract",
  source: "user_metadata",
  legacyJurisdiction: null,
  legacyCourt: null,
  coverage: "unvalidated",
  coverageByPracticeArea: true,
  choiceOfLawStatus: choice.choiceOfLawStatus,
  choiceOfLawDistinctFromForum: true,
  summary: "PA forum / DE law",
  promptBlock: "",
});
const draftSystem = buildDraftGenerationSystemPrompt();
record(tasks, {
  id: "T6T-REP-46",
  state: "PA",
  class: "draft-metadata",
  ok:
    prompt.includes("USER CASE METADATA") &&
    prompt.includes("governingLawState=DE") &&
    prompt.includes("relatedJurisdictions=NJ") &&
    !prompt.includes("governingLawState=NJ") &&
    /not evidence and not verified governing law/i.test(draftSystem),
  detail: "Draft/Ask metadata block keeps DE governing law distinct from NJ related and PA forum.",
});

const agentsOff =
  getFeatureFlags({ APP_ENV: "production" }).agents === false &&
  getFeatureFlags({ APP_ENV: "staging" }).agents === false;
record(tasks, {
  id: "T6T-REP-47",
  state: "US",
  class: "agents-flag",
  ok: agentsOff,
  critical: !agentsOff,
  detail: agentsOff
    ? "FEATURE_AGENTS remains off in production and staging defaults."
    : "FEATURE_AGENTS is on in production or staging defaults.",
});

const inventory = JSON.parse(
  readFileSync(join(BASELINES_ROOT, "BASELINE_6T_CORPUS_INVENTORY.json"), "utf8"),
) as {
  totalAuthorities: number;
  typeCounts: Record<string, number>;
  unmappedCount: number;
  unmappedJurisdictions: Record<string, number>;
  states: Record<string, { authorityCount: number }>;
};

function scorecard(code: string) {
  const rows = tasks.filter((task) => task.state === code);
  const critical = rows.filter((row) => row.severity === "CRITICAL").length;
  const fail = rows.filter((row) => row.severity === "FAIL").length;
  const nw = rows.filter((row) => row.severity === "NEEDS_WORK").length;
  const pass = rows.filter((row) => row.severity === "PASS").length;
  const routing = rows.filter((row) => row.class === "federal-circuit" || row.class === "other-circuit");
  const hierarchy = rows.filter(
    (row) =>
      row.class === "correct-state" ||
      row.class === "wrong-state" ||
      row.class === "lower-court" ||
      row.class === "hierarchy" ||
      row.class === "scotus",
  );
  const temporal = rows.filter((row) => row.class === "temporal");
  const abstention = rows.filter((row) => row.class === "abstention");
  const pct = (subset: TaskResult[]) =>
    subset.length === 0 ? null : Math.round((subset.filter((row) => row.severity === "PASS").length / subset.length) * 1000) / 10;
  const overall: Severity = critical > 0 ? "CRITICAL" : fail > 0 ? "FAIL" : nw > 0 && pass > 0 ? "NEEDS_WORK" : pass > 0 ? "PASS" : "NEEDS_WORK";
  const practice = Object.fromEntries(
    PRACTICE_AREAS.map((area) => [
      area,
      inventory.states[code]?.authorityCount ? "limited" : "unvalidated",
    ]),
  ) as Record<(typeof PRACTICE_AREAS)[number], CoverageLabel>;
  return {
    state: code,
    overall,
    pass,
    needsWork: nw,
    fail,
    critical,
    routingScore: pct(routing),
    hierarchyScore: pct(hierarchy),
    temporalScore: pct(temporal),
    citationScore: null as number | null,
    retrievalPrecision: null as number | null,
    retrievalRecall: null as number | null,
    abstentionCorrectness: pct(abstention),
    coverage: practice,
    overallCoverage: "PARTIAL" as const,
    corpusAuthorities: inventory.states[code]?.authorityCount ?? 0,
  };
}

const scorecards = states.map(scorecard);
const elapsedMs = Date.now() - started;

const totals = {
  tasks: tasks.length,
  pass: tasks.filter((task) => task.severity === "PASS").length,
  needsWork: tasks.filter((task) => task.severity === "NEEDS_WORK").length,
  fail: tasks.filter((task) => task.severity === "FAIL").length,
  critical: tasks.filter((task) => task.severity === "CRITICAL").length,
  wrongStateControlling: tasks.filter(
    (task) => task.class === "wrong-state" && task.severity === "CRITICAL",
  ).length,
  wrongCircuitControlling: tasks.filter(
    (task) => task.class === "other-circuit" && task.severity === "CRITICAL",
  ).length,
};

const c1 = {
  id: "BASELINE_6T_C1_50_STATE",
  benchmarkVersion: BENCHMARK_VERSION,
  generatedAt: new Date().toISOString(),
  elapsedMs,
  corpus: {
    totalAuthorities: inventory.totalAuthorities,
    typeCounts: inventory.typeCounts,
    unmappedCount: inventory.unmappedCount,
    unmappedJurisdictions: inventory.unmappedJurisdictions,
    statesWithMappedAuthorities: states.filter((code) => (inventory.states[code]?.authorityCount ?? 0) > 0).length,
  },
  totals,
  certifiedWording:
    "Certified/supported here means NyayaGrid internal benchmark certification only — not government, bar, court, or attorney validation.",
  betaEligibility: {
    eligible: [] as string[],
    limited: [] as string[],
    notYetValidated: states,
  },
  nationwideClaim: "NO",
  agents: { featureAgentsProduction: false, certifiedByState: false },
  scorecards,
  tasks,
};

mkdirSync(BASELINES_ROOT, { recursive: true });
mkdirSync(join(RUNS_ROOT, "6t-c1"), { recursive: true });
writeFileSync(join(BASELINES_ROOT, "BASELINE_6T_C1_50_STATE.json"), JSON.stringify(c1, null, 2));
writeFileSync(join(RUNS_ROOT, "6t-c1", "summary.json"), JSON.stringify({ totals, elapsedMs }, null, 2));

const connection =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
const sql = postgres(connection, { max: 1 });
const note = `${BENCHMARK_VERSION}: architecture routing/hierarchy/temporal/abstention evaluated. Local corpus has 0 mapped US-state authorities, so practice-area research is UNVALIDATED. Internal benchmark only — not attorney or government certification.`;
for (const code of states) {
  for (const area of PRACTICE_AREAS) {
    await sql`
      INSERT INTO jurisdiction_coverage (state_code, forum_type, practice_area, status, notes, updated_at)
      VALUES (${code}, ${"state"}, ${area}, ${"unvalidated"}, ${note}, now())
      ON CONFLICT (state_code, forum_type, practice_area)
      DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, updated_at = now()
    `;
  }
}
await sql.end();

console.log(
  JSON.stringify(
    {
      totals,
      elapsedMs,
      eligible: c1.betaEligibility.eligible,
      nationwideClaim: c1.nationwideClaim,
      coverageRowsWritten: states.length * PRACTICE_AREAS.length,
    },
    null,
    2,
  ),
);

if (totals.critical > 0 || totals.fail > 0) process.exit(1);
