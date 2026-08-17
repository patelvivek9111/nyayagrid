import { updateStudentNoteSchema } from "@nyayagrid/validation";
import { deleteStudentNote, updateStudentNote } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ noteId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { noteId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = updateStudentNoteSchema.parse(await request.json());
    const note = await updateStudentNote({
      db,
      userId: user.id,
      noteId,
      input: body,
    });
    return jsonOk({ note });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { noteId } = await params;
    const { db, user } = await requireUser(request.headers);
    const result = await deleteStudentNote({ db, userId: user.id, noteId });
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
