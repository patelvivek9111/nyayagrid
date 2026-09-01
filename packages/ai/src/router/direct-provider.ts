/**
 * Direct-adapter helpers for certification. Construction lives next to OpenAIProvider
 * in `index.ts` to avoid a circular import.
 */

import type { ProviderId } from "../provider-contract";

export type DirectProviderId = Extract<ProviderId, "openai" | "anthropic" | "xai" | "google">;

export function googleApiKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return (
    env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    env.GEMINI_API_KEY?.trim() ||
    env.GOOGLE_API_KEY?.trim() ||
    undefined
  );
}

export function providerApiKeyPresent(
  provider: DirectProviderId,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY?.trim());
  if (provider === "anthropic") return Boolean(env.ANTHROPIC_API_KEY?.trim());
  if (provider === "xai") return Boolean(env.XAI_API_KEY?.trim());
  return Boolean(googleApiKeyFromEnv(env));
}
