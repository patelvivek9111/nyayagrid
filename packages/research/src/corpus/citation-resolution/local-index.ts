/**
 * Fast local authority identity index (hash maps).
 * Returns zero / one / ambiguous — never auto-picks among multiple.
 */

import {
  citationLookupAliases,
  experimentalNormalize,
  normalizeCitationWhitespace,
  parseVolReporterPage,
  vrpKey,
} from "./normalize.js";
import type { AuthorityIndexRow, LookupCandidateResult, ResolutionMethod } from "./types.js";

function metaStringList(meta: Record<string, unknown> | null | undefined, key: string): string[] {
  const v = meta?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && Boolean(x.trim()));
}

export class LocalAuthorityIndex {
  private readonly byAlias = new Map<string, Set<string>>();
  private readonly byParallel = new Map<string, Set<string>>();
  private readonly byVrp = new Map<string, Set<string>>();
  private readonly byExternal = new Map<string, Set<string>>();
  private readonly byId = new Map<string, AuthorityIndexRow>();
  readonly size: number;

  constructor(authorities: AuthorityIndexRow[]) {
    this.size = authorities.length;
    for (const a of authorities) {
      this.byId.set(a.id, a);
      const meta = a.metadata && typeof a.metadata === "object" ? a.metadata : {};
      const keys = new Set<string>();
      const parallelKeys = new Set<string>();

      for (const v of [a.normalizedCitation, a.citation].filter(Boolean) as string[]) {
        const lean = experimentalNormalize(v) || v;
        for (const k of citationLookupAliases(lean)) keys.add(k.toLowerCase());
        for (const k of citationLookupAliases(v)) keys.add(k.toLowerCase());
        const p = parseVolReporterPage(lean);
        const vk = vrpKey(p);
        if (vk) {
          if (!this.byVrp.has(vk)) this.byVrp.set(vk, new Set());
          this.byVrp.get(vk)!.add(a.id);
        }
      }

      for (const alias of metaStringList(meta, "citationAliases")) {
        const lean = experimentalNormalize(alias) || alias;
        for (const k of citationLookupAliases(lean)) keys.add(k.toLowerCase());
      }

      for (const alias of [
        ...metaStringList(meta, "parallelCitations"),
        ...metaStringList(meta, "parallel_citations"),
      ]) {
        const lean = experimentalNormalize(alias) || alias;
        for (const k of citationLookupAliases(lean)) {
          keys.add(k.toLowerCase());
          parallelKeys.add(k.toLowerCase());
        }
        const p = parseVolReporterPage(lean);
        const vk = vrpKey(p);
        if (vk) {
          if (!this.byVrp.has(vk)) this.byVrp.set(vk, new Set());
          this.byVrp.get(vk)!.add(a.id);
        }
      }

      for (const k of keys) {
        if (!this.byAlias.has(k)) this.byAlias.set(k, new Set());
        this.byAlias.get(k)!.add(a.id);
      }
      for (const k of parallelKeys) {
        if (!this.byParallel.has(k)) this.byParallel.set(k, new Set());
        this.byParallel.get(k)!.add(a.id);
      }

      if (a.sourceExternalId) {
        const ext = String(a.sourceExternalId).trim();
        if (ext) {
          if (!this.byExternal.has(ext)) this.byExternal.set(ext, new Set());
          this.byExternal.get(ext)!.add(a.id);
          // Common CL shapes: cl-opinion-123 / opinion:123 / cluster:456
          if (!this.byExternal.has(`ext:${ext}`)) this.byExternal.set(`ext:${ext}`, new Set());
          this.byExternal.get(`ext:${ext}`)!.add(a.id);
        }
      }
    }
  }

  getAuthority(id: string): AuthorityIndexRow | undefined {
    return this.byId.get(id);
  }

  lookupExternalId(externalId: string): LookupCandidateResult {
    const hits = this.byExternal.get(String(externalId).trim()) ?? this.byExternal.get(`ext:${String(externalId).trim()}`);
    if (!hits || hits.size === 0) return { kind: "zero" };
    if (hits.size > 1) {
      return { kind: "ambiguous", authorityIds: [...hits], evidence: [`external:${externalId}`] };
    }
    return {
      kind: "one",
      authorityId: [...hits][0]!,
      method: "COURTLISTENER_CLUSTER",
      evidence: [`external:${externalId}`],
    };
  }

  /**
   * Deterministic local lookup. Case name / year are never sole resolvers.
   */
  lookupCitation(raw: string | null | undefined, normalized?: string | null): LookupCandidateResult {
    const lookupKeys = new Set<string>();
    for (const v of [experimentalNormalize(normalized || raw), experimentalNormalize(raw), normalized, raw].filter(
      Boolean,
    ) as string[]) {
      for (const a of citationLookupAliases(v)) lookupKeys.add(a.toLowerCase());
      for (const a of citationLookupAliases(experimentalNormalize(v) || v)) lookupKeys.add(a.toLowerCase());
    }

    const hitIds = new Set<string>();
    const evidence: string[] = [];
    let method: ResolutionMethod = "LOCAL_ALIAS";

    for (const k of lookupKeys) {
      const hits = this.byAlias.get(k);
      if (!hits) continue;
      for (const id of hits) hitIds.add(id);
      evidence.push(`alias:${k}`);
    }

    const exactKeys = [experimentalNormalize(normalized || raw), normalized, raw]
      .filter(Boolean)
      .map((x) => normalizeCitationWhitespace(String(x)).toLowerCase());
    for (const ek of exactKeys) {
      const hits = this.byAlias.get(ek);
      if (hits && hits.size === 1 && hitIds.size <= 1) {
        method = "LOCAL_EXACT";
        evidence.push(`exact:${ek}`);
      }
    }

    const lean = experimentalNormalize(normalized || raw) || normalizeCitationWhitespace(normalized || raw || "");
    const p = parseVolReporterPage(lean);
    const vk = vrpKey(p);
    if (vk) {
      const vhits = this.byVrp.get(vk);
      if (vhits) {
        for (const id of vhits) hitIds.add(id);
        evidence.push(`vrp:${vk}`);
        if (hitIds.size === 1 && method !== "LOCAL_EXACT") method = "LOCAL_NORMALIZED";
      }
    }

    // Prefer LOCAL_PARALLEL when the sole hit is keyed from parallelCitations metadata
    if (hitIds.size === 1) {
      let viaParallel = false;
      for (const k of lookupKeys) {
        const ph = this.byParallel.get(k);
        if (ph && ph.has([...hitIds][0]!)) {
          viaParallel = true;
          break;
        }
      }
      if (viaParallel) method = "LOCAL_PARALLEL";
    }

    if (hitIds.size === 0) return { kind: "zero" };
    if (hitIds.size > 1) {
      return { kind: "ambiguous", authorityIds: [...hitIds].slice(0, 8), evidence };
    }
    return { kind: "one", authorityId: [...hitIds][0]!, method, evidence: [...new Set(evidence)].slice(0, 12) };
  }

  get stats() {
    return {
      authorities: this.size,
      aliasKeys: this.byAlias.size,
      vrpKeys: this.byVrp.size,
      externalKeys: this.byExternal.size,
    };
  }
}
