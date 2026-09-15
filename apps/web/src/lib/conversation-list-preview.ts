/**
 * Chat-list snippet. Titles stay as stored; the preview must not pair an older title with a later
 * assistant answer from a different question.
 */
export function conversationListPreview(
  messagesNewestFirst: Array<{ role: string; content: string | null | undefined }>,
): { preview: string | null; lastRole: string | null } {
  const last = messagesNewestFirst[0];
  if (!last) return { preview: null, lastRole: null };
  const lastUser = messagesNewestFirst.find((row) => row.role === "user");
  const source = lastUser ?? last;
  const text = source.content?.trim() ?? "";
  return {
    preview: text ? text.slice(0, 160) : null,
    lastRole: last.role,
  };
}
