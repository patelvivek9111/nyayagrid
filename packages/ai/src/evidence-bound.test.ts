import { describe, expect, it } from "vitest";
import {
  extractSourceQualifiers,
  formatSourceQualifierBlock,
  NYAYA_EVIDENCE_BOUND_MARKER,
  NYAYA_FUTURE_EFFECTIVE_MARKER,
  NYAYA_PREMISE_CHALLENGE_MARKER,
  NYAYA_QUALIFIER_PRESERVE_MARKER,
  NYAYA_SILENCE_NOT_PROOF_MARKER,
  NYAYA_SOURCE_ROLE_MARKER,
} from "./evidence-bound";
import { buildNyayaSystemPrompt, buildNyayaUserPrompt, NYAYA_PROMPT_VERSION } from "./index";
import { parseGraphRelationshipExtraction, resolveGraphCanonicalId } from "./graph-memory";

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CHUNK_ID = "33333333-3333-4333-8333-333333333333";

describe("evidence-bound prompt contract", () => {
  it("ships v11 with evidence-bound rules and a binding assessment instruction", () => {
    expect(NYAYA_PROMPT_VERSION).toBe("nyaya-matter-qa-v11");
    const prompt = buildNyayaSystemPrompt();
    expect(prompt).toContain(NYAYA_EVIDENCE_BOUND_MARKER);
    expect(prompt).toContain(NYAYA_PREMISE_CHALLENGE_MARKER);
    expect(prompt).toContain(NYAYA_SILENCE_NOT_PROOF_MARKER);
    expect(prompt).toContain(NYAYA_SOURCE_ROLE_MARKER);
    expect(prompt).toContain(NYAYA_FUTURE_EFFECTIVE_MARKER);
    expect(prompt).toContain(NYAYA_QUALIFIER_PRESERVE_MARKER);
    expect(prompt).toMatch(/do not invent motives/i);
    expect(prompt).toMatch(/not-yet-effective amendment/i);
    expect(prompt).toMatch(/EvidenceAssessment block is present/i);
    expect(prompt).not.toMatch(/SYNTH-V2|Harbor Holdings|Jordan A\. Mercer|14:47/);
  });

  it("surfaces source qualifiers in the user prompt without inventing facts", () => {
    const block = formatSourceQualifierBlock([
      {
        chunkId: "chunk_log",
        quote:
          "ACCESS GRANTED at 14:47. This log records badge activity; it does not independently prove who physically carried the badge.",
      },
    ]);
    expect(block).toContain("does not independently prove");
    expect(block).toContain("chunk_log");
    const user = buildNyayaUserPrompt("When did the person enter?", [
      {
        chunkId: "chunk_log",
        documentId: "d1",
        documentVersionId: "v1",
        quote:
          "ACCESS GRANTED at 14:47. This log records badge activity; it does not independently prove who physically carried the badge.",
      },
    ]);
    expect(user).toContain("Detected hedge or limitation language");
  });

  it("extracts hedge language for preservation", () => {
    const hits = extractSourceQualifiers([
      { chunkId: "c1", quote: "Delivery occurred approximately in March." },
      { chunkId: "c2", quote: "The fee is $1,000." },
    ]);
    expect(hits).toEqual([{ chunkId: "c1", labels: ["approximately"] }]);
  });
});

describe("graph relationship extraction contract", () => {
  const nodes = [
    { canonicalEntityType: "person", canonicalEntityId: PERSON_ID, displayName: "Alex Rivera" },
    {
      canonicalEntityType: "organization",
      canonicalEntityId: ORG_ID,
      displayName: "Northwind LLC",
    },
  ];

  it("resolves display names to verified UUIDs and normalizes numeric confidence", () => {
    const parsed = parseGraphRelationshipExtraction(
      {
        relationships: [
          {
            fromCanonicalType: "person",
            fromCanonicalId: "Alex Rivera",
            toCanonicalType: "organization",
            toCanonicalId: "Northwind LLC",
            relationshipType: "works_for",
            confidence: 0.9,
            sourceChunkIds: [CHUNK_ID],
            sourceQuotes: ["Alex Rivera is employed by Northwind LLC."],
          },
        ],
      },
      nodes,
    );
    expect(parsed.relationships).toHaveLength(1);
    expect(parsed.relationships[0]?.fromCanonicalId).toBe(PERSON_ID);
    expect(parsed.relationships[0]?.toCanonicalId).toBe(ORG_ID);
    expect(parsed.relationships[0]?.confidence).toBe("high");
  });

  it("drops invented non-UUID identifiers instead of failing the extraction", () => {
    const parsed = parseGraphRelationshipExtraction(
      {
        relationships: [
          {
            fromCanonicalType: "person",
            fromCanonicalId: "someone-invented",
            toCanonicalType: "organization",
            toCanonicalId: "also-invented",
            relationshipType: "works_for",
            confidence: "medium",
            sourceChunkIds: [CHUNK_ID],
            sourceQuotes: ["nope"],
          },
        ],
      },
      nodes,
    );
    expect(parsed.relationships).toEqual([]);
  });

  it("does not treat a UUID requirement as optional", () => {
    expect(resolveGraphCanonicalId("Alex Rivera", "person", nodes)).toBe(PERSON_ID);
    expect(resolveGraphCanonicalId("not-a-node", "person", nodes)).toBeNull();
    expect(
      resolveGraphCanonicalId("99999999-9999-4999-8999-999999999999", "person", nodes),
    ).toBeNull();
  });
});
