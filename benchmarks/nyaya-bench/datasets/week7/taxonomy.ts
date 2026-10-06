/** Week 7 product completion / UX stabilization taxonomy. */

export const WEEK7_DATASET_ID = "week7-product-completion";
export const WEEK7_DATASET_VERSION = "week7-2026-10-06";
export const WEEK7_GRADER_VERSION = "week7-grade-2026-10-06";

export const WEEK7_AUDIT = {
  EXISTING: [
    "Firm workspace empty/loading/error primitives",
    "Case intelligence chrome + Ask Nyaya",
    "Guide prepare packet P1 fix (Week 6)",
    "e2e firm/prosecution/professor/guide flows",
    "Week 5 + Week 6 certification runners",
  ],
  EXTEND: [
    "plain-labels prosecution/coverage enums",
    "StatusLabel + CoverageWarningList",
    "Prosecution Elements Matrix + disclosure/warrants/pleas nav",
    "Prosecution case list search/filter/table",
    "Ask Nyaya unresolved questions + source UX",
  ],
  NEW: ["datasets/week7 product surface checks", "runner/week7 certification"],
  VALIDATE: [
    "npm run bench:week7",
    "npm run bench:week5",
    "npm run bench:week6",
    "e2e prosecution/guide/professor/firm",
    "npm run build -w apps/web",
  ],
} as const;

export type SurfaceRow = {
  id: string;
  workspace: "global" | "firm" | "prosecution" | "professor" | "guide";
  surface: string;
  classification: "COMPLETE" | "ROUGH" | "VALIDATED";
};

export const WEEK7_SURFACES: SurfaceRow[] = [
  { id: "S-AUTH", workspace: "global", surface: "Authentication", classification: "COMPLETE" },
  { id: "S-NAV", workspace: "global", surface: "Navigation", classification: "COMPLETE" },
  { id: "S-FIRM-HOME", workspace: "firm", surface: "Matter dashboard", classification: "COMPLETE" },
  { id: "S-FIRM-DOCS", workspace: "firm", surface: "Documents", classification: "COMPLETE" },
  { id: "S-FIRM-ASK", workspace: "firm", surface: "Ask Nyaya", classification: "COMPLETE" },
  { id: "S-FIRM-RESEARCH", workspace: "firm", surface: "Research", classification: "COMPLETE" },
  { id: "S-FIRM-TIMELINE", workspace: "firm", surface: "Timeline", classification: "COMPLETE" },
  { id: "S-FIRM-GRAPH", workspace: "firm", surface: "Graph", classification: "COMPLETE" },
  { id: "S-FIRM-EVIDENCE", workspace: "firm", surface: "Evidence matrix", classification: "COMPLETE" },
  { id: "S-FIRM-DRAFT", workspace: "firm", surface: "Draft", classification: "COMPLETE" },
  { id: "S-FIRM-TASKS", workspace: "firm", surface: "Tasks/calendar", classification: "COMPLETE" },
  { id: "S-PROS-LIST", workspace: "prosecution", surface: "Case list", classification: "COMPLETE" },
  { id: "S-PROS-OVERVIEW", workspace: "prosecution", surface: "Case overview", classification: "COMPLETE" },
  { id: "S-PROS-ELEMENTS", workspace: "prosecution", surface: "Elements Matrix", classification: "COMPLETE" },
  { id: "S-PROS-DISCOVERY", workspace: "prosecution", surface: "Discovery/disclosure", classification: "COMPLETE" },
  { id: "S-PROS-NAV", workspace: "prosecution", surface: "Warrants/subpoenas/pleas nav", classification: "COMPLETE" },
  { id: "S-PROF", workspace: "professor", surface: "Professor workspace", classification: "COMPLETE" },
  { id: "S-GUIDE", workspace: "guide", surface: "Guide + prepare", classification: "COMPLETE" },
];
