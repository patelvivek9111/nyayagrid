import { desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import {
  guideConsultationPackets,
  guideDocuments,
  guideSituationDocuments,
  guideSituationEvents,
} from "@nyayagrid/database";
import type {
  GuideConsultationPacket as GuideConsultationPacketRow,
  GuideConsultationPacketContent,
} from "@nyayagrid/database";
import {
  buildConsultationPacketSystemPrompt,
  buildConsultationPacketUserPrompt,
  consultationPacketSchema,
  detectHighStakes,
  GUIDE_CONSULTATION_PACKET_PROMPT_VERSION,
  type ConsultationPacket,
} from "@nyayagrid/ai";
import type { AIProvider, EmbeddingProvider } from "@nyayagrid/ai";
import { assertGuideSituationOwnership } from "./auth";
import { GuideDocumentHybridRetriever } from "./search";

export type GenerateConsultationPacketInput = {
  db: Database;
  situationId: string;
  userId: string;
  ai?: AIProvider;
  embeddings?: EmbeddingProvider;
};

export type GenerateConsultationPacketResult = {
  /** Full, structured packet returned to the caller — richer than what gets persisted. */
  packet: ConsultationPacket;
  record: GuideConsultationPacketRow;
};

/** Human-readable label for a high-stakes flag, used to populate potentiallyUrgentItems. */
const FLAG_LABELS: Record<string, string> = {
  eviction: "Possible eviction",
  arrest_or_detention: "Arrest or detention",
  deportation: "Deportation or immigration proceeding",
  domestic_violence: "Domestic violence or protective order",
  custody_emergency: "Child custody emergency",
  imminent_court_deadline: "Imminent court date or deadline",
  foreclosure: "Possible foreclosure",
  self_incrimination: "Self-incrimination risk",
  threat_to_safety: "Threat to personal safety",
};

function flagsToUrgentItems(flags: string[]): string[] {
  return flags.map((flag) => FLAG_LABELS[flag] ?? flag.replace(/_/g, " "));
}

/**
 * Flattens the rich, AI-facing ConsultationPacket into the narrower
 * GuideConsultationPacketContent shape guide_consultation_packets actually persists.
 */
function toPacketContent(
  parsed: ConsultationPacket,
  potentiallyUrgentItems: string[],
): GuideConsultationPacketContent {
  const summaryParts = [parsed.situationSummary];
  if (parsed.legalTopics.length > 0) {
    summaryParts.push(`Legal topics that may be relevant: ${parsed.legalTopics.join(", ")}.`);
  }
  if (parsed.lawyerTypeSuggestion) {
    summaryParts.push(parsed.lawyerTypeSuggestion);
  }

  return {
    situationSummary: summaryParts.join(" "),
    peopleInvolved: parsed.peopleAndOrganizations.map((p) =>
      p.role ? `${p.name} (${p.role})` : p.name,
    ),
    timeline: [
      ...parsed.keyEvents.map((e) => ({
        date: e.date ?? null,
        title: e.title,
        sourceLabel: "user_provided" as const,
      })),
      ...parsed.importantDatesFromDocuments.map((d) => ({
        date: d.date,
        title: d.label,
        sourceLabel: "document_extracted" as const,
      })),
    ],
    documentsAvailable: parsed.documentsAvailable,
    questionsForTheLawyer: parsed.questionsToAsk,
    desiredOutcome: parsed.desiredOutcome ?? null,
    missingInformation: parsed.missingDocuments,
    potentiallyUrgentItems,
    limitations: [
      "This packet organizes information you provided to help prepare for a consultation. It does not reach any legal conclusion.",
      "No outcome is guaranteed, and this is not a substitute for advice from a licensed lawyer.",
    ],
  };
}

/**
 * generateConsultationPacket assembles a consultation-preparation packet for a Guide situation:
 * situation summary, key events, people/orgs, documents available/missing, questions to ask,
 * important dates *from documents only* (never computed), legal topics, and a lawyer-type
 * suggestion phrased as a suggestion, never a definitive conclusion. Never touches Professional
 * matter/document tables — only guide_situations*, guide_documents*, and guide_document_chunks.
 */
export async function generateConsultationPacket(
  params: GenerateConsultationPacketInput,
): Promise<GenerateConsultationPacketResult> {
  const { db } = params;
  const situation = await assertGuideSituationOwnership(db, {
    situationId: params.situationId,
    userId: params.userId,
  });

  const events = await db
    .select()
    .from(guideSituationEvents)
    .where(eq(guideSituationEvents.situationId, situation.id))
    .orderBy(desc(guideSituationEvents.eventDate));

  const links = await db
    .select()
    .from(guideSituationDocuments)
    .where(eq(guideSituationDocuments.situationId, situation.id));

  const documentIds = links.map((l) => l.guideDocumentId);
  const documentTitles =
    documentIds.length > 0
      ? (
          await db
            .select({ id: guideDocuments.id, title: guideDocuments.title })
            .from(guideDocuments)
            .where(inArray(guideDocuments.id, documentIds))
        ).map((d) => d.title)
      : [];

  const documentChunks =
    params.embeddings && documentIds.length > 0
      ? (
          await Promise.all(
            documentIds.map((documentId) =>
              new GuideDocumentHybridRetriever(db, params.embeddings!).search(
                params.userId,
                situation.desiredOutcome ?? situation.title,
                { documentId, limit: 5 },
              ),
            ),
          )
        )
          .flat()
          .map((hit) => ({
            chunkId: hit.chunkId,
            documentId: hit.documentId,
            content: hit.snippet,
            page: hit.pageStart,
            segmentRef: hit.segmentRef,
          }))
      : [];

  const ai = params.ai;
  if (!ai) throw new Error("An AIProvider is required to generate a consultation packet");

  const eventContext = events
    .map((e) => `- ${e.eventDate ?? "date unknown"}: ${e.title}`)
    .join("\n");
  const { flags } = detectHighStakes(situation.title, situation.desiredOutcome, eventContext);

  const result = await ai.generate({
    messages: [
      { role: "system", content: buildConsultationPacketSystemPrompt() },
      {
        role: "user",
        content: buildConsultationPacketUserPrompt({
          situationTitle: situation.title,
          situationDescription: null,
          desiredOutcome: situation.desiredOutcome,
          events: events.map((e) => ({
            title: e.title,
            description: e.description,
            eventDate: e.eventDate,
          })),
          documentTitles,
          documentChunks,
        }),
      },
    ],
    schemaName: "consultationPacket",
  });

  const parsed = consultationPacketSchema.parse(JSON.parse(result.text));
  const potentiallyUrgentItems = flagsToUrgentItems(flags);
  const packetContent = toPacketContent(parsed, potentiallyUrgentItems);

  const [record] = await db
    .insert(guideConsultationPackets)
    .values({
      userId: params.userId,
      situationId: situation.id,
      packet: packetContent,
      provider: result.provider,
      model: result.model,
      promptVersion: GUIDE_CONSULTATION_PACKET_PROMPT_VERSION,
    })
    .returning();
  if (!record) throw new Error("Failed to persist guide consultation packet");

  return { packet: parsed, record };
}
