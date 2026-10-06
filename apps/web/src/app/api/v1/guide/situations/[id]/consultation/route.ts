import { generateConsultationPacket } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAI, getEmbeddings } from "@/lib/infra";
import { enforceRateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireGuideUser(request.headers);
    const limited = await enforceRateLimit(request, { endpointClass: "guide", userId: user.id });
    if (limited) return limited;

    const result = await generateConsultationPacket({
      db,
      situationId: id,
      userId: user.id,
      ai: getAI(),
      embeddings: getEmbeddings(),
    });

    // `packet` is the persisted UI shape (peopleInvolved/timeline/…). Keep `aiPacket` for richer consumers.
    return jsonOk({ packet: result.packet, aiPacket: result.aiPacket, record: result.record });
  } catch (error) {
    return handleRouteError(error);
  }
}
