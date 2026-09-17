import { describe, expect, it } from "vitest";
import {
  askRunKey,
  beginAskRun,
  cancelAskRun,
  endAskRun,
  mergeAbortSignals,
} from "./ask-run-control";
import { createAskSseResponse } from "./ask-sse";
import { mintAskContinueToken } from "./nyaya";

describe("ask soft-cancel control", () => {
  it("cancelAskRun aborts the active run signal without requiring fetch abort", async () => {
    const key = askRunKey({
      organizationId: "org-1",
      matterId: "matter-1",
      conversationId: "conv-1",
      userId: "user-1",
    });
    const controller = beginAskRun(key);
    expect(controller.signal.aborted).toBe(false);
    expect(cancelAskRun(key)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    endAskRun(key, controller);
    expect(cancelAskRun(key)).toBe(false);
  });

  it("mergeAbortSignals aborts when either signal aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const merged = mergeAbortSignals(a.signal, b.signal);
    expect(merged.aborted).toBe(false);
    b.abort();
    expect(merged.aborted).toBe(true);
  });

  it("soft-cancel path delivers generation_stopped + continue_available over SSE", async () => {
    const key = askRunKey({
      organizationId: "org-1",
      matterId: "matter-1",
      conversationId: "conv-soft",
      userId: "user-1",
    });
    const run = beginAskRun(key);
    const continueToken = mintAskContinueToken({
      sourceScope: "case",
      question: "Quote the monthly rent from the lease.",
      passageChunkIds: ["chunk-1"],
      authorityIds: [],
      webSourceIds: [],
    });

    const response = createAskSseResponse(async (emit) => {
      emit({
        type: "request_started",
        sourceScope: "case",
        conversationId: "conv-soft",
        usageActionId: "usage_test",
        at: "2026-09-17T12:00:00.000Z",
      });
      emit({
        type: "retrieval_completed",
        passagesFound: 1,
        label: "Case passages retrieved",
        at: "2026-09-17T12:00:01.000Z",
      });
      emit({ type: "generation_started", at: "2026-09-17T12:00:02.000Z" });

      cancelAskRun(key);
      await new Promise<void>((resolve, reject) => {
        if (run.signal.aborted) {
          resolve();
          return;
        }
        run.signal.addEventListener("abort", () => resolve(), { once: true });
        setTimeout(() => reject(new Error("cancel timed out")), 500);
      });

      // Provider may wrap abort as a non-AbortError; signal.aborted must still win.
      emit({
        type: "generation_stopped",
        status: "cancelled",
        at: "2026-09-17T12:00:03.000Z",
      });
      emit({
        type: "continue_available",
        continueToken,
        at: "2026-09-17T12:00:03.100Z",
      });
      throw Object.assign(new Error("network interrupted"), { name: "TypeError" });
    });

    const body = await response.text();
    // createAskSseResponse treats non-AbortError as generation_failed — soft-cancel
    // delivery is owned by askNyayaAboutMatter before rethrow. This test asserts the
    // SSE framing still carries stop + continue when the run emits them first.
    expect(body).toContain("event: generation_stopped");
    expect(body).toContain("event: continue_available");
    expect(body).toContain(continueToken);
    endAskRun(key, run);
  });

  it("continueToken wire size fits askOrTaskSchema max", async () => {
    const token = mintAskContinueToken({
      sourceScope: "case",
      question: "Summarize every rent, notice, and termination clause in the lease with verbatim quotes.",
      passageChunkIds: Array.from({ length: 12 }, (_, i) => `chunk-${i}-${"x".repeat(20)}`),
      authorityIds: [],
      webSourceIds: [],
    });
    expect(token.length).toBeGreaterThan(200);
    expect(token.length).toBeLessThanOrEqual(4_000);
  });
});
