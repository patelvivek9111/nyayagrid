/**
 * Phase 9 — environment resolution and the production configuration gate.
 *
 * Two separate ideas live here and must not be conflated:
 *
 * 1. Which environment is this? `NODE_ENV=production` is set by `next build`/`next start` for any
 *    optimized build, including a laptop build and a preview deploy, so it is not evidence that
 *    this process is serving real client matters. Every security decision therefore reads
 *    `APP_ENV`, and a deployment that only sets `NODE_ENV=production` is treated as production
 *    *and* rejected until it declares `APP_ENV=production`. That fails closed (a forgotten
 *    variable never downgrades us to development defaults) while still forcing the operator to
 *    state their intent.
 *
 * 2. Is this configuration safe to run? The development stack deliberately ships stand-ins that
 *    are unsafe for client data: an auth provider that trusts a request header, a mock model that
 *    invents nothing but also verifies nothing, a malware scanner that never scans. Those exist so
 *    the product can be built for free locally. `collectProductionConfigProblems` is the single
 *    list of what must be replaced first, and it is intentionally strict: several entries name
 *    adapters that do not exist yet, so production cannot boot until they are written.
 */
import { createLogger } from "@nyayagrid/observability";

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Any environment-variable-shaped bag. Injectable so configuration is testable without mutating `process.env`. */
export type EnvSource = Record<string, string | undefined>;

export type AppEnvSource = "APP_ENV" | "NODE_ENV" | "default";

export type AppEnvResolution = {
  appEnv: AppEnv;
  /** `"NODE_ENV"` for production means the environment was inferred rather than declared. */
  source: AppEnvSource;
};

export class ConfigurationError extends Error {
  readonly code = "INVALID_CONFIGURATION";
  readonly problems: readonly string[];

  constructor(message: string, problems: readonly string[] = []) {
    super(problems.length > 0 ? `${message}\n- ${problems.join("\n- ")}` : message);
    this.name = "ConfigurationError";
    this.problems = problems;
  }
}

function read(env: EnvSource, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readLower(env: EnvSource, name: string): string | undefined {
  return read(env, name)?.toLowerCase();
}

function isAppEnv(value: string): value is AppEnv {
  return (APP_ENVS as readonly string[]).includes(value);
}

export function resolveAppEnvDetailed(env: EnvSource = process.env): AppEnvResolution {
  const declared = readLower(env, "APP_ENV");
  if (declared) {
    if (!isAppEnv(declared)) {
      throw new ConfigurationError(
        `APP_ENV="${declared}" is not recognized. Use one of: ${APP_ENVS.join(", ")}.`,
      );
    }
    return { appEnv: declared, source: "APP_ENV" };
  }

  const nodeEnv = readLower(env, "NODE_ENV");
  if (nodeEnv === "test") return { appEnv: "test", source: "NODE_ENV" };
  // Inferred, never trusted: production requirements still apply, and the missing APP_ENV is
  // itself reported as a problem by collectProductionConfigProblems.
  if (nodeEnv === "production") return { appEnv: "production", source: "NODE_ENV" };
  return { appEnv: "development", source: "default" };
}

export function getAppEnv(env: EnvSource = process.env): AppEnv {
  return resolveAppEnvDetailed(env).appEnv;
}

/** Staging and production both serve non-local traffic and share the hardened defaults. */
export function isProductionLike(env: EnvSource = process.env): boolean {
  const appEnv = getAppEnv(env);
  return appEnv === "production" || appEnv === "staging";
}

export function isDevelopment(env: EnvSource = process.env): boolean {
  return getAppEnv(env) === "development";
}

export function isTestEnv(env: EnvSource = process.env): boolean {
  return getAppEnv(env) === "test";
}

/*
 * Provider resolution. Each function mirrors the default the owning package actually applies when
 * the variable is unset, so the gate below reasons about what will really run rather than about
 * what was written down. Keep these in sync with:
 *   AUTH_PROVIDER       -> @nyayagrid/auth createAuthProviderFromEnv
 *   AI_PROVIDER         -> @nyayagrid/ai createAIProviderFromEnv
 *   EMBEDDING_PROVIDER  -> @nyayagrid/ai createEmbeddingProviderFromEnv
 *   STORAGE_PROVIDER    -> @nyayagrid/documents createStorageProviderFromEnv
 */
export function resolveAuthProvider(env: EnvSource = process.env): string {
  return readLower(env, "AUTH_PROVIDER") ?? "dev";
}

export function resolveAiProvider(env: EnvSource = process.env): string {
  return readLower(env, "AI_PROVIDER") ?? "mock";
}

export function resolveEmbeddingProvider(env: EnvSource = process.env): string {
  return readLower(env, "EMBEDDING_PROVIDER") ?? readLower(env, "AI_PROVIDER") ?? "mock";
}

export function resolveStorageProvider(env: EnvSource = process.env): string {
  return readLower(env, "STORAGE_PROVIDER") ?? "minio";
}

/** Only `DevelopmentMalwareScanner` exists today, and it never reports a file clean. */
export function resolveMalwareScanner(env: EnvSource = process.env): string {
  return readLower(env, "MALWARE_SCANNER") ?? "development";
}

/**
 * `none` means image-only PDFs stay in `requires_ocr` instead of being silently treated as empty.
 * Any other value names an adapter that does not exist; `UnsupportedOcrProvider` never reports
 * success, so a bogus value would otherwise look like working OCR that extracts nothing.
 */
export function resolveOcrProvider(env: EnvSource = process.env): string {
  return readLower(env, "OCR_PROVIDER") ?? "none";
}

export const IMPLEMENTED_OCR_PROVIDERS = ["none"] as const;

export function resolveEmailProvider(env: EnvSource = process.env): string {
  return readLower(env, "EMAIL_PROVIDER") ?? "console";
}

export function resolveBillingProvider(env: EnvSource = process.env): string {
  return readLower(env, "BILLING_PROVIDER") ?? "development";
}

export function resolveRateLimitProvider(env: EnvSource = process.env): string {
  return readLower(env, "RATE_LIMIT_PROVIDER") ?? "memory";
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/**
 * Everything that must be true before this configuration may serve real client matters.
 *
 * Pure and environment-independent so a readiness endpoint can ask "what still blocks production?"
 * from a development machine. `validateProductionConfig` is what turns the list into a hard stop.
 */
export function collectProductionConfigProblems(env: EnvSource = process.env): string[] {
  const problems: string[] = [];
  const resolution = resolveAppEnvDetailed(env);

  if (resolution.appEnv === "production" && resolution.source !== "APP_ENV") {
    problems.push(
      "APP_ENV is not set. NODE_ENV=production alone is not an intent declaration, so set APP_ENV=production for a real deployment (or APP_ENV=development/staging for a local or preview build).",
    );
  }

  const authProvider = resolveAuthProvider(env);
  if (authProvider === "dev") {
    problems.push(
      "AUTH_PROVIDER resolves to dev. DevAuthProvider accepts an identity from the x-nyayagrid-dev-user request header and must never front client data. Set AUTH_PROVIDER=clerk.",
    );
  }
  if (authProvider === "clerk") {
    if (!read(env, "CLERK_SECRET_KEY")) {
      problems.push("AUTH_PROVIDER=clerk requires CLERK_SECRET_KEY.");
    }
    if (!read(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")) {
      problems.push("AUTH_PROVIDER=clerk requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.");
    }
  }

  if (resolveAiProvider(env) === "mock") {
    problems.push(
      "AI_PROVIDER resolves to mock. MockAIProvider returns fixture text and must not answer legal questions. Set AI_PROVIDER=openai with OPENAI_API_KEY.",
    );
  } else if (resolveAiProvider(env) === "openai" && !read(env, "OPENAI_API_KEY")) {
    problems.push("AI_PROVIDER=openai requires OPENAI_API_KEY.");
  }

  if (resolveEmbeddingProvider(env) === "mock") {
    problems.push(
      "EMBEDDING_PROVIDER resolves to mock. Deterministic hash embeddings do not retrieve real passages, so citations would be grounded in nothing. Set EMBEDDING_PROVIDER=openai.",
    );
  }

  if (resolveMalwareScanner(env) === "development") {
    problems.push(
      "MALWARE_SCANNER resolves to development. DevelopmentMalwareScanner never scans and leaves uploads unscanned_development; wire a real scanner before accepting client uploads.",
    );
  }

  const storageProvider = resolveStorageProvider(env);
  if (storageProvider === "minio" && !isTruthyFlag(read(env, "ALLOW_MINIO_IN_PRODUCTION"))) {
    problems.push(
      "STORAGE_PROVIDER resolves to minio. Prefer STORAGE_PROVIDER=s3 for managed encryption, versioning and durability; set ALLOW_MINIO_IN_PRODUCTION=1 only for a self-hosted MinIO you operate and back up.",
    );
  }

  const ocrProvider = resolveOcrProvider(env);
  if (!(IMPLEMENTED_OCR_PROVIDERS as readonly string[]).includes(ocrProvider)) {
    problems.push(
      `OCR_PROVIDER=${ocrProvider} names an adapter that does not exist. UnsupportedOcrProvider never reports success, so this would look like OCR that silently extracts nothing. Use OCR_PROVIDER=none until an adapter ships.`,
    );
  }

  if (resolveEmailProvider(env) === "console") {
    problems.push(
      "EMAIL_PROVIDER resolves to console. ConsoleEmailProvider writes invite links to the process log instead of delivering them; set EMAIL_PROVIDER=smtp with SMTP_HOST, SMTP_PORT and EMAIL_FROM.",
    );
  }
  if (resolveEmailProvider(env) === "smtp") {
    for (const required of ["SMTP_HOST", "SMTP_PORT", "EMAIL_FROM"]) {
      if (!read(env, required)) problems.push(`EMAIL_PROVIDER=smtp requires ${required}.`);
    }
  }

  if (resolveBillingProvider(env) === "development") {
    problems.push(
      "BILLING_PROVIDER resolves to development. DevelopmentBillingProvider grants every entitlement, which would hand out paid capacity for free; set BILLING_PROVIDER=database.",
    );
  }

  if (resolveRateLimitProvider(env) === "memory") {
    problems.push(
      "RATE_LIMIT_PROVIDER resolves to memory. InMemoryRateLimiter counts per process, so limits do not hold across instances; configure a shared store.",
    );
  }

  if (!read(env, "DATABASE_URL")) {
    problems.push("DATABASE_URL is required.");
  }
  if (!read(env, "S3_BUCKET")) {
    problems.push("S3_BUCKET is required for document storage.");
  }

  return problems;
}

/**
 * Advisory findings. These do not block startup but are worth seeing in the boot log, because each
 * one describes a way the running process differs from a hardened deployment.
 */
export function collectConfigWarnings(env: EnvSource = process.env): string[] {
  const warnings: string[] = [];
  const appEnv = getAppEnv(env);

  if (appEnv === "production" || appEnv === "staging") {
    if (!read(env, "S3_ACCESS_KEY_ID") || !read(env, "S3_SECRET_ACCESS_KEY")) {
      warnings.push(
        "No S3 static credentials are set. This is correct when the runtime assumes an IAM role, and a misconfiguration otherwise.",
      );
    }
    if (resolveAuthProvider(env) !== "dev" && read(env, "DEV_AUTH_USER_ID")) {
      warnings.push("DEV_AUTH_USER_ID is still set but unused. Remove it to avoid confusion.");
    }
    if (isTruthyFlag(read(env, "ALLOW_MINIO_IN_PRODUCTION"))) {
      warnings.push(
        "ALLOW_MINIO_IN_PRODUCTION is set: object storage durability, encryption and backup are yours to operate.",
      );
    }
    return warnings;
  }

  const devOnly: string[] = [];
  if (resolveAuthProvider(env) === "dev") devOnly.push("auth=dev");
  if (resolveAiProvider(env) === "mock") devOnly.push("ai=mock");
  if (resolveEmbeddingProvider(env) === "mock") devOnly.push("embeddings=mock");
  if (resolveMalwareScanner(env) === "development") devOnly.push("malware=development");
  if (resolveStorageProvider(env) === "minio") devOnly.push("storage=minio");
  if (resolveEmailProvider(env) === "console") devOnly.push("email=console");
  if (resolveBillingProvider(env) === "development") devOnly.push("billing=development");
  if (devOnly.length > 0) {
    warnings.push(`Development stand-ins active: ${devOnly.join(", ")}.`);
  }
  return warnings;
}

/**
 * Throws when this process is production and any production requirement is unmet. A no-op
 * elsewhere: development is *supposed* to run the mock providers.
 */
export function validateProductionConfig(env: EnvSource = process.env): void {
  if (getAppEnv(env) !== "production") return;
  const problems = collectProductionConfigProblems(env);
  if (problems.length > 0) {
    throw new ConfigurationError(
      "Refusing to start: production configuration is incomplete or unsafe",
      problems,
    );
  }
}

export type ConfigSummary = {
  appEnv: AppEnv;
  appEnvSource: AppEnvSource;
  authProvider: string;
  aiProvider: string;
  embeddingProvider: string;
  storageProvider: string;
  malwareScanner: string;
  ocrProvider: string;
  emailProvider: string;
  billingProvider: string;
  rateLimitProvider: string;
  databaseConfigured: boolean;
  storageBucketConfigured: boolean;
};

/** Provider names and booleans only — never a secret, a key or a connection string. */
export function summarizeConfig(env: EnvSource = process.env): ConfigSummary {
  const resolution = resolveAppEnvDetailed(env);
  return {
    appEnv: resolution.appEnv,
    appEnvSource: resolution.source,
    authProvider: resolveAuthProvider(env),
    aiProvider: resolveAiProvider(env),
    embeddingProvider: resolveEmbeddingProvider(env),
    storageProvider: resolveStorageProvider(env),
    malwareScanner: resolveMalwareScanner(env),
    ocrProvider: resolveOcrProvider(env),
    emailProvider: resolveEmailProvider(env),
    billingProvider: resolveBillingProvider(env),
    rateLimitProvider: resolveRateLimitProvider(env),
    databaseConfigured: Boolean(read(env, "DATABASE_URL")),
    storageBucketConfigured: Boolean(read(env, "S3_BUCKET")),
  };
}

export type ConfigValidationResult = {
  appEnv: AppEnv;
  appEnvSource: AppEnvSource;
  summary: ConfigSummary;
  /** Production blockers. Non-empty and production means `validateConfigForEnv` already threw. */
  problems: string[];
  warnings: string[];
};

/**
 * Bootstrap entry point. Call once per server process before serving traffic.
 *
 * Production throws on any blocker. Staging reports the same blockers as warnings so a rehearsal
 * deployment surfaces them without being unbootable. Development and test only log which
 * stand-ins are active.
 */
export function validateConfigForEnv(env: EnvSource = process.env): ConfigValidationResult {
  const { appEnv, source } = resolveAppEnvDetailed(env);
  const logger = createLogger("platform.config");
  const summary = summarizeConfig(env);
  const warnings = collectConfigWarnings(env);

  if (appEnv === "production") {
    validateProductionConfig(env);
    for (const warning of warnings) logger.warn(warning, { appEnv });
    logger.info("Configuration validated", { ...summary });
    return { appEnv, appEnvSource: source, summary, problems: [], warnings };
  }

  const problems = appEnv === "staging" ? collectProductionConfigProblems(env) : [];
  for (const problem of problems) {
    logger.warn(`Not production ready: ${problem}`, { appEnv });
  }
  for (const warning of warnings) logger.warn(warning, { appEnv });
  logger.info("Configuration validated", { ...summary });
  return { appEnv, appEnvSource: source, summary, problems, warnings };
}
