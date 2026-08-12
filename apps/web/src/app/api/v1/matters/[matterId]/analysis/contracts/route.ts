import { analyzeContractSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { analyzeContract, listContractAnalyses } from "@nyayagrid/intelligence";
import { MockAIProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const url = new URL(request.url);
    const analyses = await listContractAnalyses({
      db,
      organizationId: matter.organizationId,
      matterId,
      documentId: url.searchParams.get("documentId") ?? undefined,
    });
    return jsonOk({ analyses });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "documents.edit",
    });
    const body = analyzeContractSchema.parse(await request.json());
    const result = await analyzeContract({
      db,
      organizationId: matter.organizationId,
      matterId,
      documentId: body.documentId,
      documentVersionId: body.documentVersionId,
      userId: user.id,
      force: body.force,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk(result, { status: result.skipped ? 200 : 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
