/**
 * Deterministic guards: provider request bodies must never silently enable live web /
 * search / grounding tools. Web Research uses a separate explicit client.
 */

const FORBIDDEN_WEB_KEYS = [
  "tools",
  "tool_choice",
  "functions",
  "function_call",
  "web_search_options",
  "live_search",
  "search_parameters",
  "plugins",
  "file_search",
  "googleSearch",
  "google_search",
  "googleSearchRetrieval",
  "grounding",
  "toolsConfig",
  "toolConfig",
] as const;

export type ProviderRequestAudit = {
  provider: "openai" | "xai" | "google" | "anthropic";
  body: Record<string, unknown>;
};

export function assertNoSilentWebTools(audit: ProviderRequestAudit): void {
  const found = collectForbiddenKeys(audit.body);
  if (found.length > 0) {
    throw new Error(
      `Silent web/search tools forbidden on ${audit.provider} generate body: ${found.join(", ")}`,
    );
  }
}

function collectForbiddenKeys(
  value: unknown,
  path = "",
  out: string[] = [],
): string[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectForbiddenKeys(item, `${path}[${i}]`, out));
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if ((FORBIDDEN_WEB_KEYS as readonly string[]).includes(key)) {
      out.push(next);
    }
    collectForbiddenKeys(child, next, out);
  }
  return out;
}

/** Snapshot helpers used by unit tests against real body builders. */
export function openaiBodyWebEnabled(body: Record<string, unknown>): boolean {
  return collectForbiddenKeys(body).length > 0;
}

export function xaiBodyWebEnabled(body: Record<string, unknown>): boolean {
  return collectForbiddenKeys(body).length > 0;
}

export function googleBodyWebEnabled(body: Record<string, unknown>): boolean {
  return collectForbiddenKeys(body).length > 0;
}

export function anthropicBodyWebEnabled(body: Record<string, unknown>): boolean {
  return collectForbiddenKeys(body).length > 0;
}
