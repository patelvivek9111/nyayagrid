/**
 * Shared-store rate limiter using Redis INCR + EXPIRE (fixed window).
 *
 * Speaks a minimal RESP subset over `node:net` / `node:tls` so this package does not take a Redis
 * client dependency. Correct across multiple web instances; `InMemoryRateLimiter` is not.
 * `rediss://` and Upstash hosts use TLS. A Redis outage fails closed.
 */
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { RateLimitCheck, RateLimitDecision, RateLimitProvider } from "./rate-limit";

export type RedisTarget = {
  host: string;
  port: number;
  password?: string;
  username?: string;
  tls: boolean;
};

function isLocalRedisHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isTruthyFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function shouldUseTls(protocol: string, host: string, env: Record<string, string | undefined>): boolean {
  if (protocol === "rediss") return true;
  if (isTruthyFlag(env.REDIS_TLS)) return true;
  if (/\.upstash\.io$/i.test(host)) return true;
  return false;
}

/**
 * Parses REDIS_URL / REDIS_HOST. Never throws: a pasted redis-cli command or REST URL returns
 * null so callers can fail closed without logging the raw value.
 */
export function parseRedisTarget(
  env: Record<string, string | undefined> = process.env,
): RedisTarget | null {
  const urlRaw = env.REDIS_URL?.trim();
  if (urlRaw) {
    if (/\s/.test(urlRaw) || /^redis-cli\b/i.test(urlRaw)) return null;
    let parsed: URL;
    try {
      parsed = new URL(urlRaw);
    } catch {
      return null;
    }
    const protocol = parsed.protocol.replace(":", "").toLowerCase();
    if (protocol !== "redis" && protocol !== "rediss") return null;
    const host = parsed.hostname;
    if (!host) return null;
    return {
      host,
      port: parsed.port ? Number(parsed.port) : 6379,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      tls: shouldUseTls(protocol, host, env),
    };
  }
  const host = env.REDIS_HOST?.trim();
  if (!host) return null;
  const portRaw = env.REDIS_PORT?.trim();
  return {
    host,
    port: portRaw ? Number(portRaw) : 6379,
    password: env.REDIS_PASSWORD?.trim() || undefined,
    username: env.REDIS_USERNAME?.trim() || undefined,
    tls: shouldUseTls("redis", host, env),
  };
}

export function describeRedisTarget(target: RedisTarget): {
  hostClass: "localhost" | "upstash" | "remote";
  remote: boolean;
  tls: boolean;
  port: number;
  hasPassword: boolean;
  hasUsername: boolean;
} {
  const hostClass = isLocalRedisHost(target.host)
    ? "localhost"
    : /\.upstash\.io$/i.test(target.host)
      ? "upstash"
      : "remote";
  return {
    hostClass,
    remote: hostClass !== "localhost",
    tls: target.tls,
    port: target.port,
    hasPassword: Boolean(target.password),
    hasUsername: Boolean(target.username),
  };
}

type RedisValue = string | number | null;

function encodeCommand(args: string[]): Buffer {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const bytes = Buffer.byteLength(arg);
    out += `$${bytes}\r\n${arg}\r\n`;
  }
  return Buffer.from(out);
}

function decodeResp(buffer: string): { value: RedisValue; rest: string } | null {
  if (buffer.length < 3) return null;
  const kind = buffer[0];
  if (kind === "+" || kind === "-" || kind === ":") {
    const end = buffer.indexOf("\r\n");
    if (end < 0) return null;
    const body = buffer.slice(1, end);
    if (kind === "-") throw new Error(`Redis error: ${body}`);
    const value: RedisValue = kind === ":" ? Number(body) : body;
    return { value, rest: buffer.slice(end + 2) };
  }
  if (kind === "$") {
    const headerEnd = buffer.indexOf("\r\n");
    if (headerEnd < 0) return null;
    const size = Number(buffer.slice(1, headerEnd));
    if (size < 0) return { value: null, rest: buffer.slice(headerEnd + 2) };
    const dataStart = headerEnd + 2;
    const dataEnd = dataStart + size;
    if (buffer.length < dataEnd + 2) return null;
    return { value: buffer.slice(dataStart, dataEnd), rest: buffer.slice(dataEnd + 2) };
  }
  throw new Error(`Unsupported Redis response prefix: ${kind}`);
}

class RedisConnection {
  private socket: Socket | null = null;
  private buffer = "";
  private connecting: Promise<void> | null = null;
  private readonly pending: Array<{
    resolve: (value: RedisValue) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    private readonly target: RedisTarget,
    private readonly timeoutMs: number,
  ) {}

  async send(args: string[]): Promise<RedisValue> {
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket) throw new Error("Redis is not connected");

    return new Promise<RedisValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failAll(new Error(`Redis command timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.write(encodeCommand(args));
    });
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.connecting = null;
    this.buffer = "";
    this.failAll(new Error("Redis connection closed"));
  }

  private failAll(error: Error): void {
    while (this.pending.length > 0) {
      this.pending.shift()?.reject(error);
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    while (this.pending.length > 0) {
      let decoded: { value: RedisValue; rest: string } | null;
      try {
        decoded = decodeResp(this.buffer);
      } catch (error) {
        this.buffer = "";
        this.failAll(error instanceof Error ? error : new Error(String(error)));
        this.socket?.destroy();
        return;
      }
      if (!decoded) return;
      this.buffer = decoded.rest;
      this.pending.shift()?.resolve(decoded.value);
    }
  }

  private async authenticate(): Promise<void> {
    if (!this.target.password) return;
    if (this.target.username) {
      await this.send(["AUTH", this.target.username, this.target.password]);
      return;
    }
    await this.send(["AUTH", this.target.password]);
  }

  private ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket: Socket = this.target.tls
        ? tlsConnect({
            host: this.target.host,
            port: this.target.port,
            servername: this.target.host,
          })
        : netConnect({ host: this.target.host, port: this.target.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Redis connect timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      const onReady = () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.on("data", (chunk) => this.onData(chunk));
        socket.on("error", (error) => {
          this.failAll(error instanceof Error ? error : new Error(String(error)));
          this.socket = null;
        });
        socket.on("close", () => {
          this.socket = null;
          this.connecting = null;
          this.failAll(new Error("Redis connection closed"));
        });
        this.authenticate().then(() => resolve()).catch(reject);
      };

      if (this.target.tls) {
        socket.once("secureConnect", onReady);
      } else {
        socket.once("connect", onReady);
      }
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
}

/**
 * Fixed-window counter in Redis. Two app instances increment the same key, so the configured
 * limit holds globally. A Redis outage fails closed (request denied) rather than multiplying
 * the limit the way a per-process memory fallback would.
 */
export class RedisRateLimiter implements RateLimitProvider {
  readonly name = "redis";
  private readonly connection: RedisConnection;

  constructor(target: RedisTarget, options: { timeoutMs?: number; now?: () => number } = {}) {
    this.connection = new RedisConnection(target, options.timeoutMs ?? 2000);
  }

  async checkRateLimit(check: RateLimitCheck): Promise<RateLimitDecision> {
    if (check.limit <= 0 || check.windowMs <= 0) {
      throw new Error("Rate limit requires a positive limit and windowMs");
    }
    const windowSeconds = Math.max(1, Math.ceil(check.windowMs / 1000));
    try {
      const countRaw = await this.connection.send(["INCR", check.key]);
      const count = typeof countRaw === "number" ? countRaw : Number(countRaw);
      if (!Number.isFinite(count)) {
        throw new Error("Redis INCR returned a non-numeric value");
      }
      if (count === 1) {
        await this.connection.send(["EXPIRE", check.key, String(windowSeconds)]);
      }
      const ttlRaw = await this.connection.send(["PTTL", check.key]);
      const ttlMs = typeof ttlRaw === "number" ? ttlRaw : Number(ttlRaw);
      const resetAt = Date.now() + (ttlMs > 0 ? ttlMs : check.windowMs);

      if (count > check.limit) {
        return {
          allowed: false,
          remaining: 0,
          limit: check.limit,
          retryAfterMs: Math.max(0, ttlMs > 0 ? ttlMs : check.windowMs),
          resetAt,
        };
      }
      return {
        allowed: true,
        remaining: check.limit - count,
        limit: check.limit,
        resetAt,
      };
    } catch {
      const retryAfterMs = 5_000;
      return {
        allowed: false,
        remaining: 0,
        limit: check.limit,
        retryAfterMs,
        resetAt: Date.now() + retryAfterMs,
      };
    }
  }

  close(): void {
    this.connection.close();
  }

  async ping(): Promise<void> {
    const value = await this.connection.send(["PING"]);
    const text = String(value ?? "").toUpperCase();
    if (text !== "PONG") {
      throw new Error("Redis PING did not return PONG");
    }
  }
}

export function createRedisRateLimiterFromEnv(
  env: Record<string, string | undefined> = process.env,
): RedisRateLimiter {
  const target = parseRedisTarget(env);
  if (!target) {
    throw new Error("RATE_LIMIT_PROVIDER=redis requires REDIS_URL or REDIS_HOST");
  }
  return new RedisRateLimiter(target);
}

/** Readiness/ops ping. Does not log the URL or password. */
export async function pingRedis(
  env: Record<string, string | undefined> = process.env,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let target: RedisTarget | null;
  try {
    target = parseRedisTarget(env);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (!target) {
    return { ok: false, error: env.REDIS_URL?.trim() || env.REDIS_HOST?.trim() ? "invalid_url" : "not_configured" };
  }
  const limiter = new RedisRateLimiter(target, { timeoutMs: 2000 });
  try {
    await limiter.ping();
    limiter.close();
    return { ok: true };
  } catch {
    limiter.close();
    return { ok: false, error: "unreachable" };
  }
}
