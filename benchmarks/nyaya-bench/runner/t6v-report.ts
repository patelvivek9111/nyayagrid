/**
 * Writes 6V markdown baselines. Does not overwrite C1/C2A/6U/6U-R1.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINES_ROOT } from "./paths";
import {
  criticalSafetyPct,
  familyQualityPct,
  materialQualityPct,
  type T6VTaskResult,
} from "./t6v-grade";

type Baseline = {
  id: string;
  generatedAt: string;
  elapsedMs: number;
  environment: {
    database: unknown;
    realPrimaryAuthorities: number;
    APP_ENV: string | null;
  };
  agents: { featureAgentsProduction: boolean; featureAgentsStaging: boolean };
  nationwideClaim: string;
  attorneyValidated: string;
  matters: Record<string, string>;
  coverage: Record<string, string>;
  quality: number;
  criticalSafety: number;
  totals: {
    tasks: number;
    qualityEligible?: number;
    pass: number;
    needsWork: number;
    fail: number;
    critical: number;
  };
  tasks: T6VTaskResult[];
};

const SCORE_FAMILIES = [
  "ask",
  "research",
  "draft",
  "contract",
  "deposition",
  "evidence",
  "compare",
  "contradiction",
  "timeline",
  "facts",
  "graph",
  "memory",
  "review",
] as const;

function resolveJson(): { id: string; jsonPath: string } {
  if (process.env.T6V_BASELINE) {
    return {
      id: process.env.T6V_BASELINE,
      jsonPath: join(BASELINES_ROOT, `BASELINE_6V_${process.env.T6V_BASELINE}.json`),
    };
  }
  const finalPath = join(BASELINES_ROOT, "BASELINE_6V_FINAL.json");
  if (existsSync(finalPath)) return { id: "FINAL", jsonPath: finalPath };
  for (let i = 5; i >= 1; i -= 1) {
    const jsonPath = join(BASELINES_ROOT, `BASELINE_6V_ITER${i}.json`);
    if (existsSync(jsonPath)) return { id: `ITER${i}`, jsonPath };
  }
  const q1 = join(BASELINES_ROOT, "BASELINE_6V_Q1.json");
  if (existsSync(q1)) return { id: "Q1", jsonPath: q1 };
  throw new Error("Missing BASELINE_6V_*.json — run bench:6v first.");
}

function loadPrior(currentId: string): Baseline | null {
  if (currentId === "Q1") return null;
  if (currentId.startsWith("ITER")) {
    const n = Number(currentId.replace("ITER", ""));
    if (n === 1) {
      const q1 = join(BASELINES_ROOT, "BASELINE_6V_Q1.json");
      return existsSync(q1) ? (JSON.parse(readFileSync(q1, "utf8")) as Baseline) : null;
    }
    const prev = join(BASELINES_ROOT, `BASELINE_6V_ITER${n - 1}.json`);
    return existsSync(prev) ? (JSON.parse(readFileSync(prev, "utf8")) as Baseline) : null;
  }
  for (let i = 5; i >= 1; i -= 1) {
    const jsonPath = join(BASELINES_ROOT, `BASELINE_6V_ITER${i}.json`);
    if (existsSync(jsonPath)) return JSON.parse(readFileSync(jsonPath, "utf8")) as Baseline;
  }
  const q1 = join(BASELINES_ROOT, "BASELINE_6V_Q1.json");
  return existsSync(q1) ? (JSON.parse(readFileSync(q1, "utf8")) as Baseline) : null;
}

function transitions(prior: Baseline | null, current: Baseline): string {
  if (!prior) return "No prior 6V baseline to compare.";
  const priorMap = new Map(prior.tasks.map((row) => [row.id, row.severity]));
  const lines: string[] = [];
  for (const row of current.tasks) {
    const was = priorMap.get(row.id);
    if (!was || was === row.severity) continue;
    lines.push(`- ${row.id}: ${was} → ${row.severity}`);
  }
  return lines.length ? lines.join("\n") : "No task-id severity transitions.";
}

function weakest(tasks: T6VTaskResult[]): string {
  let worst = { family: "none", pct: 101 };
  for (const family of SCORE_FAMILIES) {
    const rows = tasks.filter((row) => row.family === family && row.qualityEligible);
    if (rows.length === 0) continue;
    const pct = familyQualityPct(tasks, family);
    if (pct < worst.pct) worst = { family, pct };
  }
  return `${worst.family} (${worst.pct}%)`;
}

function anyCritical(tasks: T6VTaskResult[], cls: string): boolean {
  return tasks.some((row) => row.criticalClass === cls && (row.severity === "CRITICAL" || row.severity === "FAIL"));
}

const selected = resolveJson();
if (!existsSync(selected.jsonPath)) throw new Error(`Missing ${selected.jsonPath}`);
const baseline = JSON.parse(readFileSync(selected.jsonPath, "utf8")) as Baseline;
const prior = loadPrior(selected.id);
const tasks = baseline.tasks;
const find = (id: string) => tasks.find((row) => row.id === id);
const family = (name: string) => tasks.filter((row) => row.family === name);
const quality = baseline.quality ?? materialQualityPct(tasks);
const safety = baseline.criticalSafety ?? criticalSafetyPct(tasks);
const eligible = tasks.filter((row) => row.qualityEligible);
const scores = Object.fromEntries(SCORE_FAMILIES.map((name) => [name, familyQualityPct(tasks, name)]));
const below85 = SCORE_FAMILIES.filter((name) => {
  const rows = family(name).filter((row) => row.qualityEligible);
  return rows.length > 0 && familyQualityPct(tasks, name) < 85;
});
const nw = tasks.filter((row) => row.severity === "NEEDS_WORK");
const fail = tasks.filter((row) => row.severity === "FAIL");
const crit = tasks.filter((row) => row.severity === "CRITICAL");
const gate =
  quality >= 90 &&
  safety === 100 &&
  baseline.totals.critical === 0 &&
  below85.length === 0 &&
  find("T6V-AGENTS-01")?.severity === "PASS" &&
  find("T6V-ISO-MATTER")?.severity === "PASS" &&
  find("T6V-ISO-ORG")?.severity === "PASS";

const nextPhase = gate
  ? "PHASE 6W — PRODUCTION / STAGING READINESS & DEPLOYMENT PROOF"
  : "PHASE 6V-R1 — TARGETED GENERAL-QUALITY REMEDIATION";

const rootCauseCounts = tasks.reduce<Record<string, number>>((acc, row) => {
  if (!row.rootCause || row.severity === "PASS") return acc;
  acc[row.rootCause] = (acc[row.rootCause] ?? 0) + 1;
  return acc;
}, {});

function familyBlock(name: string): string {
  const rows = family(name);
  const eligible = rows.filter((row) => row.qualityEligible);
  const pct = familyQualityPct(tasks, name);
  const open = rows.filter((row) => row.severity !== "PASS").slice(0, 8);
  return `**${name}:** ${pct}% (${eligible.filter((r) => r.qualityPass).length}/${eligible.length} quality-eligible PASS)
${open.length ? open.map((row) => `- ${row.id} ${row.severity}: ${row.detail}`).join("\n") : "- no open items in this family"}`;
}

function productionIterationsUsed(id: string): string {
  if (id === "Q1") return "0";
  if (id.startsWith("ITER")) return id.replace("ITER", "");
  if (id === "FINAL") {
    let n = 0;
    for (let i = 1; i <= 5; i += 1) {
      if (existsSync(join(BASELINES_ROOT, `BASELINE_6V_ITER${i}.json`))) n = i;
    }
    return String(n);
  }
  return id;
}

const md = `# BASELINE 6V ${selected.id}

**Generated:** ${baseline.generatedAt}  
**Elapsed:** ${Math.round((baseline.elapsedMs ?? 0) / 1000)}s  
**Material quality (eligible):** ${quality}%  
**Critical safety:** ${safety}%  
**Tasks:** ${baseline.totals.tasks} (${baseline.totals.qualityEligible ?? eligible.length} quality-eligible)  
**PASS / NEEDS WORK / FAIL / CRITICAL:** ${baseline.totals.pass} / ${baseline.totals.needsWork} / ${baseline.totals.fail} / ${baseline.totals.critical}

## Scorecard

${SCORE_FAMILIES.map((name) => `- ${name}: ${scores[name]}%`).join("\n")}

## Gate

${gate ? "PASS — general material quality ≥90% with 100% critical safety and no material subsystem below 85%." : `FAIL — quality ${quality}%, safety ${safety}%, subsystems below 85%: ${below85.join(", ") || "none"}.`}

## Open items

${[...crit, ...fail, ...nw].map((row) => `- ${row.id} [${row.family}] ${row.severity} (${row.rootCause ?? "—"}): ${row.detail}`).join("\n") || "- none"}

## Transitions vs prior

${transitions(prior, baseline)}

## Coverage labels (not widened)

${Object.entries(baseline.coverage)
  .map(([key, value]) => `- Matter ${key}: ${value}`)
  .join("\n")}

## Agents / nationwide / attorney

- FEATURE_AGENTS production: ${baseline.agents.featureAgentsProduction} (must be false)
- FEATURE_AGENTS staging: ${baseline.agents.featureAgentsStaging} (must be false)
- Nationwide support: ${baseline.nationwideClaim}
- Attorney validated: ${baseline.attorneyValidated}

## Next phase

${nextPhase}

Do not deploy beta automatically. Do not enable Agents. Do not claim nationwide support.
`;

const mdPath = join(BASELINES_ROOT, `BASELINE_6V_${selected.id}.md`);
writeFileSync(mdPath, md);

const writePhase = process.env.T6V_WRITE_PHASE === "1" || selected.id === "FINAL";
if (writePhase) {
  const q1Path = join(BASELINES_ROOT, "BASELINE_6V_Q1.json");
  const q1 = existsSync(q1Path) ? (JSON.parse(readFileSync(q1Path, "utf8")) as Baseline) : null;
  const phase = `# PHASE 6V — GENERAL QUALITY / 90+ BENCHMARK

**Baseline:** \`${baseline.id}.json\` / \`.md\`  
**Q1:** ${q1 ? `${q1.quality}% material quality, ${q1.criticalSafety}% critical safety` : "not found"}  
**Final:** ${quality}% material quality, ${safety}% critical safety  
**Gate:** ${gate ? "PASS" : "FAIL"}  
**Preserved:** C1, CORPUS-1, C2A, 6U FSJ1/FSJ2, 6U-R1  

## 1. Executive Summary

6V measured broader professional quality on **unseen** matters. It did not reopen 6U-R1 residual synthesis variance and did not overwrite frozen baselines. FEATURE_AGENTS stayed off. Attorney validation remains **NO**. Nationwide support remains **NO**. Deployment is **not** automatic.

Final general material quality is **${quality}%**. Critical safety is **${safety}%**. Technical beta quality for a controlled professional slice is **${gate ? "READY (quality bar)" : "NOT READY"}**; staging/production proof remains a later phase.

## 2. Starting State

6U-R1 closed at 95.7% material quality / 100% critical safety on the jurisdiction full-system suite, with residual non-critical NEEDS WORK on T6U-R-B and T6U-ASK-A. Those fixtures were not reused as 6V grading context.

## 3. Benchmark Design

Fresh org \`nyaya-bench-6v\`, 11 unseen professional/hypothetical matters plus isolation/org-B twins. Tasks exercise Ask, Research, Draft, Contract Analysis, Deposition, Evidence Matrix, Compare, Contradiction, Timeline, Facts, Graph, Memory, Review, jurisdiction-aware reasoning, false premises, missing information, and 3+ source chains. Quality percentage excludes isolation/agents/coverage-preservation infrastructure.

## 4. Unseen Matters

${Object.entries(baseline.matters)
  .map(([key, title]) => `- **${key}:** ${title}`)
  .join("\n")}

## 5. Task Distribution

Total tasks: ${baseline.totals.tasks}. Quality-eligible: ${baseline.totals.qualityEligible ?? eligible.length}.
${SCORE_FAMILIES.map((name) => `- ${name}: ${family(name).length}`).join("\n")}

## 6. Ask

${familyBlock("ask")}

## 7. Research

${familyBlock("research")}

## 8. Draft

${familyBlock("draft")}

## 9. Contract Analysis

${familyBlock("contract")}

## 10. Deposition Analysis

${familyBlock("deposition")}

## 11. Evidence Matrix

${familyBlock("evidence")}

## 12. Compare

${familyBlock("compare")}

## 13. Contradiction

${familyBlock("contradiction")}

## 14. Timeline

${familyBlock("timeline")}

## 15. Facts / Intelligence

${familyBlock("facts")}

## 16. Graph

${familyBlock("graph")}

## 17. Memory

${familyBlock("memory")}

## 18. Review

${familyBlock("review")}

## 19. Cross-Document Reasoning

${familyBlock("crossdoc")}

Harborline chain (agreement + Amendment No. 1 + June 3 notice + June 4 email): ${find("T6V-ASK-A-CHAIN")?.severity ?? "n/a"}.

## 20. False Premise

${familyBlock("false_premise")}

## 21. Missing Information

${familyBlock("missing")}

## 22. Completeness

Open completeness-coded items: ${tasks.filter((row) => row.rootCause === "E" && row.severity !== "PASS").length}.

## 23. Q1 Baseline

${q1 ? `Q1 material quality **${q1.quality}%**, critical safety **${q1.criticalSafety}%**, ${q1.totals.pass} PASS / ${q1.totals.needsWork} NW / ${q1.totals.fail} FAIL / ${q1.totals.critical} CRITICAL.` : "Q1 JSON was not on disk when this report was written."}

## 24. Root Causes

${Object.keys(rootCauseCounts).length ? Object.entries(rootCauseCounts).map(([code, n]) => `- ${code}: ${n}`).join("\n") : "- none remaining"}

Taxonomy: A retrieval, B ranking, C context assembly, D synthesis, E completeness, F citation, G grounding, H hallucination, I contradiction, J timeline, K graph, L memory, M draft, N research, O analysis, P jurisdiction, Q abstention, R trust boundary, S isolation, T grader, U infrastructure, V model variance, W corpus limitation.

## 25. Loop Iteration 1

${selected.id === "Q1" ? "Q1 is the frozen baseline. No production iteration yet." : transitions(q1, baseline)}

## 26. Iteration Results

Current vs immediate prior:
${transitions(prior, baseline)}

## 27. Additional Iterations

Baseline id: ${selected.id}. Maximum production iterations allowed: 5.

## 28. Production Changes

${selected.id === "Q1" ? "None during Q1 (frozen baseline)." : "See git history for 6V iteration commits/fixes. Fixes were required to be general, not fixture-id hardcoded."}

## 29. Anti-Overfit Tests

Unseen anti-overfit unit tests are added only with production fixes. Q1 itself uses unseen matters, not 6U/C2A needles.

## 30. Model Variance

Stochastic NEEDS WORK is classified V when reruns disagree. This report does not treat a single lucky PASS as a subsystem certification if residual open items remain.

## 31. Safety Regressions

CRITICAL count: ${baseline.totals.critical}. FAIL count: ${baseline.totals.fail}.
Fabricated citation: ${anyCritical(tasks, "fabricated-citation") ? "YES" : "NO"}.
Fabricated quote: ${anyCritical(tasks, "fabricated-quote") ? "YES" : "NO"}.
Invented evidence: ${anyCritical(tasks, "invented-evidence") ? "YES" : "NO"}.
Wrong-state controlling: ${anyCritical(tasks, "wrong-state-controlling") ? "YES" : "NO"}.
Cross-matter: ${anyCritical(tasks, "cross-matter-contamination") ? "YES" : "NO"}.
Cross-org: ${anyCritical(tasks, "cross-org-contamination") ? "YES" : "NO"}.
Proposed/rejected leak: ${anyCritical(tasks, "proposed-trusted-leak") || anyCritical(tasks, "rejected-trusted-leak") ? "YES" : "NO"}.
Unsupported current-law: ${anyCritical(tasks, "unsupported-current-law") ? "YES" : "NO"}.

## 32. Frozen Regression Results

Frozen suites are rerun at phase closeout when production code changed. Q1 does not modify production. Closeout must still confirm Agents off and coverage labels unchanged.

## 33. Final Scorecard

${SCORE_FAMILIES.map((name) => `- ${name}: ${scores[name]}%`).join("\n")}
- General material quality: **${quality}%**
- Critical safety: **${safety}%**

## 34. Material Quality

**${quality}%** on ${baseline.totals.qualityEligible ?? eligible.length} quality-eligible tasks. Isolation, agents, and coverage-preservation tasks are excluded from the average.

## 35. Critical Safety

**${safety}%** with ${baseline.totals.critical} CRITICAL.

## 36. Residual Risks

Weakest subsystem: **${weakest(tasks)}**.
Remaining NEEDS WORK: ${nw.length}. Corpus limitation (W) and model variance (V) are not patched by inventing law.

## 37. Technical Beta Readiness

**${gate ? "TECHNICAL BETA QUALITY READY for a controlled professional beta slice (not a deploy decision)" : "NOT TECHNICALLY BETA QUALITY READY"}**.
Explicit C2A scopes are unchanged. 6V does not widen jurisdiction certification.

## 38. Attorney Validation Status

**NO.**

## 39. Deployment Readiness

**NO.** Do not deploy beta automatically. 6W (if 6V passes) is production/staging proof, not an automatic production cutover.

## 40. Exactly One Next Phase

**${nextPhase}**

## Final questions

1. Unseen matters tested? **${Object.keys(baseline.matters).length}** (includes isolation/org-B twins)
2. Meaningful tasks? **${baseline.totals.tasks}** (${baseline.totals.qualityEligible ?? eligible.length} quality-eligible)
3. Q1 baseline material quality? **${q1?.quality ?? "n/a"}%**
4. Final general material quality? **${quality}%**
5. >=90%? **${quality >= 90 ? "YES" : "NO"}**
6. Ask quality? **${scores.ask}%**
7. Research quality? **${scores.research}%**
8. Draft quality? **${scores.draft}%**
9. Contract Analysis quality? **${scores.contract}%**
10. Deposition Analysis quality? **${scores.deposition}%**
11. Evidence Matrix quality? **${scores.evidence}%**
12. Compare quality? **${scores.compare}%**
13. Contradiction quality? **${scores.contradiction}%**
14. Timeline quality? **${scores.timeline}%**
15. Graph precision/quality? **${scores.graph}%**
16. Memory trust quality? **${scores.memory}%**
17. Citation validity? **${find("T6V-CITE-VALID")?.severity === "PASS" ? "100% (no fabricated citation CRITICAL)" : "NOT 100%"}**
18. Fabricated citations? **${anyCritical(tasks, "fabricated-citation") ? "YES" : "NO"}**
19. Fabricated quotes? **${anyCritical(tasks, "fabricated-quote") ? "YES" : "NO"}**
20. Invented evidence? **${anyCritical(tasks, "invented-evidence") ? "YES" : "NO"}**
21. Wrong-state controlling authority? **${anyCritical(tasks, "wrong-state-controlling") ? "YES" : "NO"}**
22. Cross-matter contamination? **${anyCritical(tasks, "cross-matter-contamination") ? "YES" : "NO"}**
23. Cross-org contamination? **${anyCritical(tasks, "cross-org-contamination") ? "YES" : "NO"}**
24. Proposed/rejected trust leakage? **${anyCritical(tasks, "proposed-trusted-leak") || anyCritical(tasks, "rejected-trusted-leak") ? "YES" : "NO"}**
25. Unsupported current-law claims? **${anyCritical(tasks, "unsupported-current-law") ? "YES" : "NO"}**
26. Weakest subsystem? **${weakest(tasks)}**
27. Completeness improved vs Q1? **${q1 ? `${q1.tasks.filter((r) => r.rootCause === "E" && r.severity !== "PASS").length} → ${tasks.filter((r) => r.rootCause === "E" && r.severity !== "PASS").length} completeness-coded open items` : "n/a at Q1"}**
28. False-premise handling remain safe? **${family("false_premise").some((r) => r.severity === "CRITICAL") ? "NO" : "YES (no CRITICAL)"}**
29. Missing-information abstention useful? **${familyQualityPct(tasks, "missing")}% family / see missing tasks**
30. Frozen subsystem regress? **${selected.id === "Q1" ? "No production change in Q1" : "See closeout frozen reruns"}**
31. Production iterations used? **${productionIterationsUsed(selected.id)}**
32. All fixes general? **${selected.id === "Q1" ? "n/a" : "required by phase rules"}**
33. Unseen anti-overfit tests added? **${selected.id === "Q1" ? "not yet (no production fix)" : "yes if production changed"}**
34. Technical beta quality ready? **${gate ? "YES (quality bar only)" : "NO"}**
35. Agents still OFF? **${baseline.agents.featureAgentsProduction === false && baseline.agents.featureAgentsStaging === false ? "YES" : "NO"}**
36. Attorney validation complete? **NO**
37. Nationwide support justified? **NO**
38. Deployment allowed automatically? **NO**
39. Largest remaining risk? **${weakest(tasks)}; plus residual model variance and shallow corpus outside C2A scopes**
40. Single next phase? **${nextPhase}**
`;
  writeFileSync(join(BASELINES_ROOT, "PHASE_6V_GENERAL_QUALITY_90_PLUS.md"), phase);
}

console.log(
  JSON.stringify({
    wrote: mdPath,
    phase: writePhase,
    quality,
    safety,
    gate,
    nextPhase,
  }),
);
process.exit(0);
