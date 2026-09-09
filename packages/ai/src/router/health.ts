/**
 * Short-lived operational health. Separate from benchmark certification.
 * Process-local: an outage does not change VALIDATED status.
 */

export type HealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export type HealthEvent =
  | "success"
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "malformed"
  | "transport_failure";

type Bucket = {
  failures: number[];
  lastFailureAt: number;
  lastSuccessAt: number;
  openedAt: number | null;
  halfOpen: boolean;
};

export type CircuitBreakerConfig = {
  failureThreshold: number;
  windowMs: number;
  cooldownMs: number;
};

export const DEFAULT_CIRCUIT: CircuitBreakerConfig = {
  failureThreshold: 3,
  windowMs: 60_000,
  cooldownMs: 30_000,
};

export class ProviderHealthTracker {
  private readonly buckets = new Map<string, Bucket>();
  private readonly inflight = new Map<string, number>();

  constructor(private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT) {}

  key(provider: string, modelId?: string): string {
    return modelId ? `${provider}:${modelId}` : provider;
  }

  record(provider: string, event: HealthEvent, modelId?: string, now = Date.now()): void {
    const id = this.key(provider, modelId);
    const bucket = this.buckets.get(id) ?? {
      failures: [],
      lastFailureAt: 0,
      lastSuccessAt: 0,
      openedAt: null,
      halfOpen: false,
    };
    if (event === "success") {
      bucket.lastSuccessAt = now;
      if (bucket.halfOpen || bucket.openedAt) {
        bucket.failures = [];
        bucket.openedAt = null;
        bucket.halfOpen = false;
      } else {
        bucket.failures = bucket.failures.filter((t) => now - t <= this.config.windowMs);
      }
      this.buckets.set(id, bucket);
      return;
    }
    bucket.lastFailureAt = now;
    bucket.failures.push(now);
    bucket.failures = bucket.failures.filter((t) => now - t <= this.config.windowMs);
    if (bucket.failures.length >= this.config.failureThreshold) {
      bucket.openedAt = now;
      bucket.halfOpen = false;
    }
    this.buckets.set(id, bucket);
  }

  state(provider: string, modelId?: string, now = Date.now()): HealthState {
    const bucket = this.buckets.get(this.key(provider, modelId));
    if (!bucket) return "HEALTHY";
    if (bucket.openedAt != null) {
      if (now - bucket.openedAt >= this.config.cooldownMs) {
        bucket.halfOpen = true;
        return "DEGRADED";
      }
      return "UNAVAILABLE";
    }
    const recent = bucket.failures.filter((t) => now - t <= this.config.windowMs);
    if (recent.length >= 2) return "DEGRADED";
    return "HEALTHY";
  }

  allowProbe(provider: string, modelId?: string, now = Date.now()): boolean {
    const state = this.state(provider, modelId, now);
    if (state === "UNAVAILABLE") return false;
    const id = this.key(provider, modelId);
    const flying = this.inflight.get(id) ?? 0;
    const bucket = this.buckets.get(id);
    const halfOpen = Boolean(bucket?.halfOpen && bucket.openedAt != null);
    if (halfOpen && flying >= 1) return false;
    return true;
  }

  tryAcquire(provider: string, modelId?: string, now = Date.now()): boolean {
    if (!this.allowProbe(provider, modelId, now)) return false;
    const id = this.key(provider, modelId);
    this.inflight.set(id, (this.inflight.get(id) ?? 0) + 1);
    return true;
  }

  release(provider: string, modelId?: string): void {
    const id = this.key(provider, modelId);
    const next = Math.max(0, (this.inflight.get(id) ?? 0) - 1);
    if (next === 0) this.inflight.delete(id);
    else this.inflight.set(id, next);
  }

  snapshot(): Record<string, HealthState> {
    const now = Date.now();
    const out: Record<string, HealthState> = {};
    for (const key of this.buckets.keys()) {
      const [provider, modelId] = key.split(":");
      out[key] = this.state(provider ?? key, modelId, now);
    }
    return out;
  }
}

export const defaultHealthTracker = new ProviderHealthTracker();
