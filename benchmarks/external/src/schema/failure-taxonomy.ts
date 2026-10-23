import { z } from "zod";

export const FAILURE_TAXONOMY = [
  "FABRICATED_AUTHORITY",
  "FABRICATED_FACT",
  "WRONG_JURISDICTION",
  "WRONG_RULE",
  "WRONG_RULE_APPLICATION",
  "MISSED_EXCEPTION",
  "PROCEDURAL_ERROR",
  "UNSUPPORTED_CONCLUSION",
  "CITATION_MISMATCH",
  "EVIDENCE_MISS",
  "FAILED_UNCERTAINTY",
  "INSTRUCTION_FAILURE",
  "STRUCTURED_OUTPUT_FAILURE",
  "PRIVACY_OR_SCOPE_FAILURE",
  "TOOL_POLICY_FAILURE",
] as const;

export type FailureCategory = (typeof FAILURE_TAXONOMY)[number];

export const FailureCategorySchema = z.enum(FAILURE_TAXONOMY);

export function isFailureCategory(value: string): value is FailureCategory {
  return (FAILURE_TAXONOMY as readonly string[]).includes(value);
}
