import { assertManifestImmutable, hashRunConfig, loadRunManifest } from "./manifest.js";
import { isJudgeCacheHit } from "./judge-cache.js";
import { isResponseCacheHit } from "./response-cache.js";

export function parseResumeRunId(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--resume") {
      return argv[i + 1] ?? null;
    }
    const arg = argv[i];
    if (arg?.startsWith("--resume=")) {
      return arg.slice("--resume=".length) || null;
    }
  }
  return null;
}

export type ResumeSkipResult = {
  skipResponse: boolean;
  skipJudge: boolean;
};

export function evaluateResumeSkip(input: {
  runId: string;
  config: unknown;
  responseCacheKey: string;
  judgeCacheKey?: string;
}): ResumeSkipResult {
  assertManifestImmutable(input.runId, hashRunConfig(input.config));
  const skipResponse = isResponseCacheHit(input.runId, input.responseCacheKey);
  const skipJudge =
    input.judgeCacheKey !== undefined
      ? isJudgeCacheHit(input.runId, input.judgeCacheKey)
      : false;
  return { skipResponse, skipJudge };
}

export function assertResumeRunExists(runId: string): void {
  loadRunManifest(runId);
}
