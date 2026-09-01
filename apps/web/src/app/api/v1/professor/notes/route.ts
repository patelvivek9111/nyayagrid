import { createStudentNoteSchema } from "@nyayagrid/validation";
import { createStudentNote, listStudentNotes } from "@nyayagrid/workspaces";
import { requireProfessorUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireProfessorUser(request.headers);
    const url = new URL(request.url);
    const caseId = url.searchParams.get("caseId");
    const kindRaw = url.searchParams.get("kind");
    const kind = kindRaw === "note" || kindRaw === "brief_challenge" ? kindRaw : undefined;
    const notes = await listStudentNotes({
      db,
      userId: user.id,
      caseId: caseId || undefined,
      kind,
    });
    return jsonOk({ notes });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireProfessorUser(request.headers);
    const body = createStudentNoteSchema.parse(await request.json());
    const note = await createStudentNote({
      db,
      userId: user.id,
      input: { ...body, kind: body.kind ?? "note" },
    });
    return jsonOk({ note }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
