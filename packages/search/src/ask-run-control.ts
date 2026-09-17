/**
 * Soft-cancel registry for streaming Ask.
 * Stop must abort generation without closing the SSE connection, so
 * `generation_stopped` + `continue_available` can still be delivered.
 */

type AskRunEntry = {
  controller: AbortController;
  createdAt: number;
};

const activeAskRuns = new Map<string, AskRunEntry>();

const ASK_RUN_TTL_MS = 15 * 60 * 1000;

export function askRunKey(params: {
  organizationId: string;
  matterId: string;
  conversationId: string;
  userId: string;
}): string {
  return `${params.organizationId}:${params.matterId}:${params.conversationId}:${params.userId}`;
}

function pruneStaleRuns(now = Date.now()) {
  for (const [key, entry] of activeAskRuns) {
    if (now - entry.createdAt > ASK_RUN_TTL_MS) {
      activeAskRuns.delete(key);
    }
  }
}

export function beginAskRun(key: string): AbortController {
  pruneStaleRuns();
  const existing = activeAskRuns.get(key);
  if (existing) {
    existing.controller.abort();
    activeAskRuns.delete(key);
  }
  const controller = new AbortController();
  activeAskRuns.set(key, { controller, createdAt: Date.now() });
  return controller;
}

export function cancelAskRun(key: string): boolean {
  pruneStaleRuns();
  const entry = activeAskRuns.get(key);
  if (!entry) return false;
  if (!entry.controller.signal.aborted) {
    entry.controller.abort();
  }
  return true;
}

export function endAskRun(key: string, controller: AbortController): void {
  const entry = activeAskRuns.get(key);
  if (entry?.controller === controller) {
    activeAskRuns.delete(key);
  }
}

/** Abort when any input signal aborts. */
export function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal {
  const merged = new AbortController();
  const abortMerged = () => {
    if (!merged.signal.aborted) merged.abort();
  };
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      abortMerged();
      return merged.signal;
    }
    signal.addEventListener("abort", abortMerged, { once: true });
  }
  return merged.signal;
}
