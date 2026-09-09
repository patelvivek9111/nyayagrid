import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkEndpointRateLimit } from "./rate-limit";
import { RedisRateLimiter, parseRedisTarget, pingRedis } from "./redis-rate-limit";

type RedisEntry = { value: number; expireAt?: number };

function startFakeRedis(options: { password?: string; failAfter?: number } = {}): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const store = new Map<string, RedisEntry>();
  let commandCount = 0;
  const sockets: Socket[] = [];

  const server: Server = createServer((socket) => {
    sockets.push(socket);
    let buf = Buffer.alloc(0);
    let authed = !options.password;

    const reply = (payload: string) => {
      socket.write(payload);
    };

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const parsed = parseCommand(buf);
        if (!parsed) return;
        buf = Buffer.from(parsed.rest);
        commandCount += 1;
        if (options.failAfter !== undefined && commandCount > options.failAfter) {
          socket.destroy();
          return;
        }
        const [command, ...args] = parsed.args;
        const op = (command ?? "").toUpperCase();
        if (!authed && op !== "AUTH") {
          reply("-NOAUTH Authentication required.\r\n");
          continue;
        }
        if (op === "PING") {
          reply("+PONG\r\n");
          continue;
        }
        if (op === "AUTH") {
          const provided = args.length >= 2 ? args[1] : args[0];
          if (provided === options.password) {
            authed = true;
            reply("+OK\r\n");
          } else {
            reply("-ERR invalid password\r\n");
          }
          continue;
        }
        if (op === "INCR") {
          const key = args[0] ?? "";
          const now = Date.now();
          const existing = store.get(key);
          if (existing?.expireAt && existing.expireAt <= now) store.delete(key);
          const next = (store.get(key)?.value ?? 0) + 1;
          store.set(key, { value: next, expireAt: store.get(key)?.expireAt });
          reply(`:${next}\r\n`);
          continue;
        }
        if (op === "EXPIRE") {
          const key = args[0] ?? "";
          const seconds = Number(args[1]);
          const existing = store.get(key);
          if (!existing) {
            reply(":0\r\n");
            continue;
          }
          existing.expireAt = Date.now() + seconds * 1000;
          reply(":1\r\n");
          continue;
        }
        if (op === "PTTL") {
          const key = args[0] ?? "";
          const existing = store.get(key);
          if (!existing) {
            reply(":-2\r\n");
            continue;
          }
          if (!existing.expireAt) {
            reply(":-1\r\n");
            continue;
          }
          reply(`:${Math.max(0, existing.expireAt - Date.now())}\r\n`);
          continue;
        }
        reply("-ERR unknown command\r\n");
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
    server.once("error", reject);
  });
}

function parseCommand(buffer: Buffer): { args: string[]; rest: Buffer } | null {
  const text = buffer.toString("utf8");
  if (!text.startsWith("*")) return null;
  const headerEnd = text.indexOf("\r\n");
  if (headerEnd < 0) return null;
  const count = Number(text.slice(1, headerEnd));
  if (!Number.isFinite(count) || count < 1) return null;
  const args: string[] = [];
  let cursor = headerEnd + 2;
  for (let i = 0; i < count; i++) {
    if (text[cursor] !== "$") return null;
    const sizeEnd = text.indexOf("\r\n", cursor);
    if (sizeEnd < 0) return null;
    const size = Number(text.slice(cursor + 1, sizeEnd));
    const dataStart = sizeEnd + 2;
    const dataEnd = dataStart + size;
    if (text.length < dataEnd + 2) return null;
    args.push(text.slice(dataStart, dataEnd));
    cursor = dataEnd + 2;
  }
  return { args, rest: buffer.subarray(Buffer.byteLength(text.slice(0, cursor))) };
}

describe("parseRedisTarget", () => {
  it("reads REDIS_URL including a password", () => {
    expect(parseRedisTarget({ REDIS_URL: "redis://:s3cret@127.0.0.1:6380" })).toEqual({
      host: "127.0.0.1",
      port: 6380,
      password: "s3cret",
      username: undefined,
      tls: false,
    });
  });

  it("reads REDIS_HOST / REDIS_PORT", () => {
    expect(parseRedisTarget({ REDIS_HOST: "redis.internal", REDIS_PORT: "6379" })).toEqual({
      host: "redis.internal",
      port: 6379,
      password: undefined,
      username: undefined,
      tls: false,
    });
  });

  it("enables TLS for rediss:// and Upstash hosts", () => {
    expect(parseRedisTarget({ REDIS_URL: "rediss://default:s3cret@example.upstash.io:6379" })).toEqual({
      host: "example.upstash.io",
      port: 6379,
      password: "s3cret",
      username: "default",
      tls: true,
    });
    expect(parseRedisTarget({ REDIS_URL: "redis://default:s3cret@example.upstash.io:6379" })?.tls).toBe(
      true,
    );
  });

  it("returns null for redis-cli pastes and non-redis URLs without throwing", () => {
    expect(
      parseRedisTarget({
        REDIS_URL: "redis-cli --tls -u redis://default:s3cret@example.upstash.io:6379",
      }),
    ).toBeNull();
    expect(parseRedisTarget({ REDIS_URL: "https://example.upstash.io" })).toBeNull();
  });

  it("returns null when neither URL nor host is set", () => {
    expect(parseRedisTarget({})).toBeNull();
  });
});

describe("pingRedis", () => {
  it("does not throw or echo an invalid REDIS_URL", async () => {
    const result = await pingRedis({
      REDIS_URL: "redis-cli --tls -u redis://default:s3cret@example.upstash.io:6379",
    });
    expect(result).toEqual({ ok: false, error: "invalid_url" });
  });
});

describe("RedisRateLimiter", () => {
  const limiters: RedisRateLimiter[] = [];
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const limiter of limiters.splice(0)) limiter.close();
    for (const server of servers.splice(0)) await server.close();
  });

  it("holds a limit across two limiter instances (shared store)", async () => {
    const server = await startFakeRedis();
    servers.push(server);
    const a = new RedisRateLimiter({ host: "127.0.0.1", port: server.port, tls: false });
    const b = new RedisRateLimiter({ host: "127.0.0.1", port: server.port, tls: false });
    limiters.push(a, b);
    const identity = { endpointClass: "auth" as const, ip: "203.0.113.9" };
    const overrides = { limit: 2, windowMs: 60_000 };

    expect((await checkEndpointRateLimit(a, identity, overrides)).allowed).toBe(true);
    expect((await checkEndpointRateLimit(b, identity, overrides)).allowed).toBe(true);
    expect((await checkEndpointRateLimit(a, identity, overrides)).allowed).toBe(false);
    expect((await checkEndpointRateLimit(b, identity, overrides)).allowed).toBe(false);
  });

  it("authenticates when a password is configured", async () => {
    const server = await startFakeRedis({ password: "s3cret" });
    servers.push(server);
    const limiter = new RedisRateLimiter({
      host: "127.0.0.1",
      port: server.port,
      password: "s3cret",
      tls: false,
    });
    limiters.push(limiter);
    const decision = await limiter.checkRateLimit({
      key: "auth:ip:198.51.100.1",
      limit: 5,
      windowMs: 60_000,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(4);
  });

  it("isolates counters by user and organization", async () => {
    const server = await startFakeRedis();
    servers.push(server);
    const limiter = new RedisRateLimiter({ host: "127.0.0.1", port: server.port, tls: false });
    limiters.push(limiter);
    const overrides = { limit: 1, windowMs: 60_000 };

    const userA = await checkEndpointRateLimit(
      limiter,
      { endpointClass: "ask_nyaya", userId: "user-a", organizationId: "org-1" },
      overrides,
    );
    const userB = await checkEndpointRateLimit(
      limiter,
      { endpointClass: "ask_nyaya", userId: "user-b", organizationId: "org-1" },
      overrides,
    );
    const userAAgain = await checkEndpointRateLimit(
      limiter,
      { endpointClass: "ask_nyaya", userId: "user-a", organizationId: "org-1" },
      overrides,
    );
    expect(userA.allowed).toBe(true);
    expect(userB.allowed).toBe(true);
    expect(userAAgain.allowed).toBe(false);

    const orgA = await checkEndpointRateLimit(
      limiter,
      { endpointClass: "upload", userId: "user-a", organizationId: "org-a" },
      overrides,
    );
    const orgB = await checkEndpointRateLimit(
      limiter,
      { endpointClass: "upload", userId: "user-a", organizationId: "org-b" },
      overrides,
    );
    expect(orgA.allowed).toBe(true);
    expect(orgB.allowed).toBe(true);
  });

  it("authenticates with Redis ACL username + password", async () => {
    const server = await startFakeRedis({ password: "s3cret" });
    servers.push(server);
    const limiter = new RedisRateLimiter({
      host: "127.0.0.1",
      port: server.port,
      username: "default",
      password: "s3cret",
      tls: false,
    });
    limiters.push(limiter);
    const decision = await limiter.checkRateLimit({
      key: "auth:ip:198.51.100.9",
      limit: 5,
      windowMs: 60_000,
    });
    expect(decision.allowed).toBe(true);
  });

  it("fails closed when Redis is unreachable", async () => {
    const limiter = new RedisRateLimiter({
      host: "127.0.0.1",
      port: 1,
      password: undefined,
      tls: false,
    });
    limiters.push(limiter);
    const decision = await limiter.checkRateLimit({
      key: "auth:ip:198.51.100.2",
      limit: 5,
      windowMs: 60_000,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBe(5_000);
  });
});
