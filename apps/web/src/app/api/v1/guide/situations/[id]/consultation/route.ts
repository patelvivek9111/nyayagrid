import { generateConsultationPacket } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAI, getEmbeddings } from "@/lib/infra";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser(request.headers);

    const result = await generateConsultationPacket({
      db,
      situationId: id,
      userId: user.id,
      ai: getAI(),
      embeddings: getEmbeddings(),
    });

    return jsonOk({ packet: result.packet, record: result.record });
  } catch (error) {
    return handleRouteError(error);
  }
}
