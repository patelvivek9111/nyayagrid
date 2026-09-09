/**
 * Minimal SMTP client (EHLO, STARTTLS, AUTH LOGIN/PLAIN, DATA).
 * No third-party mailer. Never logs credentials, recipients, or message bodies.
 */
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { randomUUID } from "node:crypto";
import type { EmailMessage, SmtpEmailConfig } from "./email";

const DEFAULT_TIMEOUT_MS = 15_000;

export class SmtpTransportError extends Error {
  readonly code = "SMTP_TRANSPORT_FAILED";
  readonly kind: "connect" | "timeout" | "auth" | "protocol" | "rejected";

  constructor(kind: SmtpTransportError["kind"], message: string) {
    super(message);
    this.name = "SmtpTransportError";
    this.kind = kind;
  }
}

function envelopeAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}

function encodeDotLines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

class SmtpConnection {
  private buffer = "";
  private socket: Socket;
  private readonly pending: Array<{
    resolve: (value: { code: number; text: string }) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    socket: Socket,
    private readonly timeoutMs: number,
  ) {
    this.socket = socket;
    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("error", (error) => this.failAll(error instanceof Error ? error : new Error(String(error))));
    this.socket.on("close", () => this.failAll(new Error("SMTP connection closed")));
  }

  static async open(config: SmtpEmailConfig, timeoutMs: number): Promise<SmtpConnection> {
    const implicitTls = config.secure;
    const socket = await connectSocket(config.host, config.port, implicitTls, timeoutMs);
    const connection = new SmtpConnection(socket, timeoutMs);
    await connection.readReply(220, "connect");
    await connection.ehlo();
    if (!implicitTls && config.startTls) {
      await connection.command("STARTTLS", 220);
      connection.replaceSocket(await upgradeTls(socket, config.host, timeoutMs));
      await connection.ehlo();
    }
    if (config.username && config.password) {
      await connection.authenticate(config.username, config.password);
    }
    return connection;
  }

  async mail(from: string, to: string, raw: string): Promise<string | undefined> {
    await this.command(`MAIL FROM:<${envelopeAddress(from)}>`, 250);
    await this.command(`RCPT TO:<${envelopeAddress(to)}>`, 250);
    await this.command("DATA", 354);
    const accepted = await this.command(`${raw}\r\n.`, 250);
    await this.command("QUIT", 221).catch(() => undefined);
    const idMatch = accepted.text.match(/<[^>]+>/);
    return idMatch?.[0];
  }

  close(): void {
    this.socket.destroy();
  }

  private async ehlo(): Promise<string> {
    const reply = await this.command("EHLO nyayagrid", 250);
    return reply.text;
  }

  private async authenticate(username: string, password: string): Promise<void> {
    const login = await this.commandRaw("AUTH LOGIN");
    if (login.code === 334) {
      await this.command(Buffer.from(username, "utf8").toString("base64"), 334, "auth");
      await this.command(Buffer.from(password, "utf8").toString("base64"), 235, "auth");
      return;
    }
    const payload = Buffer.from(`\u0000${username}\u0000${password}`, "utf8").toString("base64");
    await this.command(`AUTH PLAIN ${payload}`, 235, "auth");
  }

  private replaceSocket(next: Socket): void {
    this.socket = next;
    this.buffer = "";
    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("error", (error) =>
      this.failAll(error instanceof Error ? error : new Error(String(error))),
    );
    this.socket.on("close", () => this.failAll(new Error("SMTP connection closed")));
  }

  private command(
    line: string,
    expected: number,
    kind: SmtpTransportError["kind"] = "protocol",
  ): Promise<{ code: number; text: string }> {
    this.socket.write(`${line}\r\n`);
    return this.readReply(expected, kind);
  }

  private commandRaw(line: string): Promise<{ code: number; text: string }> {
    this.socket.write(`${line}\r\n`);
    return this.readReplyAny();
  }

  private readReplyAny(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failAll(new SmtpTransportError("timeout", `SMTP timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.push({
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.onData();
    });
  }

  private async readReply(
    expected: number,
    kind: SmtpTransportError["kind"],
  ): Promise<{ code: number; text: string }> {
    const reply = await this.readReplyAny();
    if (reply.code !== expected) {
      const mapped: SmtpTransportError["kind"] =
        reply.code === 535 || kind === "auth" ? "auth" : reply.code >= 400 ? "rejected" : kind;
      throw new SmtpTransportError(mapped, `SMTP ${reply.code}`);
    }
    return reply;
  }

  private onData(chunk?: Buffer): void {
    if (chunk) this.buffer += chunk.toString("utf8");
    while (this.pending.length > 0) {
      const parsed = parseReply(this.buffer);
      if (!parsed) return;
      this.buffer = parsed.rest;
      this.pending.shift()?.resolve({ code: parsed.code, text: parsed.text });
    }
  }

  private failAll(error: Error): void {
    while (this.pending.length > 0) {
      this.pending.shift()?.reject(error);
    }
  }
}

function parseReply(buffer: string): { code: number; text: string; rest: string } | null {
  let offset = 0;
  let code = 0;
  const collected: string[] = [];
  while (offset < buffer.length) {
    const nl = buffer.indexOf("\n", offset);
    if (nl < 0) return null;
    let line = buffer.slice(offset, nl);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const match = line.match(/^(\d{3})([ -])(.*)$/);
    if (!match) return null;
    code = Number(match[1]);
    collected.push(match[3] ?? "");
    offset = nl + 1;
    if (match[2] === " ") {
      return { code, text: collected.join("\n"), rest: buffer.slice(offset) };
    }
  }
  return null;
}

function connectSocket(
  host: string,
  port: number,
  tls: boolean,
  timeoutMs: number,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = tls
      ? tlsConnect({ host, port, servername: host })
      : netConnect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SmtpTransportError("timeout", `SMTP connect timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const ready = () => {
      clearTimeout(timer);
      resolve(socket);
    };
    if (tls) socket.once("secureConnect", ready);
    else socket.once("connect", ready);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new SmtpTransportError(
          "connect",
          error instanceof Error ? "SMTP connection failed" : "SMTP connection failed",
        ),
      );
    });
  });
}

function upgradeTls(socket: Socket, host: string, timeoutMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SmtpTransportError("timeout", `SMTP STARTTLS timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const tlsSocket = tlsConnect({ socket, servername: host }, () => {
      clearTimeout(timer);
      resolve(tlsSocket);
    });
    tlsSocket.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new SmtpTransportError(
          "connect",
          error instanceof Error ? "SMTP STARTTLS failed" : "SMTP STARTTLS failed",
        ),
      );
    });
  });
}

export async function sendSmtpMessage(
  config: SmtpEmailConfig,
  message: EmailMessage,
  options: { timeoutMs?: number } = {},
): Promise<{ providerMessageId?: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const messageId = `<${randomUUID()}@nyayagrid>`;
  const raw = [
    `From: ${config.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject.replace(/\r?\n/g, " ")}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    encodeDotLines(message.text),
  ].join("\r\n");

  const connection = await SmtpConnection.open(config, timeoutMs);
  try {
    const acceptedId = await connection.mail(config.from, message.to, raw);
    return { providerMessageId: acceptedId ?? messageId };
  } finally {
    connection.close();
  }
}
