import { desc, eq } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import {
  guideDocumentChunks,
  guideDocumentExplanations,
  guideDocumentVersions,
} from "@nyayagrid/database";
import type {
  GuideDocumentExplanation as GuideDocumentExplanationRow,
  GuideExplicitDate as GuideExplicitDateRow,
  GuideSourceRef,
} from "@nyayagrid/database";
import {
  buildGuideDocumentExplanationSystemPrompt,
  buildGuideDocumentExplanationUserPrompt,
  guideDocumentExplanationSchema,
  GUIDE_DOCUMENT_EXPLANATION_PROMPT_VERSION,
  type GuideDocumentExplanation,
  type GuideExplicitDate,
} from "@nyayagrid/ai";
import type { AIProvider } from "@nyayagrid/ai";
import { assertGuideDocumentOwnership } from "./auth";
import { validateQuoteAgainstText } from "./quotes";

export type ExplainGuideDocumentInput = {
  db: Database;
  documentId: string;
  userId: string;
  ai?: AIProvider;
};

export type ExplainGuideDocumentResult = {
  /** Full, structured explanation returned to the caller — richer than what gets persisted. */
  explanation: GuideDocumentExplanation;
  record: GuideDocumentExplanationRow;
  rejectedQuoteCount: number;
};

type QuotedItem = { quote?: string | null; chunkId?: string | null };

/**
 * Drop any item whose quote/chunkId cannot be verified verbatim against the chunk it claims to
 * cite. This is the enforcement point for "never fabricate a date, amount, or quotation."
 */
function filterVerified<T extends QuotedItem>(
  items: T[],
  chunkContentById: Map<string, string>,
): { kept: T[]; rejected: number } {
  const kept = items.filter((item) => {
    if (!item.quote || !item.chunkId) return false;
    const source = chunkContentById.get(item.chunkId);
    if (!source) return false;
    return validateQuoteAgainstText(item.quote, source).valid;
  });
  return { kept, rejected: items.length - kept.length };
}

/**
 * Explicit-date-only enforcement: an entry only survives if it has a chunkId that was actually
 * retrieved AND its quote is verbatim in that chunk's text. Nothing here ever computes, offsets,
 * or infers a date — every surviving entry is copy-pasted from the source document.
 */
export function validateExplicitDatesAgainstChunks(
  dates: GuideExplicitDate[],
  chunkContentById: Map<string, string>,
): { kept: GuideExplicitDate[]; rejected: number } {
  return filterVerified(dates, chunkContentById);
}

/**
 * Reformats an explicit date string already found verbatim in the document into ISO form for
 * storage. This never estimates or calculates a date — it only re-renders a date that is already
 * fully stated in the source text; unparseable text is stored with isoDate=null.
 */
function toIsoDateOrNull(raw: string): string | null {
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function toExplicitDateRow(date: GuideExplicitDate): GuideExplicitDateRow {
  return {
    rawText: date.quote,
    isoDate: toIsoDateOrNull(date.date),
    chunkId: date.chunkId,
    label: date.label,
  };
}

/**
 * Flattens the rich, per-field-quoted explanation the model produces into the narrower
 * GuideDocumentExplanationContent shape guide_document_explanations actually persists. All quote
 * verification happens before this step; this function only reshapes already-verified content.
 */
function toExplanationContent(params: {
  parsed: GuideDocumentExplanation;
  verifiedSections: GuideDocumentExplanation["sections"];
  verifiedObligations: GuideDocumentExplanation["obligations"];
  verifiedRisks: GuideDocumentExplanation["risksOrUnusualLanguage"];
  verifiedTermination: GuideDocumentExplanation["terminationLanguage"];
}): GuideDocumentExplanationRow["explanation"] {
  const { parsed, verifiedSections, verifiedObligations, verifiedRisks, verifiedTermination } =
    params;

  const summaryParts = [parsed.summary];
  if (parsed.courtNoticeMode && parsed.courtNoticeDetails) {
    const d = parsed.courtNoticeDetails;
    summaryParts.push(
      `This appears to be a court notice. Parties named in the document: ${
        d.parties.length > 0 ? d.parties.join(", ") : "none stated"
      }. Court: ${d.court ?? "not stated in the document"}.`,
    );
  }
  if (parsed.actionRequested) {
    summaryParts.push(`Action requested by the document: ${parsed.actionRequested}`);
  }

  return {
    plainLanguageSummary: summaryParts.join(" "),
    obligations: verifiedObligations.map((o) => `${o.party}: ${o.obligation}`),
    rightsMentioned: parsed.rightsMentioned,
    risksOrUnusualLanguage: [
      ...verifiedRisks.map((r) => r.text),
      ...verifiedTermination.map((t) => `[Termination] ${t.text}`),
      ...verifiedSections.filter((s) => !s.quote).map((s) => `${s.heading}: ${s.plainLanguage}`),
    ],
    termsNeedingClarification: parsed.terminology.map((t) => `${t.term} — ${t.definition}`),
    questionsForALawyer: parsed.questionsForLawyer,
    limitations: [
      "This is plain-language information about the document's own text, not legal advice.",
      "No procedural deadline was calculated; only dates explicitly written in the document are reported.",
    ],
  };
}

export async function explainGuideDocument(
  params: ExplainGuideDocumentInput,
): Promise<ExplainGuideDocumentResult> {
  const { db } = params;
  const document = await assertGuideDocumentOwnership(db, {
    documentId: params.documentId,
    userId: params.userId,
  });

  const [latestVersion] = await db
    .select()
    .from(guideDocumentVersions)
    .where(eq(guideDocumentVersions.documentId, document.id))
    .orderBy(desc(guideDocumentVersions.versionNumber))
    .limit(1);
  if (!latestVersion) {
    throw new Error("Guide document has no ingested version to explain");
  }

  const chunkRows = await db
    .select()
    .from(guideDocumentChunks)
    .where(eq(guideDocumentChunks.documentId, document.id));

  const chunks = chunkRows.map((c) => ({
    chunkId: c.id,
    documentId: c.documentId,
    content: c.content,
    page: c.pageStart,
    segmentRef: c.segmentRef,
  }));
  const chunkContentById = new Map(chunkRows.map((c) => [c.id, c.content]));

  const ai = params.ai;
  if (!ai) throw new Error("An AIProvider is required to explain a guide document");

  const result = await ai.generate({
    messages: [
      { role: "system", content: buildGuideDocumentExplanationSystemPrompt() },
      {
        role: "user",
        content: buildGuideDocumentExplanationUserPrompt({
          documentKind: document.documentKind ?? "other",
          chunks,
        }),
      },
    ],
    schemaName: "guideDocumentExplanation",
  });

  const parsed = guideDocumentExplanationSchema.parse(JSON.parse(result.text));

  let rejectedQuoteCount = 0;

  const verifiedSections = parsed.sections.filter((section) => {
    if (!section.quote || !section.chunkId) return true; // narrative sections may omit a quote
    const source = chunkContentById.get(section.chunkId);
    const valid = source ? validateQuoteAgainstText(section.quote, source).valid : false;
    if (!valid) rejectedQuoteCount += 1;
    return valid;
  });

  const obligations = filterVerified(parsed.obligations, chunkContentById);
  rejectedQuoteCount += obligations.rejected;

  const explicitDatesResult = validateExplicitDatesAgainstChunks(
    parsed.explicitDates,
    chunkContentById,
  );
  rejectedQuoteCount += explicitDatesResult.rejected;

  const explicitAmounts = filterVerified(parsed.explicitAmounts, chunkContentById);
  rejectedQuoteCount += explicitAmounts.rejected;

  const risksOrUnusualLanguage = filterVerified(parsed.risksOrUnusualLanguage, chunkContentById);
  rejectedQuoteCount += risksOrUnusualLanguage.rejected;

  const terminationLanguage = filterVerified(parsed.terminationLanguage, chunkContentById);
  rejectedQuoteCount += terminationLanguage.rejected;

  let courtNoticeDetails = parsed.courtNoticeDetails ?? null;
  if (courtNoticeDetails) {
    const hearingDates = validateExplicitDatesAgainstChunks(
      courtNoticeDetails.hearingDate ? [courtNoticeDetails.hearingDate] : [],
      chunkContentById,
    );
    const responseDeadlines = validateExplicitDatesAgainstChunks(
      courtNoticeDetails.responseDeadline ? [courtNoticeDetails.responseDeadline] : [],
      chunkContentById,
    );
    rejectedQuoteCount += hearingDates.rejected + responseDeadlines.rejected;
    courtNoticeDetails = {
      ...courtNoticeDetails,
      hearingDate: hearingDates.kept[0] ?? null,
      responseDeadline: responseDeadlines.kept[0] ?? null,
    };
  }

  const explanation: GuideDocumentExplanation = {
    ...parsed,
    sections: verifiedSections,
    obligations: obligations.kept,
    explicitDates: explicitDatesResult.kept,
    explicitAmounts: explicitAmounts.kept,
    risksOrUnusualLanguage: risksOrUnusualLanguage.kept,
    terminationLanguage: terminationLanguage.kept,
    courtNoticeDetails,
  };

  const allExplicitDateRows = [
    ...explicitDatesResult.kept.map(toExplicitDateRow),
    ...(courtNoticeDetails?.hearingDate
      ? [toExplicitDateRow({ ...courtNoticeDetails.hearingDate, label: "Hearing date" })]
      : []),
    ...(courtNoticeDetails?.responseDeadline
      ? [
          toExplicitDateRow({
            ...courtNoticeDetails.responseDeadline,
            label: "Response deadline stated in the document",
          }),
        ]
      : []),
  ];

  const explanationContent = toExplanationContent({
    parsed: explanation,
    verifiedSections,
    verifiedObligations: obligations.kept,
    verifiedRisks: risksOrUnusualLanguage.kept,
    verifiedTermination: terminationLanguage.kept,
  });

  const sources: GuideSourceRef[] = [
    ...verifiedSections
      .filter((s) => s.quote && s.chunkId)
      .map((s) => ({
        provenance: "document_extracted" as const,
        documentId: document.id,
        chunkId: s.chunkId ?? undefined,
        quote: s.quote ?? null,
      })),
    ...obligations.kept.map((o) => ({
      provenance: "document_extracted" as const,
      documentId: document.id,
      chunkId: o.chunkId,
      quote: o.quote,
    })),
    ...explicitDatesResult.kept.map((d) => ({
      provenance: "document_extracted" as const,
      documentId: document.id,
      chunkId: d.chunkId,
      quote: d.quote,
    })),
  ];

  const [record] = await db
    .insert(guideDocumentExplanations)
    .values({
      documentId: document.id,
      documentVersionId: latestVersion.id,
      userId: params.userId,
      explanation: explanationContent,
      explicitDates: allExplicitDateRows,
      sources,
      provider: result.provider,
      model: result.model,
      promptVersion: GUIDE_DOCUMENT_EXPLANATION_PROMPT_VERSION,
    })
    .returning();
  if (!record) throw new Error("Failed to persist guide document explanation");

  return { explanation, record, rejectedQuoteCount };
}
