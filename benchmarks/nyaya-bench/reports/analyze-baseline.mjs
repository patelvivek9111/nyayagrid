import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const V1 = "benchmarks/nyaya-bench/reports/runs/2026-08-18T03-14-16-862Z";
const V2 = "benchmarks/nyaya-bench/reports/runs/2026-08-18T03-20-13-556Z";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadAnswers(runDir) {
  const dir = join(runDir, "answers");
  const map = new Map();
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const row = loadJson(join(dir, name));
    map.set(row.taskId, row);
  }
  return map;
}

function classify(answer, grade) {
  if (grade.detail?.startsWith("INFRASTRUCTURE:") || answer.evidenceState === "infrastructure_error") {
    const msg = String(answer.extras?.infrastructureError ?? grade.detail);
    if (/documentVersionId|documentId|invalid_type/.test(msg)) return "SCHEMA_VALIDATION_ERROR";
    if (/timeout/i.test(msg)) return "TIMEOUT";
    return "MODEL_ERROR";
  }
  const type = grade.expectationType;
  const insufficient = answer.evidenceState === "insufficient" || /do not provide sufficient evidence/i.test(answer.answer);
  const abstained = insufficient || answer.evidenceState === "insufficient";

  if (type === "must_abstain" && grade.verdict === "fail") return "FAILED_ABSTENTION";
  if (type === "challenge_premise" && grade.verdict === "fail") return "FALSE_PREMISE_ACCEPTED";
  if (type === "challenge_premise" && grade.verdict === "needs_work") return "FALSE_PREMISE_ACCEPTED";
  if (type === "non_material_change" && grade.verdict !== "pass") return "CONTRACT_DECOY_FALSE_POSITIVE";
  if (type === "possible_contradiction" && grade.verdict === "fail") return "CONTRADICTION_MISSED";
  if (type === "not_contradiction" && grade.verdict === "fail") return "FALSE_CONTRADICTION";
  if (type === "must_cite" && grade.verdict !== "pass") return "WRONG_CITATION";
  if (type === "supersession" && grade.verdict !== "pass") {
    return abstained ? "FALSE_REFUSAL" : "WRONG_AMENDMENT_PRECEDENCE";
  }
  if (type === "future_effective" && grade.verdict !== "pass") {
    return abstained ? "FALSE_REFUSAL" : "FUTURE_TERM_USED_TOO_EARLY";
  }
  if ((type === "material_change" || type === "material_changes") && grade.verdict !== "pass") {
    return abstained ? "FALSE_REFUSAL" : "MATERIAL_CHANGE_MISSED";
  }
  if (type === "timeline" && grade.verdict !== "pass") {
    return abstained ? "FALSE_REFUSAL" : "TIMELINE_ERROR";
  }
  if (answer.category === "numeric" || answer.category === "numeric_precision") {
    if (grade.verdict !== "pass") return abstained ? "FALSE_REFUSAL" : "NUMERIC_ERROR";
  }
  if (answer.category === "entity_resolution" && grade.verdict !== "pass") {
    return abstained ? "FALSE_REFUSAL" : "ENTITY_RESOLUTION_ERROR";
  }
  if (answer.category === "quote_accuracy" && grade.verdict === "fail" && !abstained) {
    return "FABRICATED_QUOTE";
  }
  if (abstained && type !== "must_abstain" && type !== "challenge_premise") return "FALSE_REFUSAL";
  if (grade.detail?.includes("needles") && grade.needlesFound?.length === 0) return "MISSING_MATERIAL_FACT";
  if (grade.verdict !== "pass") return "MISSING_MATERIAL_FACT";
  return "PASS";
}

function retrievalBucket(answer, grade, classification) {
  if (classification === "SCHEMA_VALIDATION_ERROR" || classification === "TIMEOUT" || classification === "MODEL_ERROR") {
    return "benchmark_infrastructure";
  }
  const retrieved = (answer.retrievedChunkIds ?? []).length;
  const insufficient = answer.evidenceState === "insufficient";
  if (insufficient && retrieved === 0) return "retrieval";
  if (insufficient && retrieved > 0) return "retrieval"; // refused despite chunks — often retrieval of wrong/insufficient passages
  if (classification === "WRONG_CITATION") return "citation";
  if (classification === "FABRICATED_QUOTE" || classification === "FAILED_ABSTENTION" || classification === "FALSE_PREMISE_ACCEPTED") {
    return "grounding";
  }
  if (grade.verdict !== "pass") return "reasoning";
  return "ok";
}

function seededShuffle(items, seed) {
  const out = [...items];
  let h = createHash("sha256").update(seed).digest();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const n = h.readUInt32BE(i % 28);
    h = createHash("sha256").update(h).digest();
    const j = n % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function loadRun(runDir, dataset) {
  const summary = loadJson(join(runDir, "summary.json"));
  const answers = loadAnswers(runDir);
  const rows = summary.grades.map((grade) => {
    const answer = answers.get(grade.taskId);
    const classification = classify(answer, grade);
    return {
      dataset,
      runDir,
      taskId: grade.taskId,
      scenarioId: answer.scenarioId,
      category: answer.category,
      expectationType: grade.expectationType,
      verdict: grade.verdict,
      severity: grade.detail?.startsWith("INFRASTRUCTURE:") ? "infrastructure" : grade.severity,
      detail: grade.detail,
      classification: grade.verdict === "pass" ? "PASS" : classification,
      retrievalBucket: retrievalBucket(answer, grade, classification),
      evidenceState: answer.evidenceState,
      prompt: answer.prompt,
      answer: answer.answer,
      citations: (answer.citations ?? []).map((c) => c.originalFilename ?? c.title),
      retrievedCount: (answer.retrievedChunkIds ?? []).length,
      provider: answer.provider,
      model: answer.model,
      promptVersion: answer.promptVersion,
      latencyMs: answer.latencyMs,
      extras: answer.extras ?? {},
      needlesRequired: grade.needlesRequired,
      needlesFound: grade.needlesFound,
    };
  });
  return { summary, rows };
}

function table(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const cur = map.get(key) ?? { tests: 0, pass: 0, needs_work: 0, fail: 0, infrastructure: 0 };
    cur.tests += 1;
    if (row.detail?.startsWith("INFRASTRUCTURE:") || row.evidenceState === "infrastructure_error") cur.infrastructure += 1;
    else if (row.verdict === "pass") cur.pass += 1;
    else if (row.verdict === "needs_work") cur.needs_work += 1;
    else cur.fail += 1;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, counts]) => ({
      key,
      ...counts,
      passRate: counts.tests === 0 ? 0 : +(counts.pass / counts.tests).toFixed(4),
    }));
}

const v1 = loadRun(V1, "v1");
const v2 = loadRun(V2, "v2");
const all = [...v1.rows, ...v2.rows];
const scored = all.filter((r) => r.evidenceState !== "infrastructure_error" && !r.detail?.startsWith("INFRASTRUCTURE:"));
const infra = all.filter((r) => r.evidenceState === "infrastructure_error" || r.detail?.startsWith("INFRASTRUCTURE:"));
const nonPass = scored.filter((r) => r.verdict !== "pass");
const criticals = scored.filter((r) => r.verdict === "fail" && r.severity === "critical");

const metricSets = {
  abstain: scored.filter((r) => r.expectationType === "must_abstain"),
  falsePremise: scored.filter((r) => r.expectationType === "challenge_premise"),
  supersession: scored.filter((r) => r.expectationType === "supersession" || r.expectationType === "future_effective"),
  material: scored.filter((r) => r.expectationType === "material_change" || r.expectationType === "material_changes"),
  decoy: scored.filter((r) => r.expectationType === "non_material_change"),
  contradiction: scored.filter((r) => r.expectationType === "possible_contradiction"),
  falseContradiction: scored.filter((r) => r.expectationType === "not_contradiction"),
  timeline: scored.filter((r) => r.category === "timeline" || r.expectationType === "timeline"),
  numeric: scored.filter((r) => r.category === "numeric" || r.category === "numeric_precision"),
  citation: scored.filter((r) => r.category === "citation" || r.expectationType === "must_cite"),
  caseQa: scored.filter((r) => r.category === "case_qa"),
};

function rate(rows, pred) {
  if (rows.length === 0) return "NOT CURRENTLY MEASURABLE";
  return {
    n: rows.length,
    hits: rows.filter(pred).length,
    rate: +(rows.filter(pred).length / rows.length).toFixed(4),
  };
}

const passes = seededShuffle(
  scored.filter((r) => r.verdict === "pass"),
  "nyaya-bench-pass-20260818",
).slice(0, 10);
const needs = seededShuffle(
  scored.filter((r) => r.verdict === "needs_work"),
  "nyaya-bench-needs-20260818",
).slice(0, 10);
const fails = seededShuffle(
  scored.filter((r) => r.verdict === "fail"),
  "nyaya-bench-fail-20260818",
).slice(0, 10);

const output = {
  v1Counts: v1.summary.counts,
  v2Counts: v2.summary.counts,
  v1Config: v1.summary.config,
  v2Config: v2.summary.config,
  overall: {
    expected: 500,
    executed: all.length,
    infrastructure: infra.length,
    pass: scored.filter((r) => r.verdict === "pass").length,
    needs_work: scored.filter((r) => r.verdict === "needs_work").length,
    fail: scored.filter((r) => r.verdict === "fail").length,
  },
  byCategory: table(all, (r) => r.category),
  byExpectation: table(all, (r) => r.expectationType),
  byClassification: table(nonPass.concat(infra), (r) => r.classification),
  bySeverity: table(nonPass, (r) => r.severity),
  byRetrievalBucket: table(nonPass.concat(infra), (r) => r.retrievalBucket),
  infra: infra.map((r) => ({ taskId: r.taskId, prompt: r.prompt, error: r.extras.infrastructureError ?? r.detail })),
  criticals: criticals.map((r) => ({
    taskId: r.taskId,
    category: r.category,
    classification: r.classification,
    prompt: r.prompt,
    answer: r.answer,
    evidenceState: r.evidenceState,
    citations: r.citations,
    detail: r.detail,
  })),
  samples: { pass: passes, needs_work: needs, fail: fails },
  metrics: {
    caseQaPass: rate(metricSets.caseQa, (r) => r.verdict === "pass"),
    citationPass: rate(metricSets.citation, (r) => r.verdict === "pass"),
    abstentionAccuracy: rate(metricSets.abstain, (r) => r.verdict === "pass"),
    failedAbstention: rate(metricSets.abstain, (r) => r.verdict === "fail"),
    falseRefusal: rate(
      scored.filter((r) => r.expectationType !== "must_abstain" && r.expectationType !== "challenge_premise"),
      (r) => r.classification === "FALSE_REFUSAL",
    ),
    falsePremiseAccept: rate(metricSets.falsePremise, (r) => r.verdict === "fail"),
    amendmentAccuracy: rate(metricSets.supersession, (r) => r.verdict === "pass"),
    materialChangeAccuracy: rate(metricSets.material, (r) => r.verdict === "pass"),
    decoyFalsePositive: rate(metricSets.decoy, (r) => r.verdict !== "pass"),
    contradictionAccuracy: rate(metricSets.contradiction, (r) => r.verdict === "pass"),
    falseContradictionRate: rate(metricSets.falseContradiction, (r) => r.verdict === "fail"),
    timelineAccuracy: rate(metricSets.timeline, (r) => r.verdict === "pass"),
    numericAccuracy: rate(metricSets.numeric, (r) => r.verdict === "pass"),
  },
  strongestAdversarialPasses: scored
    .filter(
      (r) =>
        r.verdict === "pass" &&
        ["adversarial", "hard"].includes(
          // difficulty not on answer; use category
          r.category,
        ) === false &&
        ["insufficient", "missing_exhibit", "adversarial", "quote_accuracy", "false_contradiction", "contract_decoy"].includes(
          r.category,
        ),
    )
    .slice(0, 40)
    .map((r) => ({ taskId: r.taskId, category: r.category, prompt: r.prompt, answer: r.answer.slice(0, 280) })),
};

writeFileSync("benchmarks/nyaya-bench/reports/baseline-analysis.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({
  overall: output.overall,
  byCategory: output.byCategory,
  byExpectation: output.byExpectation,
  byClassification: output.byClassification,
  bySeverity: output.bySeverity,
  byRetrievalBucket: output.byRetrievalBucket,
  metrics: output.metrics,
  infraCount: output.infra.length,
  criticalCount: output.criticals.length,
  sampleIds: {
    pass: passes.map((r) => r.taskId),
    needs: needs.map((r) => r.taskId),
    fail: fails.map((r) => r.taskId),
  },
  infraIds: output.infra.map((r) => r.taskId),
}, null, 2));
