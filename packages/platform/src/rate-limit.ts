/**
 * Phase 9 — rate limiting.
 *
 * Two separate concerns share this file. Abuse control (login attempts, upload floods) protects the
 * tenant, and cost control (model calls, agent runs, research) protects the bill. Both are expressed
 * as a limit on a key inside a window, so one interface covers them.
 *
 * A limit is never an access control decision. A caller must already have passed authentication,
 * capability and entitlement checks before it gets here; `allowed: false` means "slow down", never
 * "you may not see this".
 */

export const ENDPOINT_CLASSES = [
  "auth",
  "upload",
  "ask_nyaya",
  "research",
  "agent_run",
  "professor",
  "guide",
  "expensive_ai",
] as const;

export type EndpointClass = (typeof ENDPOINT_CLASSES)[number];

export type RateLimitPreset = {
  limit: number;
  windowMs: number;
  /** Which identity the count is kept against. Documented per class below. */
  scope: "user" | "organization" | "ip";
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Starting points, not tuned numbers. Each is deliberately generous enough for real legal work and
 * tight enough to make a runaway loop or a credential-stuffing script visible.
 *
 * `auth` counts by IP because there is no trustworthy user identity yet at that point. Cost-bearing
 * classes count by organization so one member cannot spend the firm's whole budget, and per-seat
 * classes count by user.
 */
export const RATE_LIMIT_PRESETS: Record<EndpointClass, RateLimitPreset> = {
  auth: { limit: 10, windowMs: 5 * MINUTE, scope: "ip" },
  upload: { limit: 120, windowMs: HOUR, scope: "organization" },
  ask_nyaya: { limit: 60, windowMs: HOUR, scope: "user" },
  research: { limit: 40, windowMs: HOUR, scope: "organization" },
  agent_run: { limit: 20, windowMs: HOUR, scope: "organization" },
  professor: { limit: 60, windowMs: HOUR, scope: "user" },
  guide: { limit: 30, windowMs: HOUR, scope: "user" },
  expensive_ai: { limit: 10, windowMs: HOUR, scope: "organization" },
};

export function getRateLimitPreset(endpointClass: EndpointClass): RateLimitPreset {
  return RATE_LIMIT_PRESETS[endpointClass];
}

export type RateLimitIdentity = {
  endpointClass: EndpointClass;
  userId?: string | null;
  organizationId?: string | null;
  ip?: string | null;
};

export type RateLimitCheck = {
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  /** Requests left in the current window after this call; zero when blocked. */
  remaining: number;
  limit: number;
  /** Present only when blocked, so a caller can set Retry-After without guessing. */
  retryAfterMs?: number;
  resetAt: number;
};

export interface RateLimitProvider {
  readonly name: string;
  checkRateLimit(check: RateLimitCheck): Promise<RateLimitDecision>;
}

/**
 * Builds the counting key. The scope of the preset decides which identity is used, and a missing
 * identity falls back to a coarser one so a request can never end up unlimited: an unauthenticated
 * request with no IP counts against a shared `anonymous` bucket rather than against nothing.
 */
export function rateLimitKey(identity: RateLimitIdentity): string {
  const { scope } = RATE_LIMIT_PRESETS[identity.endpointClass];
  const parts: Array<[string, string | null | undefined]> = [];

  if (scope === "ip") {
    parts.push(["ip", identity.ip]);
  } else if (scope === "organization") {
    parts.push(["org", identity.organizationId], ["user", identity.userId], ["ip", identity.ip]);
  } else {
    parts.push(["user", identity.userId], ["org", identity.organizationId], ["ip", identity.ip]);
  }

  for (const [label, value] of parts) {
    if (value) return `${identity.endpointClass}:${label}:${value}`;
  }
  return `${identity.endpointClass}:anonymous`;
}

type Window = { count: number; resetAt: number };

/**
 * Fixed-window counter in process memory.
 *
 * Correct for local development, tests and a single-process deployment. Not correct for anything
 * horizontally scaled: each instance keeps its own count, so the effective limit multiplies by the
 * instance count and restarts clear it. `collectProductionConfigProblems` therefore rejects
 * `RATE_LIMIT_PROVIDER=memory` in production.
 */
export class InMemoryRateLimiter implements RateLimitProvider {
  readonly name = "memory";
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  async checkRateLimit(check: RateLimitCheck): Promise<RateLimitDecision> {
    if (check.limit <= 0 || check.windowMs <= 0) {
      throw new Error("Rate limit requires a positive limit and windowMs");
    }
    const now = this.now();
    this.prune(now);

    const existing = this.windows.get(check.key);
    const window =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + check.windowMs };

    if (window.count >= check.limit) {
      this.windows.set(check.key, window);
      return {
        allowed: false,
        remaining: 0,
        limit: check.limit,
        retryAfterMs: Math.max(0, window.resetAt - now),
        resetAt: window.resetAt,
      };
    }

    window.count += 1;
    this.windows.set(check.key, window);
    return {
      allowed: true,
      remaining: check.limit - window.count,
      limit: check.limit,
      resetAt: window.resetAt,
    };
  }

  /** Test helper. Never call this to clear a limit for a real request. */
  reset(key?: string): void {
    if (key === undefined) this.windows.clear();
    else this.windows.delete(key);
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * Convenience wrapper: pick the preset for the endpoint class, build the key, and check.
 */
export async function checkEndpointRateLimit(
  provider: RateLimitProvider,
  identity: RateLimitIdentity,
  overrides: Partial<Pick<RateLimitCheck, "limit" | "windowMs">> = {},
): Promise<RateLimitDecision> {
  const preset = RATE_LIMIT_PRESETS[identity.endpointClass];
  return provider.checkRateLimit({
    key: rateLimitKey(identity),
    limit: overrides.limit ?? preset.limit,
    windowMs: overrides.windowMs ?? preset.windowMs,
  });
}

export class RateLimitExceededError extends Error {
  readonly code = "RATE_LIMITED";
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number, message = "Too many requests") {
    super(message);
    this.name = "RateLimitExceededError";
    this.retryAfterMs = retryAfterMs;
  }
}

const globalForRateLimit = globalThis as unknown as { __nyayagridRateLimiter?: RateLimitProvider };

/**
 * Returns the process-wide limiter. Only the in-memory implementation exists today; a shared-store
 * provider is required before production, which the configuration gate enforces rather than papering
 * over here.
 */
export function getRateLimiter(): RateLimitProvider {
  if (!globalForRateLimit.__nyayagridRateLimiter) {
    globalForRateLimit.__nyayagridRateLimiter = new InMemoryRateLimiter();
  }
  return globalForRateLimit.__nyayagridRateLimiter;
}
