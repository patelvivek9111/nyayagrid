import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "./provider-contract";

const DEFAULT_CACHE_SIZE = 256;

function cacheKey(text: string, dimensions: number): string {
  return createHash("sha256").update(`${dimensions}\0${text}`).digest("hex");
}

/**
 * In-memory embedding cache. Keys are hashes of input text, never the text itself.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  hits = 0;
  misses = 0;
  private readonly cache = new Map<string, number[]>();

  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly maxEntries = DEFAULT_CACHE_SIZE,
  ) {
    this.name = inner.name;
    this.model = inner.model;
    this.dimensions = inner.dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const keys = texts.map((text) => cacheKey(text, this.dimensions));
    const missingIdx: number[] = [];
    const out: Array<number[] | undefined> = new Array(texts.length);
    for (let i = 0; i < texts.length; i += 1) {
      const cached = this.cache.get(keys[i]!);
      if (cached) {
        this.hits += 1;
        out[i] = cached;
      } else {
        this.misses += 1;
        missingIdx.push(i);
      }
    }
    if (missingIdx.length > 0) {
      const fresh = await this.inner.embed(missingIdx.map((i) => texts[i]!));
      for (let j = 0; j < missingIdx.length; j += 1) {
        const idx = missingIdx[j]!;
        const vector = fresh[j]!;
        out[idx] = vector;
        this.set(keys[idx]!, vector);
      }
    }
    return out as number[][];
  }

  private set(key: string, vector: number[]): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, vector);
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
