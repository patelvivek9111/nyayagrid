import type { AiMessage } from "../provider-contract";

export type NormalizedPrompt = {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};

/**
 * Split OpenAI-style messages into a system block plus turn messages.
 * Safety/system instructions must not be dropped when an SDK wants system separately.
 */
export function normalizePromptMessages(messages: AiMessage[]): NormalizedPrompt {
  const systemParts: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) systemParts.push(message.content);
      continue;
    }
    turns.push({ role: message.role, content: message.content });
  }
  return {
    system: systemParts.join("\n\n"),
    messages: turns,
  };
}

export function systemPlusUserMessages(messages: AiMessage[]): AiMessage[] {
  const { system, messages: turns } = normalizePromptMessages(messages);
  const out: AiMessage[] = [];
  if (system) out.push({ role: "system", content: system });
  out.push(...turns.map((m) => ({ role: m.role, content: m.content })));
  if (out.length === 0) out.push({ role: "user", content: "" });
  return out;
}

/** Google Generative Language uses `user` / `model` rather than `assistant`. */
export function toGoogleContents(messages: AiMessage[]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
} {
  const { system, messages: turns } = normalizePromptMessages(messages);
  return {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents:
      turns.length > 0
        ? turns.map((m) => ({
            role: m.role === "assistant" ? ("model" as const) : ("user" as const),
            parts: [{ text: m.content }],
          }))
        : [{ role: "user", parts: [{ text: "" }] }],
  };
}

export function toAnthropicBody(messages: AiMessage[]): {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const { system, messages: turns } = normalizePromptMessages(messages);
  const ensured =
    turns.length > 0
      ? turns
      : [{ role: "user" as const, content: "" }];
  return {
    system: system || undefined,
    messages: ensured,
  };
}
