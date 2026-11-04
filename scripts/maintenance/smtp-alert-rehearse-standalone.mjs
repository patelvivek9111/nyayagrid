#!/usr/bin/env node
/**
 * Standalone SMTP alert rehearsal for Fly SSH (no workspace imports).
 * Privacy-safe synthetic firing + recovery only.
 */
import net from "node:net";
import tls from "node:tls";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USERNAME;
const pass = process.env.SMTP_PASSWORD;
const from = process.env.EMAIL_FROM;
const to = process.env.OPS_ALERT_TO || "patelvivek9111@gmail.com";

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

requireEnv("SMTP_HOST", host);
requireEnv("SMTP_USERNAME", user);
requireEnv("SMTP_PASSWORD", pass);
requireEnv("EMAIL_FROM", from);

function readLine(socket, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SMTP read timeout")), timeoutMs);
    socket.once("data", (d) => {
      clearTimeout(timer);
      resolve(d.toString("utf8"));
    });
  });
}

async function sendMail({ subject, body }) {
  const socket = net.connect({ host, port });
  socket.setEncoding("utf8");
  let resp = await readLine(socket);
  if (!resp.startsWith("220")) throw new Error(resp.slice(0, 120));
  socket.write("EHLO nyayagrid-ops\r\n");
  resp = await readLine(socket);
  if (!resp.startsWith("250")) throw new Error(resp.slice(0, 120));
  socket.write("STARTTLS\r\n");
  resp = await readLine(socket);
  if (!resp.startsWith("220")) throw new Error(`STARTTLS: ${resp.slice(0, 120)}`);

  const secure = tls.connect({ socket, servername: host });
  secure.setEncoding("utf8");
  const send = async (cmd, code) => {
    if (cmd) secure.write(`${cmd}\r\n`);
    const x = await readLine(secure);
    if (!x.startsWith(code)) throw new Error(`${code}: ${x.slice(0, 120)}`);
    return x;
  };
  await send("EHLO nyayagrid-ops", "250");
  await send("AUTH LOGIN", "334");
  await send(Buffer.from(user).toString("base64"), "334");
  await send(Buffer.from(pass).toString("base64"), "235");
  await send(`MAIL FROM:<${from}>`, "250");
  await send(`RCPT TO:<${to}>`, "250");
  await send("DATA", "354");
  const mail = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");
  secure.write(`${mail}\r\n.\r\n`);
  resp = await readLine(secure);
  if (!resp.startsWith("250")) throw new Error(`DATA: ${resp.slice(0, 120)}`);
  await send("QUIT", "221");
  secure.end();
}

const at = new Date().toISOString();
await sendMail({
  subject: "[NyayaGrid][page] ready-probe-failing firing",
  body: [
    "Synthetic readiness failure (WP-05 staging rehearsal — not a real outage)",
    "policyId: ready-probe-failing",
    `at: ${at}`,
    "host: https://staging.nyayagrid.com",
    "status: firing",
    "",
    "No credentials, case content, or document text are included.",
  ].join("\n"),
});
const recoveredAt = new Date().toISOString();
await sendMail({
  subject: "[NyayaGrid][page] ready-probe-failing resolved",
  body: [
    "Synthetic readiness recovery (WP-05 staging rehearsal)",
    "policyId: ready-probe-failing",
    `at: ${recoveredAt}`,
    "host: https://staging.nyayagrid.com",
    "status: resolved",
    "",
    "No credentials, case content, or document text are included.",
  ].join("\n"),
});

console.log(
  JSON.stringify({
    classification: "NYAYAGRID_WP05_ALERT_REHEARSAL",
    transport: "smtp",
    destination: to,
    smtpHost: host,
    firingAt: at,
    resolvedAt: recoveredAt,
    delivered: true,
    acknowledgmentVerified: false,
    note: "SMTP accepted messages; human inbox acknowledgment still required.",
    result: "SMTP_ACCEPTED_OPERATOR_ACK_PENDING",
  }),
);
