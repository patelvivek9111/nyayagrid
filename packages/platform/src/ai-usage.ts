/**
 * Stable, call-site-facing usage recorder.
 *
 * `./usage.ts` (`recordAiUsageEvent`/`recordAiUsageEventSafe`) writes directly against the
 * `ai_usage_events` columns (`workspace`, `capability`, `embeddingTokens`, ...). Call sites in
 * `apps/web` were written against a simpler, older shape — a free-form `feature` string plus
 * `latencyMs`/`success`/`errorMessage` — before that table's columns were finalized. Rather than
 * churn every call site again, `recordUsage` is kept as the stable public entry point and adapts
 * the old shape onto the current schema: `feature` is mapped to a best-effort `workspace` +
 * `capability`, and the fields the table no longer has a column for (`latencyMs`, `success`,
 * `errorMessage`) are carried in `metadata` (subject to the same content-key stripping as any
 * other metadata — see `sanitizeUsageMetadata`).
 */
import type { Database } from "@nyayagrid/database";
import type { ModelCapability } from "./models";
import { recordAiUsageEventSafe, type AiUsageEventInput, type AiUsageWorkspace } from "./usage";

export type RecordUsageInput = {
  organizationId?: string | null;
  userId?: string | null;
  matterId?: string | null;
  /** Short, stable identifier for the call site, e.g. "nyaya.ask", "guide.ask", "agent.draft". */
  feature: string;
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  success?: boolean;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
};

const FEATURE_CAPABILITY_PREFIXES: Array<[string, ModelCapability]> = [
  ["agent.", "agents"],
  ["nyaya.", "qa"],
  ["guide.", "guide"],
  ["professor.", "professor"],
  ["research.", "research"],
  ["draft.", "draft"],
  ["extraction.", "extraction"],
  ["embedding", "embeddings"],
];

/** Best-effort mapping from a free-form feature string to the fixed capability enum. */
export function inferCapabilityFromFeature(feature: string): ModelCapability {
  const match = FEATURE_CAPABILITY_PREFIXES.find(([prefix]) => feature.startsWith(prefix));
  return match?.[1] ?? "qa";
}

/**
 * Best-effort mapping from a feature string (and whether an organization is present) to the
 * workspace enum. Guide/Professor are user-scoped workspaces with no organization by design.
 */
export function inferWorkspaceFromFeature(
  feature: string,
  organizationId?: string | null,
): AiUsageWorkspace {
  if (feature.startsWith("guide.")) return "public";
  if (feature.startsWith("professor.")) return "student";
  return organizationId ? "professional" : "public";
}

/**
 * Records usage without letting an accounting failure fail the caller's primary request. This is
 * the function `apps/web` route handlers call after an AI call completes (success or failure).
 */
export async function recordUsage(db: Database, input: RecordUsageInput) {
  if (!input.userId) return null;

  const metadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    feature: input.feature,
  };
  if (input.latencyMs !== undefined && input.latencyMs !== null)
    metadata.latencyMs = input.latencyMs;
  if (input.success !== undefined) metadata.success = input.success;
  if (input.errorMessage) metadata.errorMessage = input.errorMessage;

  const event: AiUsageEventInput = {
    organizationId: input.organizationId,
    userId: input.userId,
    matterId: input.matterId,
    workspace: inferWorkspaceFromFeature(input.feature, input.organizationId),
    capability: inferCapabilityFromFeature(input.feature),
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens ?? undefined,
    outputTokens: input.outputTokens ?? undefined,
    metadata,
  };

  return recordAiUsageEventSafe(db, event);
}
