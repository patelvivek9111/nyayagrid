/**
 * Executable Prosecution feature inventory — COMPLETE only with test evidence.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureInventoryRow, InventoryStatus } from "./taxonomy";
import { runProsecutionBenchScenarios } from "./scenarios";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function exists(rel: string): boolean {
  return existsSync(join(REPO_ROOT, rel));
}

function statusFrom(
  codeExists: boolean,
  scenarioIds: string[],
  scenarioPass: Map<string, boolean>,
): InventoryStatus {
  if (!codeExists) return "BROKEN";
  if (scenarioIds.length === 0) return "UNTESTED";
  const results = scenarioIds.map((id) => scenarioPass.get(id));
  if (results.some((r) => r === undefined)) return "PARTIAL";
  if (results.every(Boolean)) return "COMPLETE";
  if (results.some(Boolean)) return "PARTIAL";
  return "BROKEN";
}

export function buildProsecutionFeatureInventory(
  scenarioPass?: Map<string, boolean>,
): FeatureInventoryRow[] {
  const pass =
    scenarioPass ?? new Map(runProsecutionBenchScenarios().map((s) => [s.id, s.passed] as const));

  const rows: Array<{
    area: FeatureInventoryRow["area"];
    feature: string;
    code: boolean;
    scenarios: string[];
  }> = [
    {
      area: "OFFICE",
      feature: "office configuration / members / roles",
      code: exists("packages/database/src/prosecution-roles.ts"),
      scenarios: ["PB-RBAC-01"],
    },
    {
      area: "OFFICE",
      feature: "agencies",
      code: exists("packages/database/src/schema/phase14.ts"),
      scenarios: ["PB-OFF-01"],
    },
    {
      area: "OFFICE",
      feature: "caseload / assignments / My Work",
      code: exists("packages/intelligence/src/prosecution/office-ops-db.ts"),
      scenarios: ["PB-OFF-01", "PB-OFF-02", "PB-OFF-03"],
    },
    {
      area: "OFFICE",
      feature: "supervisor queues / calendar / tasks / reporting / audit / search",
      code: exists("apps/web/src/app/api/v1/prosecution/office/route.ts"),
      scenarios: ["PB-OFF-01", "PB-AUD-01", "PB-OFF-04"],
    },
    {
      area: "CASE",
      feature: "case intake / metadata / defendants / charges / elements",
      code: exists("packages/intelligence/src/prosecution/domain.ts"),
      scenarios: ["PB-EL-01", "PB-EL-02"],
    },
    {
      area: "CASE",
      feature: "evidence / witnesses / statements",
      code: exists("packages/intelligence/src/prosecution/case-intelligence.ts"),
      scenarios: ["PB-EV-01", "PB-EV-02", "PB-WIT-01"],
    },
    {
      area: "CASE",
      feature: "timeline / investigation gaps / chain of custody",
      code: exists("packages/intelligence/src/week4/chain-of-custody.ts"),
      scenarios: ["PB-COC-01", "PB-TL-01", "PB-TL-02"],
    },
    {
      area: "CASE",
      feature: "discovery / disclosure / human review / production",
      code: exists("packages/intelligence/src/prosecution/disclosure-workflow.ts"),
      scenarios: ["PB-DIS-01", "PB-DIS-02", "PB-DISC-01", "PB-WIT-02"],
    },
    {
      area: "CASE",
      feature: "warrants / procedure / motions / subpoenas / hearings / pleas",
      code: exists("packages/intelligence/src/prosecution/legal-workflow.ts"),
      scenarios: ["PB-WAR-01", "PB-SUP-01", "PB-MOT-01", "PB-HEAR-01", "PB-PLEA-01"],
    },
    {
      area: "CASE",
      feature: "research / drafts / audit",
      code: exists("packages/intelligence/src/prosecution/research-context.ts"),
      scenarios: ["PB-AUTH-01", "PB-CIT-01", "PB-DRAFT-01", "PB-AUD-01"],
    },
    {
      area: "ASK_NYAYA",
      feature: "case-scoped / office operational / source-grounded ask context",
      code: exists("packages/intelligence/src/prosecution/office-ops.ts"),
      scenarios: ["PB-OFF-01", "PB-ABS-01", "PB-INJ-01"],
    },
    {
      area: "ASK_NYAYA",
      feature: "routing safety (mock high-stakes)",
      code: true,
      scenarios: ["PB-ROUTE-01", "PB-ROUTE-02", "PB-ROUTE-03", "PB-FAIL-01"],
    },
    {
      area: "CASE",
      feature: "isolation (tenant/case/IDOR helpers)",
      code: true,
      scenarios: ["PB-EV-03", "PB-TEN-01", "PB-RBAC-02"],
    },
  ];

  return rows.map((row) => ({
    area: row.area,
    feature: row.feature,
    status: statusFrom(row.code, row.scenarios, pass),
    evidence: row.scenarios.join(", "),
  }));
}

export function summarizeInventory(rows: FeatureInventoryRow[]): Record<InventoryStatus, number> {
  return {
    COMPLETE: rows.filter((r) => r.status === "COMPLETE").length,
    PARTIAL: rows.filter((r) => r.status === "PARTIAL").length,
    BROKEN: rows.filter((r) => r.status === "BROKEN").length,
    UNTESTED: rows.filter((r) => r.status === "UNTESTED").length,
  };
}
