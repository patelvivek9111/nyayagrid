/**
 * HuggingFace LegalBench-RAG corpus filenames may contain characters that are
 * illegal on Windows (`|`, `:`, `"`, `*`, `?`, `<`, `>`). Map them reversibly
 * for local cache I/O while preserving logical upstream paths for document IDs.
 */
const ENC: ReadonlyArray<readonly [string, string]> = [
  ["%", "%25"],
  ["|", "%7C"],
  [":", "%3A"],
  ['"', "%22"],
  ["*", "%2A"],
  ["?", "%3F"],
  ["<", "%3C"],
  [">", "%3E"],
];

/** Encode one path segment (or full relative path with `/` separators). */
export function encodeCacheFsPath(relPosix: string): string {
  return relPosix
    .split("/")
    .map((segment) => {
      let out = segment;
      for (const [from, to] of ENC) {
        out = out.split(from).join(to);
      }
      return out;
    })
    .join("/");
}

/** Inverse of {@link encodeCacheFsPath}. */
export function decodeCacheFsPath(relPosix: string): string {
  return relPosix
    .split("/")
    .map((segment) => {
      let out = segment;
      for (const [from, to] of [...ENC].reverse()) {
        out = out.split(to).join(from);
      }
      return out;
    })
    .join("/");
}
