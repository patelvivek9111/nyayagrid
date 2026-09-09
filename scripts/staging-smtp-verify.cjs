/**
 * Staging SMTP proof. Runs on the Fly machine so credentials never leave the host.
 * Prints provider, TLS mode, delivery status, and log-class — never hosts, users, or passwords.
 */
const { connect: netConnect } = require("node:net");
const { connect: tlsConnect } = require("node:tls");

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
  return "remote";
}

function envelopeAddress(value) {
  const match = String(value).match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

function parseReply(buffer) {
  let offset = 0;
  let code = 0;
  const collected = [];
  while (offset < buffer.length) {
    const nl = buffer.indexOf("\n", offset);
    if (nl < 0) return null;
    let line = buffer.slice(offset, nl);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const match = line.match(/^(\d{3})([ -])(.*)$/);
    if (!match) return null;
    code = Number(match[1]);
    collected.push(match[3] || "");
    offset = nl + 1;
    if (match[2] === " ") return { code, text: collected.join("\n"), rest: buffer.slice(offset) };
  }
  return null;
}

function classifySmtpError(error) {
  const raw = String(error && error.message ? error.message : error);
  const redacted = raw
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[redacted]")
    .replace(/[^\s]+@[^\s]+/g, "[addr]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");
  let klass = "other";
  if (error && error.code === "ETIMEDOUT") klass = "timeout";
  else if (error && error.code === "ECONNREFUSED") klass = "refused";
  else if (error && error.stage === "auth") klass = "auth";
  else if (/535|auth/i.test(raw)) klass = "auth";
  else if (/timeout/i.test(raw)) klass = "timeout";
  else if (/STARTTLS/i.test(raw)) klass = "starttls";
  else if (error && error.smtpCode === 550) klass = "rejected";
  return {
    class: klass,
    stage: error && error.stage ? error.stage : undefined,
    smtpCode: error && error.smtpCode ? error.smtpCode : undefined,
    smtpClass: error && error.smtpClass ? String(error.smtpClass).replace(/[^\s]+@[^\s]+/g, "[addr]").slice(0, 80) : undefined,
    code: error && error.code ? error.code : undefined,
    message: redacted.slice(0, 120),
  };
}

async function smtpSession(config, sendMail) {
  const timeoutMs = 15000;
  let buffer = "";
  let socket = await new Promise((resolve, reject) => {
    const s = config.secure
      ? tlsConnect({ host: config.host, port: config.port, servername: config.host })
      : netConnect({ host: config.host, port: config.port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error("connect-timeout"));
    }, timeoutMs);
    const ready = () => {
      clearTimeout(timer);
      resolve(s);
    };
    if (config.secure) s.once("secureConnect", ready);
    else s.once("connect", ready);
    s.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  let currentStage = "connect";
  const pending = [];
  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    while (pending.length > 0) {
      const parsed = parseReply(buffer);
      if (!parsed) return;
      buffer = parsed.rest;
      pending.shift().resolve({ code: parsed.code, text: parsed.text });
    }
  };
  socket.on("data", onData);

  const read = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("command-timeout")), timeoutMs);
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
      onData(Buffer.alloc(0));
    });

  const command = async (line, expected, stage) => {
    currentStage = stage || currentStage;
    socket.write(`${line}\r\n`);
    const reply = await read();
    if (expected && reply.code !== expected) {
      const err = new Error(`SMTP ${reply.code}`);
      err.smtpCode = reply.code;
      err.stage = currentStage;
      err.smtpClass = String(reply.text || "")
        .replace(/[^\s]+@[^\s]+/g, "[addr]")
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
        .slice(0, 80);
      throw err;
    }
    return reply;
  };

  try {
    await read();
    currentStage = "ehlo";
    await command("EHLO nyayagrid", 250, "ehlo");
    if (!config.secure) {
      currentStage = "starttls";
      await command("STARTTLS", 220, "starttls");
      socket = await new Promise((resolve, reject) => {
        const tlsSocket = tlsConnect({ socket, servername: config.host }, () => resolve(tlsSocket));
        tlsSocket.once("error", reject);
      });
      buffer = "";
      socket.on("data", onData);
      await command("EHLO nyayagrid", 250, "ehlo-tls");
    }
    if (config.username && config.password) {
      currentStage = "auth";
      const login = await command("AUTH LOGIN", undefined, "auth");
      if (login.code === 334) {
        await command(Buffer.from(config.username, "utf8").toString("base64"), 334, "auth");
        await command(Buffer.from(config.password, "utf8").toString("base64"), 235, "auth");
      } else {
        const payload = Buffer.from(`\u0000${config.username}\u0000${config.password}`, "utf8").toString("base64");
        await command(`AUTH PLAIN ${payload}`, 235, "auth");
      }
    }
    if (sendMail) {
      await command(`MAIL FROM:<${envelopeAddress(config.from)}>`, 250, "mail-from");
      await command(`RCPT TO:<${envelopeAddress(config.to)}>`, 250, "rcpt-to");
      await command("DATA", 354, "data");
      const accepted = await command(`${sendMail}\r\n.`, 250, "data-body");
      await command("QUIT", 221, "quit").catch(() => undefined);
      return { delivered: true, smtpCode: accepted.code };
    }
    await command("QUIT", 221).catch(() => undefined);
    return { delivered: false, smtpCode: 250 };
  } finally {
    socket.destroy();
  }
}

async function main() {
  const host = readEnv("SMTP_HOST");
  const port = Number(readEnv("SMTP_PORT") ?? "0");
  const from = readEnv("EMAIL_FROM");
  const report = {
    emailProvider: process.env.EMAIL_PROVIDER ?? "unset",
    smtpHost: presence("SMTP_HOST"),
    smtpHostClass: hostClass(host),
    smtpPort: port,
    emailFrom: presence("EMAIL_FROM"),
    smtpUsername: presence("SMTP_USERNAME"),
    smtpPassword: presence("SMTP_PASSWORD"),
    smtpSecure: process.env.SMTP_SECURE ?? "unset",
    inngestDev: presence("INNGEST_DEV"),
    clamavFixture: presence("CLAMAV_FIXTURE"),
  };

  if (report.emailProvider !== "smtp" || !host || !from || !port) {
    report.ok = false;
    console.log(JSON.stringify(report));
    process.exit(1);
  }

  const implicitTls = port === 465 || ["1", "true", "yes", "on"].includes(String(report.smtpSecure).toLowerCase());
  report.tlsMode = implicitTls ? "implicit" : "starttls";

  const config = {
    host,
    port,
    from,
    to: from,
    username: readEnv("SMTP_USERNAME"),
    password: readEnv("SMTP_PASSWORD"),
    secure: implicitTls,
  };

  try {
    const raw = [
      `From: ${from}`,
      `To: ${from}`,
      "Subject: NyayaGrid staging SMTP probe",
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "NyayaGrid staging SMTP probe. No invite token. SYNTH.",
    ].join("\r\n");
    const sent = await smtpSession(config, raw);
    report.auth = "ok";
    report.delivered = sent.delivered;
    report.smtpAccepted = sent.smtpCode === 250;
  } catch (error) {
    report.auth = "error";
    report.delivered = false;
    report.sendError = classifySmtpError(error);
  }

  let failClosed = false;
  try {
    await smtpSession({ host: "127.0.0.1", port: 1, from, to: from, secure: false }, null);
  } catch {
    failClosed = true;
  }
  report.unreachableFails = failClosed;

  report.ok =
    report.emailProvider === "smtp" &&
    report.smtpHostClass === "remote" &&
    report.auth === "ok" &&
    report.delivered === true &&
    report.smtpAccepted === true &&
    report.unreachableFails === true;

  console.log(JSON.stringify(report));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, ...classifySmtpError(error) }));
  process.exit(1);
});
