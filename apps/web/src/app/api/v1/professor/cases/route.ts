import { ingestStudentCaseSchema } from "@nyayagrid/validation";
import { ingestStudentCase, listStudentCases } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getEmbeddings } from "@/lib/infra";

/**
 * Nyaya Professor case library. Every case is private to the uploading user — there is no
 * organization/matter scope to check, so `requireUser` is the whole authorization boundary.
 */
export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const cases = await listStudentCases(db, user.id);
    return jsonOk({ cases });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = ingestStudentCaseSchema.parse(await request.json());
    const result = await ingestStudentCase({
      db,
      userId: user.id,
      title: body.title,
      content: body.content,
      citation: body.citation,
      court: body.court,
      embeddings: getEmbeddings(),
    });
    return jsonOk(
      {
        case: result.case,
        version: result.version,
        chunkCount: result.chunkCount,
        skipped: result.skipped,
        labelledOpinionParts: result.labelledOpinionParts,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
