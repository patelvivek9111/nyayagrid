export type CharacterSpan = {
  start: number;
  end: number;
};

export type CharacterMetrics = {
  precision: number;
  recall: number;
  f1: number;
  predictedLength: number;
  goldLength: number;
  overlapLength: number;
};

function spanLength(span: CharacterSpan): number {
  return Math.max(0, span.end - span.start);
}

function overlapLength(a: CharacterSpan, b: CharacterSpan): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return Math.max(0, end - start);
}

function unionLength(spans: CharacterSpan[]): number {
  if (spans.length === 0) {
    return 0;
  }
  const sorted = [...spans].sort((x, y) => x.start - y.start);
  let total = 0;
  let curStart = sorted[0]!.start;
  let curEnd = sorted[0]!.end;
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (s.start <= curEnd) {
      curEnd = Math.max(curEnd, s.end);
    } else {
      total += curEnd - curStart;
      curStart = s.start;
      curEnd = s.end;
    }
  }
  total += curEnd - curStart;
  return total;
}

function intersectionLength(a: CharacterSpan[], b: CharacterSpan[]): number {
  let total = 0;
  for (const sa of a) {
    for (const sb of b) {
      total += overlapLength(sa, sb);
    }
  }
  return total;
}

export function characterPrecisionRecallF1(
  predicted: CharacterSpan[],
  gold: CharacterSpan[],
): CharacterMetrics {
  const predictedLength = unionLength(predicted);
  const goldLength = unionLength(gold);
  const overlap = intersectionLength(predicted, gold);

  const precision = predictedLength === 0 ? 0 : overlap / predictedLength;
  const recall = goldLength === 0 ? 0 : overlap / goldLength;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    precision,
    recall,
    f1,
    predictedLength,
    goldLength,
    overlapLength: overlap,
  };
}

export function documentHit(
  retrievedDocumentIds: readonly string[],
  goldDocumentIds: readonly string[],
): boolean {
  const gold = new Set(goldDocumentIds);
  return retrievedDocumentIds.some((id) => gold.has(id));
}

export function evidenceSpanHit(
  predicted: CharacterSpan[],
  gold: CharacterSpan[],
  minOverlapRatio = 0.5,
): boolean {
  for (const g of gold) {
    const gLen = spanLength(g);
    if (gLen === 0) {
      continue;
    }
    for (const p of predicted) {
      const ov = overlapLength(p, g);
      if (ov / gLen >= minOverlapRatio) {
        return true;
      }
    }
  }
  return false;
}

export function topKDocumentRecall(
  retrievedDocumentIds: readonly string[],
  goldDocumentIds: readonly string[],
  k: number,
): number {
  if (goldDocumentIds.length === 0) {
    return 0;
  }
  const top = retrievedDocumentIds.slice(0, Math.max(0, k));
  const gold = new Set(goldDocumentIds);
  const hits = top.filter((id) => gold.has(id)).length;
  return hits / goldDocumentIds.length;
}
