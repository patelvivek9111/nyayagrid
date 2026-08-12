import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { signMatterDocumentDownload } from "@/server/document-download";

type Params = { params: Promise<{ matterId: string; documentId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, documentId } = await params;
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const versionId = url.searchParams.get("versionId") ?? undefined;
    const rawDisposition = url.searchParams.get("disposition");
    if (rawDisposition !== null && rawDisposition !== "attachment" && rawDisposition !== "inline") {
      return jsonError("VALIDATION_ERROR", "disposition must be attachment or inline", 400);
    }
    const disposition = (rawDisposition ?? undefined) as "attachment" | "inline" | undefined;

    const download = await signMatterDocumentDownload({
      db,
      userId: user.id,
      matterId,
      documentId,
      documentVersionId: versionId,
      disposition,
    });

    return jsonOk({ download });
  } catch (error) {
    return handleRouteError(error);
  }
}
