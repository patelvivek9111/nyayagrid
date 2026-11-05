import { z } from "zod";
import { appendProsecutionEvidenceCustody } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ caseId: string; evidenceId: string }> };

const transferSchema = z.object({
  organizationId: z.string().uuid(),
  transfer: z.object({
    actor: z.string().trim().min(1).max(200),
    timestamp: z.string().trim().min(1).max(80),
    from: z.string().trim().max(200).nullable().optional(),
    to: z.string().trim().min(1).max(200),
    location: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    source: z
      .object({
        documentId: z.string().uuid().nullable().optional(),
        authorityId: z.string().uuid().nullable().optional(),
        sourceSpan: z.string().trim().max(8000).nullable().optional(),
        sourcePage: z.number().int().nullable().optional(),
        section: z.string().trim().max(200).nullable().optional(),
        extractionOrigin: z
          .enum(["human", "import", "deterministic_fixture", "source_metadata"])
          .optional(),
        humanEntered: z.boolean().optional(),
      })
      .optional(),
  }),
});

/** Append-only custody transfer. Prior chain history is never rewritten. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { caseId, evidenceId } = await params;
    if (
      !z.string().uuid().safeParse(caseId).success ||
      !z.string().uuid().safeParse(evidenceId).success
    ) {
      return jsonError("VALIDATION_ERROR", "caseId and evidenceId must be UUIDs", 400);
    }
    const { db, user } = await requireUser(request.headers);
    const body = transferSchema.parse(await request.json());
    const result = await appendProsecutionEvidenceCustody(db, {
      userId: user.id,
      organizationId: body.organizationId,
      caseId,
      evidenceId,
      transfer: {
        ...body.transfer,
        from: body.transfer.from ?? null,
        source: body.transfer.source ?? {
          humanEntered: true,
          extractionOrigin: "human",
        },
      },
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
