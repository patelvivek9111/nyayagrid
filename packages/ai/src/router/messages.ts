import type { AiMessage } from "../provider-contract";

export type NormalizedPrompt = {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};

export type AnthropicTextBlock = { type: "text"; text: string };

/**
 * Strip transport-illegal characters that some providers reject with HTTP 400
 * (NUL, non-characters, unpaired surrogates). Does not change legal content.
 */
export function sanitizeMessageContent(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\uFFFE\uFFFF]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "\uFFFD")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

/**
 * Split OpenAI-style messages into a system block plus turn messages.
 * Safety/system instructions must not be dropped when an SDK wants system separately.
 */
export function normalizePromptMessages(messages: AiMessage[]): NormalizedPrompt {
  const systemParts: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const content = sanitizeMessageContent(message.content);
    if (message.role === "system") {
      if (content.trim()) systemParts.push(content);
      continue;
    }
    turns.push({ role: message.role, content });
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
  system?: AnthropicTextBlock[];
  messages: Array<{ role: "user" | "assistant"; content: AnthropicTextBlock[] }>;
} {
  const { system, messages: turns } = normalizePromptMessages(messages);
  const nonempty = turns.filter((turn) => turn.content.trim().length > 0);
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of nonempty) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) {
      last.content = `${last.content}\n\n${turn.content}`;
    } else {
      merged.push({ role: turn.role, content: turn.content });
    }
  }
  if (merged[0]?.role === "assistant") {
    merged.unshift({ role: "user", content: "(context continues)" });
  }
  const ensured =
    merged.length > 0 ? merged : [{ role: "user" as const, content: "(no user content)" }];
  return {
    system: system ? [{ type: "text", text: system }] : undefined,
    messages: ensured.map((turn) => ({
      role: turn.role,
      content: [{ type: "text" as const, text: turn.content }],
    })),
  };
}
