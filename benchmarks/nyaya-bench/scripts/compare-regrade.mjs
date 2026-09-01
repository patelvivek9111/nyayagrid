import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const origV1 = join(root, "reports/runs/2026-08-18T03-14-16-862Z");
const origV2 = join(root, "reports/runs/2026-08-18T03-20-13-556Z");
const a1 = join(root, "reports/runs/regrade-A1-2026-08-18T10-52-14-395Z");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listJson(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function loadGrades(runDir) {
  const map = new Map();
  for (const name of listJson(join(runDir, "grades"))) {
    const grade = loadJson(join(runDir, "grades", name));
    map.set(grade.taskId ?? name.replace(/\.json$/, ""), grade);
  }
  return map;
}

function loadAnswers(runDir) {
  const map = new Map();
  for (const name of listJson(join(runDir, "answers"))) {
    const answer = loadJson(join(runDir, "answers", name));
    map.set(answer.taskId ?? name.replace(/\.json$/, ""), answer);
  }
  return map;
}

const origGrades = new Map([...loadGrades(origV1), ...loadGrades(origV2)]);
const a1Grades = loadGrades(a1);
const origAnswers = new Map([...loadAnswers(origV1), ...loadAnswers(origV2)]);
const a1Answers = loadAnswers(a1);

const hashMismatches = [];
for (const [taskId, orig] of origAnswers) {
  const origPath = join(taskId.startsWith("SYNTH-V2") ? origV2 : origV1, "answers", `${taskId}.json`);
  const copyPath = join(a1, "answers", `${taskId}.json`);
  if (!existsSync(copyPath)) {
    hashMismatches.push({ taskId, issue: "missing_in_a1" });
    continue;
  }
  if (hashFile(origPath) !== hashFile(copyPath)) {
    hashMismatches.push({ taskId, issue: "hash_mismatch" });
  }
}

function verdictOf(grade) {
  if (String(grade.detail ?? "").startsWith("INFRASTRUCTURE:")) return "infrastructure";
  return grade.verdict;
}

function countBy(grades) {
  const counts = { pass: 0, needs_work: 0, fail: 0, infrastructure: 0 };
  for (const grade of grades.values()) {
    const v = verdictOf(grade);
    counts[v] += 1;
  }
  return counts;
}

const origCounts = countBy(origGrades);
const a1Counts = countBy(a1Grades);

const transitions = [];
let failToBetter = 0;
let passToWorse = 0;
let needsWorkToPass = 0;
let needsWorkToFail = 0;

for (const [taskId, orig] of origGrades) {
  const next = a1Grades.get(taskId);
  if (!next) continue;
  const from = verdictOf(orig);
  const to = verdictOf(next);
  if (from === to) continue;
  transitions.push({
    taskId,
    from,
    to,
    category: origAnswers.get(taskId)?.category,
    origDetail: orig.detail,
    a1Detail: next.detail,
    expectationType: next.expectationType ?? orig.expectationType,
    severity: next.severity ?? orig.severity,
  });
  if (from === "fail" && (to === "pass" || to === "needs_work")) failToBetter += 1;
  if (from === "pass" && (to === "fail" || to === "needs_work")) passToWorse += 1;
  if (from === "needs_work" && to === "pass") needsWorkToPass += 1;
  if (from === "needs_work" && to === "fail") needsWorkToFail += 1;
}

function groupCount(grades, pred) {
  const rows = [...grades.entries()].filter(([taskId, grade]) => pred(taskId, grade, origAnswers.get(taskId)));
  const counts = { tests: rows.length, pass: 0, needs_work: 0, fail: 0, infrastructure: 0 };
  for (const [, grade] of rows) counts[verdictOf(grade)] += 1;
  return counts;
}

function byCategory(grades) {
  const map = new Map();
  for (const [taskId, grade] of grades) {
    const category = origAnswers.get(taskId)?.category ?? "unknown";
    if (!map.has(category)) map.set(category, { tests: 0, pass: 0, needs_work: 0, fail: 0, infrastructure: 0 });
    const row = map.get(category);
    row.tests += 1;
    row[verdictOf(grade)] += 1;
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function suffix(taskId) {
  const match = taskId.match(/-(Q|T)(\d+)$/);
  return match ? `${match[1]}${match[2]}` : taskId;
}

function cluster(pattern) {
  const ids = [...origAnswers.keys()].filter((id) => pattern(id, origAnswers.get(id)));
  return {
    tests: ids.length,
    original: Object.fromEntries(
      ["pass", "needs_work", "fail", "infrastructure"].map((k) => [
        k,
        ids.filter((id) => verdictOf(origGrades.get(id)) === k).length,
      ]),
    ),
    a1: Object.fromEntries(
      ["pass", "needs_work", "fail", "infrastructure"].map((k) => [
        k,
        ids.filter((id) => verdictOf(a1Grades.get(id)) === k).length,
      ]),
    ),
    remainingFails: ids.filter((id) => verdictOf(a1Grades.get(id)) === "fail"),
    remainingNeedsWork: ids.filter((id) => verdictOf(a1Grades.get(id)) === "needs_work"),
  };
}

const metrics = {
  overall: { original: origCounts, corrected: a1Counts },
  must_abstain: {
    original: groupCount(origGrades, (_, g) => g.expectationType === "must_abstain"),
    corrected: groupCount(a1Grades, (_, g) => g.expectationType === "must_abstain"),
  },
  challenge_premise: {
    original: groupCount(origGrades, (_, g) => g.expectationType === "challenge_premise"),
    corrected: groupCount(a1Grades, (_, g) => g.expectationType === "challenge_premise"),
  },
  not_contradiction: {
    original: groupCount(origGrades, (_, g) => g.expectationType === "not_contradiction" || g.taskId?.includes("T011") || suffix(g.taskId ?? "") === "T011"),
    corrected: groupCount(a1Grades, (_, g) => g.expectationType === "not_contradiction"),
  },
  entity_distinction: {
    original: groupCount(origGrades, (_, g) => g.expectationType === "entity_distinction"),
    corrected: groupCount(a1Grades, (_, g) => g.expectationType === "entity_distinction"),
  },
  quote: {
    original: groupCount(origGrades, (id, g, a) => a?.category === "quote_accuracy" || g.expectationType === "quote_not_found"),
    corrected: groupCount(a1Grades, (id, g, a) => a?.category === "quote_accuracy" || g.expectationType === "quote_not_found" || g.expectationType === "must_abstain" && a?.category === "quote_accuracy"),
  },
  numeric: {
    original: groupCount(origGrades, (id, _, a) => a?.category === "numeric" || a?.category === "numeric_precision"),
    corrected: groupCount(a1Grades, (id, _, a) => origAnswers.get(id)?.category === "numeric" || origAnswers.get(id)?.category === "numeric_precision"),
  },
  contract_compare: {
    original: groupCount(origGrades, (id, _, a) => ["contract_compare", "contract_decoy", "decoy"].includes(a?.category)),
    corrected: groupCount(a1Grades, (id, _, a) => ["contract_compare", "contract_decoy", "decoy"].includes(origAnswers.get(id)?.category)),
  },
  false_contradiction_category: {
    original: groupCount(origGrades, (id, _, a) => a?.category === "false_contradiction"),
    corrected: groupCount(a1Grades, (id) => origAnswers.get(id)?.category === "false_contradiction"),
  },
  contradiction_category: {
    original: groupCount(origGrades, (id, _, a) => a?.category === "contradiction"),
    corrected: groupCount(a1Grades, (id) => origAnswers.get(id)?.category === "contradiction"),
  },
  timeline_category: {
    original: groupCount(origGrades, (id, _, a) => a?.category === "timeline"),
    corrected: groupCount(a1Grades, (id) => origAnswers.get(id)?.category === "timeline"),
  },
  entity_category: {
    original: groupCount(origGrades, (id, _, a) => a?.category === "entity_resolution"),
    corrected: groupCount(a1Grades, (id) => origAnswers.get(id)?.category === "entity_resolution"),
  },
  quote_category: {
    original: groupCount(origGrades, (id, _, a) => a?.category === "quote_accuracy"),
    corrected: groupCount(a1Grades, (id) => origAnswers.get(id)?.category === "quote_accuracy"),
  },
  termination: {
    original: groupCount(origGrades, (id, _, a) => a?.category === "termination"),
    corrected: groupCount(a1Grades, (id) => origAnswers.get(id)?.category === "termination"),
  },
};

const criticalOrig = [...origGrades.values()].filter(
  (g) => g.severity === "critical" && verdictOf(g) === "fail",
).length;
const criticalA1 = [...a1Grades.values()].filter(
  (g) => g.severity === "critical" && verdictOf(g) === "fail",
).length;

const falseRefusalOrig = [...origGrades.values()].filter(
  (g) => g.verdict === "fail" && String(g.detail).includes("insufficient") && g.expectationType !== "must_abstain",
).length;

const report = {
  originalAnswerHashesUnchanged: hashMismatches.length === 0,
  hashMismatches,
  origAnswerCount: origAnswers.size,
  a1AnswerCount: a1Answers.size,
  origGradeCount: origGrades.size,
  a1GradeCount: a1Grades.size,
  origCounts,
  a1Counts,
  passRateOrig: origCounts.pass / origGrades.size,
  passRateA1: a1Counts.pass / a1Grades.size,
  graderFalseFailuresCorrected: failToBetter,
  graderFalsePassesCorrected: passToWorse,
  needsWorkToPass,
  needsWorkToFail,
  criticalFailOrig: criticalOrig,
  criticalFailA1: criticalA1,
  transitionsByKind: transitions.reduce((acc, row) => {
    const key = `${row.from}->${row.to}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {}),
  clusters: {
    T004_deductible: cluster((id) => suffix(id) === "T004" && id.startsWith("SYNTH-V2")),
    T005_premise: cluster((id) => suffix(id) === "T005" && id.startsWith("SYNTH-V2")),
    T011_false_contradiction: cluster((id) => suffix(id) === "T011" && id.startsWith("SYNTH-V2")),
    T019_quote_trap: cluster((id) => suffix(id) === "T019" && id.startsWith("SYNTH-V2")),
    T020_retroactivity: cluster((id) => suffix(id) === "T020" && id.startsWith("SYNTH-V2")),
    T023_entity: cluster((id) => suffix(id) === "T023" && id.startsWith("SYNTH-V2")),
    T024_quote_proof: cluster((id) => suffix(id) === "T024" && id.startsWith("SYNTH-V2")),
    T025_badge: cluster((id) => suffix(id) === "T025" && id.startsWith("SYNTH-V2")),
    T010_tension: cluster((id) => suffix(id) === "T010" && id.startsWith("SYNTH-V2")),
    V1_Q008_silence: cluster((id) => id === "SYNTH-008-Q008" || id === "SYNTH-010-Q008"),
    V1_Q006: cluster((id) => id.endsWith("-Q006") && id.startsWith("SYNTH-00")),
  },
  metrics,
  categoriesOrig: byCategory(origGrades),
  categoriesA1: byCategory(a1Grades),
  passToWorseIds: transitions.filter((t) => t.from === "pass" && (t.to === "fail" || t.to === "needs_work")),
  failToPassIds: transitions.filter((t) => t.from === "fail" && t.to === "pass").map((t) => t.taskId),
};

writeFileSync(join(root, "reports/baseline-a1-delta.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      hashes: report.originalAnswerHashesUnchanged,
      orig: origCounts,
      a1: a1Counts,
      failToBetter,
      passToWorse,
      needsWorkToPass,
      needsWorkToFail,
      critical: { orig: criticalOrig, a1: criticalA1 },
      transitions: report.transitionsByKind,
      T011: report.clusters.T011_false_contradiction,
      T004: report.clusters.T004_deductible,
      T023: report.clusters.T023_entity,
      T024: report.clusters.T024_quote_proof,
      T025: report.clusters.T025_badge,
      T020: report.clusters.T020_retroactivity,
      T005: report.clusters.T005_premise,
      T019: report.clusters.T019_quote_trap,
      passToWorse: report.passToWorseIds,
    },
    null,
    2,
  ),
);
