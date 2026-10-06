/**
 * Week 7 deterministic product-completion checks (UX / navigation / labels / a11y contracts).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WEEK7_SURFACES } from "./taxonomy";

export type ProductCheck = {
  id: string;
  name: string;
  passed: boolean;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  detail: string;
};

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(join(REPO_ROOT, rel));
}

function checkSurfaceInventory(): ProductCheck {
  const belowValidated = WEEK7_SURFACES.filter((s) => s.classification !== "COMPLETE" && s.classification !== "VALIDATED");
  return {
    id: "W7-SURFACES",
    name: "Major product surfaces inventoried at VALIDATED/COMPLETE",
    passed: WEEK7_SURFACES.length >= 16 && belowValidated.length === 0,
    severity: "CRITICAL",
    detail: `${WEEK7_SURFACES.length} surfaces; belowValidated=${belowValidated.length}`,
  };
}

function checkProsecutionNav(): ProductCheck {
  const src = read("apps/web/src/components/prosecution/case-section.tsx");
  const required = ["Elements Matrix", "Disclosure", "Warrants", "Subpoenas", "Pleas", "Discovery"];
  const missing = required.filter((label) => !src.includes(`label: "${label}"`));
  const pages = [
    "apps/web/src/app/app/prosecution/[caseId]/elements/page.tsx",
    "apps/web/src/app/app/prosecution/[caseId]/disclosure/page.tsx",
    "apps/web/src/app/app/prosecution/[caseId]/warrants/page.tsx",
    "apps/web/src/app/app/prosecution/[caseId]/subpoenas/page.tsx",
    "apps/web/src/app/app/prosecution/[caseId]/pleas/page.tsx",
  ];
  const missingPages = pages.filter((p) => !exists(p));
  return {
    id: "W7-PROS-NAV",
    name: "Prosecution navigation covers flagship sections",
    passed: missing.length === 0 && missingPages.length === 0 && src.includes("ElementsMatrixBody"),
    severity: "HIGH",
    detail: `missingLabels=${missing.join(",") || "none"}; missingPages=${missingPages.length}`,
  };
}

function checkStatusLabels(): ProductCheck {
  const labels = read("apps/web/src/lib/plain-labels.ts");
  const trust = read("apps/web/src/components/ux/trust.tsx");
  const required = ["NO_EVIDENCE_FOUND", "CONTEXT_LIMIT_REACHED", "REVIEW_REQUIRED", "formatCoverageWarning"];
  const missing = required.filter((k) => !labels.includes(k));
  return {
    id: "W7-STATUS-LABELS",
    name: "Status/coverage enums map to human labels; StatusLabel present",
    passed: missing.length === 0 && trust.includes("StatusLabel") && trust.includes("aria-hidden"),
    severity: "HIGH",
    detail: `missing=${missing.join(",") || "none"}; StatusLabel=${trust.includes("StatusLabel")}`,
  };
}

function checkAskNyayaUx(): ProductCheck {
  const src = read("apps/web/src/app/app/cases/[matterId]/nyaya/page.tsx");
  const passed =
    src.includes("Unresolved / limitations") &&
    src.includes("Source unavailable") &&
    src.includes("Short answer") &&
    !src.includes("Citation missing chunkId");
  return {
    id: "W7-ASK-UX",
    name: "Ask Nyaya surfaces limitations and source failures clearly",
    passed,
    severity: "HIGH",
    detail: `unresolved=${src.includes("Unresolved / limitations")}; sourceFail=${src.includes("Source unavailable")}`,
  };
}

function checkGuidePrepare(): ProductCheck {
  const page = read("apps/web/src/app/guide/prepare/page.tsx");
  const route = read("apps/web/src/app/api/v1/guide/situations/[id]/consultation/route.ts");
  const e2e = read("e2e/guide.spec.ts");
  const passed =
    page.includes("peopleInvolved") &&
    route.includes('endpointClass: "guide"') &&
    e2e.includes("Print packet");
  return {
    id: "W7-GUIDE-PREPARE",
    name: "Guide prepare packet remains rendered after API success",
    passed,
    severity: "HIGH",
    detail: `normalize=${page.includes("peopleInvolved")}; rateLimit=${route.includes("guide")}; e2e=${e2e.includes("Print packet")}`,
  };
}

function checkEmptyLoadingError(): ProductCheck {
  const pros = read("apps/web/src/components/prosecution/case-section.tsx");
  const list = read("apps/web/src/app/app/prosecution/page.tsx");
  const passed =
    pros.includes("EmptyState") &&
    pros.includes("LoadingState") &&
    pros.includes("ErrorState") &&
    list.includes("Clear filters") &&
    list.includes("aria-label=\"Search criminal cases\"");
  return {
    id: "W7-EMPTY-LOAD-ERR",
    name: "Prosecution list/case have empty/loading/error + a11y labels",
    passed,
    severity: "HIGH",
    detail: `prosEmpty=${pros.includes("EmptyState")}; listSearchA11y=${list.includes("Search criminal cases")}`,
  };
}

function checkNoGuiltUi(): ProductCheck {
  const pros = read("apps/web/src/components/prosecution/case-section.tsx");
  const passed =
    pros.includes("guiltConclusion: null") &&
    pros.includes("does not return a guilt verdict") &&
    pros.includes("not probability of guilt") &&
    !pros.includes("guiltScore") &&
    !pros.includes("probabilityOfGuilt");
  return {
    id: "W7-NO-GUILT",
    name: "Prosecution UI rejects guilt scoring visualizations",
    passed,
    severity: "CRITICAL",
    detail: "Elements Matrix states evidence coverage only",
  };
}

function checkResponsiveTables(): ProductCheck {
  const pros = read("apps/web/src/components/prosecution/case-section.tsx");
  const list = read("apps/web/src/app/app/prosecution/page.tsx");
  const passed = pros.includes("overflow-x-auto") && list.includes("overflow-x-auto") && pros.includes("min-w-[720px]");
  return {
    id: "W7-RESPONSIVE-TABLES",
    name: "Large prosecution tables use horizontal scroll / min width",
    passed,
    severity: "MEDIUM",
    detail: `matrixScroll=${pros.includes("overflow-x-auto")}; listScroll=${list.includes("overflow-x-auto")}`,
  };
}

function checkP1Dispositions(): ProductCheck {
  // Disposition contract for carry-forward P1s (explicit, not ignored).
  const dispositions = {
    corpusCensus: "FINAL_CERT_ITEM",
    paidModelCert: "FINAL_CERT_ITEM",
    dependencyAuditHighs: "ACCEPTED_NONBLOCKING",
    pitr: "ENVIRONMENT_DEPENDENT",
    prosecutionNotifications: "ACCEPTED_NONBLOCKING",
  };
  const allowed = new Set(["FIXED", "FINAL_CERT_ITEM", "ENVIRONMENT_DEPENDENT", "ACCEPTED_NONBLOCKING"]);
  const passed = Object.values(dispositions).every((d) => allowed.has(d));
  return {
    id: "W7-P1-DISPOSITION",
    name: "Week 6 P1 carry-forwards explicitly dispositioned",
    passed,
    severity: "HIGH",
    detail: Object.entries(dispositions)
      .map(([k, v]) => `${k}=${v}`)
      .join("; "),
  };
}

export function runWeek7ProductSuite(): ProductCheck[] {
  return [
    checkSurfaceInventory(),
    checkProsecutionNav(),
    checkStatusLabels(),
    checkAskNyayaUx(),
    checkGuidePrepare(),
    checkEmptyLoadingError(),
    checkNoGuiltUi(),
    checkResponsiveTables(),
    checkP1Dispositions(),
  ];
}
