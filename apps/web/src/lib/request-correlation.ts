import {
  CORRELATION_ID_HEADER,
  createRequestLogger,
  withCorrelationId,
  type Logger,
} from "@nyayagrid/observability";

export { CORRELATION_ID_HEADER };

/**
 * Begin request-scoped correlation for a route handler.
 * Reuses an incoming x-correlation-id when present; otherwise generates one.
 * Never log question/prompt/document/source text through this logger.
 */
export function beginRouteCorrelation(request: Request, scope: string): {
  correlationId: string;
  log: Logger;
  startedAt: number;
  elapsedMs: () => number;
  /** Attach correlation header to a Response / NextResponse. */
  attach: <T extends Response>(response: T) => T;
} {
  const correlationId = withCorrelationId(request.headers);
  const log = createRequestLogger(scope, correlationId);
  const startedAt = Date.now();
  return {
    correlationId,
    log,
    startedAt,
    elapsedMs: () => Math.max(0, Date.now() - startedAt),
    attach: <T extends Response>(response: T) => {
      response.headers.set(CORRELATION_ID_HEADER, correlationId);
      return response;
    },
  };
}
