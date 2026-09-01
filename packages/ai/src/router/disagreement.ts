/**
 * DEEP disagreement: compare propositions against retrieved sources, never majority vote.
 * Two models agreeing does not make a proposition true.
 */

export type NormalizedClaim = {
  claim: string;
  supportSources: string[];
  authorityIds: string[];
  confidence?: string | null;
  jurisdictionContext?: string | null;
  verificationResult: "supported" | "unsupported" | "unresolved";
};

export type DisagreementFinding = {
  disputedProposition: string;
  primaryClaim: string;
  verifierClaim: string;
  primarySources: string[];
  verifierSources: string[];
  evidenceWinner: "primary" | "verifier" | "unresolved";
  reason: string;
};

export type DisagreementResult = {
  agreed: boolean;
  findings: DisagreementFinding[];
  preferredClaims: NormalizedClaim[];
  unresolved: boolean;
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3),
  );
}

function similar(a: string, b: string): boolean {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let overlap = 0;
  for (const t of left) if (right.has(t)) overlap += 1;
  const denom = Math.min(left.size, right.size);
  return denom > 0 && overlap / denom >= 0.55;
}

function negatePair(a: string, b: string): boolean {
  const notA = /\b(not|no|never|cannot|unfounded|unsupported|does not)\b/i.test(a);
  const notB = /\b(not|no|never|cannot|unfounded|unsupported|does not)\b/i.test(b);
  return notA !== notB && similar(a.replace(/\b(not|no|never|cannot)\b/gi, ""), b.replace(/\b(not|no|never|cannot)\b/gi, ""));
}

export function extractClaimsFromText(text: string): NormalizedClaim[] {
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [
      {
        claim: text.slice(0, 500),
        supportSources: [],
        authorityIds: [],
        verificationResult: "unresolved",
      },
    ];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.legalPropositions)) {
    return obj.legalPropositions.map((item) => propositionToClaim(item));
  }
  if (Array.isArray(obj.propositions)) {
    return obj.propositions.map((item) => propositionToClaim(item));
  }
  if (Array.isArray(obj.claims)) {
    return obj.claims.map((item) => propositionToClaim(item));
  }
  if (typeof obj.answer === "string") {
    const sources = Array.isArray(obj.sources)
      ? obj.sources.flatMap((s) => {
          if (s && typeof s === "object") {
            const row = s as Record<string, unknown>;
            return typeof row.chunkId === "string" ? [row.chunkId] : [];
          }
          return [];
        })
      : [];
    return [
      {
        claim: obj.answer,
        supportSources: sources,
        authorityIds: [],
        verificationResult: sources.length > 0 ? "supported" : "unresolved",
      },
    ];
  }
  return [];
}

function propositionToClaim(item: unknown): NormalizedClaim {
  if (typeof item === "string") {
    return { claim: item, supportSources: [], authorityIds: [], verificationResult: "unresolved" };
  }
  if (!item || typeof item !== "object") {
    return { claim: "", supportSources: [], authorityIds: [], verificationResult: "unresolved" };
  }
  const row = item as Record<string, unknown>;
  const claim = String(row.text ?? row.claim ?? row.proposition ?? "");
  const supportSources = Array.isArray(row.supportSources)
    ? row.supportSources.filter((s): s is string => typeof s === "string")
    : Array.isArray(row.sourceChunkIds)
      ? row.sourceChunkIds.filter((s): s is string => typeof s === "string")
      : [];
  const authorityIds = Array.isArray(row.authorityIds)
    ? row.authorityIds.filter((s): s is string => typeof s === "string")
    : [];
  return {
    claim,
    supportSources,
    authorityIds,
    confidence: typeof row.confidence === "string" ? row.confidence : null,
    jurisdictionContext: typeof row.jurisdiction === "string" ? row.jurisdiction : null,
    verificationResult: "unresolved",
  };
}

function evidenceSupport(
  claim: NormalizedClaim,
  evidenceIds: Set<string>,
  authorityIds: Set<string>,
): boolean {
  if (claim.supportSources.some((id) => evidenceIds.has(id))) return true;
  if (claim.authorityIds.some((id) => authorityIds.has(id))) return true;
  return false;
}

export function analyzeDisagreement(params: {
  primaryText: string;
  verifierText: string;
  evidenceChunkIds?: string[];
  authorityIds?: string[];
}): DisagreementResult {
  const primaryClaims = extractClaimsFromText(params.primaryText);
  const verifierClaims = extractClaimsFromText(params.verifierText);
  const evidence = new Set(params.evidenceChunkIds ?? []);
  const authorities = new Set(params.authorityIds ?? []);
  const findings: DisagreementFinding[] = [];
  const preferred: NormalizedClaim[] = [];

  const usedVerifier = new Set<number>();
  for (const primary of primaryClaims) {
    const matchIdx = verifierClaims.findIndex(
      (v, i) => !usedVerifier.has(i) && (similar(primary.claim, v.claim) || negatePair(primary.claim, v.claim)),
    );
    if (matchIdx < 0) {
      const supported = evidenceSupport(primary, evidence, authorities);
      preferred.push({
        ...primary,
        verificationResult: supported ? "supported" : "unresolved",
      });
      continue;
    }
    usedVerifier.add(matchIdx);
    const verifier = verifierClaims[matchIdx]!;
    const same = similar(primary.claim, verifier.claim) && !negatePair(primary.claim, verifier.claim);
    if (same) {
      const supported =
        evidenceSupport(primary, evidence, authorities) ||
        evidenceSupport(verifier, evidence, authorities);
      preferred.push({
        ...primary,
        verificationResult: supported ? "supported" : "unresolved",
      });
      continue;
    }
    const primaryOk = evidenceSupport(primary, evidence, authorities);
    const verifierOk = evidenceSupport(verifier, evidence, authorities);
    let winner: DisagreementFinding["evidenceWinner"] = "unresolved";
    let reason = "Neither proposition is clearly supported by retrieved sources.";
    if (primaryOk && !verifierOk) {
      winner = "primary";
      reason = "Primary claim is supported by retrieved sources; verifier is not.";
      preferred.push({ ...primary, verificationResult: "supported" });
    } else if (verifierOk && !primaryOk) {
      winner = "verifier";
      reason = "Verifier claim is supported by retrieved sources; primary is not.";
      preferred.push({ ...verifier, verificationResult: "supported" });
    } else if (primaryOk && verifierOk) {
      reason = "Both claims cite retrieved sources; issue remains unresolved.";
      preferred.push({ ...primary, verificationResult: "unresolved" });
    } else {
      preferred.push({ ...primary, verificationResult: "unresolved" });
    }
    findings.push({
      disputedProposition: primary.claim.slice(0, 280),
      primaryClaim: primary.claim,
      verifierClaim: verifier.claim,
      primarySources: primary.supportSources,
      verifierSources: verifier.supportSources,
      evidenceWinner: winner,
      reason,
    });
  }

  const unresolved = findings.some((f) => f.evidenceWinner === "unresolved") ||
    preferred.some((c) => c.verificationResult === "unresolved");
  return {
    agreed: findings.length === 0,
    findings,
    preferredClaims: preferred,
    unresolved,
  };
}
