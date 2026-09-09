export type CertCircuitState = "HEALTHY" | "DEGRADED" | "UNSTABLE" | "CIRCUIT_OPEN";

export type CircuitEvent = {
  provider: string;
  modelId: string;
  state: CertCircuitState;
  hardHangs: number;
  at: string;
};

export class CertProviderCircuit {
  private readonly hangs = new Map<string, number>();
  private readonly state = new Map<string, CertCircuitState>();
  readonly events: CircuitEvent[] = [];

  constructor(private readonly hangOpenThreshold = 2) {}

  key(provider: string, modelId: string): string {
    return `${provider}:${modelId}`;
  }

  getState(provider: string, modelId: string): CertCircuitState {
    return this.state.get(this.key(provider, modelId)) ?? "HEALTHY";
  }

  isOpen(provider: string, modelId: string): boolean {
    return this.getState(provider, modelId) === "CIRCUIT_OPEN";
  }

  recordHardHang(provider: string, modelId: string): CertCircuitState {
    const id = this.key(provider, modelId);
    const count = (this.hangs.get(id) ?? 0) + 1;
    this.hangs.set(id, count);
    let next: CertCircuitState = "DEGRADED";
    if (count >= this.hangOpenThreshold) next = "CIRCUIT_OPEN";
    this.state.set(id, next);
    this.events.push({
      provider,
      modelId,
      state: next,
      hardHangs: count,
      at: new Date().toISOString(),
    });
    return next;
  }

  hangCount(provider: string, modelId: string): number {
    return this.hangs.get(this.key(provider, modelId)) ?? 0;
  }
}
