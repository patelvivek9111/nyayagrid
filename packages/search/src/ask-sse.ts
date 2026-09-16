import {
  encodeSseEvent,
  nowIso,
  type AskStreamEvent,
  type AskStreamListener,
} from "@nyayagrid/ai";

/**
 * Build a text/event-stream Response for Ask. Events are emitted as they occur;
 * the stream closes when `run` settles.
 */
export function createAskSseResponse(
  run: (emit: AskStreamListener) => Promise<unknown>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const emit: AskStreamListener = (event: AskStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        } catch {
          closed = true;
        }
      };
      try {
        await run(emit);
      } catch (error) {
        const aborted =
          (error instanceof Error &&
            (error.name === "AbortError" || /cancelled|aborted/i.test(error.message))) ||
          (typeof DOMException !== "undefined" && error instanceof DOMException);
        if (!aborted) {
          const message =
            error instanceof Error ? error.message : "Ask generation failed";
          emit({
            type: "generation_failed",
            message,
            recoverable: false,
            at: nowIso(),
          });
        }
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
