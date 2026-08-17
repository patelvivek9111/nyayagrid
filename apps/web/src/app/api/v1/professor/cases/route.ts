import { ingestStudentCaseSchema } from "@nyayagrid/validation";
import { ingestStudentCase, listStudentCases } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { getEmbeddings, getStorage } from "@/lib/infra";

/**
 * Nyaya Professor case library. Every case is private to the uploading user — there is no
 * organization/matter scope to check, so `requireUser` is the whole authorization boundary.
 * FEATURE_PROFESSOR is a deployment switch, not a substitute for this identity check.
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
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const title = String(form.get("title") ?? "").trim();
      const citation = optionalFormString(form.get("citation"));
      const court = optionalFormString(form.get("court"));
      const courseLabel = optionalFormString(form.get("courseLabel"));
      const pasted = optionalFormString(form.get("content"));
      const file = form.get("file");

      if (!title || title.length < 3) {
        return jsonError("VALIDATION_ERROR", "A case title of at least 3 characters is required.", 400);
      }

      let buffer: Buffer | undefined;
      let mimeType: string | undefined;
      let filename: string | undefined;
      if (file instanceof File && file.size > 0) {
        buffer = Buffer.from(await file.arrayBuffer());
        mimeType = file.type || "application/octet-stream";
        filename = file.name;
      }

      if (!buffer && (!pasted || pasted.length < 20)) {
        return jsonError(
          "VALIDATION_ERROR",
          "Paste at least 20 characters of opinion text, or upload a text or PDF file.",
          400,
        );
      }

      const result = await ingestStudentCase({
        db,
        userId: user.id,
        title,
        content: pasted,
        buffer,
        mimeType,
        filename,
        citation,
        court,
        courseLabel,
        embeddings: getEmbeddings(),
        storage: buffer ? getStorage() : undefined,
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
    }

    const body = ingestStudentCaseSchema.parse(await request.json());
    if (!body.content) {
      return jsonError(
        "VALIDATION_ERROR",
        "Paste at least 20 characters of opinion text, or upload a text or PDF file.",
        400,
      );
    }
    const result = await ingestStudentCase({
      db,
      userId: user.id,
      title: body.title,
      content: body.content,
      citation: body.citation,
      court: body.court,
      courseLabel: body.courseLabel,
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

function optionalFormString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
