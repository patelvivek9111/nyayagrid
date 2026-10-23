import type { CredentialPresenceReport } from "./credentials.js";

export type ModelAccessStatus = "ACCESS_CONFIRMED" | "ACCESS_NOT_CONFIRMED" | "KEY_MISSING";

export type ModelAccessReport = Record<string, ModelAccessStatus>;

const MODELS = [
  "gpt-6.1-sol",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "gemini-4-argon",
  "grok-4.7",
] as const;

/**
 * Zero-inference access classification.
 * Without credentials, all models are KEY_MISSING.
 * Listing endpoints are not called here to avoid accidental spend or secret leakage;
 * when keys are present, callers may separately invoke provider Models/list APIs.
 */
export function classifyModelAccessFromCredentials(
  credentials: CredentialPresenceReport,
): ModelAccessReport {
  const map: ModelAccessReport = {};
  for (const id of MODELS) {
    if (id.startsWith("gpt-") || id === "gpt-6.1-sol") {
      map[id] = credentials.OPENAI_API_KEY === "PRESENT" ? "ACCESS_NOT_CONFIRMED" : "KEY_MISSING";
    } else if (id.startsWith("claude-")) {
      map[id] =
        credentials.ANTHROPIC_API_KEY === "PRESENT" ? "ACCESS_NOT_CONFIRMED" : "KEY_MISSING";
    } else if (id.startsWith("gemini-")) {
      map[id] = credentials.GOOGLE_API_KEY === "PRESENT" ? "ACCESS_NOT_CONFIRMED" : "KEY_MISSING";
    } else if (id.startsWith("grok-")) {
      map[id] = credentials.XAI_API_KEY === "PRESENT" ? "ACCESS_NOT_CONFIRMED" : "KEY_MISSING";
    } else {
      map[id] = "ACCESS_NOT_CONFIRMED";
    }
  }
  return map;
}

export { MODELS as STAGE1_ACCESS_MODEL_IDS };
