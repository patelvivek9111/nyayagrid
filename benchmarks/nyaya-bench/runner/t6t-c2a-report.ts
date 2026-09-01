/**
 * Writes C2A markdown baselines from BASELINE_6T_C2A_REAL_STATE_BATCH.json.
 * Does not overwrite C1 or CORPUS-1 artifacts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINES_ROOT } from "./paths";
import type { C2ACoverageLabel, C2ATaskResult } from "./t6t-c2a-grade";

type CoverageCell = { label: C2ACoverageLabel; scope: string; dbStatus: string };

type Scorecard = {
  state: string;
  name: string;
  quality: number;
  critical: number;
  fail: number;
  pass: number;
  needsWork: number;
  coverage: Record<string, CoverageCell>;
  dimensions: Record<string, number | null>;
  tasks: C2ATaskResult[];
};

type C2ABaseline = {
  id: string;
  generatedAt: string;
  elapsedMs: number;
  environment: {
    APP_ENV: string | null;
    database: { host: string; port: string; database: string };
    intendedCertification: unknown;
    realPrimaryAuthorities: number;
  };
  agents: {
    featureAgentsProduction: boolean;
    featureAgentsStaging: boolean;
    certifiedByState: boolean;
  };
  nationwideClaim: string;
  statesEvaluated: string[];
  extras: C2ATaskResult[];
  askResults: Array<{ state: string; evidenceState: string; answerPreview: string }>;
  draftResults: Array<{ state: string; draftId: string; preview: string }>;
  scorecards: Scorecard[];
  totals: { tasks: number; pass: number; needsWork: number; fail: number; critical: number };
};

const jsonPath = join(BASELINES_ROOT, "BASELINE_6T_C2A_REAL_STATE_BATCH.json");
if (!existsSync(jsonPath)) {
  throw new Error("Missing BASELINE_6T_C2A_REAL_STATE_BATCH.json — run bench:6t-c2a first.");
}

const baseline = JSON.parse(readFileSync(jsonPath, "utf8")) as C2ABaseline;
const allTasks = [...baseline.scorecards.flatMap((row) => row.tasks), ...baseline.extras];

function labelsOf(area: string): Array<{ state: string; cell: CoverageCell }> {
  return baseline.scorecards.map((row) => ({ state: row.state, cell: row.coverage[area]! }));
}

function listByLabel(area: string, label: C2ACoverageLabel): string[] {
  return labelsOf(area)
    .filter((row) => row.cell.label === label)
    .map((row) => `${row.state} (${row.cell.scope})`);
}

function dimAvg(key: string): string {
  const values = baseline.scorecards
    .map((row) => row.dimensions[key])
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return "n/a";
  return `${Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10}%`;
}

function taskKind(kind: C2ATaskResult["kind"]): C2ATaskResult[] {
  return allTasks.filter((task) => task.kind === kind);
}

function extra(id: string): C2ATaskResult | undefined {
  return baseline.extras.find((task) => task.id === id);
}

const fabricatedCite = allTasks.filter(
  (task) => task.rootCause === "F" && task.severity === "CRITICAL",
);
const fabricatedQuote = allTasks.filter(
  (task) => task.rootCause === "H" && task.severity === "CRITICAL",
);
const wrongState = allTasks.filter(
  (task) =>
    task.rootCause === "E" &&
    task.severity === "CRITICAL" &&
    /wrong-state|decoy|foreign/i.test(task.detail),
);
const syntheticControlling = allTasks.filter(
  (task) => task.severity === "CRITICAL" && /synthetic or non-primary/i.test(task.detail),
);
const unsupported = allTasks.filter(
  (task) => (task.rootCause === "G" || task.rootCause === "K") && (task.severity === "FAIL" || task.severity === "CRITICAL"),
);
const currentLaw = allTasks.filter((task) => task.rootCause === "I" && task.severity === "FAIL");
const productionCritical = allTasks.filter(
  (task) => task.severity === "CRITICAL" && task.rootCause && task.rootCause !== "A",
);

const quality90 = baseline.scorecards.filter((row) => row.quality >= 90).map((row) => row.state);
const zeroCritical = baseline.scorecards.filter((row) => row.critical === 0).map((row) => row.state);

const validatedContract = listByLabel("Contract", "VALIDATED");
const validatedEmployment = listByLabel("Employment", "VALIDATED");
const validatedCivil = listByLabel("Civil", "VALIDATED");
const limitedAll = ["Contract", "Employment", "Civil", "Criminal"].flatMap((area) =>
  listByLabel(area, "LIMITED").map((row) => `${area}: ${row}`),
);
const unvalidatedAll = ["Contract", "Employment", "Civil", "Criminal"].flatMap((area) =>
  listByLabel(area, "UNVALIDATED").map((row) => `${area}: ${row}`),
);
const failedAll = ["Contract", "Employment", "Civil", "Criminal"].flatMap((area) =>
  listByLabel(area, "FAILED").map((row) => `${area}: ${row}`),
);

const betaScopes = baseline.scorecards.flatMap((row) =>
  Object.entries(row.coverage)
    .filter(([area, cell]) =>
      (area === "Contract" || area === "Employment") &&
      (cell.label === "VALIDATED" || cell.label === "LIMITED") &&
      row.critical === 0,
    )
    .map(([area, cell]) => ({ state: row.state, area, label: cell.label, scope: cell.scope })),
);

const needsWorkTasks = allTasks.filter((task) => task.severity === "NEEDS_WORK");
const groundingNeedsWork = allTasks.filter(
  (task) => task.kind === "grounding" && task.severity === "NEEDS_WORK",
);

const citationExercised = taskKind("citation").length > 0;
const groundingExercised = taskKind("grounding").length > 0;
const hasMeaningfulScope = betaScopes.length > 0;

const c2bApplicable = productionCritical.length > 0;
let nextPhase: string;
let nextReason: string;
if (c2bApplicable) {
  nextPhase = "PHASE 6T-C2B — GENERAL JURISDICTION OR RETRIEVAL DEFECT FIX";
  nextReason =
    "C2A recorded CRITICAL defects with production root causes (not corpus-depth A). Finish the baseline, then patch the general defect before deepening corpus or opening 6U.";
} else if (
  baseline.totals.critical === 0 &&
  hasMeaningfulScope &&
  citationExercised &&
  groundingExercised
) {
  nextPhase = "PHASE 6U — JURISDICTION-AWARE FULL-SYSTEM REGRESSION / BETA GATE";
  nextReason =
    "At least one honest VALIDATED/LIMITED real-corpus scope exists, citation and proposition grounding were exercised, and no CRITICAL defects were recorded.";
} else {
  nextPhase = "PHASE 6T-CORPUS-2 — DEEPEN PRIMARY-LAW COVERAGE";
  nextReason =
    "The initial 10-state batch is too shallow or too uneven for a full-system beta gate. Deepen primary-law coverage before 6U.";
}

const gov = extra("T6T-C2A-GOV-01");
const multi = extra("T6T-C2A-MULTI-01");
const askSafe = baseline.extras
  .filter((task) => task.id.startsWith("T6T-C2A-ASK-"))
  .every((task) => task.severity !== "CRITICAL");
const draftSafe = baseline.extras
  .filter((task) => task.id.startsWith("T6T-C2A-DRAFT-"))
  .every((task) => task.severity !== "CRITICAL");
const researchCritical = baseline.scorecards.some((row) => row.critical > 0);

const rootCauseCounts = allTasks.reduce<Record<string, number>>((acc, task) => {
  if (!task.rootCause) return acc;
  acc[task.rootCause] = (acc[task.rootCause] ?? 0) + 1;
  return acc;
}, {});

const scorecardTable = [
  "| State | Quality | PASS | NEEDS WORK | FAIL | CRITICAL | Contract | Employment | Civil | Criminal |",
  "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |",
  ...baseline.scorecards.map(
    (row) =>
      `| ${row.state} | ${row.quality}% | ${row.pass} | ${row.needsWork} | ${row.fail} | ${row.critical} | ${row.coverage.Contract?.label ?? "—"} | ${row.coverage.Employment?.label ?? "—"} | ${row.coverage.Civil?.label ?? "—"} | ${row.coverage.Criminal?.label ?? "—"} |`,
  ),
].join("\n");

const dimensionTable = [
  "| State | Routing | Retrieval | Citation | Hierarchy | Grounding | Wrong-state | Temporal | Abstention |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...baseline.scorecards.map(
    (row) =>
      `| ${row.state} | ${row.dimensions.routing ?? "n/a"} | ${row.dimensions.retrieval ?? "n/a"} | ${row.dimensions.citation ?? "n/a"} | ${row.dimensions.hierarchy ?? "n/a"} | ${row.dimensions.propositionGrounding ?? "n/a"} | ${row.dimensions.wrongStateSafety ?? "n/a"} | ${row.dimensions.temporalSafety ?? "n/a"} | ${row.dimensions.abstention ?? "n/a"} |`,
  ),
].join("\n");

const extrasTable = [
  "| Id | State | Severity | Detail |",
  "| --- | --- | --- | --- |",
  ...baseline.extras.map((task) => `| ${task.id} | ${task.state} | ${task.severity} | ${task.detail} |`),
].join("\n");

const md = `# BASELINE 6T C2A — Real state-batch certification

**Run:** ${baseline.generatedAt}  
**Duration:** ${baseline.elapsedMs} ms  
**Nationwide claim:** ${baseline.nationwideClaim}  
**Agents certified by state:** no  
**C1 / CORPUS-1 overwrite:** none

"Certified" / VALIDATED / LIMITED here means **NyayaGrid internal benchmark certification**. It is not government certification, bar certification, court approval, or attorney validation.

## Totals

| Metric | Value |
| --- | ---: |
| Tasks | ${baseline.totals.tasks} |
| PASS | ${baseline.totals.pass} |
| NEEDS WORK | ${baseline.totals.needsWork} |
| FAIL | ${baseline.totals.fail} |
| CRITICAL | ${baseline.totals.critical} |
| Real primary authorities | ${baseline.environment.realPrimaryAuthorities} |
| States evaluated | ${baseline.statesEvaluated.join(", ")} |

## State scorecards

${scorecardTable}

## Dimensions

${dimensionTable}

## Representative extras (Ask / Draft / governing law / multi-jurisdiction)

${extrasTable}

## Coverage labels (honest, narrow)

Contract VALIDATED: ${validatedContract.length ? validatedContract.join("; ") : "none"}  
Employment VALIDATED: ${validatedEmployment.length ? validatedEmployment.join("; ") : "none"}  
Civil VALIDATED: ${validatedCivil.length ? validatedCivil.join("; ") : "none (Civil is excerpt-only LIMITED at best)"}  
LIMITED: ${limitedAll.length ? limitedAll.join("; ") : "none"}  
UNVALIDATED: ${unvalidatedAll.length ? unvalidatedAll.join("; ") : "none"}  
FAILED: ${failedAll.length ? failedAll.join("; ") : "none"}
`;

writeFileSync(join(BASELINES_ROOT, "BASELINE_6T_C2A_REAL_STATE_BATCH.md"), md);

const phase = `# PHASE 6T-C2A — INITIAL STATE CERTIFICATION

**Date:** ${baseline.generatedAt.slice(0, 10)}  
**Baseline:** \`BASELINE_6T_C2A_REAL_STATE_BATCH.json\` / \`.md\`  
**Preserved:** \`BASELINE_6T_C1_50_STATE.*\`, \`PHASE_6T_50_STATE_JURISDICTION_CERTIFICATION.md\`, \`BASELINE_6T_CORPUS1.*\`  
**Agents:** FEATURE_AGENTS remains **OFF** in production/staging defaults (agents===false check passed: production=${baseline.agents.featureAgentsProduction}, staging=${baseline.agents.featureAgentsStaging})  
**Nationwide claim:** **${baseline.nationwideClaim}**  
**Database:** ${baseline.environment.database.host}:${baseline.environment.database.port}/${baseline.environment.database.database}  
**APP_ENV:** ${baseline.environment.APP_ENV ?? "(unset)"}

"Certified" in this document means **NyayaGrid internal benchmark certification**. It is not government certification, bar certification, court approval, or attorney validation.

## 1. Executive Summary

C2A is the first **real-corpus** state-law certification for the initial 10-state batch. It is not routing-only C1 and not a nationwide claim.

| Metric | Value |
| --- | ---: |
| States evaluated | ${baseline.statesEvaluated.length} |
| Tasks | ${baseline.totals.tasks} |
| PASS | ${baseline.totals.pass} |
| NEEDS WORK | ${baseline.totals.needsWork} |
| FAIL | ${baseline.totals.fail} |
| CRITICAL | ${baseline.totals.critical} |
| States at 90%+ material quality | ${quality90.length ? quality90.join(", ") : "none"} |
| States with 0 CRITICAL | ${zeroCritical.length ? zeroCritical.join(", ") : "none"} |
| Beta-eligible scopes | ${betaScopes.length ? betaScopes.map((row) => `${row.state} ${row.area} (${row.label})`).join("; ") : "none"} |
| NEEDS WORK (not FAIL) | ${needsWorkTasks.length ? needsWorkTasks.map((t) => t.id).join(", ") : "none"} |
| Next phase | **${nextPhase}** |

Production was not patched mid-run. Coverage writes are limited to these 10 states × four practice areas. The other 41 C1 jurisdictions remain UNVALIDATED.

## 2. Real Corpus Scope

Imported under \`us-primary-corpus\` (CORPUS-1), not synthetic fixtures:

- 10 states: ${baseline.statesEvaluated.join(", ")}
- 30 real primary authorities expected in the certification DB (observed: ${baseline.environment.realPrimaryAuthorities})
- 20 statutes (UCC § 2-725 + one wage/employment statute per state)
- 10 state high-court excerpts
- 0 regulations
- 0 effective dates unless a bundle explicitly provided one
- Synthetic / overlay authorities remain in the same database but are excluded from coverage and treated as CRITICAL if labeled controlling

## 3. Certification Scope

C2A certifies **narrow retrieved-corpus behavior**, not completeness of any state's law.

In scope:

- Retrieval and citation of imported UCC § 2-725
- Retrieval of the imported wage/employment statute
- Retrieval of the imported high-court excerpt
- Wrong-state / decoy safety
- Hierarchy labels on the home high court
- Quote and proposition grounding against stored text
- Family-law abstention (no family corpus)
- Temporal honesty when effective dates are missing
- Excerpt-limit honesty
- Representative Ask (PA, NY, CA) and Draft (PA, DE)
- Governing-law vs forum (PA forum / DE governing)
- Multi-jurisdiction flattening (PA / DE / NJ)

Out of scope:

- Nationwide support
- Agents-by-state certification
- Criminal practice
- Regulations
- Complete civil procedure, family law, or high-court completeness
- 41 jurisdictions not in this batch

## 4. Benchmark Design

Production path only: \`runResearchQuery\` → retrieve / rank / synthesize / cite. Hidden ground truth (citation needles, \`sourceExternalId\`) is used for **grading**, never injected as retrieval filters. Queries are not forced to \`sourceProvider: us-primary-corpus\`. Shared questions are cached per \`matterId::question\`.

Graders live in \`runner/t6t-c2a-grade.ts\`. Failure taxonomy: A corpus depth, B retrieval, C ranking, D jurisdiction, E authority relationship, F citation, G proposition grounding, H quote grounding, I temporal, J abstention, K synthesis overclaim, L metadata, M grader, N infrastructure.

## 5. State Results

${scorecardTable}

${dimensionTable}

## 6. Contract

VALIDATED scopes (UCC § 2-725 limitations retrieval and citation only): ${validatedContract.length ? validatedContract.join("; ") : "none"}.

LIMITED / UNVALIDATED / FAILED: see coverage lists below. This is not general contract-law completeness.

## 7. Employment

VALIDATED scopes (imported wage/employment statute only): ${validatedEmployment.length ? validatedEmployment.join("; ") : "none"}.

## 8. Civil

Civil remains **LIMITED at best** because the corpus holds excerpt-only high-court opinions. VALIDATED Civil: ${validatedCivil.length ? validatedCivil.join("; ") : "none, by design"}.

## 9. Criminal

**UNVALIDATED in every C2A state.** DE/VA excerpts that are criminal-adjacent are not a criminal statute corpus and do not certify Criminal practice.

## 10. Retrieval

Contract / employment / high-court retrieval dimension average: ${dimAvg("retrieval")}. Failures of expected home-state authority in top hits are class B.

## 11. Citation Validity

Citation tasks: ${taskKind("citation").length}. CRITICAL fabricated citations (class F): ${fabricatedCite.length}. Stored citations must match imported records; canonical source URLs were required on retrieved home authorities.

## 12. Proposition Grounding

Grounding tasks: ${taskKind("grounding").length}. FAIL/CRITICAL unsupported propositions (G/K): ${unsupported.length}. Four-year UCC limitations language is the Contract grounding needle.

## 13. Wrong-State Safety

Wrong-state / decoy CRITICAL: ${wrongState.length}. Synthetic-as-controlling CRITICAL: ${syntheticControlling.length}. Dimension average: ${dimAvg("wrongStateSafety")}.

## 14. Hierarchy

Home high court must not be labeled \`out_of_jurisdiction\`. Dimension: ${dimAvg("hierarchy")}.

## 15. Temporal

Imported statutes generally have **unknown effective dates**. Current-law overclaim FAILs: ${currentLaw.length}. Dimension: ${dimAvg("temporalSafety")}.

## 16. Abstention

Family-law waiting-period and excerpt-limit questions must abstain or warn. Dimension: ${dimAvg("abstention")}.

## 17. Governing Law

${gov ? `${gov.id}: **${gov.severity}** — ${gov.detail}` : "Governing-law extra not present."}

Forum (PA) and governing law (DE) must remain distinct. Substituting forum law for governing law is CRITICAL.

## 18. Multi-Jurisdiction

${multi ? `${multi.id}: **${multi.severity}** — ${multi.detail}` : "Multi-jurisdiction extra not present."}

## 19. Ask

Representative Ask on PA, NY, CA via \`askNyayaAboutMatter\` with \`AuthorityHybridRetriever\` plus empty-matter document retrieval. Nationwide-rule invention is CRITICAL. Ask CRITICAL: ${askSafe ? 0 : "yes"}. Evidence states: ${baseline.askResults.map((row) => `${row.state}=${row.evidenceState}`).join(", ") || "none"}.

## 20. Research

Live \`runResearchQuery\` on each state's 12 specs (cached shared questions). Research-path CRITICAL states: ${researchCritical ? baseline.scorecards.filter((row) => row.critical > 0).map((row) => row.state).join(", ") : "none"}.

## 21. Draft

PA and DE: retrieve, then \`saveAuthorityToMatter\`, then \`generateDraft\`. Authorities are **not** injected into Research. Draft CRITICAL: ${draftSafe ? 0 : "yes"}.

## 22. Agents Context Regression

\`getFeatureFlags({ APP_ENV: "production" }).agents === false\`: **${baseline.agents.featureAgentsProduction}**  
\`getFeatureFlags({ APP_ENV: "staging" }).agents === false\`: **${baseline.agents.featureAgentsStaging}**  
Agents were **not** certified by state.

## 23. Quality Scores

Material quality = PASS / all tasks for that state (CRITICAL counts as not-PASS). 90%+ states: ${quality90.length ? quality90.join(", ") : "none"}.

## 24. Coverage Labels

DB writes use \`supported\` / \`limited\` / \`unvalidated\` (VALIDATED maps to \`supported\`). Report labels:

- VALIDATED Contract: ${validatedContract.length ? validatedContract.join("; ") : "none"}
- VALIDATED Employment: ${validatedEmployment.length ? validatedEmployment.join("; ") : "none"}
- VALIDATED Civil: ${validatedCivil.length ? validatedCivil.join("; ") : "none"}
- LIMITED: ${limitedAll.length ? limitedAll.join("; ") : "none"}
- UNVALIDATED: ${unvalidatedAll.length ? unvalidatedAll.join("; ") : "none"}
- FAILED: ${failedAll.length ? failedAll.join("; ") : "none"}

Criminal is UNVALIDATED everywhere. Other 41 C1 jurisdictions were not rewritten.

## 25. Beta Eligibility

${
  betaScopes.length
    ? betaScopes.map((row) => `- ${row.state} / ${row.area} / ${row.label}: ${row.scope}`).join("\n")
    : "No state/practice-area pair is beta-eligible from C2A."
}

Eligibility is **explicit-scope only** for Contract (UCC § 2-725) and Employment (imported wage statute). Civil LIMITED is excerpt-retrieval honesty, **not** a Civil beta slice. It is not statewide Nyaya Research completeness and not a nationwide beta.

## 26. Root Causes

${
  Object.keys(rootCauseCounts).length
    ? Object.entries(rootCauseCounts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([code, n]) => `- ${code}: ${n}`)
        .join("\n")
    : "No graded root-cause codes (all PASS or unlabeled)."
}

## 27. Production Changes

**None during C2A.** The runner graded current behavior. Environment reconciliation (env load, inventory split, C1 freeze) was a prior phase and is not a mid-run C2A patch.

## 28. C2B if applicable

${
  c2bApplicable
    ? `C2B **is** applicable. ${productionCritical.length} CRITICAL task(s) have production root causes: ${productionCritical.map((t) => `${t.id}/${t.rootCause}`).join(", ")}.`
    : "C2B is **not** opened. No production-class CRITICAL defect was recorded that requires a general mid-certification patch."
}

## 29. Regressions

C1 routing snapshot is preserved (7 synthetic authorities, 0 mapped US-state rows, 51 UNVALIDATED). C2A did not overwrite those files. This run does not re-score the 41 jurisdictions outside the batch.

## 30. Remaining Corpus Gaps

- 3 authorities per state
- 0 regulations
- 0 (or nearly 0) effective dates
- High-court texts are excerpts, not full opinions
- No family, criminal-statute, or civil-procedure corpus
- 40 states + DC still have no real primary authorities
- DE/VA criminal-adjacent excerpts must not be read as Criminal VALIDATED

## 31. Controlled-Beta State Decision

${
  betaScopes.length
    ? `Controlled beta may exercise **only** the listed scopes in §25. No statewide or nationwide Research beta. Agents stay OFF.`
    : `No controlled-beta state-law Research slice is opened from C2A.`
}

Do not deploy beta. Do not enable Agents. Do not claim nationwide support.

## 32. Exactly One Next Phase

**${nextPhase}**

${nextReason}

---

## Explicit questions

1. Which 10 states were evaluated? **${baseline.statesEvaluated.join(", ")}**
2. Which states achieved 90%+ material quality? **${quality90.length ? quality90.join(", ") : "none"}**
3. Which states had 0 critical failures? **${zeroCritical.length ? zeroCritical.join(", ") : "none"}**
4. Which Contract scopes are VALIDATED? **${validatedContract.length ? validatedContract.join("; ") : "none"}**
5. Which Employment scopes are VALIDATED? **${validatedEmployment.length ? validatedEmployment.join("; ") : "none"}**
6. Which Civil scopes are VALIDATED? **${validatedCivil.length ? validatedCivil.join("; ") : "none"}**
7. Which remain LIMITED? **${limitedAll.length ? limitedAll.join("; ") : "none"}**
8. Which remain UNVALIDATED? **${unvalidatedAll.length ? unvalidatedAll.join("; ") : "none"}**
9. Any fabricated citation? **${fabricatedCite.length ? fabricatedCite.map((t) => t.id).join(", ") : "no"}**
10. Any fabricated quote? **${fabricatedQuote.length ? fabricatedQuote.map((t) => t.id).join(", ") : "no"}**
11. Any wrong-state authority as controlling? **${wrongState.length ? wrongState.map((t) => t.id).join(", ") : "no"}**
12. Any wrong circuit as controlling? **C2A did not include a dedicated other-circuit trap; no C2A CRITICAL was scored as wrong-circuit. C1 remains 0 wrong-circuit controlling.**
13. Any unsupported proposition? **${
  unsupported.length
    ? unsupported.map((t) => t.id).join(", ")
    : groundingNeedsWork.length
      ? `no FAIL/CRITICAL; NEEDS_WORK grounding: ${groundingNeedsWork.map((t) => t.id).join(", ")}`
      : "no FAIL/CRITICAL G/K"
}**
14. Any current-law overclaim with unknown dates? **${currentLaw.length ? currentLaw.map((t) => t.id).join(", ") : "no"}**
15. Is governing law preserved separately from forum? **${gov ? (gov.severity === "PASS" ? "yes" : `no (${gov.severity})`) : "not scored"}**
16. Are multi-jurisdiction cases safe? **${multi ? (multi.severity === "PASS" ? "yes" : `no (${multi.severity})`) : "not scored"}**
17. Is Ask safe on real state law? **${askSafe ? "yes — no Ask CRITICAL in PA/NY/CA extras" : "no — Ask CRITICAL recorded"}**
18. Is Research safe on real state law? **${researchCritical ? "no — Research CRITICAL recorded" : "yes — no Research CRITICAL on the 10-state scorecards"}**
19. Is Draft safe with real state authority? **${draftSafe ? "yes — no Draft CRITICAL in PA/DE extras" : "no — Draft CRITICAL recorded"}**
20. Can any state be beta-eligible now? **${betaScopes.length ? "yes, explicit scope only" : "no"}**
21. For exactly what practice-area scope? **${betaScopes.length ? betaScopes.map((row) => `${row.state} ${row.area}: ${row.scope}`).join("; ") : "none"}**
22. Which states need deeper corpus before validation? **All ten still need depth beyond 3 authorities; especially any state without VALIDATED Contract/Employment, plus every Criminal/Civil completeness claim.**
23. Is 6U ready to start? **${nextPhase.startsWith("PHASE 6U") ? "yes — as the next phase, not started here" : "no"}**
24. What is the largest remaining state-law risk? **Shallow corpus (3 authorities/state, no dates, no regulations, excerpt-only cases) plus any remaining wrong-state/synthetic-controlling or current-law overclaim behavior.**
`;

writeFileSync(join(BASELINES_ROOT, "PHASE_6T_C2A_INITIAL_STATE_CERTIFICATION.md"), phase);

console.log(
  JSON.stringify(
    {
      wrote: [
        "BASELINE_6T_C2A_REAL_STATE_BATCH.md",
        "PHASE_6T_C2A_INITIAL_STATE_CERTIFICATION.md",
      ],
      nextPhase,
      totals: baseline.totals,
      betaScopes: betaScopes.length,
    },
    null,
    2,
  ),
);
