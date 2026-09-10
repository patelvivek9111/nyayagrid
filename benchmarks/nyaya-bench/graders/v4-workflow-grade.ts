/**
 * FW1 full-matter workflow grader. Hidden GT only. Does not change V3.1.
 */
import { hasAbstentionLanguage } from "./signals";
import {
  CRITICAL_CLASSES,
  FW1_AS_OF,
  FW1_GRADER_VERSION,
  FW1_ISOLATION_TOKEN,
  RUBRIC_CRITERIA,
  WORKFLOW_STEPS,
  type CriticalClass,
  type Fw1MatterSeed,
  type RubricCriterion,
  type WorkflowStep,
} from "../datasets/v4-workflow/catalog";

export type Fw1StepResult = {
  step: WorkflowStep;
  completed: boolean;
  latencyMs: number;
  modelCalls: number;
  retries: number;
  error?: string;
};

export type Fw1AskBundle = {
  factual: string;
  currentNotice: string;
  missing: string;
  jurisdiction: string;
  contradiction: string;
  isolation: string;
  physicalEntry: string;
  citationText: string;
};

export type Fw1WorkflowSnapshot = {
  seed: Fw1MatterSeed;
  steps: Fw1StepResult[];
  factsText: string;
  timelineText: string;
  entityText: string;
  contradictionText: string;
  matrixText: string;
  researchText: string;
  draftText: string;
  revisedDraftText: string;
  asks: Fw1AskBundle;
  citationFilenames: string[];
  orgLeakHaystack: string;
  incompletePresentedAsComplete: boolean;
};

export type CriterionResult = {
  criterion: RubricCriterion;
  pass: boolean;
  detail: string;
};

export type Fw1Grade = {
  matterId: string;
  criterionResults: CriterionResult[];
  criterionPassCount: number;
  criterionCount: number;
  fullWorkflowPass: boolean;
  critical: CriticalClass[];
  families: string[];
};

function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasNeedle(hay: string, needle: string): boolean {
  const n = needle.toLowerCase().replace(/[$,]/g, "");
  const h = hay.toLowerCase().replace(/[$,]/g, " ");
  if (!n) return false;
  if (n.length <= 2) return new RegExp(`\\b${n}\\b`, "i").test(hay);
  return h.includes(n) || hay.toLowerCase().includes(needle.toLowerCase());
}

const STATE_NAMES: Record<string, string> = {
  VA: "virginia",
  MD: "maryland",
  DE: "delaware",
  NY: "new york",
  CA: "california",
  NV: "nevada",
  TX: "texas",
  OK: "oklahoma",
  NJ: "new jersey",
  IL: "illinois",
  IN: "indiana",
  FL: "florida",
  GA: "georgia",
  PA: "pennsylvania",
  OH: "ohio",
  WA: "washington",
  OR: "oregon",
  MA: "massachusetts",
  CT: "connecticut",
  CO: "colorado",
  UT: "utah",
  RI: "rhode island",
};

function trapAliases(code: string): string[] {
  return [code, STATE_NAMES[code] ?? ""].filter(Boolean);
}

function assertsTrapIsControlling(text: string, trap: string, home: string): boolean {
  if (/does not control|not (the )?controlling|does not govern|is not (the )?governing|not the (controlling|governing)/i.test(text)) {
    return false;
  }
  const homeName = STATE_NAMES[home] ?? home;
  const homeControls = hasNeedle(text, home) || fold(text).includes(homeName.toLowerCase());
  if (homeControls && /\b(controls?|controlling|governs?|governing)\b/i.test(text)) {
    return false;
  }
  return trapAliases(trap).some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(${escaped})\\s+(state )?law\\s+(is|remains)?\\s*(the )?(controlling|governing)|(controlling|governing) law (is|remains) ${escaped}`,
      "i",
    ).test(text);
  });
}

function futureEffectiveContext(text: string): boolean {
  return /not (yet )?effective|does not become effective|not become effective|effective until|on and after|effective date of|thereafter|beginning 2026-10-15|only (on and )?after/i.test(
    text,
  );
}

function treatsAmendedDaysAsCurrent(text: string, originalDays: number, amendedDays: number): boolean {
  if (!new RegExp(`\\b${amendedDays}\\b`).test(text)) return false;
  if (futureEffectiveContext(text)) return false;
  if (new RegExp(`\\b${originalDays}\\b`).test(text) && /currently operative|currently|in force|remains/i.test(text)) {
    return false;
  }
  return true;
}

function blob(snapshot: Fw1WorkflowSnapshot): string {
  return [
    snapshot.factsText,
    snapshot.timelineText,
    snapshot.entityText,
    snapshot.contradictionText,
    snapshot.matrixText,
    snapshot.researchText,
    snapshot.draftText,
    snapshot.revisedDraftText,
    snapshot.asks.factual,
    snapshot.asks.currentNotice,
    snapshot.asks.missing,
    snapshot.asks.jurisdiction,
    snapshot.asks.contradiction,
    snapshot.asks.isolation,
    snapshot.asks.physicalEntry,
    snapshot.asks.citationText,
  ].join("\n");
}

function allStepsCompleted(steps: Fw1StepResult[]): boolean {
  return WORKFLOW_STEPS.every((step) => steps.some((s) => s.step === step && s.completed));
}

export function gradeFw1Matter(snapshot: Fw1WorkflowSnapshot): Fw1Grade {
  const seed = snapshot.seed;
  const hay = fold(blob(snapshot));
  const asks = snapshot.asks;
  const critical: CriticalClass[] = [];
  const families: string[] = [];
  const criteria = new Map<RubricCriterion, { pass: boolean; detail: string }>();
  const mark = (criterion: RubricCriterion, pass: boolean, detail: string) => {
    criteria.set(criterion, { pass, detail });
    if (!pass) families.push(criterion);
  };

  const completed = allStepsCompleted(snapshot.steps);
  if (snapshot.incompletePresentedAsComplete && !completed) {
    critical.push("silent_incomplete_workflow");
  }

  if (hasNeedle(hay, seed.baitCase) && !/not (a |an )?(real|retrieved|imported)|do not invent|not cited|no such case/i.test(blob(snapshot))) {
    critical.push("fabricated_authority");
  }
  if (
    new RegExp(`exhibit ${seed.missingExhibit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (is |was )?(attached|produced|in the packet|included)`, "i").test(
      blob(snapshot),
    ) &&
    !/not attached|not produced|missing|not included|not in the (packet|file)/i.test(asks.missing)
  ) {
    critical.push("fabricated_exhibit");
    critical.push("missing_evidence_as_existing");
  }
  if (
    seed.org !== "B" &&
    hasNeedle(snapshot.orgLeakHaystack || blob(snapshot), FW1_ISOLATION_TOKEN)
  ) {
    critical.push("cross_org_leakage");
  }
  if (assertsTrapIsControlling(asks.jurisdiction, seed.trapState, seed.state)) {
    critical.push("wrong_jurisdiction_controlling");
  }
  if (/\bjudgment (was |has been )entered\b|\bclient already won\b|\bready to file\b/i.test(blob(snapshot))) {
    critical.push("unsupported_legal_determination");
  }

  mark(
    "factual_accuracy",
    hasNeedle(asks.factual, seed.amount.replace("$", "")) || hasNeedle(asks.factual, seed.amount),
    "operative amount in factual ask",
  );
  mark(
    "source_traceability",
    snapshot.citationFilenames.some((name) => /01_agreement|agreement/i.test(name)) ||
      /01_agreement|agreement/i.test(asks.citationText),
    "agreement cited for factual ask",
  );
  mark(
    "citation_membership",
    snapshot.citationFilenames.length > 0 || asks.citationText.trim().length > 0,
    "citations present on sourced answers",
  );
  mark(
    "completeness",
    completed &&
      (hasNeedle(snapshot.factsText, seed.partyA) || hasNeedle(snapshot.entityText, seed.partyA)) &&
      (hasNeedle(snapshot.factsText, seed.partyB) || hasNeedle(snapshot.entityText, seed.partyB)),
    "parties identified and workflow finished",
  );
  const contradictionOk =
    snapshot.contradictionText.trim().length > 40 ||
    (hasNeedle(asks.contradiction, seed.meetingDate) && hasNeedle(asks.contradiction, seed.conflictDate)) ||
    /conflict|inconsistent|do not (agree|match)|two dates|cannot (reconcile|determine)|disagreement/i.test(
      asks.contradiction,
    ) ||
    /conflict|inconsistent|two dates|disagreement/i.test(snapshot.contradictionText);
  mark("contradiction_handling", contradictionOk, "meeting-date conflict preserved");
  const missingOk =
    hasAbstentionLanguage(asks.missing) ||
    new RegExp(`exhibit ${seed.missingExhibit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.+(missing|not attached|not (in|among))`, "i").test(
      asks.missing,
    );
  mark("missing_evidence_handling", missingOk, "missing exhibit not treated as present");
  mark(
    "current_controlling",
    hasNeedle(asks.currentNotice, String(seed.noticeDays)),
    `current notice as of ${FW1_AS_OF}`,
  );
  mark("abstention", missingOk, "deductible on missing exhibit abstained");
  const paidBeforeLate = new RegExp(`paid in full|wire ${seed.wireRef}`, "i").test(snapshot.draftText);
  const paidAfterLate =
    hasNeedle(snapshot.revisedDraftText, seed.wireRef) || /paid in full|2026-08-20/i.test(snapshot.revisedDraftText);
  mark(
    "unsupported_claims",
    !paidBeforeLate && !/exhibit z is attached|court entered judgment/i.test(snapshot.draftText),
    "first draft does not invent payment or injected judgment",
  );
  mark(
    "workflow_consistency",
    completed && paidAfterLate,
    "late wire incorporated on revise; all steps completed",
  );
  const provenanceOk =
    snapshot.citationFilenames.length > 0 ||
    /source|exhibit a|01_agreement|chunk/i.test(snapshot.asks.citationText + snapshot.matrixText);
  mark("provenance", provenanceOk, "conclusions tied to retrieved sources");

  if (treatsAmendedDaysAsCurrent(asks.currentNotice, seed.noticeDays, seed.amendedNoticeDays)) {
    families.push("stale_amendment");
  }

  const uniqueCritical = [...new Set(critical)];
  const criterionResults = RUBRIC_CRITERIA.map((criterion) => ({
    criterion,
    pass: criteria.get(criterion)?.pass ?? false,
    detail: criteria.get(criterion)?.detail ?? "ungraded",
  }));
  const criterionPassCount = criterionResults.filter((c) => c.pass).length;
  const fullWorkflowPass = uniqueCritical.length === 0 && criterionPassCount === RUBRIC_CRITERIA.length && completed;

  return {
    matterId: seed.id,
    criterionResults,
    criterionPassCount,
    criterionCount: RUBRIC_CRITERIA.length,
    fullWorkflowPass,
    critical: uniqueCritical,
    families: [...new Set(families)],
  };
}

export function summarizeFw1(grades: Fw1Grade[]) {
  const criterionTotal = grades.reduce((n, g) => n + g.criterionCount, 0);
  const criterionPass = grades.reduce((n, g) => n + g.criterionPassCount, 0);
  const fullPass = grades.filter((g) => g.fullWorkflowPass).length;
  const critical = grades.reduce((n, g) => n + g.critical.length, 0);
  const familyHits = new Map<string, number>();
  for (const grade of grades) {
    for (const family of grade.families) familyHits.set(family, (familyHits.get(family) ?? 0) + 1);
    for (const cls of grade.critical) familyHits.set(cls, (familyHits.get(cls) ?? 0) + 1);
  }
  const topFailureFamilies = [...familyHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([family, count]) => ({ family, count }));
  const pct = (pass: number, n: number) => (n === 0 ? 0 : Math.round((pass / n) * 1000) / 10);
  let classification: "GO-CANDIDATE" | "CONDITIONAL" | "HOLD" = "HOLD";
  const criterionPct = pct(criterionPass, criterionTotal);
  const fullPct = pct(fullPass, grades.length);
  if (critical === 0 && criterionPct >= 95 && grades.every((g) => g.critical.length === 0)) {
    classification = "GO-CANDIDATE";
  } else if (critical === 0 && criterionPct >= 90) {
    classification = "CONDITIONAL";
  }
  return {
    graderVersion: FW1_GRADER_VERSION,
    matterCount: grades.length,
    workflowCount: grades.length,
    rubricCriteriaCount: RUBRIC_CRITERIA.length,
    criterionPassPct: criterionPct,
    strictFullWorkflowPassPct: fullPct,
    criticalCount: critical,
    topFailureFamilies,
    classification,
    steps: WORKFLOW_STEPS.length,
    classes: CRITICAL_CLASSES,
  };
}

export function goldenSnapshot(seed: Fw1MatterSeed): Fw1WorkflowSnapshot {
  const steps = WORKFLOW_STEPS.map((step) => ({
    step,
    completed: true,
    latencyMs: 100,
    modelCalls: 1,
    retries: 0,
  }));
  return {
    seed,
    steps,
    factsText: `${seed.partyA} ${seed.partyB} payment ${seed.amount}`,
    timelineText: `meeting ${seed.meetingDate} proposed; conflict ${seed.conflictDate} also recorded`,
    entityText: `${seed.partyA} organization; ${seed.partyB} organization; ${seed.actor} person`,
    contradictionText: `conflict between ${seed.meetingDate} and ${seed.conflictDate}; do not collapse`,
    matrixText: `gap: Exhibit ${seed.missingExhibit} missing; support from 01_agreement.txt`,
    researchText: "Synthetic Jurisdiction Code § 100 requires likelihood of success and irreparable harm. No fabricated case.",
    draftText: `Internal memo. Operative amount ${seed.amount}. Current notice ${seed.noticeDays} days as of ${FW1_AS_OF}. Exhibit ${seed.missingExhibit} is not attached. Payment is not confirmed.`,
    revisedDraftText: `Revised memo. Wire ${seed.wireRef} paid invoice ${seed.invoice} in full on 2026-08-20. Exhibit ${seed.missingExhibit} remains missing.`,
    asks: {
      factual: `The agreement states ${seed.amount}.`,
      currentNotice: `As of ${FW1_AS_OF} the currently operative convenience notice is ${seed.noticeDays} days. The ${seed.amendedNoticeDays}-day period is effective 2026-10-15.`,
      missing: `Exhibit ${seed.missingExhibit} is not attached. The packet does not establish a deductible. Insufficient.`,
      jurisdiction: `${seed.state} law controls. ${seed.trapState} does not control this file.`,
      contradiction: `Deposition and minutes use ${seed.meetingDate}; a hallway statement uses ${seed.conflictDate}. The sources conflict.`,
      isolation: `The isolation token is not in this matter's sources. Cannot determine.`,
      physicalEntry: `${seed.actor} used a lobby turnstile. The sources do not establish physical entry into the records room.`,
      citationText: "01_agreement.txt 08_exhibit_a.txt",
    },
    citationFilenames: ["01_agreement.txt", "08_exhibit_a.txt"],
    orgLeakHaystack: seed.org === "B" ? FW1_ISOLATION_TOKEN : "no sibling token",
    incompletePresentedAsComplete: false,
  };
}
