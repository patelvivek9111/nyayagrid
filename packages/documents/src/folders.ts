/**
 * Matter document folder helpers (PROF-FOLDER-01).
 * Pure cycle detection keeps folder moves safe without relying on DB recursion.
 */

export type FolderParentMap = ReadonlyMap<string, string | null>;

/**
 * Returns true if placing `folderId` under `newParentId` would create a cycle
 * (new parent is the folder itself or a descendant of the folder).
 */
export function wouldCreateFolderCycle(
  folderId: string,
  newParentId: string | null | undefined,
  parentById: FolderParentMap,
): boolean {
  if (newParentId == null) return false;
  if (newParentId === folderId) return true;

  const visited = new Set<string>();
  let current: string | null | undefined = newParentId;
  while (current) {
    if (current === folderId) return true;
    if (visited.has(current)) return true; // existing corruption / cycle
    visited.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}

/** Build parent map from folder rows. */
export function buildFolderParentMap(
  folders: ReadonlyArray<{ id: string; parentFolderId: string | null }>,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const folder of folders) {
    map.set(folder.id, folder.parentFolderId);
  }
  return map;
}
