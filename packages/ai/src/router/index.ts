export {
  MODEL_REGISTRY_VERSION,
  PINNED_MODEL_IDS,
  buildDefaultModelRegistry,
  overlayRegistryEvidence,
  getRegistryEntry,
  isAutoEligible,
  isCertifiedFor,
  countAutoEligibleProviders,
  parseModelRef,
  resolvePinnedModelId,
  type ModelLifecycle,
  type ModelRegistryEntry,
  type SubsystemCertification,
} from "./registry";
export { classifyRisk, classifyTask, deriveRiskSignalsFromRequest, isKnownRouterSchemaName, toCertificationSubsystem } from "./classifier";
export { selectStrategy, STRATEGY_LABELS } from "./strategy";
export { scoreModel, pickHighest, ROUTING_SCORE_VERSION } from "./score";
export { analyzeDisagreement, extractClaimsFromText } from "./disagreement";
export { NyayaRouter, type NyayaRouterOptions, NYAYA_ROUTER_VERSION, DEFAULT_ROUTER_TIMEOUT_MS } from "./router";
export { AnthropicProvider } from "./providers/anthropic";
export { XaiProvider } from "./providers/xai";
export { GoogleProvider } from "./providers/google";
export { FakeProvider } from "./providers/fake";
export {
  ProviderError,
  RouterUnavailableError,
  RouterPolicyError,
  ROUTER_UNAVAILABLE_USER_MESSAGE,
  classifyThrownError,
  classifyCredentialFailure,
  type CredentialFailureClass,
} from "./errors";
export { resolveKillSwitches } from "./kill-switch";
export { resolveEnvProviderPolicy, mergeProviderPolicy, isProviderAllowed } from "./policy";
export { ProviderHealthTracker, defaultHealthTracker } from "./health";
export { budgetFor, STRATEGY_BUDGETS } from "./budget";
export { estimateCostUsd, lookupModelPrice } from "./pricing";
export { defaultRouterMetrics } from "./metrics";
export {
  normalizePromptMessages,
  sanitizeMessageContent,
  toAnthropicBody,
  toGoogleContents,
} from "./messages";
export { parseJsonObject, extractJsonText } from "./structured";
export { listValidatedRoutingOptions, isCertificationSubsystem } from "./options";
export type { RoutingOptions, RoutingOptionModel } from "./options";
export {
  decideCertification,
  pickPreferredAuto,
  rankFallbackOrder,
  blockedExternalMeasurement,
  CERTIFICATION_RULES_VERSION,
} from "./certify";
export { providerApiKeyPresent, googleApiKeyFromEnv } from "./direct-provider";
export type { DirectProviderId } from "./direct-provider";
export type { SubsystemMeasurement } from "./certify";
export { CERTIFICATION_EVIDENCE } from "./certification-evidence";
export type { CertificationEvidence, CertificationEvidenceModel } from "./certification-evidence";
export type { RoutingAuditRecord } from "./audit";
export type { NormalizedClaim, DisagreementResult } from "./disagreement";
