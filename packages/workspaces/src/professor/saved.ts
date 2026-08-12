import { z } from "zod";
import { and, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { studentSavedItems } from "@nyayagrid/database";
import type { StudentSavedItem } from "@nyayagrid/database";
import { StudentAccessError, assertStudentSavedItemOwnership } from "./auth";

export const STUDENT_SAVED_ITEM_TYPES = [
  "explanation",
  "case_brief",
  "authority",
  "case_comparison",
] as const;

export type StudentSavedItemType = (typeof STUDENT_SAVED_ITEM_TYPES)[number];

export const saveItemInputSchema = z.object({
  itemType: z.enum(STUDENT_SAVED_ITEM_TYPES),
  title: z.string().trim().min(1).max(300),
  content: z.string().max(20000).nullish(),
  /** Pointer back to the source record (conversation message, brief, authority, comparison). */
  ref: z.record(z.unknown()).default({}),
});

export type SaveItemInput = z.infer<typeof saveItemInputSchema>;

export async function saveItem(params: {
  db: Database;
  userId: string;
  input: SaveItemInput;
}): Promise<StudentSavedItem> {
  if (!params.userId) throw new StudentAccessError("userId is required");
  const input = saveItemInputSchema.parse(params.input);
  const [row] = await params.db
    .insert(studentSavedItems)
    .values({
      userId: params.userId,
      itemType: input.itemType,
      title: input.title,
      content: input.content ?? null,
      ref: input.ref,
    })
    .returning();
  if (!row) throw new Error("Failed to save the item");
  return row;
}

export async function listSavedItems(params: {
  db: Database;
  userId: string;
  itemType?: StudentSavedItemType;
  limit?: number;
}): Promise<StudentSavedItem[]> {
  if (!params.userId) throw new StudentAccessError("userId is required");
  const scope = params.itemType
    ? and(
        eq(studentSavedItems.userId, params.userId),
        eq(studentSavedItems.itemType, params.itemType),
      )
    : eq(studentSavedItems.userId, params.userId);
  return params.db
    .select()
    .from(studentSavedItems)
    .where(scope)
    .orderBy(desc(studentSavedItems.createdAt))
    .limit(params.limit ?? 100);
}

/** Deletes only after proving ownership, so an id from another library is simply not found. */
export async function deleteSavedItem(params: {
  db: Database;
  userId: string;
  itemId: string;
}): Promise<{ deletedId: string }> {
  const existing = await assertStudentSavedItemOwnership(params.db, params.userId, params.itemId);
  await params.db
    .delete(studentSavedItems)
    .where(and(eq(studentSavedItems.id, existing.id), eq(studentSavedItems.userId, params.userId)));
  return { deletedId: existing.id };
}
