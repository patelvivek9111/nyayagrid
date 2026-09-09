export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|authorization|api[_-]?key|cookie|session|clerk|smtp|database[_-]?url|redis[_-]?url|dsn|connection[_-]?string|prompt|document[_-]?text|matter[_-]?text|content|body|verification[_-]?code)/i;

/** Strips connection strings, bearer tokens, and key-shaped secrets from log text. */
export function redactLogText(value: string): string {
  return value
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(
      /\b(?:CLERK_SECRET_KEY|DATABASE_URL|REDIS_URL|S3_SECRET_ACCESS_KEY|SMTP_PASSWORD|OPENAI_API_KEY|ANTHROPIC_API_KEY|XAI_API_KEY)=[^\s'"]+/gi,
      "[redacted]",
    );
}

function sanitizeFields(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = typeof value === "string" ? redactLogText(value) : value;
  }
  return out;
}

/** Public alias for the redaction logic every logger already applies. */
export const sanitize = sanitizeFields;

export function createLogger(scope: string) {
  const level = (process.env.LOG_LEVEL ?? "info") as LogLevel;
  const order: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  function write(at: LogLevel, message: string, fields?: LogFields) {
    if (order[at] < order[level]) return;
    const payload = {
      ts: new Date().toISOString(),
      level: at,
      scope,
      message: redactLogText(message),
      ...sanitizeFields(fields),
    };
    const line = JSON.stringify(payload);
    if (at === "error") {
      console.error(line);
    } else if (at === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (message: string, fields?: LogFields) => write("debug", message, fields),
    info: (message: string, fields?: LogFields) => write("info", message, fields),
    warn: (message: string, fields?: LogFields) => write("warn", message, fields),
    error: (message: string, fields?: LogFields) => write("error", message, fields),
  };
}

export type Logger = ReturnType<typeof createLogger>;

/** Header used to propagate a correlation id across services/requests. */
export const CORRELATION_ID_HEADER = "x-correlation-id";

/**
 * Returns the correlation id from an incoming request's headers, generating a new one when
 * absent. Use this once at the top of a route handler and thread the result through downstream
 * calls (including as the outgoing header on any fetch to another internal service).
 */
export function withCorrelationId(headers: Headers): string {
  const existing = headers.get(CORRELATION_ID_HEADER);
  if (existing && existing.trim().length > 0) return existing.trim();
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** A `Logger` that stamps every line with a correlation id, for tracing one request end-to-end. */
export function createRequestLogger(scope: string, correlationId: string): Logger {
  const base = createLogger(scope);
  return {
    debug: (message: string, fields?: LogFields) =>
      base.debug(message, { ...fields, correlationId }),
    info: (message: string, fields?: LogFields) => base.info(message, { ...fields, correlationId }),
    warn: (message: string, fields?: LogFields) => base.warn(message, { ...fields, correlationId }),
    error: (message: string, fields?: LogFields) =>
      base.error(message, { ...fields, correlationId }),
  };
}

/**
 * Abstraction over an external error-reporting service (Sentry, Bugsnag, etc.). NyayaGrid does
 * not wire a real provider by default — `ConsoleErrorReporter` is the fallback so error capture
 * always has somewhere to go, and a real provider can be swapped in via `createErrorReporterFromEnv`
 * without touching call sites.
 */
export interface ErrorReportingProvider {
  readonly name: string;
  captureException(error: unknown, context?: Record<string, unknown>): void;
}

export class ConsoleErrorReporter implements ErrorReportingProvider {
  readonly name = "console";
  private readonly logger = createLogger("error-reporter");

  captureException(error: unknown, context?: Record<string, unknown>): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(message, {
      ...(sanitizeFields(context as LogFields | undefined) ?? {}),
      stack,
    });
  }
}

/** Only a console reporter ships today; this indirection is the seam for adding a real provider. */
export function createErrorReporterFromEnv(): ErrorReportingProvider {
  return new ConsoleErrorReporter();
}

export type ConfigCheckResult = {
  ok: boolean;
  warnings: string[];
};

/**
 * Soft, non-throwing environment sanity check for use by health/readiness endpoints. Reports
 * *which* variables are missing/inconsistent, never their values, so this is always safe to
 * return in an HTTP response body.
 */
export function validateConfig(env: NodeJS.ProcessEnv = process.env): ConfigCheckResult {
  const warnings: string[] = [];

  if (!env.DATABASE_URL) warnings.push("DATABASE_URL is not set");

  const authProvider = env.AUTH_PROVIDER ?? "dev";
  if (authProvider === "clerk") {
    if (!env.CLERK_SECRET_KEY) warnings.push("AUTH_PROVIDER=clerk requires CLERK_SECRET_KEY");
    if (!env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
      warnings.push("AUTH_PROVIDER=clerk requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    }
  }
  if (env.NODE_ENV === "production" && authProvider === "dev") {
    warnings.push("AUTH_PROVIDER=dev must not be used in production");
  }

  const aiProvider = env.AI_PROVIDER ?? "mock";
  if (aiProvider === "openai" && !env.OPENAI_API_KEY) {
    warnings.push("AI_PROVIDER=openai requires OPENAI_API_KEY");
  }
  const embeddingProvider = env.EMBEDDING_PROVIDER ?? aiProvider;
  if (embeddingProvider === "openai" && !env.OPENAI_API_KEY) {
    warnings.push("EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY");
  }

  if (!env.S3_BUCKET) warnings.push("S3_BUCKET is not set");
  if (env.STORAGE_PROVIDER === "s3" && (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) {
    warnings.push("STORAGE_PROVIDER=s3 requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  }

  return { ok: warnings.length === 0, warnings };
}

/** Races a promise against a timeout, rejecting with `Error(label + " timed out")` if too slow. */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "operation",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
