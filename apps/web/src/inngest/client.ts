import { Inngest } from "inngest";

export function readInngestEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const inngest = new Inngest({
  id: "nyayagrid",
  eventKey: readInngestEnv("INNGEST_EVENT_KEY"),
});
