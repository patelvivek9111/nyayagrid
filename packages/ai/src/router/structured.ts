/**
 * Local structured-output validation. Provider "JSON mode" is never trusted alone.
 */

export function extractJsonText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (candidate.startsWith("{") || candidate.startsWith("[")) {
    const endBrace = candidate.lastIndexOf("}");
    const endBracket = candidate.lastIndexOf("]");
    const end = Math.max(endBrace, endBracket);
    if (end > 0) return candidate.slice(0, end + 1);
    return candidate;
  }
  const start = candidate.search(/[{[]/);
  if (start < 0) return null;
  const slice = candidate.slice(start);
  const endBrace = slice.lastIndexOf("}");
  const endBracket = slice.lastIndexOf("]");
  const end = Math.max(endBrace, endBracket);
  if (end < 0) return null;
  return slice.slice(0, end + 1);
}

export function parseJsonObject(raw: string): { ok: true; value: unknown } | { ok: false } {
  const extracted = extractJsonText(raw);
  if (!extracted) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(extracted) };
  } catch {
    return { ok: false };
  }
}

export const MAX_STRUCTURED_REPAIR_ATTEMPTS = 1;

export function isLikelyJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
