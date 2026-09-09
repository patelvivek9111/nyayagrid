/**
 * Staging Redis proof. Runs on the Fly machine so secrets never leave the host.
 * Prints statuses, host class, and TLS/remote flags — never URLs, hosts, or passwords.
 */
const { connect: netConnect } = require("node:net");
const { connect: tlsConnect } = require("node:tls");
const dns = require("node:dns").promises;

function readEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function presence(name) {
  return readEnv(name) ? "set" : "missing";
}

function classifyHost(host) {
  if (!host) return "missing";
  if (/^localhost$|^127\.0\.0\.1$|^::1$/i.test(host)) return "localhost";
  if (/\.upstash\.io$/i.test(host)) return "upstash";
  return "remote";
}

function parseTarget(raw) {
  if (!raw || /\s/.test(raw) || /^redis-cli\b/i.test(raw)) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const protocol = parsed.protocol.replace(":", "").toLowerCase();
  if (protocol !== "redis" && protocol !== "rediss") return null;
  const host = parsed.hostname;
  if (!host) return null;
  const tls = protocol === "rediss" || /\.upstash\.io$/i.test(host);
  return {
    host,
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    tls,
    scheme: protocol,
  };
}

function encodeCommand(args) {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const bytes = Buffer.byteLength(arg);
    out += `$${bytes}\r\n${arg}\r\n`;
  }
  return Buffer.from(out);
}

function decodeResp(buffer) {
  if (buffer.length < 3) return null;
  const kind = buffer[0];
  if (kind === "+" || kind === "-" || kind === ":") {
    const end = buffer.indexOf("\r\n");
    if (end < 0) return null;
    const body = buffer.slice(1, end);
    if (kind === "-") throw new Error(`Redis error: ${body}`);
    return { value: kind === ":" ? Number(body) : body, rest: buffer.slice(end + 2) };
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

function safeError(error) {
  const raw = String(error && error.message ? error.message : error);
  const redacted = raw
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[redacted]")
    .replace(/\b[a-z0-9.-]+\.upstash\.io\b/gi, "[host]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");
  const upper = redacted.toUpperCase();
  let klass = "other";
  if (upper.includes("WRONGPASS") || upper.includes("INVALID PASSWORD") || upper.includes("NOAUTH")) {
    klass = "auth-failed";
  } else if (upper.includes("CONNECT-TIMEOUT") || error.code === "ETIMEDOUT") {
    klass = "timeout";
  } else if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
    klass = "dns";
  } else if (error.code === "ECONNREFUSED") {
    klass = "refused";
  } else if (String(error.code || "").startsWith("ERR_TLS") || upper.includes("CERTIFICATE") || upper.includes("UNABLE_TO_VERIFY")) {
    klass = "tls-cert";
  } else if (error.code === "ECONNRESET") {
    klass = "reset";
  }
  return {
    class: klass,
    name: error && error.name ? error.name : "Error",
    code: error && error.code ? error.code : undefined,
    message: redacted.slice(0, 160),
  };
}

function connectSocket(target, timeoutMs) {
  return new Promise((resolve, reject) => {
    const options = {
      host: target.host,
      port: target.port,
      family: 4,
    };
    const socket = target.tls
      ? tlsConnect({ ...options, servername: target.host })
      : netConnect(options);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("connect-timeout"));
    }, timeoutMs);
    const ready = () => {
      clearTimeout(timer);
      resolve(socket);
    };
    if (target.tls) socket.once("secureConnect", ready);
    else socket.once("connect", ready);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function withClient(target, fn) {
  const socket = await connectSocket(target, 8000);
  let buffer = "";
  const pending = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (pending.length > 0) {
      let decoded;
      try {
        decoded = decodeResp(buffer);
      } catch (error) {
        pending.shift()?.reject(error);
        return;
      }
      if (!decoded) return;
      buffer = decoded.rest;
      pending.shift()?.resolve(decoded.value);
    }
  });
  const send = (args) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("command-timeout")), 4000);
      pending.push({
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
  try {
    if (target.password) {
      if (target.username) await send(["AUTH", target.username, target.password]);
      else await send(["AUTH", target.password]);
    }
    return await fn(send);
  } finally {
    socket.destroy();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const report = {
    rateLimitProvider: process.env.RATE_LIMIT_PROVIDER ?? "unset",
    redisUrl: presence("REDIS_URL"),
    inngestDev: presence("INNGEST_DEV"),
  };

  const target = parseTarget(readEnv("REDIS_URL"));
  report.parseOk = Boolean(target);
  if (!target) {
    report.scheme = "invalid";
    report.remote = false;
    report.tls = false;
    console.log(JSON.stringify(report));
    process.exit(1);
  }

  report.scheme = target.scheme;
  report.hostClass = classifyHost(target.host);
  report.remote = report.hostClass !== "localhost";
  report.tls = target.tls;
  report.hasUsername = Boolean(target.username);
  report.hasPassword = Boolean(target.password);
  report.usernameIsDefault = target.username === "default";
  report.passwordLengthClass =
    !target.password ? "empty" : target.password.length < 16 ? "short" : "ok";

  try {
    const looked = await dns.lookup(target.host, { all: true });
    report.dnsA = looked.filter((row) => row.family === 4).length;
    report.dnsAAAA = looked.filter((row) => row.family === 6).length;
  } catch (error) {
    report.dnsError = safeError(error);
  }

  if (!report.remote || !report.tls) {
    console.log(JSON.stringify(report));
    process.exit(1);
  }

  const prefix = `nyayagrid:staging-probe:${Date.now()}`;
  const valueKey = `${prefix}:kv`;
  const userA = `${prefix}:ask_nyaya:user:user-a`;
  const userB = `${prefix}:ask_nyaya:user:user-b`;
  const orgA = `${prefix}:upload:org:org-a`;
  const orgB = `${prefix}:upload:org:org-b`;

  try {
    await withClient(target, async (send) => {
      const pong = await send(["PING"]);
      report.ping = String(pong).toUpperCase() === "PONG" ? "ok" : "error";

      await send(["SET", valueKey, "staging-ok"]);
      const got = await send(["GET", valueKey]);
      report.setGet = got === "staging-ok" ? "ok" : "error";

      await send(["EXPIRE", valueKey, "2"]);
      const ttl = await send(["PTTL", valueKey]);
      report.ttlArmed = typeof ttl === "number" && ttl > 0 && ttl <= 2000;
      await sleep(2500);
      const expired = await send(["GET", valueKey]);
      report.ttlExpired = expired === null;

      const a1 = await send(["INCR", userA]);
      const b1 = await send(["INCR", userB]);
      const a2 = await send(["INCR", userA]);
      report.userIsolation = a1 === 1 && b1 === 1 && a2 === 2;

      const oa = await send(["INCR", orgA]);
      const ob = await send(["INCR", orgB]);
      report.orgIsolation = oa === 1 && ob === 1;

      await send(["DEL", valueKey, userA, userB, orgA, orgB]);
    });
  } catch (error) {
    report.commandError = safeError(error);
  }

  let failClosed = false;
  try {
    await connectSocket({ host: "127.0.0.1", port: 1, tls: false }, 800);
  } catch {
    failClosed = true;
  }
  report.unreachableConnectFails = failClosed;
  report.failClosedInApp = "deny-on-error";

  report.ok =
    report.ping === "ok" &&
    report.setGet === "ok" &&
    report.ttlArmed === true &&
    report.ttlExpired === true &&
    report.userIsolation === true &&
    report.orgIsolation === true &&
    report.unreachableConnectFails === true &&
    report.remote === true &&
    report.tls === true;

  console.log(JSON.stringify(report));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, ...safeError(error) }));
  process.exit(1);
});
