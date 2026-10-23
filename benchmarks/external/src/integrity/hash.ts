import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";

export function sha256Buffer(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

export async function sha256FileOrRead(filePath: string): Promise<string> {
  try {
    return await sha256File(filePath);
  } catch {
    const buf = await readFile(filePath);
    return sha256Buffer(buf);
  }
}
