/**
 * Deterministic aggregation of completed human dogfood reviews.
 * Never averages away CRITICAL. Operator-only packets cannot become DOGFOOD PASS.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOGFOOD_MATTERS,
  DOGFOOD_PACK_ID,
  RUBRIC_CATEGORIES,
  SAFETY_FLAGS,
  type RubricKey,
  type SafetyKey,
} from "./catalog";

export type ReviewerRole = "attorney" | "student" | "paralegal" | "operator";
export type WouldUse = "YES" | "WITH_CHANGES" | "NO";
export type Severity = "CRITICAL" | "MAJOR" | "MINOR";
export type GateStatus = "READY-FOR-HUMAN-REVIEW" | "DOGFOOD PASS" | "HOLD";

export type ReviewRecord = {
  reviewerId: string;
  reviewerRole: ReviewerRole;
  matterId: string;
  taskId: string;
  scores: Partial<Record<RubricKey, number>>;
  safety: Record<SafetyKey, boolean>;
  wouldUse: WouldUse;
  timeMinutes: number;
  observations: string;
};

export type IssueRecord = {
  reviewerId: string;
  matterId: string;
  taskId: string;
  severity: Severity;
  theme: string;
  text: string;
};

export type DogfoodReport = {
  packId: string;
  status: GateStatus;
  holdReasons: string[];
  reviewers: number;
  attorneyReviewers: number;
  matters: number;
  workProducts: number;
  means: Record<string, number | null>;
  medians: Record<string, number | null>;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  trustScore: number | null;
  usefulnessScore: number | null;
  estimatedTimeSavedMean: number | null;
  wouldUse: { YES: number; WITH_CHANGES: number; NO: number; pct: Record<string, number> };
  recurringThemes: Array<{ theme: string; count: number }>;
  safetyYesCounts: Record<SafetyKey, number>;
};

const QUALIFIED: ReviewerRole[] = ["attorney"];

export function parseScore(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "NA" || trimmed === "-") return undefined;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new Error(`score must be 1-5 or NA, got ${JSON.stringify(raw)}`);
  }
  return n;
}

export function parseBool(raw: string): boolean {
  const v = raw.trim().toUpperCase();
  if (["Y", "YES", "TRUE", "1"].includes(v)) return true;
  if (["N", "NO", "FALSE", "0", ""].includes(v)) return false;
  throw new Error(`boolean flag must be YES/NO, got ${JSON.stringify(raw)}`);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  return Math.round(value * 100) / 100;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"') inQuotes = true;
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseReviewsCsv(text: string): ReviewRecord[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.trim());
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`reviews.csv missing column ${name}`);
    return i;
  };
  const col = {
    reviewerId: idx("reviewer_id"),
    role: idx("reviewer_role"),
    matterId: idx("matter_id"),
    taskId: idx("task_id"),
    wouldUse: idx("would_use"),
    time: idx("time_minutes"),
    observations: idx("observations"),
  };
  const scoreCols = Object.fromEntries(
    RUBRIC_CATEGORIES.map((c) => [c.key, idx(`score_${c.key}`)]),
  ) as Record<RubricKey, number>;
  const safetyCols = Object.fromEntries(SAFETY_FLAGS.map((f) => [f.key, idx(f.key)])) as Record<
    SafetyKey,
    number
  >;
  return lines.slice(1).map((line, row) => {
    const cells = splitCsvLine(line);
    const role = cells[col.role]?.trim() as ReviewerRole;
    if (!["attorney", "student", "paralegal", "operator"].includes(role)) {
      throw new Error(`row ${row + 2}: invalid reviewer_role`);
    }
    const wouldRaw = (cells[col.wouldUse] ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    const normalizedUse = wouldRaw === "WITHCHANGES" ? "WITH_CHANGES" : wouldRaw;
    if (!["YES", "WITH_CHANGES", "NO"].includes(normalizedUse)) {
      throw new Error(`row ${row + 2}: would_use must be YES / WITH CHANGES / NO`);
    }
    const scores: Partial<Record<RubricKey, number>> = {};
    for (const key of RUBRIC_CATEGORIES.map((c) => c.key)) {
      const parsed = parseScore(cells[scoreCols[key]] ?? "");
      if (parsed !== undefined) scores[key] = parsed;
    }
    const safety = {} as Record<SafetyKey, boolean>;
    for (const flag of SAFETY_FLAGS) {
      safety[flag.key] = parseBool(cells[safetyCols[flag.key]] ?? "NO");
    }
    return {
      reviewerId: (cells[col.reviewerId] ?? "").trim(),
      reviewerRole: role,
      matterId: (cells[col.matterId] ?? "").trim(),
      taskId: (cells[col.taskId] ?? "").trim(),
      scores,
      safety,
      wouldUse: normalizedUse as WouldUse,
      timeMinutes: Number(cells[col.time] ?? 0) || 0,
      observations: (cells[col.observations] ?? "").trim(),
    };
  });
}

export function parseIssuesCsv(text: string): IssueRecord[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.trim());
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`issues.csv missing column ${name}`);
    return i;
  };
  const col = {
    reviewerId: idx("reviewer_id"),
    matterId: idx("matter_id"),
    taskId: idx("task_id"),
    severity: idx("severity"),
    theme: idx("theme"),
    text: idx("text"),
  };
  return lines.slice(1).map((line, row) => {
    const cells = splitCsvLine(line);
    const severity = (cells[col.severity] ?? "").trim().toUpperCase() as Severity;
    if (!["CRITICAL", "MAJOR", "MINOR"].includes(severity)) {
      throw new Error(`issues row ${row + 2}: severity must be CRITICAL|MAJOR|MINOR`);
    }
    return {
      reviewerId: (cells[col.reviewerId] ?? "").trim(),
      matterId: (cells[col.matterId] ?? "").trim(),
      taskId: (cells[col.taskId] ?? "").trim(),
      severity,
      theme: (cells[col.theme] ?? "").trim().toLowerCase(),
      text: (cells[col.text] ?? "").trim(),
    };
  });
}

function impliedCriticalIssues(reviews: ReviewRecord[]): IssueRecord[] {
  const extra: IssueRecord[] = [];
  for (const review of reviews) {
    const flags: Array<[SafetyKey, string]> = [
      ["fabricated_authority", "fabricated authority"],
      ["fabricated_exhibit", "fabricated exhibit"],
      ["unsupported_material_fact", "unsupported material fact"],
      ["dangerous_omission", "dangerous omission"],
    ];
    for (const [key, theme] of flags) {
      if (review.safety[key]) {
        extra.push({
          reviewerId: review.reviewerId,
          matterId: review.matterId,
          taskId: review.taskId,
          severity: "CRITICAL",
          theme,
          text: `Safety flag ${key}=YES`,
        });
      }
    }
  }
  return extra;
}

export function aggregateDogfood(reviews: ReviewRecord[], issues: IssueRecord[]): DogfoodReport {
  const allIssues = [...issues, ...impliedCriticalIssues(reviews)];
  const reviewerIds = new Set(reviews.map((r) => r.reviewerId));
  const attorneyReviewers = new Set(
    reviews.filter((r) => QUALIFIED.includes(r.reviewerRole)).map((r) => r.reviewerId),
  );
  const matterIds = new Set(reviews.map((r) => r.matterId));
  const workProducts = reviews.length;
  const means: Record<string, number | null> = {};
  const medians: Record<string, number | null> = {};
  for (const cat of RUBRIC_CATEGORIES) {
    const values = reviews.map((r) => r.scores[cat.key]).filter((n): n is number => typeof n === "number");
    means[cat.key] = mean(values);
    medians[cat.key] = median(values);
  }
  const criticalCount = allIssues.filter((i) => i.severity === "CRITICAL").length;
  const majorCount = allIssues.filter((i) => i.severity === "MAJOR").length;
  const minorCount = allIssues.filter((i) => i.severity === "MINOR").length;
  const wouldUse = { YES: 0, WITH_CHANGES: 0, NO: 0 };
  for (const review of reviews) wouldUse[review.wouldUse] += 1;
  const wouldTotal = reviews.length || 1;
  const wouldPct = {
    YES: Math.round((wouldUse.YES / wouldTotal) * 1000) / 10,
    WITH_CHANGES: Math.round((wouldUse.WITH_CHANGES / wouldTotal) * 1000) / 10,
    NO: Math.round((wouldUse.NO / wouldTotal) * 1000) / 10,
  };
  const themeCounts = new Map<string, number>();
  for (const issue of allIssues) {
    if (!issue.theme) continue;
    themeCounts.set(issue.theme, (themeCounts.get(issue.theme) ?? 0) + 1);
  }
  const recurringThemes = [...themeCounts.entries()]
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count);
  const safetyYesCounts = Object.fromEntries(
    SAFETY_FLAGS.map((f) => [f.key, reviews.filter((r) => r.safety[f.key]).length]),
  ) as Record<SafetyKey, number>;

  const holdReasons: string[] = [];
  if (reviews.length === 0) {
    return {
      packId: DOGFOOD_PACK_ID,
      status: "READY-FOR-HUMAN-REVIEW",
      holdReasons: ["No completed reviews yet. Human attorney review is required."],
      reviewers: 0,
      attorneyReviewers: 0,
      matters: DOGFOOD_MATTERS.length,
      workProducts: 0,
      means,
      medians,
      criticalCount: 0,
      majorCount: 0,
      minorCount: 0,
      trustScore: null,
      usefulnessScore: null,
      estimatedTimeSavedMean: null,
      wouldUse: { ...wouldUse, pct: wouldPct },
      recurringThemes,
      safetyYesCounts,
    };
  }
  if (criticalCount > 0) holdReasons.push(`${criticalCount} CRITICAL issue(s) — never averaged away`);
  if (attorneyReviewers.size === 0) {
    holdReasons.push("No admitted-attorney reviewer. Operator/student/paralegal scores are advisory only.");
  }
  const factual = means.A;
  const citation = means.B;
  const trust = means.K;
  const usefulness = mean(
    reviews.flatMap((r) => [r.scores.C, r.scores.I, r.scores.J].filter((n): n is number => typeof n === "number")),
  );
  if (factual !== null && factual < 4) holdReasons.push(`mean factual accuracy ${factual} < 4`);
  if (citation !== null && citation < 4) holdReasons.push(`mean citation traceability ${citation} < 4`);
  if (trust !== null && trust < 4) holdReasons.push(`mean trust ${trust} < 4`);
  if (usefulness !== null && usefulness < 4) holdReasons.push(`mean usefulness ${usefulness} < 4`);
  const majorityUse = wouldUse.YES + wouldUse.WITH_CHANGES > wouldUse.NO;
  if (!majorityUse) holdReasons.push("majority would not use NyayaGrid in practice");
  const recurringUnsupported = recurringThemes.filter(
    (t) => t.count >= 2 && /unsupported|fabricat|cannot trace|missing citation/.test(t.theme),
  );
  if (recurringUnsupported.length > 0) {
    holdReasons.push(`recurring unsupported/traceability theme: ${recurringUnsupported.map((t) => t.theme).join("; ")}`);
  }

  let status: GateStatus;
  if (reviews.length === 0) status = "READY-FOR-HUMAN-REVIEW";
  else if (holdReasons.length > 0) status = attorneyReviewers.size === 0 && criticalCount === 0 ? "READY-FOR-HUMAN-REVIEW" : "HOLD";
  else status = "DOGFOOD PASS";

  if (attorneyReviewers.size === 0 && criticalCount === 0) status = "READY-FOR-HUMAN-REVIEW";
  if (criticalCount > 0) status = "HOLD";

  return {
    packId: DOGFOOD_PACK_ID,
    status,
    holdReasons,
    reviewers: reviewerIds.size,
    attorneyReviewers: attorneyReviewers.size,
    matters: matterIds.size,
    workProducts,
    means,
    medians,
    criticalCount,
    majorCount,
    minorCount,
    trustScore: trust,
    usefulnessScore: usefulness,
    estimatedTimeSavedMean: means.L,
    wouldUse: { ...wouldUse, pct: wouldPct },
    recurringThemes,
    safetyYesCounts,
  };
}

export function formatReport(report: DogfoodReport): string {
  const scoreLines = RUBRIC_CATEGORIES.map(
    (c) => `- ${c.key} ${c.label}: mean ${report.means[c.key] ?? "n/a"} / median ${report.medians[c.key] ?? "n/a"}`,
  );
  return [
    `# Dogfood aggregation`,
    "",
    `Status: **${report.status}**`,
    `Pack: ${report.packId}`,
    report.holdReasons.length ? `Reasons: ${report.holdReasons.join("; ")}` : "Reasons: (none)",
    "",
    `- Reviewers: ${report.reviewers} (attorney: ${report.attorneyReviewers})`,
    `- Matters: ${report.matters}`,
    `- Reviewed work products: ${report.workProducts}`,
    `- CRITICAL: ${report.criticalCount}  MAJOR: ${report.majorCount}  MINOR: ${report.minorCount}`,
    `- Trust (K): ${report.trustScore ?? "n/a"}`,
    `- Usefulness (C/I/J): ${report.usefulnessScore ?? "n/a"}`,
    `- Time saved (L): ${report.estimatedTimeSavedMean ?? "n/a"}`,
    `- would-use YES ${report.wouldUse.pct.YES}% / WITH CHANGES ${report.wouldUse.pct.WITH_CHANGES}% / NO ${report.wouldUse.pct.NO}%`,
    "",
    "## Rubric",
    ...scoreLines,
    "",
    "## Recurring themes",
    ...(report.recurringThemes.length
      ? report.recurringThemes.map((t) => `- ${t.theme} (${t.count})`)
      : ["- (none)"]),
    "",
  ].join("\n");
}

function hereDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export function loadCompletedDir(dir: string): { reviews: ReviewRecord[]; issues: IssueRecord[] } {
  if (!existsSync(dir)) return { reviews: [], issues: [] };
  const files = readdirSync(dir);
  const reviews: ReviewRecord[] = [];
  const issues: IssueRecord[] = [];
  for (const name of files) {
    const path = join(dir, name);
    if (name.endsWith("reviews.csv")) reviews.push(...parseReviewsCsv(readFileSync(path, "utf8")));
    if (name.endsWith("issues.csv")) issues.push(...parseIssuesCsv(readFileSync(path, "utf8")));
  }
  return { reviews, issues };
}

function main(): void {
  const root = hereDir();
  const completed = join(root, "completed");
  const { reviews, issues } = loadCompletedDir(completed);
  const report = aggregateDogfood(reviews, issues);
  const outDir = join(root, "dist");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "AGGREGATE.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, "AGGREGATE.md"), `${formatReport(report)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status, reviewers: report.reviewers, critical: report.criticalCount })}\n`);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) main();
