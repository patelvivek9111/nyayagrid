/**
 * In-process router metrics. Not a dashboard. Safe identifiers only.
 */

export type RouterMetricsSnapshot = {
  routerCalls: number;
  providerDistribution: Record<string, number>;
  strategyDistribution: Record<string, number>;
  fallbackCount: number;
  deepEscalationCount: number;
  providerErrors: number;
  validationFailures: number;
  totalDecisionLatencyMs: number;
  totalEstimatedUsd: number;
  estimatedUsdKnown: boolean;
};

export class RouterMetrics {
  private snapshot: RouterMetricsSnapshot = emptyMetrics();

  record(params: {
    provider: string;
    strategy: string;
    fallback: boolean;
    deepEscalation: boolean;
    error: boolean;
    decisionLatencyMs: number;
    estimatedUsd?: number | null;
  }) {
    this.snapshot.routerCalls += 1;
    this.snapshot.providerDistribution[params.provider] =
      (this.snapshot.providerDistribution[params.provider] ?? 0) + 1;
    this.snapshot.strategyDistribution[params.strategy] =
      (this.snapshot.strategyDistribution[params.strategy] ?? 0) + 1;
    if (params.fallback) this.snapshot.fallbackCount += 1;
    if (params.deepEscalation) this.snapshot.deepEscalationCount += 1;
    if (params.error) this.snapshot.providerErrors += 1;
    this.snapshot.totalDecisionLatencyMs += params.decisionLatencyMs;
    if (params.estimatedUsd == null) this.snapshot.estimatedUsdKnown = false;
    else this.snapshot.totalEstimatedUsd += params.estimatedUsd;
  }

  get(): RouterMetricsSnapshot {
    return {
      ...this.snapshot,
      providerDistribution: { ...this.snapshot.providerDistribution },
      strategyDistribution: { ...this.snapshot.strategyDistribution },
    };
  }

  reset() {
    this.snapshot = emptyMetrics();
  }
}

function emptyMetrics(): RouterMetricsSnapshot {
  return {
    routerCalls: 0,
    providerDistribution: {},
    strategyDistribution: {},
    fallbackCount: 0,
    deepEscalationCount: 0,
    providerErrors: 0,
    validationFailures: 0,
    totalDecisionLatencyMs: 0,
    totalEstimatedUsd: 0,
    estimatedUsdKnown: true,
  };
}

export const defaultRouterMetrics = new RouterMetrics();
