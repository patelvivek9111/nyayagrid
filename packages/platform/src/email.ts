/**
 * Phase 9 — outbound email.
 *
 * Only two things are sent today: an organization invite, which carries a single-use credential, and
 * a notification, which must not carry client material. Both go through one interface so the invite
 * flow can be built and tested locally without an SMTP account.
 *
 * Email is an untrusted, unencrypted channel that often lands in a shared mailbox. Nothing here may
 * contain matter content, document text, or anything privileged — a notification says that something
 * changed and links back into the product, where permissions are enforced.
 */
import { createLogger } from "@nyayagrid/observability";
import { getAppEnv, type EnvSource } from "./config";
import { sendSmtpMessage, SmtpTransportError } from "./smtp-transport";

const logger = createLogger("platform.email");

export type EmailAddress = string;

export type EmailMessage = {
  to: EmailAddress;
  subject: string;
  /** Plain text is required; HTML is optional and must say the same thing. */
  text: string;
  html?: string;
  replyTo?: EmailAddress;
};

export type EmailSendResult = {
  provider: string;
  delivered: boolean;
  providerMessageId?: string;
};

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Writes the message to the process log instead of delivering it, so local development can complete
 * an invite by copying the link out of the terminal.
 *
 * This logs the full body, which includes the invite token. That is acceptable only because the
 * token is worthless without the local database, and it is why `EMAIL_PROVIDER=console` is a
 * production blocker in the configuration gate rather than a fallback.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  constructor(env: EnvSource = process.env) {
    if (getAppEnv(env) === "production") {
      throw new Error(
        "ConsoleEmailProvider does not deliver mail and logs invite tokens. Set EMAIL_PROVIDER=smtp for production.",
      );
    }
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    // Written with console.log rather than the structured logger on purpose: the logger redacts
    // token-shaped fields, and a developer needs the whole invite link here.
    console.log(
      `\n[nyayagrid:email:console] to=${message.to}\nsubject=${message.subject}\n${message.text}\n`,
    );
    return { provider: this.name, delivered: false };
  }
}

export type SmtpEmailConfig = {
  host: string;
  port: number;
  from: EmailAddress;
  username?: string;
  password?: string;
  /** Implicit TLS from connect (port 465). */
  secure: boolean;
  /** Upgrade with STARTTLS after EHLO (port 587). Ignored when `secure` is true. */
  startTls: boolean;
};

/**
 * Configuration-complete SMTP adapter. Port 465 uses implicit TLS; port 587 uses STARTTLS.
 * Failures throw (invites are not silently swallowed). Timeouts are bounded. Credentials and
 * message bodies are never logged.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  readonly config: SmtpEmailConfig;

  constructor(config: SmtpEmailConfig) {
    const missing = (["host", "port", "from"] as const).filter((key) => !config[key]);
    if (missing.length > 0) {
      throw new Error(`SmtpEmailProvider requires ${missing.join(", ")}`);
    }
    this.config = {
      ...config,
      startTls: config.startTls ?? !config.secure,
    };
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const sent = await sendSmtpMessage(this.config, message);
      logger.info("SMTP message accepted", { provider: this.name, delivered: true });
      return {
        provider: this.name,
        delivered: true,
        providerMessageId: sent.providerMessageId,
      };
    } catch (error) {
      const kind = error instanceof SmtpTransportError ? error.kind : "protocol";
      logger.error("SMTP send failed", { provider: this.name, kind });
      throw new SmtpTransportError(
        kind,
        error instanceof SmtpTransportError ? error.message : "SMTP send failed",
      );
    }
  }
}

function resolveSmtpSecure(env: Record<string, string | undefined>, port: number): boolean {
  const raw = env.SMTP_SECURE?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return port === 465;
}

export function createEmailProviderFromEnv(env: EnvSource = process.env): EmailProvider {
  const configured = env.EMAIL_PROVIDER?.trim().toLowerCase() ?? "console";
  if (configured === "smtp") {
    const port = Number(env.SMTP_PORT);
    const resolvedPort = Number.isFinite(port) ? port : 0;
    const secure = resolveSmtpSecure(env, resolvedPort);
    return new SmtpEmailProvider({
      host: env.SMTP_HOST ?? "",
      port: resolvedPort,
      from: env.EMAIL_FROM ?? "",
      username: env.SMTP_USERNAME,
      password: env.SMTP_PASSWORD,
      secure,
      startTls: !secure,
    });
  }
  if (configured === "console") return new ConsoleEmailProvider(env);
  throw new Error(`EMAIL_PROVIDER=${configured} is not implemented. Use "smtp" or "console".`);
}

export { SmtpTransportError } from "./smtp-transport";

export type InviteEmailParams = {
  to: EmailAddress;
  organizationName: string;
  invitedByName?: string | null;
  /** Absolute URL containing the single-use token. Built by the caller from NEXT_PUBLIC_APP_URL. */
  acceptUrl: string;
  expiresAt: Date;
};

export function buildInviteEmail(params: InviteEmailParams): EmailMessage {
  const inviter = params.invitedByName ? `${params.invitedByName} ` : "";
  const expires = params.expiresAt.toISOString();
  return {
    to: params.to,
    subject: `You have been invited to ${params.organizationName} on NyayaGrid`,
    text: [
      `${inviter}invited you to join ${params.organizationName} on NyayaGrid.`,
      "",
      `Accept the invitation: ${params.acceptUrl}`,
      "",
      `This link works once and expires at ${expires}.`,
      "It is tied to this email address, so sign in with it to accept.",
      "",
      "If you were not expecting this invitation, ignore this message and the link will expire unused.",
    ].join("\n"),
  };
}

export async function sendInviteEmail(
  provider: EmailProvider,
  params: InviteEmailParams,
): Promise<EmailSendResult> {
  const result = await provider.send(buildInviteEmail(params));
  logger.info("Invite email dispatched", {
    provider: provider.name,
    delivered: result.delivered,
    organization: params.organizationName,
  });
  return result;
}

export type NotificationParams = {
  to: EmailAddress;
  subject: string;
  /** One or two sentences describing what changed. No matter content, no document text. */
  body: string;
  actionUrl?: string;
  actionLabel?: string;
};

export async function sendNotification(
  provider: EmailProvider,
  params: NotificationParams,
): Promise<EmailSendResult> {
  const lines = [params.body];
  if (params.actionUrl) {
    lines.push("", `${params.actionLabel ?? "Open in NyayaGrid"}: ${params.actionUrl}`);
  }
  lines.push(
    "",
    "You are receiving this because you are a member of a NyayaGrid workspace. Details stay inside the product, where access is checked.",
  );
  return provider.send({ to: params.to, subject: params.subject, text: lines.join("\n") });
}
