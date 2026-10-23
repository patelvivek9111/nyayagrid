export type CredentialName =
  "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_API_KEY" | "XAI_API_KEY";

export type CredentialPresence = "PRESENT" | "MISSING";

export type CredentialPresenceReport = Record<CredentialName, CredentialPresence>;

const NAMES: CredentialName[] = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
];

function isPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Presence-only check. Never returns or logs secret values. */
export function checkCredentialPresence(
  env: NodeJS.ProcessEnv = process.env,
): CredentialPresenceReport {
  const report = {} as CredentialPresenceReport;
  for (const name of NAMES) {
    const primary = env[name];
    const googleAlt = name === "GOOGLE_API_KEY" ? env.GEMINI_API_KEY : undefined;
    report[name] = isPresent(primary) || isPresent(googleAlt) ? "PRESENT" : "MISSING";
  }
  return report;
}

export function allCredentialsPresent(report: CredentialPresenceReport): boolean {
  return NAMES.every((n) => report[n] === "PRESENT");
}
