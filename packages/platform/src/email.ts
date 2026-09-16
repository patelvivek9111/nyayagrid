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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatInviteExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(expiresAt);
}

export function buildInviteEmail(params: InviteEmailParams): EmailMessage {
  const org = params.organizationName.trim() || "a NyayaGrid workspace";
  const inviter = params.invitedByName?.trim() || "";
  const expires = formatInviteExpiry(params.expiresAt);
  const subject = inviter ? `${inviter} invited you to ${org}` : `You're invited to join ${org}`;
  const greeting = inviter
    ? `${inviter} invited you to join ${org} on NyayaGrid.`
    : `You've been invited to join ${org} on NyayaGrid.`;
  const text = [
    greeting,
    "",
    "NyayaGrid is the workspace your firm uses for matters, documents, and legal work.",
    "",
    `Accept invitation: ${params.acceptUrl}`,
    "",
    "Use this email address to sign in or create your account. The invitation can be used once and expires on " +
      `${expires}.`,
    "",
    "If you were not expecting this, you can ignore this email. The invitation will expire unused.",
    "",
    "— NyayaGrid",
  ].join("\n");

  const orgHtml = escapeHtml(org);
  const inviterHtml = escapeHtml(inviter);
  const acceptHref = escapeHtml(params.acceptUrl);
  const expiresHtml = escapeHtml(expires);
  const leadHtml = inviter
    ? `<strong>${inviterHtml}</strong> invited you to join <strong>${orgHtml}</strong> on NyayaGrid.`
    : `You've been invited to join <strong>${orgHtml}</strong> on NyayaGrid.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f1ea;color:#14212b;font-family:'Segoe UI',Source Sans 3,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Accept your invitation to ${orgHtml}. This link is single-use.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #cfc7ba;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="height:4px;background:#1f4b3a;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#1f4b3a;font-weight:700;">
              NyayaGrid
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px;font-size:24px;line-height:1.3;font-weight:650;color:#14212b;">
              You're invited
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 20px;font-size:16px;line-height:1.55;color:#14212b;">
              ${leadHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;font-size:15px;line-height:1.55;color:#3a4a54;">
              NyayaGrid is the workspace your firm uses for matters, documents, and legal work.
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;">
              <a href="${acceptHref}" style="display:inline-block;background:#1f4b3a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:650;padding:12px 20px;border-radius:6px;">
                Accept invitation
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px;font-size:13px;line-height:1.55;color:#5b6770;">
              Use this email address to sign in or create your account. This invitation can be used once and expires on ${expiresHtml}.
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;font-size:13px;line-height:1.55;color:#5b6770;">
              If the button does not work, copy and paste this link into your browser:<br>
              <a href="${acceptHref}" style="color:#1f4b3a;word-break:break-all;">${acceptHref}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #cfc7ba;font-size:12px;line-height:1.5;color:#7a7368;">
              If you were not expecting this, you can ignore this email. The invitation will expire unused.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { to: params.to, subject, text, html };
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
