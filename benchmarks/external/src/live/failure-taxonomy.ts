export type FailureTaxonomyCategory =
  | "successful"
  | "rate_limit"
  | "temporary_5xx"
  | "transport_pre_dispatch"
  | "transport_post_dispatch_unknown"
  | "timeout_pre_dispatch"
  | "timeout_post_dispatch_unknown"
  | "auth"
  | "billing"
  | "parser"
  | "semantic_refusal"
  | "unknown_completion"
  | "other";

export type ProviderFailureTaxonomy = Record<FailureTaxonomyCategory, number>;

export function emptyFailureTaxonomy(): ProviderFailureTaxonomy {
  return {
    successful: 0,
    rate_limit: 0,
    temporary_5xx: 0,
    transport_pre_dispatch: 0,
    transport_post_dispatch_unknown: 0,
    timeout_pre_dispatch: 0,
    timeout_post_dispatch_unknown: 0,
    auth: 0,
    billing: 0,
    parser: 0,
    semantic_refusal: 0,
    unknown_completion: 0,
    other: 0,
  };
}

export type FailureTaxonomyByProvider = Record<string, ProviderFailureTaxonomy>;

export function bumpTaxonomy(
  byProvider: FailureTaxonomyByProvider,
  provider: string,
  category: FailureTaxonomyCategory,
): void {
  if (!byProvider[provider]) byProvider[provider] = emptyFailureTaxonomy();
  byProvider[provider]![category] += 1;
}

export function classifyErrorToTaxonomy(err: unknown): FailureTaxonomyCategory {
  if (!err || typeof err !== "object") return "other";
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  const message = err instanceof Error ? err.message : String(err);
  switch (code) {
    case "RATE_LIMIT":
      return "rate_limit";
    case "TEMPORARY_PROVIDER_ERROR":
      return /non-JSON|parse|JSON/i.test(message) ? "parser" : "temporary_5xx";
    case "TRANSPORT_PRE_DISPATCH":
    case "TRANSPORT_ERROR":
      return "transport_pre_dispatch";
    case "TRANSPORT_POST_DISPATCH_UNKNOWN":
      return "transport_post_dispatch_unknown";
    case "TIMEOUT_PRE_DISPATCH":
      return "timeout_pre_dispatch";
    case "TIMEOUT_POST_DISPATCH_UNKNOWN":
      return "timeout_post_dispatch_unknown";
    case "AUTH_ERROR":
      return /billing|credit|quota/i.test(message) ? "billing" : "auth";
    case "CONTENT_FILTER_OR_REFUSAL":
      return "semantic_refusal";
    case "UNKNOWN_COMPLETION":
    case "UNKNOWN_COMPLETION_REVIEW_REQUIRED":
      return "unknown_completion";
    default:
      return "other";
  }
}
