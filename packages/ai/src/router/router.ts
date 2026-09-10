/**
 * Nyaya Router v1 — deterministic multi-provider execution.
 *
 * Trust layer (citations, jurisdiction, provenance, abstention, Review) remains in callers.
 * This module only chooses a VALIDATED execution path and bounds operational failover.
 */

import type {
  AiGenerateRequest,
  AiGenerateResult,
  AIProvider,
  ExecutionStrategy,
  ProviderId,
  RouterRequestContext,
} from "../provider-contract";
import {
  classifyThrownError,
  isOperationalProviderFailure,
  ProviderError,
  RouterPolicyError,
  RouterUnavailableError,
} from "./errors";
import { estimateTokensFromMessages, generateWithTimeout } from "./http";
import { parseJsonObject } from "./structured";
import { estimateCostUsd, sumEstimatedCosts } from "./pricing";
import {
  buildDefaultModelRegistry,
  getRegistryEntry,
  isAutoEligible,
  isCertifiedFor,
  MODEL_REGISTRY_VERSION,
  parseModelRef,
  resolvePinnedModelId,
  type ModelRegistryEntry,
} from "./registry";
import { classifyRisk, classifyTask, deriveRiskSignalsFromRequest, isKnownRouterSchemaName, toCertificationSubsystem } from "./classifier";
import { isProviderAllowed, mergeProviderPolicy, resolveEnvProviderPolicy } from "./policy";
import {
  defaultHealthTracker,
  type HealthEvent,
  type ProviderHealthTracker,
} from "./health";
import { BudgetMeter, budgetFor } from "./budget";
import { pickHighest, scoreModel, type RoutingScoreBreakdown } from "./score";
import { selectStrategy } from "./strategy";
import { analyzeDisagreement } from "./disagreement";
import {
  auditHasNoSecrets,
  newRunId,
  sanitizeAudit,
  ROUTING_AUDIT_VERSION,
  type RoutingAuditRecord,
} from "./audit";
import { LAST_AUDITS_RING, ProviderCallLedger } from "../call-telemetry";
import {
  isModelKilled,
  isProductionLikeEnv,
  resolveKillSwitches,
  type KillSwitches,
} from "./kill-switch";
import { defaultRouterMetrics, type RouterMetrics } from "./metrics";

/** Per-attempt bound. Long drafts may pass a higher request.timeoutMs. */
const DEFAULT_TIMEOUT_MS = 60_000;
export const NYAYA_ROUTER_VERSION = "nyaya-router-v1.1";
export const DEFAULT_ROUTER_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

export type NyayaRouterOptions = {
  providers: Partial<Record<ProviderId, AIProvider>>;
  registry?: ModelRegistryEntry[];
  health?: ProviderHealthTracker;
  metrics?: RouterMetrics;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Env AI_PROVIDER — preferred when scoring, and the public `name`. */
  envProvider?: string;
  onAudit?: (record: RoutingAuditRecord) => void;
};

function envTimeoutMs(env: Record<string, string | undefined>): number | undefined {
  const raw = env.AI_TIMEOUT_MS;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function healthEventFromError(error: ProviderError): HealthEvent {
  if (error.code === "timeout") return "timeout";
  if (error.code === "rate_limit") return "rate_limit";
  if (error.code === "server_error") return "server_error";
  if (error.code === "malformed") return "malformed";
  return "transport_failure";
}

export class NyayaRouter implements AIProvider {
  readonly name: string;
  readonly lastAudits: RoutingAuditRecord[] = [];
  readonly callLedger = new ProviderCallLedger();
  private readonly providers: Partial<Record<ProviderId, AIProvider>>;
  private readonly registry: ModelRegistryEntry[];
  private readonly health: ProviderHealthTracker;
  private readonly metrics: RouterMetrics;
  private readonly env: Record<string, string | undefined>;
  private readonly timeoutMs: number;
  private readonly envProvider: string;
  private readonly onAudit?: (record: RoutingAuditRecord) => void;

  constructor(options: NyayaRouterOptions) {
    this.providers = options.providers;
    this.env = options.env ?? process.env;
    this.registry = options.registry ?? buildDefaultModelRegistry(this.env);
    this.health = options.health ?? defaultHealthTracker;
    this.metrics = options.metrics ?? defaultRouterMetrics;
    this.timeoutMs = options.timeoutMs ?? envTimeoutMs(this.env) ?? DEFAULT_TIMEOUT_MS;
    this.envProvider = options.envProvider ?? this.env.AI_PROVIDER ?? "mock";
    this.name = this.envProvider;
    this.onAudit = options.onAudit;
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const decisionStarted = Date.now();
    const routing = request.routing ?? {};
    const switches = resolveKillSwitches(this.env);
    const subsystem = classifyTask(request);
    const certSubsystem = toCertificationSubsystem(subsystem);
    const contextTokens =
      routing.contextTokensEstimate ?? estimateTokensFromMessages(request.messages);
    const derivedSignals = deriveRiskSignalsFromRequest(request);
    const risk = classifyRisk({
      subsystem,
      signals: [...derivedSignals, ...(routing.riskSignals ?? [])],
      contextTokensEstimate: contextTokens,
      draftType: routing.draftType,
    });
    let strategyPick = selectStrategy({
      requested: routing.strategy ?? "auto",
      subsystem,
      risk: risk.level,
      deepDisabled: switches.deepDisabled,
    });
    const policy = mergeProviderPolicy(
      resolveEnvProviderPolicy(this.env),
      routing.providerPolicy,
    );

    const runId = routing.runId ?? newRunId();
    const fallbacks: RoutingAuditRecord["fallbacks"] = [];
    let decisionLatencyMs = 0;

    const emitUnavailable = (reason: string, extra?: Partial<RoutingAuditRecord>): never => {
      const audit = this.finishAudit({
        runId,
        routing,
        subsystem,
        strategyRequested: routing.strategy ?? "auto",
        strategySelected: strategyPick.selected,
        riskLevel: risk.level,
        provider: "none",
        model: "none",
        certificationStatus: "none",
        routingReason: reason,
        fallbacks,
        healthState: "UNAVAILABLE",
        decisionLatencyMs: Date.now() - decisionStarted,
        finalStatus: extra?.finalStatus ?? "unavailable",
        estimatedCost: { known: false },
        latencyMs: Date.now() - decisionStarted,
        ...extra,
      });
      this.metrics.record({
        provider: "none",
        strategy: strategyPick.selected,
        fallback: fallbacks.length > 0,
        deepEscalation: strategyPick.escalated,
        error: true,
        decisionLatencyMs: audit.decisionLatencyMs,
      });
      throw new RouterUnavailableError(reason);
    };

    if (subsystem === "agents" && this.env.FEATURE_AGENTS !== "1" && isProductionLikeEnv(this.env)) {
      emitUnavailable("Agents are disabled in staging/production");
    }
    if (
      request.schemaName &&
      !isKnownRouterSchemaName(request.schemaName) &&
      !routing.subsystem &&
      isProductionLikeEnv(this.env)
    ) {
      emitUnavailable(`unknown schemaName refused in staging/production`);
    }

    let selected: { entry: ModelRegistryEntry; score: RoutingScoreBreakdown; reason: string };

    try {
      selected = this.selectModel({
        routing,
        certSubsystem,
        strategy: strategyPick.selected,
        contextTokens,
        policy,
        switches,
        reasonPrefix: strategyPick.reason,
      });
    } catch (error) {
      if (error instanceof RouterPolicyError) {
        emitUnavailable(error.message, { finalStatus: "policy_blocked" });
      }
      throw error;
    }

    if (strategyPick.selected === "deep") {
      const verifier = this.findVerifier({
        primary: selected.entry,
        certSubsystem,
        contextTokens,
        policy,
        switches,
      });
      if (!verifier) {
        strategyPick = {
          selected: "standard",
          reason:
            "Deep Review has no validated independent verifier; using Standard",
          escalated: false,
        };
      }
    }

    decisionLatencyMs = Date.now() - decisionStarted;
    const budget = new BudgetMeter(budgetFor(strategyPick.selected));
    const costs: AiGenerateResult["estimatedCost"][] = [];
    let primaryResult: AiGenerateResult | undefined;
    let usedEntry = selected.entry;
    let providerLatencyMs = 0;
    let verificationLatencyMs = 0;
    let fallbackOverheadMs = 0;

    const tryGenerate = async (
      entry: ModelRegistryEntry,
      kind: "primary" | "fallback" | "verifier",
    ): Promise<AiGenerateResult> => {
      if (!budget.canCallModel()) {
        throw new ProviderError({
          provider: entry.provider,
          code: "unavailable",
          message: "Execution call budget exceeded",
        });
      }
      if (kind === "fallback" && !budget.canFallback()) {
        throw new ProviderError({
          provider: entry.provider,
          code: "unavailable",
          message: "Fallback budget exceeded",
        });
      }
      if (kind === "verifier" && !budget.canVerify()) {
        throw new ProviderError({
          provider: entry.provider,
          code: "unavailable",
          message: "Verifier budget exceeded",
        });
      }
      const adapter = this.providers[entry.provider];
      if (!adapter) {
        throw new ProviderError({
          provider: entry.provider,
          code: "unavailable",
          modelId: entry.modelId,
          message: `${entry.provider} adapter is not configured`,
        });
      }
      const started = Date.now();
      if (!this.health.tryAcquire(entry.provider, entry.modelId)) {
        throw new ProviderError({
          provider: entry.provider,
          code: "unavailable",
          modelId: entry.modelId,
          message: "provider circuit open or half-open probe already in flight",
        });
      }
      let recordedHttp = false;
      const timeoutMs = request.timeoutMs ?? this.timeoutMs;
      const recordAttempt = (params: { success: boolean; result?: AiGenerateResult; status?: string }) => {
        this.callLedger.record({
          runId,
          correlationId: runId,
          organizationId: routing.organizationId,
          matterId: routing.matterId,
          subsystem,
          provider: entry.provider,
          requestedModel: routing.modelId ?? entry.modelId,
          servedModel: params.result?.model || entry.modelId,
          inputTokens: params.result?.usage?.inputTokens ?? 0,
          outputTokens: params.result?.usage?.outputTokens ?? 0,
          latencyMs: Date.now() - started,
          success: params.success,
          fallbackCount: kind === "fallback" ? 1 : 0,
          finalStatus: params.status ?? (params.success ? "ok" : "error"),
          attemptKind: kind,
        });
      };
      try {
        const result = await generateWithTimeout(
          (signal) =>
            adapter.generate({
              ...request,
              signal: request.signal ?? signal,
            }),
          timeoutMs,
          request.signal,
        );
        recordAttempt({ success: true, result });
        recordedHttp = true;
        const parsed = parseJsonObject(result.text);
        if (!parsed.ok && request.schemaName) {
          throw new ProviderError({
            provider: entry.provider,
            code: "malformed",
            modelId: entry.modelId,
            message: "Provider returned non-JSON structured output",
          });
        }
        this.health.record(entry.provider, "success", entry.modelId);
        const tokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
        const cost = estimateCostUsd({
          modelId: entry.modelId,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        });
        costs.push(cost);
        budget.recordCall(kind, tokens, cost.known ? cost.amountUsd : null);
        const withMeta: AiGenerateResult = {
          ...result,
          provider: result.provider || entry.provider,
          model: result.model || entry.modelId,
          latencyMs: result.latencyMs ?? Date.now() - started,
          estimatedCost: cost,
        };
        if (kind === "primary") providerLatencyMs += withMeta.latencyMs ?? 0;
        if (kind === "fallback") fallbackOverheadMs += withMeta.latencyMs ?? 0;
        if (kind === "verifier") verificationLatencyMs += withMeta.latencyMs ?? 0;
        return withMeta;
      } catch (error) {
        if (!recordedHttp) recordAttempt({ success: false, status: "error" });
        const normalized = classifyThrownError(entry.provider, error);
        this.health.record(entry.provider, healthEventFromError(normalized), entry.modelId);
        throw normalized;
      } finally {
        this.health.release(entry.provider, entry.modelId);
      }
    };

    try {
      primaryResult = await tryGenerate(usedEntry, "primary");
    } catch (error) {
      const normalized = classifyThrownError(usedEntry.provider, error);
      if (!isOperationalProviderFailure(normalized.code)) {
        emitUnavailable(`non-operational provider failure: ${normalized.code}`);
      }
      const fallbackEntry = this.findFallback({
        failed: usedEntry,
        certSubsystem,
        strategy: strategyPick.selected,
        contextTokens,
        policy,
        switches,
        budget,
      });
      if (!fallbackEntry) {
        emitUnavailable(
          `operational failure (${normalized.code}) with no validated fallback`,
        );
      } else {
      fallbacks.push({
        provider: fallbackEntry.entry.provider,
        model: fallbackEntry.entry.modelId,
        reason: `primary ${usedEntry.provider} ${normalized.code}`,
      });
      try {
        primaryResult = await tryGenerate(fallbackEntry.entry, "fallback");
        usedEntry = fallbackEntry.entry;
      } catch {
        emitUnavailable("validated fallback also failed operationally");
      }
      }
    }

    if (!primaryResult) {
      emitUnavailable("no provider result");
    }
    let output = primaryResult as AiGenerateResult;

    let disagreementUnresolved = false;
    let verifierProvider: string | undefined;
    let verifierModel: string | undefined;
    if (strategyPick.selected === "deep" && budget.canVerify()) {
      const verifier = this.findVerifier({
        primary: usedEntry,
        certSubsystem,
        contextTokens,
        policy,
        switches,
      });
      if (verifier) {
        try {
          const verifierResult = await tryGenerate(verifier.entry, "verifier");
          verifierProvider = verifier.entry.provider;
          verifierModel = verifier.entry.modelId;
          const disagreement = analyzeDisagreement({
            primaryText: output.text,
            verifierText: verifierResult.text,
            evidenceChunkIds: routing.evidenceChunkIds,
            authorityIds: routing.authorityIds,
          });
          disagreementUnresolved = disagreement.unresolved;
          const verifierWins =
            disagreement.findings.length > 0 &&
            disagreement.findings.every((f) => f.evidenceWinner === "verifier");
          // Evidence-supported replacement only. Never majority-vote. Caller trust layer still runs.
          if (verifierWins) {
            output = verifierResult;
          }
        } catch {
          // Verifier operational failure does not answer-shop; keep primary.
        }
      }
    }

    const estimatedCost = sumEstimatedCosts(
      costs.filter((c): c is NonNullable<typeof c> => Boolean(c)),
    );
    const audit = this.finishAudit({
      runId,
      routing,
      subsystem,
      strategyRequested: routing.strategy ?? "auto",
      strategySelected: strategyPick.selected,
      riskLevel: risk.level,
      provider: usedEntry.provider,
      model: output.model,
      certificationStatus: usedEntry.certification[certSubsystem],
      routingReason: selected.reason,
      fallbacks,
      healthState: this.health.state(usedEntry.provider, usedEntry.modelId),
      promptVersion: routing.promptVersion,
      retrievalIds: routing.retrievalIds,
      jurisdictionSummary: routing.jurisdictionSummary,
      tokenUsage: output.usage,
      estimatedCost,
      latencyMs: Date.now() - decisionStarted,
      providerLatencyMs,
      verificationLatencyMs,
      fallbackOverheadMs,
      decisionLatencyMs,
      finalStatus: "ok",
      verifierProvider,
      verifierModel,
      disagreementUnresolved,
    });
    this.metrics.record({
      provider: usedEntry.provider,
      strategy: strategyPick.selected,
      fallback: fallbacks.length > 0,
      deepEscalation: strategyPick.escalated,
      error: false,
      decisionLatencyMs: audit.decisionLatencyMs,
      estimatedUsd: estimatedCost.known ? estimatedCost.amountUsd : null,
    });

    return {
      ...output,
      estimatedCost,
    };
  }

  private selectModel(params: {
    routing: RouterRequestContext;
    certSubsystem: ReturnType<typeof toCertificationSubsystem>;
    strategy: ExecutionStrategy;
    contextTokens: number;
    policy: ReturnType<typeof mergeProviderPolicy>;
    switches: KillSwitches;
    reasonPrefix: string;
  }): { entry: ModelRegistryEntry; score: RoutingScoreBreakdown; reason: string } {
    if (params.routing.modelId) {
      return this.selectManualModel(params);
    }

    const scores: RoutingScoreBreakdown[] = [];
    const candidates: ModelRegistryEntry[] = [];
    for (const entry of this.registry) {
      if (!this.providers[entry.provider]) continue;
      if (!isProviderAllowed(entry.provider, params.policy)) continue;
      if (isModelKilled(params.switches, entry.provider, entry.modelId)) continue;
      if (entry.provider === "mock" && (isProductionLikeEnv(this.env) || (this.envProvider !== "mock" && this.envProvider !== "fake"))) {
        continue;
      }
      if (this.envProvider === "mock" && entry.provider !== "mock" && entry.provider !== "fake") {
        continue;
      }
      if (params.contextTokens > entry.contextWindowTokens) continue;
      const health = this.health.state(entry.provider, entry.modelId);
      if (!this.health.allowProbe(entry.provider, entry.modelId)) continue;
      const score = scoreModel({
        entry,
        subsystem: params.certSubsystem,
        health,
        strategy: params.strategy,
        preferProvider: this.envProvider,
        preferModelId: this.pinnedModelFor(entry.provider),
      });
      scores.push(score);
      if (score.eligible) candidates.push(entry);
    }
    const winner = pickHighest(scores, {
      preferProvider: this.envProvider,
      pinnedModelId: (provider) => this.pinnedModelFor(provider),
    });
    if (!winner) {
      throw new RouterPolicyError(
        `No VALIDATED model is available for ${params.certSubsystem} under current policy and health`,
      );
    }
    const entry = candidates.find(
      (e) => e.provider === winner.provider && e.modelId === winner.modelId,
    );
    if (!entry) {
      throw new RouterPolicyError("Scored model is not instantiable");
    }
    const reason = [
      params.reasonPrefix,
      `selected ${entry.provider}:${entry.modelId}`,
      `VALIDATED for ${params.certSubsystem}`,
      winner.parts.quality == null
        ? "quality unrated (historical OpenAI route floor)"
        : `quality ${winner.parts.quality}`,
      `provider ${this.health.state(entry.provider, entry.modelId)}`,
      `within ${params.strategy} budget`,
    ].join("; ");
    return { entry, score: winner, reason };
  }

  private selectManualModel(params: {
    routing: RouterRequestContext;
    certSubsystem: ReturnType<typeof toCertificationSubsystem>;
    strategy: ExecutionStrategy;
    contextTokens: number;
    policy: ReturnType<typeof mergeProviderPolicy>;
    switches: KillSwitches;
    reasonPrefix: string;
  }): { entry: ModelRegistryEntry; score: RoutingScoreBreakdown; reason: string } {
    const raw = params.routing.modelId!;
    const parsed = parseModelRef(raw) ?? parseModelRef(`openai:${raw}`);
    if (!parsed) {
      throw new RouterPolicyError("Manual model id must be provider:modelId");
    }
    const entry =
      getRegistryEntry(this.registry, parsed.provider, parsed.modelId) ??
      this.registry.find((e) => e.modelId === parsed.modelId);
    if (!entry) {
      throw new RouterPolicyError(`Unknown model ${raw}; refusing silent substitution`);
    }
    if (!this.providers[entry.provider]) {
      throw new RouterPolicyError(`${entry.provider} adapter is not configured`);
    }
    if (entry.provider === "mock" && isProductionLikeEnv(this.env)) {
      throw new RouterPolicyError("Mock provider is not allowed in staging/production");
    }
    if (!isProviderAllowed(entry.provider, params.policy)) {
      throw new RouterPolicyError(`Provider ${entry.provider} is blocked by policy`);
    }
    if (isModelKilled(params.switches, entry.provider, entry.modelId)) {
      throw new RouterPolicyError(`Model ${entry.id} is disabled`);
    }
    const experimentalOk = params.switches.allowExperimentalModels && !isProductionLikeEnv(this.env);
    if (!isCertifiedFor(entry, params.certSubsystem) && !experimentalOk) {
      throw new RouterPolicyError(
        `Manual selection of ${entry.id} is blocked; it is not VALIDATED for ${params.certSubsystem}`,
      );
    }
    if (isProductionLikeEnv(this.env) && !isAutoEligible(entry, params.certSubsystem)) {
      throw new RouterPolicyError(
        `Beta production allows manual selection only among VALIDATED models`,
      );
    }
    const health = this.health.state(entry.provider, entry.modelId);
    const score = scoreModel({
      entry,
      subsystem: params.certSubsystem,
      health,
      strategy: params.strategy,
    });
    return {
      entry,
      score,
      reason: `manual selection ${entry.id}; certification ${entry.certification[params.certSubsystem]}`,
    };
  }

  private findFallback(params: {
    failed: ModelRegistryEntry;
    certSubsystem: ReturnType<typeof toCertificationSubsystem>;
    strategy: ExecutionStrategy;
    contextTokens: number;
    policy: ReturnType<typeof mergeProviderPolicy>;
    switches: KillSwitches;
    budget: BudgetMeter;
  }): { entry: ModelRegistryEntry } | null {
    if (!params.budget.canFallback()) return null;
    const scores: RoutingScoreBreakdown[] = [];
    const map = new Map<string, ModelRegistryEntry>();
    for (const entry of this.registry) {
      if (entry.id === params.failed.id) continue;
      if (!this.providers[entry.provider]) continue;
      if (!isProviderAllowed(entry.provider, params.policy)) continue;
      if (isModelKilled(params.switches, entry.provider, entry.modelId)) continue;
      if (entry.provider === "mock" && (isProductionLikeEnv(this.env) || this.envProvider !== "mock")) continue;
      if (!isAutoEligible(entry, params.certSubsystem)) continue;
      if (params.contextTokens > entry.contextWindowTokens) continue;
      if (!this.health.allowProbe(entry.provider, entry.modelId)) continue;
      const score = scoreModel({
        entry,
        subsystem: params.certSubsystem,
        health: this.health.state(entry.provider, entry.modelId),
        strategy: params.strategy,
        preferModelId: this.pinnedModelFor(entry.provider),
      });
      scores.push(score);
      map.set(`${entry.provider}:${entry.modelId}`, entry);
    }
    const winner = pickHighest(scores, {
      preferProvider: this.envProvider,
      pinnedModelId: (provider) => this.pinnedModelFor(provider),
    });
    if (!winner) return null;
    const entry = map.get(`${winner.provider}:${winner.modelId}`);
    return entry ? { entry } : null;
  }

  private pinnedModelFor(provider: string): string | undefined {
    if (
      provider === "openai" ||
      provider === "anthropic" ||
      provider === "xai" ||
      provider === "google" ||
      provider === "mock"
    ) {
      return resolvePinnedModelId(provider, this.env);
    }
    return undefined;
  }

  private findVerifier(params: {
    primary: ModelRegistryEntry;
    certSubsystem: ReturnType<typeof toCertificationSubsystem>;
    contextTokens: number;
    policy: ReturnType<typeof mergeProviderPolicy>;
    switches: KillSwitches;
  }): { entry: ModelRegistryEntry } | null {
    for (const entry of this.registry) {
      if (entry.id === params.primary.id) continue;
      if (entry.provider === params.primary.provider) continue;
      if (!this.providers[entry.provider]) continue;
      if (!isProviderAllowed(entry.provider, params.policy)) continue;
      if (isModelKilled(params.switches, entry.provider, entry.modelId)) continue;
      if (entry.provider === "mock" && (isProductionLikeEnv(this.env) || this.envProvider !== "mock")) continue;
      if (!isAutoEligible(entry, params.certSubsystem)) continue;
      if (params.contextTokens > entry.contextWindowTokens) continue;
      if (!this.health.allowProbe(entry.provider, entry.modelId)) continue;
      return { entry };
    }
    return null;
  }

  private finishAudit(
    record: Omit<RoutingAuditRecord, "auditVersion" | "modelRegistryVersion"> & {
      routing: RouterRequestContext;
    },
  ): RoutingAuditRecord {
    const { routing: _routing, ...rest } = record;
    const audit = sanitizeAudit({
      ...rest,
      auditVersion: ROUTING_AUDIT_VERSION,
      modelRegistryVersion: MODEL_REGISTRY_VERSION,
      organizationId: record.organizationId ?? record.routing.organizationId,
      matterId: record.matterId ?? record.routing.matterId,
      promptVersion: record.promptVersion ?? record.routing.promptVersion,
      retrievalIds: record.retrievalIds ?? record.routing.retrievalIds,
      jurisdictionSummary: record.jurisdictionSummary ?? record.routing.jurisdictionSummary,
    });
    if (!auditHasNoSecrets(audit)) {
      throw new Error("Routing audit attempted to store a secret or content key");
    }
    this.lastAudits.push(audit);
    if (this.lastAudits.length > LAST_AUDITS_RING) this.lastAudits.shift();
    this.onAudit?.(audit);
    return audit;
  }
}

export { ROUTING_AUDIT_VERSION };
