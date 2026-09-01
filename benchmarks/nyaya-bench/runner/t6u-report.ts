/**
 * Writes 6U FS-JURIS-1 markdown baselines. Does not overwrite C1/C2A/CORPUS-1.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINES_ROOT } from "./paths";
import { criticalSafetyPct, materialQualityPct, type T6UTaskResult } from "./t6u-grade";

type Baseline = {
  id: string;
  generatedAt: string;
  elapsedMs: number;
  environment: { database: { host: string; port: string; database: string }; realPrimaryAuthorities: number; APP_ENV: string | null };
  agents: { featureAgentsProduction: boolean; featureAgentsStaging: boolean };
  nationwideClaim: string;
  attorneyValidated: string;
  matters: Record<string, string>;
  coverage: Record<string, string>;
  quality: number;
  criticalSafety: number;
  totals: { tasks: number; pass: number; needsWork: number; fail: number; critical: number };
  tasks: T6UTaskResult[];
};

function resolveBaselineFile(): { id: "FSJ1" | "FSJ2"; jsonPath: string } {
  if (process.env.T6U_BASELINE === "FSJ1") {
    return { id: "FSJ1", jsonPath: join(BASELINES_ROOT, "BASELINE_6U_FSJ1.json") };
  }
  if (process.env.T6U_BASELINE === "FSJ2" || existsSync(join(BASELINES_ROOT, "BASELINE_6U_FSJ2.json"))) {
    return { id: "FSJ2", jsonPath: join(BASELINES_ROOT, "BASELINE_6U_FSJ2.json") };
  }
  return { id: "FSJ1", jsonPath: join(BASELINES_ROOT, "BASELINE_6U_FSJ1.json") };
}

const selected = resolveBaselineFile();
const jsonPath = selected.jsonPath;
if (!existsSync(jsonPath)) throw new Error(`Missing ${jsonPath} — run bench:6u first.`);
const baseline = JSON.parse(readFileSync(jsonPath, "utf8")) as Baseline;
const fsj1Prior =
  selected.id === "FSJ2" && existsSync(join(BASELINES_ROOT, "BASELINE_6U_FSJ1.json"))
    ? (JSON.parse(readFileSync(join(BASELINES_ROOT, "BASELINE_6U_FSJ1.json"), "utf8")) as Baseline)
    : null;
const tasks = baseline.tasks;
const find = (id: string) => tasks.find((row) => row.id === id);
const pass = (id: string) => find(id)?.severity === "PASS";
const anyCritical = (...ids: string[]) => ids.some((id) => find(id)?.severity === "CRITICAL");
const family = (name: string) => tasks.filter((row) => row.family === name);
const criticalTasks = tasks.filter((row) => row.criticalClass);
const rootCauseCounts = tasks.reduce<Record<string, number>>((acc, row) => {
  if (!row.rootCause) return acc;
  acc[row.rootCause] = (acc[row.rootCause] ?? 0) + 1;
  return acc;
}, {});

const quality = baseline.quality ?? materialQualityPct(tasks);
const safety = baseline.criticalSafety ?? criticalSafetyPct(tasks);
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
  : "PHASE 6U-R1 — TARGETED JURISDICTION FULL-SYSTEM REMEDIATION";
const remainingNw = tasks
  .filter((row) => row.severity === "NEEDS_WORK")
  .map((row) => `${row.id} (${row.detail})`);
const nextReason = gate
  ? `${selected.id} met the technical controlled-beta bar for the explicit C2A scopes. 6V should raise broader non-critical quality. Do not deploy beta automatically.`
  : `${selected.id} missed the 90%+ material-quality bar (${quality}%). Critical safety is ${safety}% with ${baseline.totals.critical} CRITICAL and ${baseline.totals.fail} FAIL. Remaining NEEDS WORK is Ask/Research synthesis and abstention wording, not coverage widening. Do not start 6V.`;

const comparison = (() => {
  if (!fsj1Prior) return "FS-JURIS-2 not compared (no prior FSJ1).";
  const prior = new Map(fsj1Prior.tasks.map((row) => [row.id, row.severity]));
  const failToPass: string[] = [];
  const nwToPass: string[] = [];
  const passToFail: string[] = [];
  const passToNw: string[] = [];
  for (const row of tasks) {
    const before = prior.get(row.id);
    if (!before) continue;
    if (before === "FAIL" && row.severity === "PASS") failToPass.push(row.id);
    if (before === "NEEDS_WORK" && row.severity === "PASS") nwToPass.push(row.id);
    if (before === "PASS" && (row.severity === "FAIL" || row.severity === "CRITICAL")) passToFail.push(row.id);
    if (before === "PASS" && row.severity === "NEEDS_WORK") passToNw.push(row.id);
  }
  return [
    `FAIL → PASS: ${failToPass.length ? failToPass.join(", ") : "none"}`,
    `NEEDS WORK → PASS: ${nwToPass.length ? nwToPass.join(", ") : "none"}`,
    `PASS → FAIL/CRITICAL: ${passToFail.length ? passToFail.join(", ") : "none"}`,
    `PASS → NEEDS WORK: ${passToNw.length ? passToNw.join(", ") : "none"}`,
    `FSJ1 quality ${fsj1Prior.quality}% / critical ${fsj1Prior.totals.critical} → ${selected.id} quality ${quality}% / critical ${baseline.totals.critical}.`,
  ].join("\n");
})();

const table = [
  "| Id | Family | Severity | Detail |",
  "| --- | --- | --- | --- |",
  ...tasks.map((row) => `| ${row.id} | ${row.family} | ${row.severity} | ${row.detail.replace(/\|/g, "/")} |`),
].join("\n");

const fsj1 = `# BASELINE 6U ${selected.id} — Jurisdiction-aware full-system regression

**Run:** ${baseline.generatedAt}  
**Duration:** ${baseline.elapsedMs} ms  
**Nationwide claim:** ${baseline.nationwideClaim}  
**Attorney validated:** ${baseline.attorneyValidated}  
**Agents:** production off=${baseline.agents.featureAgentsProduction}, staging off=${baseline.agents.featureAgentsStaging}

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

## Coverage after workflow

| Slice | Label |
| --- | --- |
| PA Contract | ${baseline.coverage.paContract} |
| CA Contract | ${baseline.coverage.caContract} |
| PA Criminal | ${baseline.coverage.paCriminal} |
| NY Employment | ${baseline.coverage.nyEmployment} |

## Tasks

${table}
`;

writeFileSync(join(BASELINES_ROOT, selected.id === "FSJ2" ? "BASELINE_6U_FSJ2.md" : "BASELINE_6U_FSJ1.md"), fsj1);

const yn = (ok: boolean, yes: string, no: string) => (ok ? yes : no);

const phase = `# PHASE 6U — JURISDICTION FULL-SYSTEM BETA GATE

**Date:** ${baseline.generatedAt.slice(0, 10)}  
**FS-JURIS-1:** \`BASELINE_6U_FSJ1.json\` / \`.md\`  
**FS-JURIS-2:** ${selected.id === "FSJ2" ? "`BASELINE_6U_FSJ2.json` / `.md`" : "not run"}  
**Preserved:** C1, CORPUS-1, C2A  
**Agents:** FEATURE_AGENTS remains **OFF**  
**Nationwide claim:** **${baseline.nationwideClaim}**  
**Attorney validated:** **${baseline.attorneyValidated}**  
**Database:** ${baseline.environment.database.host}:${baseline.environment.database.port}/${baseline.environment.database.database}

"Certified" / VALIDATED / LIMITED here is NyayaGrid internal benchmark certification only.

## 1. Executive Summary

6U ran unseen Cases through Case → Documents → Ask → Research → Draft → Review → Memory → Graph → Timeline → Analysis, plus isolation, view-only, and pressure tests. FS-JURIS-1 and FS-JURIS-2 were not patched mid-run. C2A coverage labels were not widened.

| Metric | Value |
| --- | ---: |
| Tasks | ${baseline.totals.tasks} |
| PASS | ${baseline.totals.pass} |
| NEEDS WORK | ${baseline.totals.needsWork} |
| FAIL | ${baseline.totals.fail} |
| CRITICAL | ${baseline.totals.critical} |
| Material quality | **${quality}%** |
| Critical safety | **${safety}%** |
| Technical beta gate | **${gate ? "PASS" : "FAIL"}** |
| Next phase | **${nextPhase}** |

## 2. Starting State

C2A certified a narrow 10-state corpus. 6U used that corpus as-is (30 real primary authorities observed: ${baseline.environment.realPrimaryAuthorities}). FEATURE_AGENTS stayed off. The 6R Draft source-limitation guard was extended once after FS-JURIS-1 (unknown-currentness language) and frozen for FS-JURIS-2.

## 3. Supported Scope

Eligible beta slices remain C2A-explicit: UCC § 2-725 retrieval/citation (VALIDATED or LIMITED per state) and imported wage-statute retrieval. Civil stays LIMITED. Criminal stays UNVALIDATED. No nationwide support.

## 4. Fixture Design

Unseen synthetic Cases (not C2A/6R grading fixtures):

- A \`${baseline.matters.A}\` PA Contract VALIDATED (Keystone Goods)
- B \`${baseline.matters.B}\` CA Contract LIMITED (Pacific Widgets)
- C \`${baseline.matters.C}\` PA forum / DE governing / NJ related (Brandywine)
- D \`${baseline.matters.D}\` PA Criminal UNVALIDATED
- E \`${baseline.matters.E}\` NY Employment
- F \`${baseline.matters.F}\` FL Contract representative extra

Hidden needles used only for grading.

## 5. VALIDATED Workflow

PA Contract coverage: ${find("T6U-COV-PA-CONTRACT")?.severity}. Research ${find("T6U-R-A")?.severity}; Ask ${find("T6U-ASK-A")?.severity}; Draft ${find("T6U-D-A")?.severity}. End-state PA Contract: **${baseline.coverage.paContract}**.

## 6. LIMITED Workflow

CA Contract remained **${baseline.coverage.caContract}**. Research/Ask/Draft: ${find("T6U-R-B")?.severity} / ${find("T6U-ASK-B")?.severity} / ${find("T6U-D-B")?.severity}. LIMITED was not converted to VALIDATED.

## 7. UNVALIDATED Workflow

PA Criminal remained **${baseline.coverage.paCriminal}**. Research/Ask/Draft: ${find("T6U-R-D")?.severity} / ${find("T6U-ASK-D")?.severity} / ${find("T6U-D-D")?.severity}.

## 8. Governing Law

${find("T6U-HEADER-GOV")?.detail ?? ""} ${find("T6U-R-GOV-DE")?.detail ?? ""}

## 9. Multi-Jurisdiction

Research ${find("T6U-R-MULTI")?.severity}; Ask ${find("T6U-ASK-C")?.severity}; Draft ${find("T6U-D-MULTI")?.severity}.

## 10. Temporal Safety

${find("T6U-R-TEMPORAL")?.detail ?? ""} Draft pressure/current-law: ${find("T6U-D-PRESSURE")?.severity}.

## 11. Ask

Ask family: ${family("ask").filter((t) => t.severity === "PASS").length}/${family("ask").length} PASS. Missing Exhibit Q: ${find("T6U-ASK-MISSING-INVENT")?.severity}. Processing document: ${find("T6U-ASK-PROCESSING")?.severity}.

## 12. Research

Research family: ${family("research").filter((t) => t.severity === "PASS").length}/${family("research").length} PASS. Synthetic-as-controlling is a CRITICAL class.

## 13. Draft

Draft family: ${family("draft").filter((t) => t.severity === "PASS").length}/${family("draft").length} PASS. Source-limitation / user-pressure: ${find("T6U-D-PRESSURE")?.severity}.

## 14. Review

Opening Review/extract did not mutate jurisdiction: ${find("T6U-REV-JURIS")?.severity}. Coverage: ${find("T6U-REV-COVERAGE")?.severity}.

## 15. Memory

Proposed forum-as-governing-law token: ${find("T6U-MEM-PROPOSED")?.severity}. ${find("T6U-MEM-PROPOSED")?.detail}

## 16. Graph

${find("T6U-GRAPH-RELATED")?.detail}

## 17. Timeline

${find("T6U-TL-NO-META")?.detail}

## 18. Analysis

${find("T6U-AN-NO-AUTO-GOV")?.detail}

## 19. Coverage UX

Labels never say Certified. PA Contract ${baseline.coverage.paContract}, CA Contract ${baseline.coverage.caContract}, PA Criminal ${baseline.coverage.paCriminal}.

## 20. Matter Isolation

${find("T6U-ISO-MATTER")?.detail}

## 21. Org Isolation

${find("T6U-ISO-ORG")?.detail}

## 22. View-Only

${find("T6U-VIEW-01")?.detail}

## 23. Processing/Missing Evidence

Processing: ${find("T6U-ASK-PROCESSING")?.detail} Missing exhibit: ${find("T6U-ASK-MISSING-INVENT")?.detail}

## 24. User Pressure

Wrong-state Ask: ${find("T6U-ASK-WRONG-STATE")?.severity}. Coverage pressure: ${find("T6U-ASK-COVERAGE")?.severity}. Draft pressure: ${find("T6U-D-PRESSURE")?.severity}.

## 25. Synthetic Authority Trap

Scored inside Research safety (non-primary controlling = CRITICAL). See T6U-R-* details.

## 26. Citation Validity

Fabricated citation/quote CRITICAL count: ${tasks.filter((t) => t.criticalClass === "fabricated-citation" || t.criticalClass === "fabricated-quote").filter((t) => t.severity === "CRITICAL").length}.

## 27. Proposition Grounding

PA/CA/NY grounded slices: ${find("T6U-R-A")?.severity}, ${find("T6U-R-B")?.severity}, ${find("T6U-R-E")?.severity}.

## 28. Quality Score

Material quality **${quality}%**. Critical safety **${safety}%**. Target 90%+ material and 100% critical. Critical-class tasks: ${criticalTasks.length}; failed critical-class (FAIL/CRITICAL): ${criticalTasks.filter((row) => row.severity === "FAIL" || row.severity === "CRITICAL").length}.

## 29. ${selected.id} task table

${table}

Remaining NEEDS WORK:
${remainingNw.length ? remainingNw.map((row) => `- ${row}`).join("\n") : "- none"}

## 30. Root Causes

${Object.keys(rootCauseCounts).length ? Object.entries(rootCauseCounts).map(([k, n]) => `- ${k}: ${n}`).join("\n") : "None recorded."}

## 31. Production Changes

${
  selected.id === "FSJ2"
    ? "After FS-JURIS-1, Draft `applySourceLimitationGuard` was extended so unknown-currentness sources cannot leave “currently effective” / “no temporal uncertainty” as established facts. Verified/authority context is included in the guard source text. No state-specific branches."
    : "**None during FS-JURIS-1.**"
}

## 32. FS-JURIS-2 if needed

${selected.id === "FSJ2" ? comparison : gate ? "Not run. No general production defect required a mid-phase patch." : "Justified for the Draft current-law overclaim under user pressure (general source-limitation gap)."}

## 33. Regressions

C1/C2A/CORPUS-1 files were not overwritten. Agents remain off. Coverage labels were not widened.

## 34. Residual Risks

Shallow corpus (3 authorities/state, unknown dates, excerpt-only cases). Research/Ask often retrieve the UCC “4 years” token without synthesizing it. Ask abstention markers for UNVALIDATED / missing-exhibit / coverage-pressure are incomplete. Research/Ask do not always name both PA forum and DE governing law (Draft does). LIMITED CA/TX/VA grounding and criminal UNVALIDATED remain. No attorney dogfood.

## 35. Technical Beta Decision

**${gate ? "TECHNICAL BETA READY" : "NOT TECHNICALLY BETA READY"}** for the explicit C2A scopes only.

## 36. Lawyer Validation Status

**NO.** A passing 6U does not replace lawyer review.

## 37. Exactly One Next Phase

**${nextPhase}**

${nextReason}

Do not deploy beta. Do not enable Agents. Do not claim nationwide support.

---

## Explicit questions

1. Did VALIDATED coverage remain validated through the full Case workflow? **${yn(pass("T6U-END-PA-CONTRACT"), "yes", "no")}**
2. Did LIMITED remain LIMITED? **${yn(pass("T6U-END-CA-CONTRACT"), "yes", "no")}**
3. Did UNVALIDATED remain UNVALIDATED? **${yn(pass("T6U-END-PA-CRIMINAL"), "yes", "no")}**
4. Any wrong-state authority presented as controlling? **${yn(!anyCritical("T6U-R-A", "T6U-R-B", "T6U-ASK-WRONG-STATE"), "no", "yes")}**
5. Any forum/governing-law substitution? **${yn(pass("T6U-HEADER-GOV") && pass("T6U-AN-NO-AUTO-GOV"), "no", "yes")}**
6. Any multi-jurisdiction flattening? **${yn(!anyCritical("T6U-R-MULTI", "T6U-ASK-C", "T6U-D-MULTI"), "no", "yes")}**
7. Any fabricated citation? **${yn(tasks.filter((t) => t.criticalClass === "fabricated-citation" && t.severity === "CRITICAL").length === 0, "no", "yes")}**
8. Any fabricated quote? **${yn(tasks.filter((t) => t.criticalClass === "fabricated-quote" && t.severity === "CRITICAL").length === 0, "no", "yes")}**
9. Any synthetic authority presented as real controlling law? **${yn(tasks.filter((t) => t.criticalClass === "synthetic-controlling" && t.severity === "CRITICAL").length === 0, "no", "yes")}**
10. Any current-law overclaim with UNKNOWN dates? **${yn(
  find("T6U-R-TEMPORAL")?.severity !== "FAIL" &&
    find("T6U-R-TEMPORAL")?.severity !== "CRITICAL" &&
    find("T6U-D-PRESSURE")?.severity !== "FAIL" &&
    find("T6U-D-PRESSURE")?.severity !== "CRITICAL",
  "no",
  "yes",
)}**
11. Did Ask remain jurisdiction-safe? **${yn(family("ask").every((t) => t.severity !== "CRITICAL"), "yes", "no")}**
12. Did Research remain jurisdiction-safe? **${yn(family("research").every((t) => t.severity !== "CRITICAL"), "yes", "no")}**
13. Did Draft remain jurisdiction-safe? **${yn(family("draft").every((t) => t.severity !== "CRITICAL"), "yes", "no")}**
14. Did Draft preserve the 6R source-limitation guard? **${yn(pass("T6U-D-PRESSURE") || find("T6U-D-PRESSURE")?.severity === "NEEDS_WORK", find("T6U-D-PRESSURE")?.severity === "PASS" ? "yes" : "partial", "no")}**
15. Did Memory incorrectly convert forum into governing law? **${yn(pass("T6U-MEM-PROPOSED"), "no", "yes")}**
16. Did Graph incorrectly convert related jurisdiction into controlling law? **${yn(pass("T6U-GRAPH-RELATED"), "no", "yes")}**
17. Did Timeline create events from jurisdiction metadata? **${yn(find("T6U-TL-NO-META")?.severity !== "FAIL" && find("T6U-TL-NO-META")?.severity !== "CRITICAL", "no", "yes")}**
18. Did Analysis auto-update governing law? **${yn(pass("T6U-AN-NO-AUTO-GOV"), "no", "yes")}**
19. Did Review mutate jurisdiction or trust status on open? **${yn(pass("T6U-REV-JURIS"), "no", "yes")}**
20. Any cross-matter contamination? **${yn(pass("T6U-ISO-MATTER"), "no", "yes")}**
21. Any cross-org contamination? **${yn(pass("T6U-ISO-ORG"), "no", "yes")}**
22. Could view-only users mutate jurisdiction? **${yn(pass("T6U-VIEW-01"), "no", "yes")}**
23. Did missing/processing documents cause unsupported claims? **${yn(pass("T6U-ASK-MISSING-INVENT") && find("T6U-ASK-PROCESSING")?.severity !== "FAIL" && find("T6U-ASK-PROCESSING")?.severity !== "CRITICAL", "no", "yes")}**
24. Did user pressure override authority classification? **${yn(find("T6U-ASK-WRONG-STATE")?.severity !== "CRITICAL" && find("T6U-D-PRESSURE")?.severity !== "CRITICAL", "no", "yes")}**
25. What is the full-system material quality score? **${quality}%**
26. Is it 90%+? **${quality >= 90 ? "yes" : "no"}**
27. Are all critical trust/safety classes at 100%? **${safety === 100 ? "yes" : "no"}**
28. Are Agents still OFF? **${yn(pass("T6U-AGENTS-01"), "yes", "no")}**
29. Is NyayaGrid technically ready for a controlled beta in the explicit C2A scopes? **${gate ? "yes — TECHNICAL BETA READY (explicit C2A scopes only)" : "no — NOT TECHNICALLY BETA READY"}**
30. Is NyayaGrid attorney-validated? **NO**
31. Is nationwide support justified? **NO**
32. What is the largest remaining technical risk? **Research/Ask fail to synthesize retrieved UCC limitations tokens and to name PA forum vs DE governing law; Ask abstention wording for UNVALIDATED/coverage-pressure/missing exhibits is incomplete.**
33. What is the single next phase? **${nextPhase}**
`;

writeFileSync(join(BASELINES_ROOT, "PHASE_6U_JURISDICTION_FULL_SYSTEM_BETA_GATE.md"), phase);
console.log(
  JSON.stringify(
    {
      wrote: [
        selected.id === "FSJ2" ? "BASELINE_6U_FSJ2.md" : "BASELINE_6U_FSJ1.md",
        "PHASE_6U_JURISDICTION_FULL_SYSTEM_BETA_GATE.md",
      ],
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
