import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSourceScopeInvariants,
  encodeSseEvent,
  resolveSourceScopeFlags,
  SourceScopeViolationError,
  type AskStreamEvent,
} from "@nyayagrid/ai";
import {
  categorizeAskSource,
  mintAskContinueToken,
  parseAskContinueToken,
  questionFingerprint,
  webPagesToGroundingPassages,
} from "./nyaya";
import { createAskSseResponse } from "./ask-sse";

const root = resolve(__dirname, "../../..");

function readNyayaSrc(): string {
  return readFileSync(resolve(root, "packages/search/src/nyaya.ts"), "utf8");
}

describe("ask sourceScope wiring", () => {
  it("CASE cannot enable web (flags + source guard)", () => {
    const flags = resolveSourceScopeFlags("case");
    expect(flags.webEnabled).toBe(false);
    expect(() => assertSourceScopeInvariants(flags)).not.toThrow();
    expect(() =>
      assertSourceScopeInvariants({ ...flags, webEnabled: true, generalWebEnabled: true }),
    ).toThrow(SourceScopeViolationError);

    const src = readNyayaSrc();
    expect(src).toContain("resolveSourceScopeFlags");
    expect(src).toContain("assertSourceScopeInvariants");
    expect(src).toMatch(/flags\.legalCorpusEnabled/);
    expect(src).toMatch(/webEnabled=true is only valid for explicit web sourceScope/);
  });

  it("separates categories: web never under case_evidence", () => {
    expect(
      categorizeAskSource({
        sourceScope: "case",
        documentId: "doc-1",
        chunkId: "chunk-1",
      }),
    ).toBe("case_evidence");

    expect(
      categorizeAskSource({
        sourceScope: "legal_research",
        authorityId: "auth-1",
      }),
    ).toBe("legal_authority");

    expect(
      categorizeAskSource({
        sourceScope: "web",
        documentId: "web:web_abc",
        chunkId: "web_abc",
        url: "https://example.gov/x",
      }),
    ).toBe("web");

    expect(
      categorizeAskSource({
        sourceScope: "case",
        documentId: "web:web_sneak",
        chunkId: "web_sneak",
      }),
    ).toBe("web");
  });

  it("maps web pages to external grounding passages (not case doc ids)", () => {
    const passages = webPagesToGroundingPassages([
      {
        id: "web_1",
        url: "https://courts.example.gov/a",
        title: "Court page",
        text: "Official notice text",
        retrievedAt: "2026-09-16T12:00:00.000Z",
        authorityHint: "court",
      },
    ]);
    expect(passages[0]?.documentId.startsWith("web:")).toBe(true);
    expect(passages[0]?.chunkId).toBe("web_1");
  });

  it("continue token round-trips fingerprint + scope", () => {
    const question = "What is the notice period?";
    const token = mintAskContinueToken({
      sourceScope: "case",
      question,
      passageChunkIds: ["c1", "c2"],
    });
    const parsed = parseAskContinueToken(token);
    expect(parsed?.sourceScope).toBe("case");
    expect(parsed?.questionFingerprint).toBe(questionFingerprint(question));
    expect(parsed?.passageChunkIds).toEqual(["c1", "c2"]);
  });

  it("event ordering smoke: request → retrieval → generation → provenance → text → completed", async () => {
    const events: AskStreamEvent[] = [];
    const sequence: AskStreamEvent[] = [
      {
        type: "request_started",
        sourceScope: "case",
        usageActionId: "ua-1",
        at: "2026-09-16T12:00:00.000Z",
      },
      {
        type: "retrieval_started",
        label: "Searching this case",
        at: "2026-09-16T12:00:01.000Z",
      },
      {
        type: "retrieval_completed",
        passagesFound: 2,
        label: "Case passages retrieved",
        at: "2026-09-16T12:00:02.000Z",
      },
      { type: "generation_started", at: "2026-09-16T12:00:03.000Z" },
      {
        type: "provenance_ready",
        provenance: {
          sourceScope: "case",
          headline: "Grounded in this case",
          detail: "2 case sources · No external web sources",
          counts: {
            caseSourceCount: 2,
            authoritySourceCount: 0,
            webSourceCount: 0,
          },
        },
        at: "2026-09-16T12:00:04.000Z",
      },
      { type: "text_delta", text: "Hello", at: "2026-09-16T12:00:05.000Z" },
      {
        type: "generation_completed",
        answer: "Hello",
        conversationId: "conv-1",
        status: "completed",
        provenance: {
          sourceScope: "case",
          headline: "Grounded in this case",
          detail: "2 case sources · No external web sources",
          counts: {
            caseSourceCount: 2,
            authoritySourceCount: 0,
            webSourceCount: 0,
          },
        },
        at: "2026-09-16T12:00:06.000Z",
      },
    ];

    const response = createAskSseResponse(async (emit) => {
      for (const event of sequence) emit(event);
    });
    expect(response.headers.get("Content-Type")).toMatch(/text\/event-stream/);
    const body = await response.text();
    for (const event of sequence) {
      expect(body).toContain(`event: ${event.type}`);
      events.push(event);
    }
    expect(events.map((e) => e.type)).toEqual([
      "request_started",
      "retrieval_started",
      "retrieval_completed",
      "generation_started",
      "provenance_ready",
      "text_delta",
      "generation_completed",
    ]);
    expect(encodeSseEvent(sequence[0]!)).toContain("request_started");
  });

  it("mints usageActionId once per ask (wiring)", () => {
    const src = readNyayaSrc();
    const matches = src.match(/const usageActionId = newUsageActionId\(\)/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
