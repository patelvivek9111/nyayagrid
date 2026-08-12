import { z } from "zod";
import {
  agentIntentSchema,
  buildIntentClassificationSystemPrompt,
  buildIntentClassificationUserPrompt,
  intentClassificationSchema,
  DEFAULT_BLOCKED_ACTIONS,
  INTENT_CLASSIFICATION_PROMPT_VERSION,
  type AgentIntent,
  type AIProvider,
} from "@nyayagrid/ai";
import { containsInstructionLikeDirectives, wrapUntrustedContent } from "./prompt-injection";

export { agentIntentSchema, INTENT_CLASSIFICATION_PROMPT_VERSION };
export type { AgentIntent };

/** Local mirror of the AI package's classification schema so this module can validate offline. */
export const intentSchema = intentClassificationSchema;

export type IntentDecision = {
  intent: AgentIntent;
  confidence: "low" | "medium" | "high";
  rationale: string;
  requiresAgentRun: boolean;
  /** Operations refused for this request regardless of what the user or a document asks for. */
  blockedActions: string[];
  suggestedAgents: string[];
  source: "rules" | "ai";
  /** Notes worth surfacing to the user, e.g. an ignored injection attempt. */
  safetyNotes: string[];
};

const BLOCKED_ACTION_PATTERNS: Array<{ action: string; pattern: RegExp }> = [
  {
    action: "send_email",
    pattern:
      /\b(?:send|email|e-mail|mail|transmit|forward|reply\s+to)\b[^.?!]{0,60}\b(?:opposing|counsel|client|email|letter|message|them|him|her)\b|\bemail\s+(?:opposing|counsel|the\s+\w+)/i,
  },
  {
    action: "court_filing",
    pattern:
      /\b(?:file|e-file|efile|submit|lodge)\b[^.?!]{0,40}\b(?:with\s+the\s+court|court|docket|clerk)\b/i,
  },
  {
    action: "payment",
    pattern:
      /\b(?:pay|wire|remit|transfer\s+funds|process\s+(?:the\s+)?payment|settle\s+the\s+invoice)\b/i,
  },
  {
    action: "accept_settlement",
    pattern:
      /\b(?:accept|agree\s+to|sign\s+off\s+on|approve)\b[^.?!]{0,40}\b(?:settlement|offer|terms)\b/i,
  },
  {
    action: "delete_evidence",
    pattern:
      /\b(?:delete|destroy|shred|purge|remove)\b[^.?!]{0,40}\b(?:evidence|documents?|files?|records?)\b/i,
  },
  { action: "approve_privilege", pattern: /\b(?:approve|finalize|mark)\b[^.?!]{0,40}\bprivileg/i },
  {
    action: "contact_external",
    pattern:
      /\b(?:contact|call|reach\s+out\s+to|notify)\b[^.?!]{0,40}\b(?:opposing|third\s+party|witness|court|counsel)\b/i,
  },
];

const DRAFTING_PATTERN =
  /\b(?:draft|write|prepare|compose|revise|redline|rewrite)\b|\b(?:motion|letter|brief|memo|agreement|complaint|response)\b/i;
const RESEARCH_PATTERN =
  /\b(?:research|precedent|case\s?law|statute|authority|authorities|holding|legal\s+standard|what\s+is\s+the\s+law|cite)\b/i;
const CONTRACT_PATTERN =
  /\b(?:contract|clause|indemnif|termination\s+provision|agreement\s+review|warranty|covenant|redline)\b/i;
const DEPOSITION_PATTERN =
  /\b(?:deposition|depo|witness|testimony|transcript|impeach|cross-?examin)\b/i;
const EVIDENCE_PATTERN =
  /\b(?:contradiction|inconsistenc|evidence|exhibit|authenticat|chain\s+of\s+custody|corroborat)\b/i;
const DISCOVERY_PATTERN =
  /\b(?:discovery|privilege|responsive|production\s+request|e-?discovery|bates|confidentialit)\b/i;
const TIMELINE_PATTERN =
  /\b(?:timeline|chronolog|sequence\s+of\s+events|deadline|calendar|order\s+of\s+events)\b/i;
const GRAPH_PATTERN =
  /\b(?:relationship|who\s+(?:is|are)\s+related|entity\s+map|connection|graph)\b/i;
const MEMORY_PATTERN = /\b(?:remember|memory|note\s+for\s+later|keep\s+in\s+mind|preference)\b/i;
const MULTI_STEP_PATTERN =
  /\b(?:and\s+then|then\s+|after\s+that|also\b[^.?!]{0,60}\band\b|step\s+by\s+step|first\b[^.?!]{0,80}\bthen\b)/i;
const SIMPLE_QA_PATTERN =
  /^(?:what|who|when|where|which|how\s+many|how\s+much|is|are|was|were|does|did|do)\b/i;
/** Verbs that ask for work to be produced rather than a question to be answered. */
const TASK_VERB_PATTERN =
  /\b(?:draft|write|prepare|compose|revise|redline|rewrite|research|analy[sz]e|review|compare|classify|summari[sz]e|extract|generate|create|propose|identify|detect|build|assemble)\b/i;

/**
 * A question the assistant can answer in one pass.
 *
 * Domain keywords alone are not enough to justify a run: "What is the notice deadline?" mentions a
 * deadline but wants an answer, not a timeline analysis. Requiring question form and the absence of
 * a task verb keeps cheap questions cheap.
 */
function isPlainQuestion(text: string): boolean {
  if (TASK_VERB_PATTERN.test(text)) return false;
  return SIMPLE_QA_PATTERN.test(text) || text.trimEnd().endsWith("?");
}

const INTENT_AGENTS: Record<AgentIntent, string[]> = {
  simple_qa: ["matter_qa"],
  research: ["research_agent"],
  drafting: ["draft_agent"],
  contract_review: ["contract_agent"],
  deposition_prep: ["deposition_agent"],
  evidence_analysis: ["evidence_agent"],
  discovery_review: ["discovery_agent"],
  timeline_analysis: ["timeline_agent"],
  multi_step_task: ["research_agent", "draft_agent"],
};

/** Blocked operations that apply to every request, independent of what was asked. */
export const ALWAYS_BLOCKED_ACTIONS: string[] = [...DEFAULT_BLOCKED_ACTIONS];

export function detectBlockedActions(goal: string): string[] {
  const requested = BLOCKED_ACTION_PATTERNS.filter(({ pattern }) => pattern.test(goal)).map(
    ({ action }) => action,
  );
  return [...new Set([...ALWAYS_BLOCKED_ACTIONS, ...requested])];
}

/** Blocked operations the user explicitly asked for, which must be refused in the response. */
export function detectRequestedBlockedActions(goal: string): string[] {
  return BLOCKED_ACTION_PATTERNS.filter(({ pattern }) => pattern.test(goal)).map(
    ({ action }) => action,
  );
}

function countMatches(goal: string, patterns: RegExp[]): number {
  return patterns.filter((pattern) => pattern.test(goal)).length;
}

/**
 * Rules-first intent classification.
 *
 * Heuristics run before any model call so that routing is deterministic and testable, and so a
 * request that names a refused operation cannot be routed into one by a model's interpretation.
 * A request like "email opposing counsel and accept the settlement" classifies as drafting: the
 * agent may prepare text for review, and `blockedActions` records that sending and accepting are
 * refused. Nothing in the pipeline can promote a blocked action into an executable tool.
 */
export function classifyIntentWithRules(goal: string): IntentDecision {
  const text = goal.trim();
  const blockedActions = detectBlockedActions(text);
  const requestedBlocked = detectRequestedBlockedActions(text);
  const safetyNotes: string[] = [];

  if (requestedBlocked.length > 0) {
    safetyNotes.push(
      `NyayaGrid will not perform ${requestedBlocked.join(", ")}. The agent may prepare reviewable work product instead, and an attorney remains responsible for any external action.`,
    );
  }
  if (containsInstructionLikeDirectives(text)) {
    safetyNotes.push(
      "The request contains instruction-like text; it was treated as a user request and did not change tool authorization.",
    );
  }

  const decide = (
    intent: AgentIntent,
    confidence: IntentDecision["confidence"],
    rationale: string,
    requiresAgentRun: boolean,
  ): IntentDecision => ({
    intent,
    confidence,
    rationale,
    requiresAgentRun,
    blockedActions,
    suggestedAgents: INTENT_AGENTS[intent],
    source: "rules",
    safetyNotes,
  });

  // A request naming a refused external action still gets useful work: prepare the document.
  if (requestedBlocked.length > 0) {
    if (DRAFTING_PATTERN.test(text) || /\b(?:email|letter|message|response)\b/i.test(text)) {
      return decide(
        "drafting",
        "high",
        "Request names externally-facing actions NyayaGrid refuses; scoped to preparing reviewable draft text only.",
        true,
      );
    }
    return decide(
      "multi_step_task",
      "medium",
      "Request names refused actions; scoped to reviewable analysis with those actions blocked.",
      true,
    );
  }

  if (isPlainQuestion(text)) {
    return decide(
      "simple_qa",
      "high",
      "Single question answerable directly from matter sources.",
      false,
    );
  }

  const domainMatches = countMatches(text, [
    RESEARCH_PATTERN,
    DRAFTING_PATTERN,
    CONTRACT_PATTERN,
    DEPOSITION_PATTERN,
    EVIDENCE_PATTERN,
    DISCOVERY_PATTERN,
    TIMELINE_PATTERN,
  ]);

  if (MULTI_STEP_PATTERN.test(text) && domainMatches >= 2) {
    return decide(
      "multi_step_task",
      "high",
      "Request chains several capabilities and needs an orchestrated plan.",
      true,
    );
  }

  if (CONTRACT_PATTERN.test(text)) {
    return decide("contract_review", "high", "Request concerns contract or clause review.", true);
  }
  if (DEPOSITION_PATTERN.test(text)) {
    return decide(
      "deposition_prep",
      "high",
      "Request concerns deposition or testimony preparation.",
      true,
    );
  }
  if (DISCOVERY_PATTERN.test(text)) {
    return decide(
      "discovery_review",
      "high",
      "Request concerns discovery review or classification.",
      true,
    );
  }
  if (DRAFTING_PATTERN.test(text) && !SIMPLE_QA_PATTERN.test(text)) {
    return decide("drafting", "high", "Request asks for document drafting or revision.", true);
  }
  if (RESEARCH_PATTERN.test(text)) {
    return decide(
      "research",
      "high",
      "Request asks for legal research grounded in authority.",
      true,
    );
  }
  if (EVIDENCE_PATTERN.test(text)) {
    return decide(
      "evidence_analysis",
      "medium",
      "Request concerns evidence or contradictions.",
      true,
    );
  }
  if (TIMELINE_PATTERN.test(text) || GRAPH_PATTERN.test(text) || MEMORY_PATTERN.test(text)) {
    return decide(
      "timeline_analysis",
      "medium",
      "Request concerns matter chronology or verified relationships.",
      true,
    );
  }

  return decide("simple_qa", "low", "No task pattern matched; answering directly.", false);
}

export type ClassifyIntentParams = {
  goal: string;
  matterTitle?: string | null;
  conversationSummary?: string | null;
  availableCapabilities?: string[] | null;
  ai?: AIProvider;
  /** Use the model only when rules are not confident. Defaults to true. */
  useAiFallback?: boolean;
};

/**
 * Classifies intent, consulting the model only when the rules are unsure.
 *
 * The AI result can never widen authority: blocked actions detected by the rules are re-applied
 * on top of whatever the model returns, and the user's goal is quoted as untrusted content.
 */
export async function classifyIntent(params: ClassifyIntentParams): Promise<IntentDecision> {
  const rules = classifyIntentWithRules(params.goal);
  const shouldAskModel =
    params.useAiFallback !== false && Boolean(params.ai) && rules.confidence === "low";

  if (!shouldAskModel || !params.ai) return rules;

  try {
    const generation = await params.ai.generate({
      temperature: 0,
      schemaName: "intent_classification",
      messages: [
        { role: "system", content: buildIntentClassificationSystemPrompt() },
        {
          role: "user",
          content: buildIntentClassificationUserPrompt({
            matterTitle: params.matterTitle ?? "(no matter)",
            userMessage: wrapUntrustedContent("user goal", params.goal),
            conversationSummary: params.conversationSummary ?? null,
            availableCapabilities: params.availableCapabilities ?? null,
          }),
        },
      ],
    });

    const parsed = intentSchema.safeParse(JSON.parse(generation.text) as unknown);
    if (!parsed.success) return rules;

    return {
      intent: parsed.data.intent,
      confidence: parsed.data.confidence,
      rationale: parsed.data.rationale,
      requiresAgentRun: parsed.data.requiresAgentRun,
      blockedActions: [...new Set([...rules.blockedActions, ...parsed.data.blockedActions])],
      suggestedAgents:
        parsed.data.suggestedAgents.length > 0
          ? parsed.data.suggestedAgents
          : INTENT_AGENTS[parsed.data.intent],
      source: "ai",
      safetyNotes: rules.safetyNotes,
    };
  } catch {
    return rules;
  }
}

export const intentDecisionSchema = z.object({
  intent: agentIntentSchema,
  confidence: z.enum(["low", "medium", "high"]),
  rationale: z.string(),
  requiresAgentRun: z.boolean(),
  blockedActions: z.array(z.string()),
  suggestedAgents: z.array(z.string()),
  source: z.enum(["rules", "ai"]),
  safetyNotes: z.array(z.string()),
});
