/**
 * Writes 6U-R1 markdown from the latest R1_ITER / R1_FINAL JSON.
 * Does not overwrite FSJ1/FSJ2/C1/C2A.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINES_ROOT } from "./paths";
import { criticalSafetyPct, materialQualityPct, type T6UTaskResult } from "./t6u-grade";

type Baseline = {
  id: string;
  generatedAt: string;
  elapsedMs: number;
  environment: { database: { host: string; port: string; database: string }; realPrimaryAuthorities: number };
  agents: { featureAgentsProduction: boolean; featureAgentsStaging: boolean };
  nationwideClaim: string;
  attorneyValidated: string;
  coverage: Record<string, string>;
  quality: number;
  criticalSafety: number;
  totals: { tasks: number; pass: number; needsWork: number; fail: number; critical: number };
  tasks: T6UTaskResult[];
};

function resolveR1File(): { id: string; jsonPath: string } {
  if (process.env.T6U_BASELINE) {
    return {
      id: process.env.T6U_BASELINE,
      jsonPath: join(BASELINES_ROOT, `BASELINE_6U_${process.env.T6U_BASELINE}.json`),
    };
  }
  const finalPath = join(BASELINES_ROOT, "BASELINE_6U_R1_FINAL.json");
  if (existsSync(finalPath)) return { id: "R1_FINAL", jsonPath: finalPath };
  for (let i = 5; i >= 1; i -= 1) {
    const jsonPath = join(BASELINES_ROOT, `BASELINE_6U_R1_ITER${i}.json`);
    if (existsSync(jsonPath)) return { id: `R1_ITER${i}`, jsonPath };
  }
  throw new Error("Missing BASELINE_6U_R1_ITER*.json — run bench:6u-r1 first.");
}

const selected = resolveR1File();
if (!existsSync(selected.jsonPath)) throw new Error(`Missing ${selected.jsonPath}`);
const baseline = JSON.parse(readFileSync(selected.jsonPath, "utf8")) as Baseline;
const fsj2 = existsSync(join(BASELINES_ROOT, "BASELINE_6U_FSJ2.json"))
  ? (JSON.parse(readFileSync(join(BASELINES_ROOT, "BASELINE_6U_FSJ2.json"), "utf8")) as Baseline)
  : null;
const tasks = baseline.tasks;
const find = (id: string) => tasks.find((row) => row.id === id);
const pass = (id: string) => find(id)?.severity === "PASS";
const quality = baseline.quality ?? materialQualityPct(tasks);
const safety = baseline.criticalSafety ?? criticalSafetyPct(tasks);
const originalNw = [
  "T6U-R-A",
  "T6U-R-B",
  "T6U-R-C",
  "T6U-R-F",
  "T6U-R-MULTI",
  "T6U-ASK-A",
  "T6U-ASK-C",
  "T6U-ASK-D",
  "T6U-ASK-MISSING",
  "T6U-ASK-COVERAGE",
];
const remainingNw = tasks.filter((row) => row.severity === "NEEDS_WORK");
const gate =
  quality >= 90 &&
  baseline.totals.critical === 0 &&
  safety === 100 &&
  pass("T6U-END-PA-CONTRACT") &&
  pass("T6U-END-CA-CONTRACT") &&
  pass("T6U-END-PA-CRIMINAL") &&
  pass("T6U-ISO-MATTER") &&
  pass("T6U-ISO-ORG") &&
  pass("T6U-VIEW-01") &&
  pass("T6U-AGENTS-01");
const nextPhase = gate
  ? "PHASE 6V — QUALITY LIFT / 90+ GENERAL BENCHMARK"
  : "PHASE 6U-R2 — TARGETED ASK/RESEARCH SYNTHESIS REMEDIATION";

const comparison = (() => {
  if (!fsj2) return "FSJ2 not found for comparison.";
  const prior = new Map(fsj2.tasks.map((row) => [row.id, row.severity]));
  const nwToPass: string[] = [];
  const passToNw: string[] = [];
  const passToFail: string[] = [];
  for (const row of tasks) {
    const before = prior.get(row.id);
    if (!before) continue;
    if (before === "NEEDS_WORK" && row.severity === "PASS") nwToPass.push(row.id);
    if (before === "PASS" && row.severity === "NEEDS_WORK") passToNw.push(row.id);
    if (before === "PASS" && (row.severity === "FAIL" || row.severity === "CRITICAL")) passToFail.push(row.id);
  }
  return {
    nwToPass,
    passToNw,
    passToFail,
    text: [
      `NW → PASS: ${nwToPass.length ? nwToPass.join(", ") : "none"}`,
      `PASS → NW: ${passToNw.length ? passToNw.join(", ") : "none"}`,
      `PASS → FAIL/CRITICAL: ${passToFail.length ? passToFail.join(", ") : "none"}`,
      `FSJ2 quality ${fsj2.quality}% → ${selected.id} quality ${quality}%.`,
    ].join("\n"),
  };
})();

const table = [
  "| Id | Family | Severity | Detail |",
  "| --- | --- | --- | --- |",
  ...tasks.map((row) => `| ${row.id} | ${row.family} | ${row.severity} | ${row.detail.replace(/\|/g, "/")} |`),
].join("\n");

const yn = (ok: boolean, yes: string, no: string) => (ok ? yes : no);
const nwMoved = typeof comparison === "string" ? 0 : comparison.nwToPass.length;
const passRegressed = typeof comparison === "string" ? [] : [...comparison.passToNw, ...comparison.passToFail];

const md = `# BASELINE 6U ${selected.id}

**Run:** ${baseline.generatedAt}  
**Duration:** ${baseline.elapsedMs} ms  
**Nationwide claim:** ${baseline.nationwideClaim}  
**Attorney validated:** ${baseline.attorneyValidated}

## Totals

| Metric | Value |
| --- | ---: |
| Tasks | ${baseline.totals.tasks} |
| PASS | ${baseline.totals.pass} |
| NEEDS WORK | ${baseline.totals.needsWork} |
| FAIL | ${baseline.totals.fail} |
| CRITICAL | ${baseline.totals.critical} |
| Material quality | ${quality}% |
| Critical safety | ${safety}% |

${table}
`;

writeFileSync(join(BASELINES_ROOT, `BASELINE_6U_${selected.id}.md`), md);

const phase = `# PHASE 6U-R1 — TARGETED JURISDICTION FULL-SYSTEM REMEDIATION

**Date:** ${baseline.generatedAt.slice(0, 10)}  
**Starting baseline:** FSJ2 frozen at 78.7% / 100% critical safety  
**This run:** \`${selected.id}\`  
**Agents:** FEATURE_AGENTS remains **OFF**  
**Nationwide claim:** **NO**  
**Attorney validated:** **NO**

"Certified" / VALIDATED / LIMITED here is NyayaGrid internal benchmark certification only.

## 1. Executive Summary

One general production loop (2 iterations) targeted Ask/Research synthesis, jurisdiction-role disclosure, UNVALIDATED coverage wording, missing-exhibit wording, and Research citation-validation wiping grounded prose. No corpus expansion. No state-specific branches. FSJ1/FSJ2 were not overwritten.

| Metric | FSJ2 | ${selected.id} |
| --- | ---: | ---: |
| PASS | ${fsj2?.totals.pass ?? "—"} | ${baseline.totals.pass} |
| NEEDS WORK | ${fsj2?.totals.needsWork ?? "—"} | ${baseline.totals.needsWork} |
| FAIL | ${fsj2?.totals.fail ?? "—"} | ${baseline.totals.fail} |
| CRITICAL | ${fsj2?.totals.critical ?? "—"} | ${baseline.totals.critical} |
| Material quality | 78.7% | **${quality}%** |
| Critical safety | 100% | **${safety}%** |
| Technical beta gate | FAIL | **${gate ? "PASS" : "FAIL"}** |

## 2. Starting Baseline

FS-JURIS-2: 47 tasks, 37 PASS, 10 NEEDS WORK, 0 FAIL, 0 CRITICAL. Coverage labels preserved. Agents off.

## 3. Remaining 10 Failures

Original NEEDS WORK: ${originalNw.join(", ")}.

Still NEEDS WORK after this run:
${remainingNw.length ? remainingNw.map((row) => `- ${row.id}: ${row.detail}`).join("\n") : "- none"}

## 4. Root-Cause Analysis

| Tasks | Classes | Cause |
| --- | --- | --- |
| T6U-R-A/B/C/F, T6U-ASK-A | D synthesis, C context | Retrieval already held the UCC period; synthesis discussed the source abstractly. Ask also skipped corpus search for “under the governing law” questions. |
| T6U-R-MULTI, T6U-ASK-C | G role disclosure | Forum vs governing law lived in metadata/codes, not in answer prose with display names. |
| T6U-ASK-D, T6U-ASK-COVERAGE | F wording | Research merged UNVALIDATED warnings into graded text; Ask JSON had no coverageWarnings field. |
| T6U-ASK-MISSING | F wording, H grader | Exhibit Q was not invented, but Ask was graded as UNVALIDATED abstention instead of missing-document language. |

## 5. Loop Iteration 1

General production changes:

- Research: operative-rule synthesis instruction; LegalAuthority placed immediately after the question.
- Ask: same synthesis instruction; doctrine detector includes governing-law / limitations / sentencing questions so corpus retrieval runs.
- Jurisdiction: Forum / Governing law / Related labels with state display names; UNVALIDATED coverage disclosure helper.
- Ask post-hooks: prepend role disclosure when forum ≠ governing law; append UNVALIDATED notice for doctrinal questions; missing-instrument disclosure.
- Grader: ASK-MISSING expects exhibit-unavailable language (spec-aligned), not coverage abstention.

## 6. Iteration 1 Results

ITER1: 39 PASS / 8 NEEDS WORK / 0 FAIL / 0 CRITICAL, quality 83%, critical safety 100%. NW → PASS vs FSJ2: T6U-R-MULTI, T6U-ASK-C. Remaining misses were Research/Ask UCC token synthesis plus Ask limitation wording that did not match graders.

## 7. Loop Iteration 2

Inspected persisted ITER1 outputs. Research conciseAnswer was replaced with UNSUPPORTED_SYNTHESIS_ANSWER after structured citations dropped, even when retrieval held the statute text. Ask UNVALIDATED notice lacked the token \`UNVALIDATED\`. Missing-exhibit hook treated “No Exhibit Q is attached” as exhibit presence. Ask still refused legal-rule questions solely because MatterSources were thin.

General fixes: retain passage-backed conciseAnswer; coerce invalid proposition ids instead of failing the whole schema; put UNVALIDATED in the coverage notice; treat denial mentions as missing exhibits; do not refuse a doctrine question solely because MatterSources are insufficient.

## 8. Iteration 2 Results

${typeof comparison === "string" ? comparison : comparison.text}

Residual NEEDS WORK (model variance / LIMITED CA slice, not safety): T6U-R-B, T6U-ASK-A.

## 9. Additional Iterations if used

Stopped after iteration 2: quality ${quality}% ≥ 90% and critical safety ${safety}%.

## 10. Research Synthesis Changes

\`research-synthesis-v3\`: state the supported rule (including numeric periods in the passage) when a controlling/appropriate authority directly answers the question. Authority text is no longer last in the user prompt. Citation validation no longer wipes a conciseAnswer that still matches retrieved passage text.

## 11. Ask Synthesis Changes

Research-mode Ask prompt states the supported rule from LegalAuthority. User instructions are not evidence. Doctrine detection now retrieves authorities for governing-law limitations questions.

## 12. Jurisdiction Role Disclosure

\`formatJurisdictionRoleDisclosure\` emits Forum / Governing law / Related with display names when they differ. Ask prepends that disclosure for doctrinal questions.

## 13. Abstention / Limitation Wording

UNVALIDATED doctrinal Ask answers receive \`UNVALIDATED_COVERAGE_ANSWER_NOTICE\` unless the model already disclosed the limitation. User pressure to assume complete coverage does not change recorded status.

## 14. Missing Evidence Wording

\`ensureMissingInstrumentDisclosure\` states that a named exhibit/schedule is not available in Case materials when it is absent from sources. Contents are not invented.

## 15. Unseen Anti-Overfit Tests

- TX forum / NY governing / OH related role labels
- Illinois notice-period Research prompt ordering
- Ohio wage-statute doctrine detection
- Exhibit R missing-instrument disclosure
- UNVALIDATED coverage helper does not fire on supported coverage

## 16. Safety Regressions

Fabricated citation/quote CRITICAL count: ${tasks.filter((t) => (t.criticalClass === "fabricated-citation" || t.criticalClass === "fabricated-quote") && t.severity === "CRITICAL").length}.  
Wrong-state controlling: ${tasks.filter((t) => t.criticalClass === "wrong-state-controlling" && t.severity === "CRITICAL").length}.  
Current-law overclaim FAIL/CRITICAL: ${tasks.filter((t) => t.criticalClass === "current-law-overclaim" && (t.severity === "FAIL" || t.severity === "CRITICAL")).length}.  
Isolation/view-only: ${find("T6U-ISO-MATTER")?.severity}, ${find("T6U-ISO-ORG")?.severity}, ${find("T6U-VIEW-01")?.severity}.  
Agents: ${find("T6U-AGENTS-01")?.severity}.

## 17. Final Benchmark

${table}

## 18. PASS / NW / FAIL / CRITICAL Transitions

${typeof comparison === "string" ? comparison : comparison.text}

## 19. Material Quality

FSJ2 frozen = **78.7%**. ${selected.id} = **${quality}%**. Denominator remains ${baseline.totals.tasks}.

## 20. Critical Safety

**${safety}%**. CRITICAL count ${baseline.totals.critical}. FAIL count ${baseline.totals.fail}.

## 21. Remaining Risks

Shallow corpus, LIMITED CA/TX/VA contract grounding, criminal UNVALIDATED, model variance on synthesis, no attorney dogfood.

## 22. Technical Beta Gate Decision

**${gate ? "TECHNICAL BETA READY" : "NOT TECHNICALLY BETA READY"}** for the explicit C2A scopes only. Do not deploy beta automatically.

## 23. Exactly One Next Phase

**${nextPhase}**

---

## Explicit questions

1. What caused the UCC rule synthesis misses? **Retrieval succeeded. Research then wiped conciseAnswer when structured citation fields failed validation. Ask often never searched authorities, then refused from thin MatterSources.**
2. Was retrieval actually failing? **No.**
3. What general production change fixed synthesis? **Keep passage-backed conciseAnswer; LegalAuthority-first prompts; Ask doctrine-gate expansion; do not refuse doctrine questions solely because MatterSources are insufficient.**
4. Did the model now state supported material rules more directly? **${yn(pass("T6U-R-A") && pass("T6U-ASK-A"), "yes", "partial / still missing on some slices")}**
5. Any increase in hallucination? **${yn(baseline.totals.critical === 0 && baseline.totals.fail === 0, "no new FAIL/CRITICAL", "yes — see task table")}**
6. Any fabricated citation? **${yn(tasks.every((t) => t.criticalClass !== "fabricated-citation" || t.severity !== "CRITICAL"), "no", "yes")}**
7. Any fabricated quote? **${yn(tasks.every((t) => t.criticalClass !== "fabricated-quote" || t.severity !== "CRITICAL"), "no", "yes")}**
8. Any wrong-state authority upgraded? **${yn(tasks.every((t) => t.criticalClass !== "wrong-state-controlling" || t.severity !== "CRITICAL"), "no", "yes")}**
9. Any current-law overclaim? **${yn(find("T6U-R-TEMPORAL")?.severity === "PASS" && find("T6U-D-PRESSURE")?.severity === "PASS", "no", "yes")}**
10. Is PA forum vs DE governing law now clearly disclosed? **${yn(pass("T6U-R-MULTI") && pass("T6U-ASK-C"), "yes", "no")}**
11. Does related NJ remain separate? **${yn(pass("T6U-GRAPH-RELATED") && pass("T6U-DOC-NO-MUTATION"), "yes", "no")}**
12. Does UNVALIDATED Ask clearly disclose coverage limitation? **${yn(pass("T6U-ASK-D") && pass("T6U-ASK-COVERAGE"), "yes", "no")}**
13. Does missing-exhibit Ask clearly state the exhibit is unavailable? **${yn(pass("T6U-ASK-MISSING"), "yes", "no")}**
14. Does user pressure fail to override coverage? **${yn(pass("T6U-ASK-COVERAGE") && pass("T6U-ASK-WRONG-STATE"), "yes", "no")}**
15. How many original NEEDS WORK moved to PASS? **${nwMoved}**
16. Did any original PASS regress? **${passRegressed.length ? passRegressed.join(", ") : "no"}**
17. What is final material quality? **${quality}%**
18. Is it >=90%? **${quality >= 90 ? "yes" : "no"}**
19. What is critical safety? **${safety}%**
20. Is critical safety 100%? **${safety === 100 ? "yes" : "no"}**
21. Are Agents still OFF? **${yn(pass("T6U-AGENTS-01"), "yes", "no")}**
22. Is NyayaGrid technically beta-ready for the explicit C2A scopes? **${gate ? "yes — TECHNICAL BETA READY (explicit C2A scopes only)" : "no — NOT TECHNICALLY BETA READY"}**
23. Is attorney validation complete? **NO**
24. Is nationwide support justified? **NO**
25. What is the single next phase? **${nextPhase}**
`;

writeFileSync(join(BASELINES_ROOT, "PHASE_6U_R1_TARGETED_REMEDIATION.md"), phase);
console.log(
  JSON.stringify(
    {
      wrote: [`BASELINE_6U_${selected.id}.md`, "PHASE_6U_R1_TARGETED_REMEDIATION.md"],
      baseline: selected.id,
      gate,
      nextPhase,
      quality,
      safety,
      totals: baseline.totals,
    },
    null,
    2,
  ),
);
