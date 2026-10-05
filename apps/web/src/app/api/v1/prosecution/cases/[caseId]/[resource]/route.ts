import { z } from "zod";
import { addProsecutionRecord } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const provenanceSchema = z
  .object({
    documentId: z.string().uuid().nullable().optional(),
    authorityId: z.string().uuid().nullable().optional(),
    sourceSpan: z.string().trim().max(8000).nullable().optional(),
    sourcePage: z.number().int().nullable().optional(),
    section: z.string().trim().max(200).nullable().optional(),
    extractionOrigin: z.enum(["human", "import", "deterministic_fixture", "source_metadata"]).optional(),
    humanEntered: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.humanEntered === true ||
      value.extractionOrigin === "human" ||
      Boolean(value.documentId || value.authorityId || value.sourceSpan),
    { message: "Provenance requires a document, authority, source span, or human origin." },
  );

const text = z.string().trim().min(1).max(500);
const optionalText = z.string().trim().max(4000).nullable().optional();

export const prosecutionResourceSchemas = {
  defendants: z.object({
    displayName: text,
    aliases: z.array(z.string().max(200)).max(20).optional(),
    custodyStatus: optionalText,
    defenseCounsel: optionalText,
    notes: optionalText,
    status: z.string().trim().max(40).optional(),
    provenance: provenanceSchema,
  }),
  charges: z.object({
    defendantId: z.string().uuid(),
    countNumber: text,
    statuteCitation: optionalText,
    offenseName: text,
    offenseClassification: optionalText,
    jurisdiction: z.string().trim().min(2).max(16),
    status: z.string().trim().max(40).optional(),
    provenance: provenanceSchema,
  }),
  elements: z.object({
    chargeId: z.string().uuid(),
    elementOrder: z.number().int().min(1).max(100),
    elementText: z.string().trim().min(1).max(4000),
    elementType: text,
    supportingEvidenceIds: z.array(z.string().uuid()).max(100).optional(),
    contraryEvidenceIds: z.array(z.string().uuid()).max(100).optional(),
    uncertainEvidenceIds: z.array(z.string().uuid()).max(100).optional(),
    missingEvidenceIds: z.array(z.string().max(200)).max(100).optional(),
    relatedAuthorityIds: z.array(z.string().uuid()).max(100).optional(),
    status: z.enum(["SUPPORTED", "PARTIALLY_SUPPORTED", "CONFLICTED", "NO_EVIDENCE_FOUND", "UNKNOWN"]).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    humanReviewStatus: z.string().trim().max(40).optional(),
    provenance: provenanceSchema,
  }),
  evidence: z.object({
    evidenceType: text,
    sourceAgency: optionalText,
    collector: optionalText,
    storageReference: optionalText,
    chainOfCustody: z.array(z.string().max(200)).max(50).optional(),
    sensitivity: z.string().trim().max(40).optional(),
    reviewStatus: z.string().trim().max(40).optional(),
    provenance: provenanceSchema,
  }),
  "evidence-links": z.object({
    evidenceId: z.string().uuid(),
    relationship: z.enum([
      "SUPPORTS_ELEMENT",
      "UNDERMINES_ELEMENT",
      "CORROBORATES",
      "CONTRADICTS",
      "IMPEACHES",
      "RELATED_TO",
      "FOUND_AT",
      "SEIZED_DURING",
      "MENTIONED_BY",
      "COLLECTED_BY",
      "SOURCE_OF",
    ]),
    targetType: text,
    targetId: z.string().trim().min(1).max(80),
    provenance: provenanceSchema,
  }),
  witnesses: z.object({
    displayName: text,
    witnessType: text,
    relationship: optionalText,
    notes: optionalText,
    sensitivity: z.string().trim().max(40).optional(),
    provenance: provenanceSchema,
  }),
  statements: z.object({
    witnessId: z.string().uuid(),
    statementType: text,
    sourceSpan: optionalText,
    interviewer: optionalText,
    eventContext: optionalText,
    claims: z.array(z.object({ key: text, value: z.string().max(2000), kind: z.enum(["fact", "time"]).optional() })).max(100).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    provenance: provenanceSchema,
  }),
  discovery: z.object({
    source: text,
    category: text,
    reviewStatus: z.enum(["RECEIVED", "REVIEWED", "FLAGGED", "PRODUCED", "WITHHELD_FOR_ATTORNEY_REVIEW", "UNKNOWN"]).optional(),
    productionStatus: z.enum(["RECEIVED", "REVIEWED", "FLAGGED", "PRODUCED", "WITHHELD_FOR_ATTORNEY_REVIEW", "UNKNOWN"]).optional(),
    notes: optionalText,
    relatedDocumentIds: z.array(z.string().uuid()).max(100).optional(),
    provenance: provenanceSchema,
  }),
  disclosure: z.object({
    category: z.enum([
      "POTENTIALLY_EXCULPATORY",
      "POTENTIAL_IMPEACHMENT",
      "PRIOR_INCONSISTENT_STATEMENT",
      "EVIDENCE_WEAKENING_ELEMENT",
      "ALTERNATE_SUSPECT",
      "WITNESS_BENEFIT_OR_PROMISE",
      "CONTRADICTORY_EVIDENCE",
      "OTHER",
      "UNKNOWN",
    ]),
    status: z.enum(["UNREVIEWED", "REVIEW_REQUIRED", "REVIEWED_DISCLOSE", "REVIEWED_NOT_DISCLOSE", "ESCALATE"]).optional(),
    notes: optionalText,
    provenance: provenanceSchema,
  }),
  "procedure-issues": z.object({
    issueType: text,
    missingFacts: z.array(z.string().max(500)).max(50).optional(),
    status: z.string().trim().max(40).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    provenance: provenanceSchema,
  }),
  warrants: z.object({
    warrantType: text,
    issuingCourt: optionalText,
    issuingJudge: optionalText,
    scope: optionalText,
    probableCauseFacts: z.array(z.string().max(2000)).max(50).optional(),
    seizedEvidenceIds: z.array(z.string().uuid()).max(100).optional(),
    provenance: provenanceSchema,
  }),
  "warrant-affidavits": z.object({
    warrantId: z.string().uuid(),
    affiant: optionalText,
    statement: z.string().trim().min(1).max(20000),
    provenance: provenanceSchema,
  }),
  "warrant-executions": z.object({
    warrantId: z.string().uuid(),
    executedBy: optionalText,
    notes: optionalText,
    provenance: provenanceSchema,
  }),
  "warrant-returns": z.object({
    warrantId: z.string().uuid(),
    inventory: z.array(z.string().max(500)).max(100).optional(),
    provenance: provenanceSchema,
  }),
  motions: z.object({
    motionType: text,
    filingParty: text,
    status: z.string().trim().max(40).optional(),
    response: optionalText,
    ruling: optionalText,
    provenance: provenanceSchema,
  }),
  hearings: z.object({
    hearingType: text,
    court: optionalText,
    judge: optionalText,
    participants: z.array(z.string().max(200)).max(40).optional(),
    outcome: optionalText,
    provenance: provenanceSchema,
  }),
  subpoenas: z.object({
    recipient: text,
    requestScope: z.string().trim().min(1).max(4000),
    status: z.string().trim().max(40).optional(),
    provenance: provenanceSchema,
  }),
  pleas: z.object({
    terms: z.string().trim().min(1).max(20000),
    status: z.string().trim().max(40).optional(),
    history: z.array(z.string().max(2000)).max(50).optional(),
    provenance: provenanceSchema,
  }),
  dispositions: z.object({
    chargeId: z.string().uuid(),
    result: text,
    notes: optionalText,
    provenance: provenanceSchema,
  }),
  sentences: z.object({
    chargeId: z.string().uuid(),
    conviction: text,
    sentenceTerms: z.string().trim().min(1).max(8000),
    custodial: z.boolean().nullable().optional(),
    conditions: z.array(z.string().max(500)).max(40).optional(),
    notes: optionalText,
    provenance: provenanceSchema,
  }),
  timeline: z.object({
    eventType: z.enum([
      "OFFENSE",
      "REPORT",
      "SEARCH",
      "SEIZURE",
      "ARREST",
      "INTERVIEW",
      "WARRANT_ISSUED",
      "WARRANT_EXECUTED",
      "CHARGE_FILED",
      "DISCOVERY_RECEIVED",
      "DISCOVERY_PRODUCED",
      "MOTION_FILED",
      "HEARING",
      "PLEA_EVENT",
      "TRIAL_EVENT",
      "SENTENCING",
      "OTHER",
    ]),
    title: text,
    provenance: provenanceSchema,
  }),
  tasks: z.object({
    title: text,
    status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(),
  }),
  agencies: z.object({
    name: text,
    agencyType: text,
    jurisdiction: optionalText,
    contact: z.record(z.string().max(200)).optional(),
  }),
  officers: z.object({
    agencyId: z.string().uuid(),
    name: text,
    role: text,
    badgeIdentifier: optionalText,
  }),
} as const;

export async function POST(request: Request, context: { params: Promise<{ caseId: string; resource: string }> }) {
  try {
    const { db, user } = await requireUser(request.headers);
    const { caseId, resource } = await context.params;
    const organizationId = new URL(request.url).searchParams.get("organizationId");
    const schema = prosecutionResourceSchemas[resource as keyof typeof prosecutionResourceSchemas];
    if (!schema || !organizationId || !z.string().uuid().safeParse(organizationId).success || !z.string().uuid().safeParse(caseId).success) {
      return jsonError("VALIDATION_ERROR", "Unknown prosecution resource or id.", 400);
    }
    const body = schema.parse(await request.json());
    const record = await addProsecutionRecord(db, {
      userId: user.id,
      organizationId,
      caseId,
      resource,
    body: body as Record<string, unknown>,
    });
    return jsonOk({ record }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
