export type CanaryPlan = {
  tasks: 1;
  models: 1;
  stopAfter: true;
};

export function buildCanaryPlan(): CanaryPlan {
  return { tasks: 1, models: 1, stopAfter: true };
}

export function shouldStopAfterCanary(completedCanaryCalls: number): boolean {
  return completedCanaryCalls >= 1;
}
