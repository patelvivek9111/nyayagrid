/**
 * Non-generation Gemini access probe via Models.list.
 * Does not create interactions / generate content (no billable generation).
 */
import type { LiveFetch } from "../providers/live-types.js";

export type GeminiAccessProbeResult = {
  status:
    | "GEMINI_ACCESS_OK"
    | "GEMINI_PROVIDER_ACCESS_BLOCKED"
    | "GEMINI_KEY_MISSING"
    | "GEMINI_PROBE_ERROR";
  httpStatus: number | null;
  modelListed: boolean;
  exactModelId: "gemini-4-argon";
  note: string;
  paidGenerationCalls: 0;
};

export async function probeGeminiModelAccess(input: {
  apiKey?: string;
  fetchImpl?: LiveFetch;
  baseUrl?: string;
}): Promise<GeminiAccessProbeResult> {
  const exactModelId = "gemini-4-argon" as const;
  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    return {
      status: "GEMINI_KEY_MISSING",
      httpStatus: null,
      modelListed: false,
      exactModelId,
      note: "GOOGLE_API_KEY missing",
      paidGenerationCalls: 0,
    };
  }

  const base = (input.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/$/,
    "",
  );
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const url = `${base}/models?pageSize=200`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      const blocked =
        res.status === 403 ||
        res.status === 401 ||
        /quota|permission|billing|blocked|limit/i.test(text);
      return {
        status: blocked ? "GEMINI_PROVIDER_ACCESS_BLOCKED" : "GEMINI_PROBE_ERROR",
        httpStatus: res.status,
        modelListed: false,
        exactModelId,
        note: `Models.list HTTP ${res.status}`,
        paidGenerationCalls: 0,
      };
    }
    const listed = /models\/gemini-4-argon\b|"gemini-4-argon"/i.test(text);
    if (!listed) {
      return {
        status: "GEMINI_PROVIDER_ACCESS_BLOCKED",
        httpStatus: res.status,
        modelListed: false,
        exactModelId,
        note: "gemini-4-argon not present in Models.list",
        paidGenerationCalls: 0,
      };
    }
    return {
      status: "GEMINI_ACCESS_OK",
      httpStatus: res.status,
      modelListed: true,
      exactModelId,
      note: "Models.list confirmed gemini-4-argon without generation",
      paidGenerationCalls: 0,
    };
  } catch (err) {
    return {
      status: "GEMINI_PROBE_ERROR",
      httpStatus: null,
      modelListed: false,
      exactModelId,
      note: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      paidGenerationCalls: 0,
    };
  }
}
