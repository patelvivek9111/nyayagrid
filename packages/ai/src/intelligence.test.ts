import { describe, expect, it } from "vitest";
import {
  normalizeMatterIntelligenceExtractionRaw,
  parseMatterIntelligenceExtraction,
} from "./intelligence";

const CHUNK_A = "11111111-1111-4111-8111-111111111111";
const CHUNK_B = "22222222-2222-4222-8222-222222222222";

describe("normalizeMatterIntelligenceExtractionRaw", () => {
  it("rescues string entities and alternate fact/deadline field names", () => {
    const normalized = normalizeMatterIntelligenceExtractionRaw(
      {
        facts: [
          {
            name: "Termination notice",
            text: "30 days written notice",
            sources: [{ chunkId: CHUNK_A, quote: "30 days written notice" }],
          },
        ],
        entities: ["Riverview Legal LLC", { name: "Northwind Logistics Inc.", type: "company" }],
        deadlines: [
          {
            label: "Late fee accrual",
            dueDate: null,
            chunkIds: [CHUNK_B],
          },
        ],
        timeline: [
          {
            name: "Agreement terms stated",
            type: "contract_term",
            chunkId: CHUNK_A,
          },
        ],
      },
      { availableChunkIds: [CHUNK_A, CHUNK_B] },
    ) as {
      facts: Array<{ factKey: string; label: string; value: string }>;
      entities: Array<{ displayName: string; entityType: string }>;
      deadlines: Array<{ title: string }>;
      timelineEvents: Array<{ title: string; eventType: string }>;
    };

    expect(normalized.facts[0]).toMatchObject({
      factKey: "termination_notice",
      label: "Termination notice",
      value: "30 days written notice",
    });
    expect(normalized.entities.map((e) => e.displayName)).toEqual([
      "Riverview Legal LLC",
      "Northwind Logistics Inc.",
    ]);
    expect(normalized.entities[0]?.entityType).toBe("organization");
    expect(normalized.deadlines[0]?.title).toBe("Late fee accrual");
    expect(normalized.timelineEvents[0]).toMatchObject({
      title: "Agreement terms stated",
      eventType: "contract_term",
    });
  });

  it("parses rescued payloads through Zod", () => {
    const parsed = parseMatterIntelligenceExtraction(
      {
        facts: [{ label: "Governing law", value: "Synthetic Jurisdiction" }],
        entities: ["Acme Corp"],
        deadlines: [],
        timelineEvents: [],
      },
      { availableChunkIds: [CHUNK_A] },
    );

    expect(parsed.facts).toHaveLength(1);
    expect(parsed.facts[0]?.sourceChunkIds).toEqual([CHUNK_A]);
    expect(parsed.entities[0]).toMatchObject({
      displayName: "Acme Corp",
      entityType: "organization",
      sourceChunkIds: [CHUNK_A],
    });
  });

  it("drops unsavable items instead of throwing", () => {
    const parsed = parseMatterIntelligenceExtraction({
      facts: [{ label: "Missing value only" }],
      entities: [42, null],
      deadlines: [{ dueAt: "2026-01-01" }],
      timelineEvents: "not-an-array",
    });

    expect(parsed).toEqual({
      timelineEvents: [],
      facts: [],
      entities: [],
      deadlines: [],
    });
  });
});
