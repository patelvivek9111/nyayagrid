/**
 * Phase 9 — AI usage accounting.
 *
 * One row per model call, so three questions can be answered later: what did this organization spend,
 * which capability spent it, and did a specific agent run cost what we thought. It is an accounting
 * record, not a transcript: token counts and identifiers only. Prompts, completions, document text
 * and anything else a lawyer would consider privileged never belong in this table, which is why
 * metadata is filtered rather than trusted.
 */
import { aiUsageEvents, type Database } from "@nyayagrid/database";
import { createLogger } from "@nyayagrid/observability";
import type { ModelCapability } from "./models";

const logger = createLogger("platform.usage");

export type AiUsageWorkspace = "professional" | "student" | "public";

export type AiUsageEventInput = {
  /** Null for student and public workspaces, which have no organization by design. */
  organizationId?: string | null;
  userId: string;
  matterId?: string | null;
  workspace: AiUsageWorkspace;
  capability: ModelCapability;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  embeddingTokens?: number;
  /** Omit to derive it from the token counts; pass null to record no estimate. */
  estimatedCostCents?: number | null;
  agentRunId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Keys that carry model or document text. Anything matching is dropped before the row is written:
 * a usage record that accidentally stores a prompt turns a billing table into an uncontrolled copy
 * of client material with a different retention policy.
 */
const CONTENT_KEY_PATTERN =
  /(prompt|completion|answer|message|content|text|body|quote|excerpt|passage|chunk|document|transcript)/i;

export function sanitizeUsageMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (CONTENT_KEY_PATTERN.test(key)) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    // Only scalars survive. A nested object could hide text under an innocent-looking key.
    if (["string", "number", "boolean"].includes(typeof value)) {
      out[key] = typeof value === "string" && value.length > 200 ? value.slice(0, 200) : value;
    }
  }
  return out;
}

/** List prices in cents per million tokens, recorded when this table was added. */
const PRICE_TABLE: Record<string, { inputPerMillionCents: number; outputPerMillionCents: number }> =
  {
    "gpt-4o": { inputPerMillionCents: 250, outputPerMillionCents: 1000 },
    "gpt-4o-mini": { inputPerMillionCents: 15, outputPerMillionCents: 60 },
    "text-embedding-3-small": { inputPerMillionCents: 2, outputPerMillionCents: 0 },
    "text-embedding-3-large": { inputPerMillionCents: 13, outputPerMillionCents: 0 },
  };

/**
 * A rough, deliberately non-authoritative cost estimate for dashboards and budget alerts.
 *
 * Returns null for any model that is not in the table above, and for the mock providers, rather than
 * guessing. Provider prices change and per-account rates differ, so this must never be treated as a
 * bill, reconciled against an invoice, or shown to a client as a charge.
 */
export function estimateCostCents(params: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  embeddingTokens?: number;
}): number | null {
  const price = PRICE_TABLE[params.model];
  if (!price) return null;

  const inputTokens = (params.inputTokens ?? 0) + (params.embeddingTokens ?? 0);
  const outputTokens = params.outputTokens ?? 0;
  const cents =
    (inputTokens / 1_000_000) * price.inputPerMillionCents +
    (outputTokens / 1_000_000) * price.outputPerMillionCents;
  return Math.round(cents);
}

function nonNegativeInt(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

export async function recordAiUsageEvent(db: Database, event: AiUsageEventInput) {
  const inputTokens = nonNegativeInt(event.inputTokens);
  const outputTokens = nonNegativeInt(event.outputTokens);
  const embeddingTokens = nonNegativeInt(event.embeddingTokens);
  const estimatedCostCents =
    event.estimatedCostCents === undefined
      ? estimateCostCents({ model: event.model, inputTokens, outputTokens, embeddingTokens })
      : event.estimatedCostCents;

  const [row] = await db
    .insert(aiUsageEvents)
    .values({
      organizationId: event.organizationId ?? null,
      userId: event.userId,
      matterId: event.matterId ?? null,
      workspace: event.workspace,
      capability: event.capability,
      provider: event.provider,
      model: event.model,
      inputTokens,
      outputTokens,
      embeddingTokens,
      estimatedCostCents,
      agentRunId: event.agentRunId ?? null,
      metadata: sanitizeUsageMetadata(event.metadata),
    })
    .returning();
  return row;
}

/**
 * Records usage without letting an accounting failure fail the user's legal work. Use this on the
 * response path; use `recordAiUsageEvent` where the caller genuinely needs the row.
 */
export async function recordAiUsageEventSafe(db: Database, event: AiUsageEventInput) {
  try {
    return await recordAiUsageEvent(db, event);
  } catch (error) {
    logger.error("Failed to record AI usage event", {
      capability: event.capability,
      provider: event.provider,
      model: event.model,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return undefined;
  }
}
