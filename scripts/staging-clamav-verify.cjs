/**
 * Staging ClamAV proof. Runs on the Fly web machine so it uses 6PN DNS.
 * Prints host class, ports, ping, defs, and scan outcomes — never secrets or IPs.
 */
const { connect } = require("node:net");
const dns = require("node:dns").promises;

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const CLEAN = "NyayaGrid SYNTH clean upload for ClamAV rehearsal.\n";

function readEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function presence(name) {
  return readEnv(name) ? "set" : "missing";
}

function hostClass(value) {
  if (!value) return "missing";
  if (/localhost|127\.0\.0\.1|^::1$/i.test(value)) return "localhost";
  if (/\.internal$/i.test(value)) return "fly-internal";
  if (/\.fly\.dev$/i.test(value)) return "fly-public";
  return "other";
}

function sendCommand(host, port, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, family: 0 });
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);
    socket.on("connect", () => {
      if (typeof payload === "function") payload(socket);
      else socket.write(payload);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(response.trim());
    });
  });
}

function ping(host, port) {
  return sendCommand(host, port, "nPING\n", 8000);
}

function version(host, port) {
  return sendCommand(host, port, "nVERSION\n", 8000);
}

function instream(host, port, buffer) {
  return sendCommand(
    host,
    port,
    (socket) => {
      socket.write("zINSTREAM\0");
      const size = Buffer.alloc(4);
      size.writeUInt32BE(buffer.length, 0);
      socket.write(size);
      socket.write(buffer);
      const end = Buffer.alloc(4);
      end.writeUInt32BE(0, 0);
      socket.write(end);
    },
    30_000,
  );
}

function safeError(error) {
  const raw = String(error && error.message ? error.message : error);
  const redacted = raw
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[redacted]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
    .replace(/\b[0-9a-f:]{8,}\b/gi, "[addr]");
  return {
    name: error && error.name ? error.name : "Error",
    code: error && error.code ? error.code : undefined,
    message: redacted.slice(0, 160),
  };
}

async function main() {
  const host = readEnv("CLAMAV_HOST");
  const port = Number(readEnv("CLAMAV_PORT") ?? "3310");
  const report = {
    malwareScanner: process.env.MALWARE_SCANNER ?? "unset",
    clamavHost: presence("CLAMAV_HOST"),
    clamavHostClass: hostClass(host),
    clamavPort: port,
    clamavFixture: presence("CLAMAV_FIXTURE"),
    inngestDev: presence("INNGEST_DEV"),
  };

  if (!host) {
    report.ok = false;
    console.log(JSON.stringify(report));
    process.exit(1);
  }

  try {
    const looked = await dns.lookup(host, { all: true });
    report.dnsA = looked.filter((row) => row.family === 4).length;
    report.dnsAAAA = looked.filter((row) => row.family === 6).length;
    report.resolveOk = looked.length > 0;
  } catch (error) {
    report.resolveOk = false;
    report.dnsError = safeError(error);
    console.log(JSON.stringify(report));
    process.exit(1);
  }

  try {
    const pong = await ping(host, port);
    report.tcp3310 = "open";
    report.ping = /PONG/i.test(pong) ? "ok" : "error";
    report.pingResponseClass = /PONG/i.test(pong) ? "pong" : "other";
  } catch (error) {
    report.tcp3310 = "closed";
    report.ping = "error";
    report.pingError = safeError(error);
    console.log(JSON.stringify(report));
    process.exit(1);
  }

  try {
    const ver = await version(host, port);
    const parts = ver.split("/").map((part) => part.trim());
    report.defsLoaded = parts.length >= 2 && /^\d+$/.test(parts[1] || "");
    report.versionTokens = parts.length;
  } catch (error) {
    report.defsLoaded = false;
    report.versionError = safeError(error);
  }

  try {
    const clean = await instream(host, port, Buffer.from(CLEAN));
    report.clean = /FOUND/i.test(clean) ? "blocked" : /OK/i.test(clean) ? "ok" : "unknown";
  } catch (error) {
    report.clean = "error";
    report.cleanError = safeError(error);
  }

  try {
    const infected = await instream(host, port, Buffer.from(EICAR));
    report.eicar = /FOUND/i.test(infected) ? "detected" : /OK/i.test(infected) ? "missed" : "unknown";
    report.eicarSignature = /Eicar/i.test(infected) || /EICAR/i.test(infected);
  } catch (error) {
    report.eicar = "error";
    report.eicarError = safeError(error);
  }

  report.ok =
    report.clamavHostClass === "fly-internal" &&
    report.clamavFixture === "missing" &&
    report.resolveOk === true &&
    report.ping === "ok" &&
    report.defsLoaded === true &&
    report.clean === "ok" &&
    report.eicar === "detected";

  console.log(JSON.stringify(report));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, ...safeError(error) }));
  process.exit(1);
});
