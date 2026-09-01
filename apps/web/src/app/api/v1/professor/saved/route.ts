import { saveStudentItemSchema, studentSavedItemTypeSchema } from "@nyayagrid/validation";
import { listSavedItems, saveItem } from "@nyayagrid/workspaces";
import { requireProfessorUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireProfessorUser(request.headers);
    const url = new URL(request.url);
    const itemTypeRaw = url.searchParams.get("itemType");
    const parsedType = itemTypeRaw ? studentSavedItemTypeSchema.safeParse(itemTypeRaw) : null;
    const items = await listSavedItems({
      db,
      userId: user.id,
      itemType: parsedType?.success ? parsedType.data : undefined,
    });
    return jsonOk({ items });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireProfessorUser(request.headers);
    const body = saveStudentItemSchema.parse(await request.json());
    const item = await saveItem({ db, userId: user.id, input: body });
    return jsonOk({ item }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
