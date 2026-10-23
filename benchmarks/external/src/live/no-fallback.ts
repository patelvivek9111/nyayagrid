export class ModelSwapForbiddenError extends Error {
  constructor(fromModel: string, toModel: string) {
    super(`Model swap forbidden mid-benchmark: ${fromModel} -> ${toModel}`);
    this.name = "ModelSwapForbiddenError";
  }
}

export function assertSameModelPinned(
  plannedModelId: string,
  actualModelId: string,
): void {
  if (plannedModelId !== actualModelId) {
    throw new ModelSwapForbiddenError(plannedModelId, actualModelId);
  }
}
