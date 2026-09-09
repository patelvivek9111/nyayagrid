import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConsoleEmailProvider,
  SmtpEmailProvider,
  createEmailProviderFromEnv,
  sendInviteEmail,
} from "./email";
import { SmtpTransportError } from "./smtp-transport";

function startFakeSmtp(options: { password?: string } = {}): Promise<{
  port: number;
  close: () => Promise<void>;
  messages: string[];
}> {
  const messages: string[] = [];
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    let buf = "";
    let authed = !options.password;
    let dataMode = false;
    let dataBuf = "";
    let authStep: "none" | "user" | "pass" = "none";

    const reply = (line: string) => {
      socket.write(`${line}\r\n`);
    };

    reply("220 nyayagrid-test ESMTP");

    socket.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (dataMode) {
        dataBuf += text;
        if (dataBuf.includes("\r\n.\r\n")) {
          messages.push(dataBuf);
          dataMode = false;
          dataBuf = "";
          buf = "";
          reply("250 2.0.0 Ok: queued as SYNTH");
        }
        return;
      }
      buf += text;
      while (buf.includes("\r\n")) {
        const idx = buf.indexOf("\r\n");
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const upper = line.toUpperCase();
        if (authStep === "user") {
          authStep = "pass";
          reply("334 UGFzc3dvcmQ6");
          continue;
        }
        if (authStep === "pass") {
          const decoded = Buffer.from(line, "base64").toString("utf8");
          authed = decoded === options.password;
          authStep = "none";
          reply(authed ? "235 2.7.0 Authentication successful" : "535 5.7.8 Auth failed");
          continue;
        }
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          reply("250-localhost");
          reply("250 AUTH LOGIN PLAIN");
          continue;
        }
        if (upper === "AUTH LOGIN") {
          authStep = "user";
          reply("334 VXNlcm5hbWU6");
          continue;
        }
        if (upper.startsWith("MAIL FROM:")) {
          reply("250 2.1.0 OK");
          continue;
        }
        if (upper.startsWith("RCPT TO:")) {
          reply("250 2.1.5 OK");
          continue;
        }
        if (upper === "DATA") {
          dataMode = true;
          dataBuf = buf;
          buf = "";
          reply("354 End data with <CR><LF>.<CR><LF>");
          continue;
        }
        if (upper === "QUIT") {
          reply("221 2.0.0 Bye");
          socket.end();
          continue;
        }
        reply("502 5.5.2 Unrecognized");
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        messages,
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

describe("createEmailProviderFromEnv", () => {
  it("selects SMTP and uses STARTTLS (not implicit TLS) on port 587", () => {
    const provider = createEmailProviderFromEnv({
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      EMAIL_FROM: "noreply@example.com",
    });
    expect(provider.name).toBe("smtp");
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
    expect((provider as SmtpEmailProvider).config.secure).toBe(false);
    expect((provider as SmtpEmailProvider).config.startTls).toBe(true);
  });

  it("uses implicit TLS on port 465 by default", () => {
    const provider = createEmailProviderFromEnv({
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      EMAIL_FROM: "noreply@example.com",
    }) as SmtpEmailProvider;
    expect(provider.config.secure).toBe(true);
    expect(provider.config.startTls).toBe(false);
  });
});

describe("SmtpEmailProvider", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
  });

  it("delivers a message over AUTH LOGIN without logging the body", async () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args);
    });
    const server = await startFakeSmtp({ password: "s3cret" });
    servers.push(server);
    const provider = new SmtpEmailProvider({
      host: "127.0.0.1",
      port: server.port,
      from: "noreply@example.com",
      username: "smtp-user",
      password: "s3cret",
      secure: false,
      startTls: false,
    });
    const result = await provider.send({
      to: "probe@example.com",
      subject: "NyayaGrid staging SMTP probe",
      text: "synthetic probe body",
    });
    spy.mockRestore();
    expect(result.delivered).toBe(true);
    expect(result.provider).toBe("smtp");
    expect(server.messages.some((msg) => msg.includes("synthetic probe body"))).toBe(true);
    expect(JSON.stringify(logged)).not.toContain("synthetic probe body");
    expect(JSON.stringify(logged)).not.toContain("s3cret");
  });

  it("does not write invite links to the console when sending invites", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const server = await startFakeSmtp({ password: "s3cret" });
    servers.push(server);
    const provider = new SmtpEmailProvider({
      host: "127.0.0.1",
      port: server.port,
      from: "noreply@example.com",
      username: "smtp-user",
      password: "s3cret",
      secure: false,
      startTls: false,
    });
    await sendInviteEmail(provider, {
      to: "member@example.com",
      organizationName: "Example Firm",
      acceptUrl: "https://nyayagrid-staging.fly.dev/invites/accept?token=synth-token-value",
      expiresAt: new Date("2026-09-08T00:00:00.000Z"),
    });
    const consoleOutput = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    spy.mockRestore();
    expect(consoleOutput).not.toContain("synth-token-value");
    expect(consoleOutput).not.toContain("/invites/accept");
    expect(server.messages.some((msg) => msg.includes("synth-token-value"))).toBe(true);
  });

  it("fails closed on unreachable SMTP without marking delivered", async () => {
    const provider = new SmtpEmailProvider({
      host: "127.0.0.1",
      port: 1,
      from: "noreply@example.com",
      username: "smtp-user",
      password: "s3cret",
      secure: false,
      startTls: false,
    });
    await expect(
      provider.send({ to: "probe@example.com", subject: "x", text: "y" }),
    ).rejects.toBeInstanceOf(SmtpTransportError);
  });
});

describe("ConsoleEmailProvider", () => {
  it("still logs invite text in development", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const provider = new ConsoleEmailProvider({ APP_ENV: "development" });
    await provider.send({
      to: "dev@example.com",
      subject: "invite",
      text: "Accept the invitation: https://localhost/invites/accept?token=dev-token",
    });
    const consoleOutput = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    spy.mockRestore();
    expect(consoleOutput).toContain("[nyayagrid:email:console]");
    expect(consoleOutput).toContain("dev-token");
  });
});
