import { looksLikeJurisdictionSensitiveQuestion } from "./sensitive";
import type { MatterJurisdictionContext } from "./types";

export function jurisdictionIsUnknown(ctx: MatterJurisdictionContext | null | undefined): boolean {
  if (!ctx) return true;
  return ctx.jurisdictionMode === "unknown" && !ctx.primaryState && !ctx.governingLawState && !ctx.courtId;
}

/**
 * When the question depends on which law applies and the Case has no forum/governing law,
 * Nyaya must not guess a nationwide answer.
 */
export function shouldAbstainForUnknownJurisdiction(
  question: string,
  ctx: MatterJurisdictionContext | null | undefined,
): boolean {
  return jurisdictionIsUnknown(ctx) && looksLikeJurisdictionSensitiveQuestion(question);
}

export const UNKNOWN_JURISDICTION_ABSTENTION =
  "This question depends on the applicable claim, forum, and potentially governing law. This Case does not have a recorded jurisdiction, so NyayaGrid will not guess a nationwide legal rule. Record the forum and any stated choice of law in Case settings, then ask again.";
