/**
 * WP-05 SMTP alert transport.
 * Sends privacy-safe operational alerts only. Never logs SMTP passwords.
 */

import type { AlertEvent, AlertTransport } from "./alert-delivery";

export type SmtpAlertConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  to: string;
  secure?: boolean;
};

function required(name: string, value: string | undefined): string {
  const v = String(value ?? "").trim();
  if (!v) throw new Error(`Missing SMTP config: ${name}`);
  return v;
}

export function smtpConfigFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SmtpAlertConfig {
  return {
    host: required("SMTP_HOST", env.SMTP_HOST),
    port: Number(env.SMTP_PORT ?? "587"),
    username: required("SMTP_USERNAME", env.SMTP_USERNAME),
    password: required("SMTP_PASSWORD", env.SMTP_PASSWORD),
    from: required("EMAIL_FROM", env.EMAIL_FROM ?? env.SMTP_FROM),
    to: required("OPS_ALERT_TO", env.OPS_ALERT_TO ?? env.ALERT_EMAIL_TO),
    secure: String(env.SMTP_SECURE ?? "").toLowerCase() === "true" || Number(env.SMTP_PORT) === 465,
  };
}

/** Minimal SMTP DATA sender without adding a new dependency (Node net/tls). */
export class SmtpAlertTransport implements AlertTransport {
  readonly name = "smtp";
  constructor(private readonly config: SmtpAlertConfig) {}

  async send(event: AlertEvent): Promise<{ delivered: boolean; detail: string }> {
    const net = await import("node:net");
    const tls = await import("node:tls");
    const { host, port, username, password, from, to, secure } = this.config;
    const subject = `[NyayaGrid][${event.severity}] ${event.policyId} ${event.status ?? "firing"}`;
    const body = [
      `policyId: ${event.policyId}`,
      `severity: ${event.severity}`,
      `signal: ${event.signal}`,
      `status: ${event.status ?? "firing"}`,
      `at: ${event.at}`,
      `host: ${event.host ?? "(none)"}`,
      `message: ${event.message}`,
      "",
      "No credentials, case content, or document text are included in this alert.",
    ].join("\r\n");

    const mail = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n");

    const readLine = (socket: { once: Function }, timeoutMs = 15_000): Promise<string> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("SMTP read timeout")), timeoutMs);
        socket.once("data", (buf: Buffer) => {
          clearTimeout(timer);
          resolve(buf.toString("utf8"));
        });
      });

    const sendCmd = async (
      socket: { write: Function; once: Function },
      cmd: string,
      expectCode: string,
    ) => {
      if (cmd) socket.write(cmd + "\r\n");
      const resp = await readLine(socket);
      if (!resp.startsWith(expectCode)) {
        throw new Error(`SMTP unexpected response (wanted ${expectCode}): ${resp.slice(0, 120)}`);
      }
      return resp;
    };

    return await new Promise((resolve, reject) => {
      const connect = () => {
        if (secure) {
          return tls.connect({ host, port, servername: host });
        }
        return net.connect({ host, port });
      };
      const socket = connect();
      socket.setEncoding("utf8");
      socket.on("error", reject);
      (async () => {
        try {
          await sendCmd(socket, "", "220");
          await sendCmd(socket, `EHLO nyayagrid-ops`, "250");
          if (!secure) {
            socket.write("STARTTLS\r\n");
            const startTlsResp = await readLine(socket);
            if (!startTlsResp.startsWith("220")) {
              throw new Error(`STARTTLS failed: ${startTlsResp.slice(0, 120)}`);
            }
            const secureSock = tls.connect({
              socket,
              servername: host,
            });
            secureSock.setEncoding("utf8");
            await sendCmd(secureSock, `EHLO nyayagrid-ops`, "250");
            await sendCmd(secureSock, "AUTH LOGIN", "334");
            await sendCmd(secureSock, Buffer.from(username).toString("base64"), "334");
            await sendCmd(secureSock, Buffer.from(password).toString("base64"), "235");
            await sendCmd(secureSock, `MAIL FROM:<${from}>`, "250");
            await sendCmd(secureSock, `RCPT TO:<${to}>`, "250");
            await sendCmd(secureSock, "DATA", "354");
            secureSock.write(mail + "\r\n.\r\n");
            const dataResp = await readLine(secureSock);
            if (!dataResp.startsWith("250")) {
              throw new Error(`DATA failed: ${dataResp.slice(0, 120)}`);
            }
            await sendCmd(secureSock, "QUIT", "221");
            secureSock.end();
          } else {
            await sendCmd(socket, "AUTH LOGIN", "334");
            await sendCmd(socket, Buffer.from(username).toString("base64"), "334");
            await sendCmd(socket, Buffer.from(password).toString("base64"), "235");
            await sendCmd(socket, `MAIL FROM:<${from}>`, "250");
            await sendCmd(socket, `RCPT TO:<${to}>`, "250");
            await sendCmd(socket, "DATA", "354");
            socket.write(mail + "\r\n.\r\n");
            const dataResp = await readLine(socket);
            if (!dataResp.startsWith("250")) {
              throw new Error(`DATA failed: ${dataResp.slice(0, 120)}`);
            }
            await sendCmd(socket, "QUIT", "221");
            socket.end();
          }
          resolve({ delivered: true, detail: `smtp:${host}:${to}` });
        } catch (err) {
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
          reject(err);
        }
      })();
    });
  }
}
