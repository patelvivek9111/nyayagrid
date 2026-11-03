/**
 * Server-side Ask model-routing classification for Router v2.
 * Never trust client-supplied highStakesLegal / subsystem downgrades.
 */

import type { RouterSubsystem } from "@nyayagrid/ai";

export type AskWorkspaceKind = "professional" | "prosecution";

export type AskModelRoutingDecision = {
  /** Semantic workspace used for routing + structured context. */
  workspaceType: AskWorkspaceKind;
  /** Router subsystem — prosecution when a criminal case is linked. */
  subsystem: RouterSubsystem;
  /**
   * Ask answer generation is always high-stakes legal Q&A.
   * Routine extraction uses separate schemas/subsystems, not this path.
   */
  highStakesLegal: true;
  /** Linked criminal case when prosecution workspace applies. */
  criminalCaseId: string | null;
  classificationSource: "LINKED_CRIMINAL_CASE" | "EXPLICIT_PROSECUTION" | "PROFESSIONAL_ASK";
};

/**
 * Resolve Ask routing metadata from server-verified workspace identity.
 * Client cannot force professional/routine routing when a case is linked.
 */
export function resolveAskModelRouting(params: {
  /** Caller-supplied workspace hint; ignored when a criminal case is linked. */
  workspaceType?: string | null;
  /** Server-verified criminal case id for this matter (org-scoped). */
  linkedCriminalCaseId?: string | null;
  useResearchPrompt?: boolean;
  webEnabled?: boolean;
}): AskModelRoutingDecision {
  const linkedId =
    typeof params.linkedCriminalCaseId === "string" && params.linkedCriminalCaseId.trim()
      ? params.linkedCriminalCaseId.trim()
      : null;
  const explicitProsecution = params.workspaceType === "prosecution";

  if (linkedId || explicitProsecution) {
    return {
      workspaceType: "prosecution",
      subsystem: "prosecution",
      highStakesLegal: true,
      criminalCaseId: linkedId,
      classificationSource: linkedId ? "LINKED_CRIMINAL_CASE" : "EXPLICIT_PROSECUTION",
    };
  }

  const researchish = Boolean(params.useResearchPrompt || params.webEnabled);
  return {
    workspaceType: "professional",
    subsystem: researchish ? "research" : "ask",
    highStakesLegal: true,
    criminalCaseId: null,
    classificationSource: "PROFESSIONAL_ASK",
  };
}

/**
 * Strip client model overrides that would bypass Router v2 high-stakes policy.
 * Returns undefined so the server-side planner selects Claude→Grok→FAIL_CLOSED.
 */
export function sanitizeAskClientModelId(params: {
  modelId: string | undefined;
  highStakesLegal: boolean;
  routerV2Enabled: boolean;
}): string | undefined {
  if (!params.modelId) return undefined;
  if (!params.routerV2Enabled) return params.modelId;
  if (!params.highStakesLegal) return params.modelId;
  // High-stakes Ask never accepts client model pins — prevents GPT/Gemini downgrade.
  return undefined;
}
