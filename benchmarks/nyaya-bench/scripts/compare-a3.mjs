import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const a2v1 = join(root, "reports/runs/2026-08-18T11-35-07-966Z");
const a2v2 = join(root, "reports/runs/2026-08-18T11-40-00-604Z");
const a3v1 = join(root, "reports/runs/2026-08-18T17-18-03-355Z");
const a3v2 = join(root, "reports/runs/2026-08-18T17-59-29-753Z");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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

function verdictOf(grade) {
  if (String(grade.detail ?? "").startsWith("INFRASTRUCTURE:")) return "infrastructure";
  return grade.verdict;
}

const a2 = new Map([...loadGrades(a2v1), ...loadGrades(a2v2)]);
const a3 = new Map([...loadGrades(a3v1), ...loadGrades(a3v2)]);
const a3Answers = new Map([...loadAnswers(a3v1), ...loadAnswers(a3v2)]);

function countBy(grades) {
  const counts = { pass: 0, needs_work: 0, fail: 0, infrastructure: 0, criticalFails: 0 };
  for (const grade of grades.values()) {
    counts[verdictOf(grade)] += 1;
    if (grade.severity === "critical" && verdictOf(grade) === "fail") counts.criticalFails += 1;
  }
  return counts;
}

function cluster(suffix) {
  const ids = [...a3.keys()].filter((id) => id.endsWith(suffix));
  const rows = ids.map((id) => ({
    id,
    a2: verdictOf(a2.get(id) ?? {}),
    a3: verdictOf(a3.get(id) ?? {}),
    a2sev: a2.get(id)?.severity,
    a3sev: a3.get(id)?.severity,
    a2detail: a2.get(id)?.detail,
    a3detail: a3.get(id)?.detail,
  }));
  const tally = (key) => {
    const fails = rows.filter((r) => r[key] === "fail").length;
    const critical = rows.filter(
      (r) => r[`${key}sev`] === "critical" && r[key] === "fail",
    ).length;
    const pass = rows.filter((r) => r[key] === "pass").length;
    const nw = rows.filter((r) => r[key] === "needs_work").length;
    return { n: rows.length, pass, nw, fail: fails, critical };
  };
  return { ids: rows, a2: tally("a2"), a3: tally("a3") };
}

const transitions = [];
for (const [id, g3] of a3) {
  const g2 = a2.get(id);
  if (!g2) continue;
  const from = verdictOf(g2);
  const to = verdictOf(g3);
  if (from !== to) transitions.push({ id, from, to, detail: g3.detail, severity: g3.severity });
}

const byKind = {};
for (const t of transitions) {
  const key = `${t.from}→${t.to}`;
  byKind[key] = (byKind[key] ?? 0) + 1;
}

const latencies = [];
const assessmentLatencies = [];
let triggered = 0;
const sources = {};
for (const answer of a3Answers.values()) {
  if (typeof answer.latencyMs === "number") latencies.push(answer.latencyMs);
  const extra = answer.extras ?? {};
  if (typeof extra.assessmentLatency === "number") assessmentLatencies.push(extra.assessmentLatency);
  if (extra.assessmentTriggered) triggered += 1;
  const src = extra.assessmentSource ?? "unknown";
  sources[src] = (sources[src] ?? 0) + 1;
}
latencies.sort((a, b) => a - b);
assessmentLatencies.sort((a, b) => a - b);
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] ?? null;

const report = {
  a2: countBy(a2),
  a3: countBy(a3),
  executed: a3.size,
  T025: cluster("-T025"),
  T020: cluster("-T020"),
  T002: cluster("-T002"),
  T003: cluster("-T003"),
  T014: cluster("-T014"),
  v1q008: cluster("-Q008"),
  transitionsByKind: byKind,
  passToFail: transitions.filter((t) => t.from === "pass" && t.to === "fail"),
  passToNeedsWork: transitions.filter((t) => t.from === "pass" && t.to === "needs_work"),
  failToPass: transitions.filter((t) => t.from === "fail" && t.to === "pass").map((t) => t.id),
  remainingCritical: [...a3.values()]
    .filter((g) => g.severity === "critical" && verdictOf(g) === "fail")
    .map((g) => ({ id: g.taskId, detail: g.detail })),
  remainingFailDetails: [...a3.values()]
    .filter((g) => verdictOf(g) === "fail")
    .reduce((acc, g) => {
      const key = String(g.detail ?? "unknown").split(":")[0];
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  performance: {
    n: latencies.length,
    medianLatencyMs: pct(latencies, 50),
    p95LatencyMs: pct(latencies, 95),
    medianAssessmentMs: pct(assessmentLatencies, 50),
    p95AssessmentMs: pct(assessmentLatencies, 95),
    triggered,
    triggerRate: triggered / a3Answers.size,
    sources,
  },
};

writeFileSync(join(root, "baselines/A3_COMPARE_STATS.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  a2: report.a2,
  a3: report.a3,
  T025: { a2: report.T025.a2, a3: report.T025.a3 },
  T020: { a2: report.T020.a2, a3: report.T020.a3 },
  T002: { a2: report.T002.a2, a3: report.T002.a3 },
  T003: { a2: report.T003.a2, a3: report.T003.a3 },
  T014: { a2: report.T014.a2, a3: report.T014.a3 },
  v1q008: { a2: report.v1q008.a2, a3: report.v1q008.a3 },
  transitionsByKind: report.transitionsByKind,
  passToFailCount: report.passToFail.length,
  passToNeedsWorkCount: report.passToNeedsWork.length,
  remainingCritical: report.remainingCritical,
  remainingFailDetails: report.remainingFailDetails,
  performance: report.performance,
}, null, 2));
