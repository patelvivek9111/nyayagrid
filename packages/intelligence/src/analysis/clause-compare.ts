import type { DiffChange } from "../draft/helpers";

export type LegalSegment = {
  sectionNumber: string | null;
  title: string | null;
  text: string;
  boilerplate: boolean;
};

type AmendmentOp =
  | { kind: "replace_section"; section: string; restatement: string }
  | { kind: "amend_section"; section: string; restatement: string }
  | { kind: "renumber_exhibit"; from: string; to: string }
  | { kind: "spelling"; from: string; to: string };

function insertHeadingBreaks(text: string): string {
  return text.replace(
    /(^|\n)(Section\s+\d{1,2}(?:\.\d+)*\b|\d{1,2}(?:\.\d+)*\s*[.)]\s+[A-Z][A-Za-z]|ARTICLE\s+[IVXLCM]+\b|Exhibit\s+[A-Z0-9]+\b|Schedule\s+[A-Z]+\b|General Provision\s+\S+|Amendment\b)/g,
    "$1\n\n$2",
  );
}

export function normalizeForMatch(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/page\s+\d+\b/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim()
    .toLowerCase();
}

function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function repeatedHeaderLines(text: string): Set<string> {
  const counts = new Map<string, number>();
  for (const raw of text.split("\n")) {
    const line = collapseWs(raw);
    if (line.length < 12 || line.length > 120) continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n >= 3).map(([line]) => line.toLowerCase()));
}

export function stripRepeatedHeaders(text: string): string {
  const repeated = repeatedHeaderLines(text);
  if (repeated.size === 0) return text.replace(/\r\n/g, "\n");
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !repeated.has(collapseWs(line).toLowerCase()))
    .join("\n");
}

function parseHeading(block: string): { sectionNumber: string | null; title: string | null } {
  const trimmed = block.trim();
  const section = trimmed.match(/^section\s+(\d+(?:\.\d+)*)(?:\s*[—\-:]\s*|\s+)([^\n]{0,80})?/i);
  if (section?.[1]) {
    return { sectionNumber: section[1], title: collapseWs(section[2] ?? "").slice(0, 80) || null };
  }
  const numbered = trimmed.match(/^(\d{1,2}(?:\.\d+)*)\s*[\.)]\s+([A-Z][^\n]{0,80})/);
  if (numbered?.[1]) {
    const title = collapseWs(numbered[2] ?? "").replace(/\s+/g, " ");
    const short = title.split(/[.:(]/)[0]?.trim() ?? title;
    return { sectionNumber: numbered[1], title: short.slice(0, 80) || null };
  }
  const article = trimmed.match(/^article\s+([ivxlcm]+)\b(?:\s*[—\-:]\s*|\s+)?([^\n]{0,80})?/i);
  if (article?.[1]) {
    return { sectionNumber: article[1].toUpperCase(), title: collapseWs(article[2] ?? "") || null };
  }
  const exhibit = trimmed.match(/^(exhibit|schedule)\s+([A-Z0-9]+)\b/i);
  if (exhibit?.[1] && exhibit[2]) {
    return { sectionNumber: `${exhibit[1].toLowerCase()}:${exhibit[2].toUpperCase()}`, title: exhibit[1] };
  }
  return { sectionNumber: null, title: null };
}

function boilerplateSignature(text: string): string {
  return collapseWs(
    normalizeForMatch(text)
      .replace(/\b[a-z]*-?\d{1,3}\b/g, "#")
      .replace(/\bpage\b/g, ""),
  );
}

export function segmentLegalDocument(text: string): LegalSegment[] {
  const stripped = stripRepeatedHeaders(text).trim();
  if (!stripped) return [];

  let blocks: string[] = [];
  const headingReady = insertHeadingBreaks(stripped).trim();
  const byHeading = headingReady
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (byHeading.length >= 3) {
    blocks = byHeading;
  } else {
    const byBlank = stripped
      .split(/\n\s*\n+/)
      .map((block) => block.trim())
      .filter(Boolean);
    if (byBlank.length >= 2) blocks = byBlank;
    else {
      blocks = stripped
        .split(/\n/)
        .map((block) => block.trim())
        .filter(Boolean);
    }
  }

  const signatures = new Map<string, number>();
  const prepared = blocks.map((block) => {
    const heading = parseHeading(block);
    const sig = boilerplateSignature(block);
    if (sig.length >= 80) signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
    return { ...heading, text: block, sig };
  });

  return prepared.map((block) => ({
    sectionNumber: block.sectionNumber,
    title: block.title,
    text: block.text,
    boilerplate: Boolean(block.sig.length >= 80 && (signatures.get(block.sig) ?? 0) >= 3),
  }));
}

function tokens(text: string): Set<string> {
  return new Set(
    collapseWs(normalizeForMatch(text))
      .replace(/[^a-z0-9$\s.%]/g, " ")
      .split(/\s+/)
      .filter((tok) => tok.length >= 4 || /^\d/.test(tok) || tok.startsWith("$")),
  );
}

function jaccard(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 && right.size === 0) return 1;
  let inter = 0;
  for (const tok of left) if (right.has(tok)) inter += 1;
  const union = left.size + right.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function extractNumericValues(text: string): {
  money: string[];
  percents: string[];
  durations: string[];
  dates: string[];
} {
  const money = [...text.matchAll(/\$\s*[\d,]+(?:\.\d+)?/g)].map((m) => m[0].replace(/\s+/g, ""));
  const percents = [
    ...text.matchAll(/\b\d+(?:\.\d+)?\s*%/g),
    ...text.matchAll(/\b(percent|percentage)\s+of\b/gi),
  ].map((m) => m[0].toLowerCase());
  const percentWords = [
    ...text.matchAll(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)\s+percent\b/gi,
    ),
  ].map((m) => m[0].toLowerCase());
  const durations = [
    ...text.matchAll(/\b\d+\s*\)?\s*(days?|months?|years?|hours?|weeks?)\b/gi),
    ...text.matchAll(
      /\b(thirty|sixty|ninety|fifteen|forty-five|forty five)\s*(?:\((\d+)\)\s*)?(days?|months?)\b/gi,
    ),
  ].map((m) => collapseWs(m[0].toLowerCase()));
  const dates = [
    ...text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g),
    ...text.matchAll(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}\b/gi,
    ),
  ].map((m) => m[0]);
  return {
    money,
    percents: [...percents, ...percentWords],
    durations,
    dates,
  };
}

function setDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const norm = (items: string[]) => items.map((item) => item.replace(/[$,\s]/g, "").toLowerCase());
  const left = new Set(norm(a));
  const right = new Set(norm(b));
  return {
    onlyA: a.filter((_, i) => !right.has(norm(a)[i] ?? "")),
    onlyB: b.filter((_, i) => !left.has(norm(b)[i] ?? "")),
  };
}

export function materialNumericDeltas(
  oldText: string | null,
  newText: string | null,
): Array<{ kind: "money" | "percent" | "duration" | "date"; before: string; after: string }> {
  const a = extractNumericValues(oldText ?? "");
  const b = extractNumericValues(newText ?? "");
  const out: Array<{
    kind: "money" | "percent" | "duration" | "date";
    before: string;
    after: string;
  }> = [];
  const push = (
    kind: "money" | "percent" | "duration" | "date",
    left: string[],
    right: string[],
  ) => {
    const diff = setDiff(left, right);
    if (diff.onlyA.length && diff.onlyB.length) {
      out.push({ kind, before: diff.onlyA[0]!, after: diff.onlyB[0]! });
    }
  };
  push("money", a.money, b.money);
  push("percent", a.percents, b.percents);
  push("duration", a.durations, b.durations);
  push("date", a.dates, b.dates);
  return out;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

function wordList(text: string): string[] {
  return collapseWs(text).split(/\s+/).filter(Boolean);
}

function isWhitespaceOnly(a: string, b: string): boolean {
  return collapseWs(a) === collapseWs(b) && a !== b;
}

function isTypoOrSpellingOnly(a: string, b: string): boolean {
  const left = wordList(a.toLowerCase().replace(/[^a-z0-9\s]/g, " "));
  const right = wordList(b.toLowerCase().replace(/[^a-z0-9\s]/g, " "));
  if (Math.abs(left.length - right.length) > 1) return false;
  const diffs: Array<[string, string]> = [];
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    if (left[i] !== right[i]) diffs.push([left[i] ?? "", right[i] ?? ""]);
  }
  if (diffs.length === 0) return isWhitespaceOnly(a, b);
  if (diffs.length > 2) return false;
  return diffs.every(([x, y]) => {
    if (!x || !y) return false;
    if (/\d|\$|%/.test(x) || /\d|\$|%/.test(y)) return false;
    if (/\b(may|shall|must|will|not)\b/.test(x) || /\b(may|shall|must|will|not)\b/.test(y)) {
      return false;
    }
    return levenshtein(x, y) > 0 && levenshtein(x, y) <= 2;
  });
}

function stripNumbersAndExhibits(text: string): string {
  return collapseWs(
    text
      .replace(/\bexhibit\s+[a-z0-9]+\b/gi, "exhibit")
      .replace(/\bsection\s+\d+(?:\.\d+)*\b/gi, "section")
      .replace(/\b\d+(?:\.\d+)*\b/g, "#"),
  ).toLowerCase();
}

function isRenumberOnly(a: string, b: string): boolean {
  if (materialNumericDeltas(a, b).length > 0) return false;
  return stripNumbersAndExhibits(a) === stripNumbersAndExhibits(b) && collapseWs(a) !== collapseWs(b);
}

function modalTokens(text: string): string[] {
  return [...text.toLowerCase().matchAll(/\b(may|shall|must|will)\b/g)].map((m) => m[1]!);
}

function notPresent(text: string): boolean {
  return /\bnot\b/i.test(text);
}

function changedContentTokens(a: string, b: string): string {
  const left = new Set(wordList(a.toLowerCase()));
  const right = new Set(wordList(b.toLowerCase()));
  const delta: string[] = [];
  for (const w of left) if (!right.has(w)) delta.push(w);
  for (const w of right) if (!left.has(w)) delta.push(w);
  return delta.join(" ");
}

export function classifyChangeAttention(
  oldText: string | null,
  newText: string | null,
  changeType: DiffChange["changeType"],
): DiffChange["attention"] {
  const a = oldText ?? "";
  const b = newText ?? "";
  if (!a && !b) return "informational";
  if (materialNumericDeltas(a || null, b || null).length > 0) return "high_attention";
  const oldModals = modalTokens(a).join(" ");
  const newModals = modalTokens(b).join(" ");
  if (oldModals !== newModals && collapseWs(a) && collapseWs(b)) {
    return "high_attention";
  }
  if (a && b && notPresent(a) !== notPresent(b)) return "high_attention";
  if (changeType === "formatting" || isWhitespaceOnly(a, b)) return "informational";
  if (a && b && isTypoOrSpellingOnly(a, b)) return "informational";
  if (a && b && isRenumberOnly(a, b)) return "informational";
  if (changeType === "moved") return "informational";

  const delta = changedContentTokens(a, b);
  const clauseTheme =
    /indemn|liabil|terminat|warrant|governing law|notice requires|notice period|insurance|assign/.test(
      `${a} ${b}`.toLowerCase(),
    );
  if (
    /indemn|liabil|terminat|warrant|governing|notice|\$|percent|obligat|assign|insurance|sole discretion/.test(
      delta,
    ) ||
    (clauseTheme && a && b && !isTypoOrSpellingOnly(a, b) && !isRenumberOnly(a, b) && !isWhitespaceOnly(a, b))
  ) {
    return "high_attention";
  }

  if (changeType === "added" || changeType === "removed") {
    const blob = (a || b).toLowerCase();
    if (boilerplateSignature(a || b).length >= 80 && /general provision|headings are for convenience/.test(blob)) {
      return "informational";
    }
    if (/shall |must |indemn|liabil|terminat|\$/.test(blob)) return "high_attention";
  }
  return a && b ? "review" : "review";
}

function sentenceWith(text: string, needle: string): string {
  const parts = text.split(/(?<=[.!?])\s+/);
  const hit = parts.find((part) => part.toLowerCase().includes(needle.toLowerCase().replace(/[$,]/g, "")));
  return collapseWs(hit ?? text).slice(0, 600);
}

function focusedTexts(oldText: string, newText: string): { oldText: string; newText: string } {
  const deltas = materialNumericDeltas(oldText, newText);
  if (deltas[0]) {
    return {
      oldText: sentenceWith(oldText, deltas[0].before),
      newText: sentenceWith(newText, deltas[0].after),
    };
  }
  return { oldText: collapseWs(oldText).slice(0, 800), newText: collapseWs(newText).slice(0, 800) };
}

export function parseAmendmentOperations(text: string): AmendmentOp[] {
  const ops: AmendmentOp[] = [];
  const src = text.replace(/\r\n/g, "\n");

  const replaceRe =
    /section\s+(\d+(?:\.\d+)*)\s+is\s+deleted\s+and\s+replaced\.?\s*([\s\S]*?)(?=section\s+\d+(?:\.\d+)*\s+is\s+(?:deleted|amended)|exhibit\s+[a-z0-9]+\s+is\s+renumbered|administrative changes|general provision|$)/gi;
  for (const match of src.matchAll(replaceRe)) {
    if (match[1] && match[2]) {
      ops.push({
        kind: "replace_section",
        section: match[1],
        restatement: collapseWs(match[2]).slice(0, 1200),
      });
    }
  }

  const amendRe =
    /section\s+(\d+(?:\.\d+)*)\s+is\s+amended(?:\s+so(?:\s+that)?)?\s*([\s\S]*?)(?=section\s+\d+(?:\.\d+)*\s+is\s+(?:deleted|amended)|exhibit\s+[a-z0-9]+\s+is\s+renumbered|administrative changes|general provision|$)/gi;
  for (const match of src.matchAll(amendRe)) {
    if (
      match[1] &&
      match[2] &&
      !ops.some(
        (op) =>
          (op.kind === "replace_section" || op.kind === "amend_section") && op.section === match[1],
      )
    ) {
      ops.push({
        kind: "amend_section",
        section: match[1],
        restatement: collapseWs(match[2]).slice(0, 1200),
      });
    }
  }

  const exhibitRe = /exhibit\s+([A-Z0-9]+)\s+is\s+renumbered\s+(?:as\s+)?exhibit\s+([A-Z0-9]+)/gi;
  for (const match of src.matchAll(exhibitRe)) {
    if (match[1] && match[2]) ops.push({ kind: "renumber_exhibit", from: match[1], to: match[2] });
  }

  const spellingRe = /(?:the\s+word\s+)?["“']([^"”']+)["”']\s+is\s+corrected\s+to\s+["“']([^"”']+)["”']/gi;
  for (const match of src.matchAll(spellingRe)) {
    if (match[1] && match[2]) ops.push({ kind: "spelling", from: match[1], to: match[2] });
  }
  return ops;
}

function loc(section: LegalSegment | null, fallback: string): string {
  if (!section) return fallback;
  if (section.sectionNumber && section.title) return `Section ${section.sectionNumber} — ${section.title}`;
  if (section.sectionNumber) return `Section ${section.sectionNumber}`;
  if (section.title) return section.title;
  return fallback;
}

function row(
  changeType: DiffChange["changeType"],
  locationA: string | null,
  locationB: string | null,
  oldText: string | null,
  newText: string | null,
): DiffChange {
  return {
    changeType,
    locationA,
    locationB,
    oldText,
    newText,
    attention: classifyChangeAttention(oldText, newText, changeType),
  };
}

function findSection(segments: LegalSegment[], section: string): LegalSegment | undefined {
  return segments.find(
    (seg) => seg.sectionNumber === section || seg.sectionNumber?.startsWith(`${section}.`),
  );
}

function matchSegments(left: LegalSegment[], right: LegalSegment[]): Array<[number, number]> {
  const used = new Set<number>();
  const pairs: Array<[number, number]> = [];
  left.forEach((seg, i) => {
    if (seg.boilerplate) return;
    let best = -1;
    let bestScore = 0;
    right.forEach((other, j) => {
      if (used.has(j) || other.boilerplate) return;
      let score = 0;
      if (seg.sectionNumber && other.sectionNumber && seg.sectionNumber === other.sectionNumber) {
        score = 2 + jaccard(seg.text, other.text);
      } else if (
        seg.title &&
        other.title &&
        seg.title.toLowerCase() === other.title.toLowerCase() &&
        jaccard(seg.text, other.text) >= 0.35
      ) {
        score = 1.4 + jaccard(seg.text, other.text);
      } else {
        const sim = jaccard(seg.text, other.text);
        if (sim >= 0.45) score = sim;
      }
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    });
    if (best >= 0 && bestScore >= 0.45) {
      used.add(best);
      pairs.push([i, best]);
    }
  });
  return pairs;
}

function pairEqualLength(left: LegalSegment[], right: LegalSegment[]): Array<[number, number]> | null {
  if (left.length !== right.length || left.length === 0) return null;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < left.length; i++) {
    if (left[i]!.boilerplate || right[i]!.boilerplate) continue;
    if (jaccard(left[i]!.text, right[i]!.text) < 0.25) return null;
    pairs.push([i, i]);
  }
  return pairs;
}

/**
 * Clause-aware document comparison. Display text is original; matching uses
 * conservative whitespace/header normalization only.
 */
export function computeClauseDiffs(textA: string, textB: string): DiffChange[] {
  const leftText = stripRepeatedHeaders(textA);
  const rightText = stripRepeatedHeaders(textB);
  if (collapseWs(normalizeForMatch(leftText)) === collapseWs(normalizeForMatch(rightText))) {
    return [];
  }

  const leftSegs = segmentLegalDocument(leftText);
  const rightSegs = segmentLegalDocument(rightText);
  const ops = parseAmendmentOperations(rightText);
  const changes: DiffChange[] = [];
  const consumedLeft = new Set<number>();
  const consumedRight = new Set<number>();

  if (ops.length > 0) {
    for (const op of ops) {
      if (op.kind === "replace_section" || op.kind === "amend_section") {
        const original = findSection(leftSegs, op.section);
        const idx = original ? leftSegs.indexOf(original) : -1;
        if (idx >= 0) consumedLeft.add(idx);
        const focused = focusedTexts(original?.text ?? "", op.restatement);
        changes.push(
          row(
            "changed",
            loc(original ?? null, `Section ${op.section}`),
            `Amendment to Section ${op.section}`,
            focused.oldText || original?.text || null,
            focused.newText || op.restatement,
          ),
        );
      } else if (op.kind === "renumber_exhibit") {
        changes.push(
          row(
            "moved",
            `Exhibit ${op.from}`,
            `Exhibit ${op.to}`,
            `Exhibit ${op.from}`,
            `Exhibit ${op.to}`,
          ),
        );
      } else if (op.kind === "spelling") {
        changes.push(row("formatting", "spelling", "spelling", op.from, op.to));
      }
    }
  }

  const pairs =
    ops.length > 0
      ? []
      : (pairEqualLength(leftSegs, rightSegs) ?? matchSegments(leftSegs, rightSegs));
  for (const [i, j] of pairs) {
    consumedLeft.add(i);
    consumedRight.add(j);
    const a = leftSegs[i]!;
    const b = rightSegs[j]!;
    if (collapseWs(a.text) === collapseWs(b.text)) continue;
    if (normalizeForMatch(a.text) === normalizeForMatch(b.text) || isWhitespaceOnly(a.text, b.text)) {
      changes.push(row("formatting", loc(a, `paragraph ${i + 1}`), loc(b, `paragraph ${j + 1}`), a.text, b.text));
      continue;
    }
    const renumbered =
      a.sectionNumber &&
      b.sectionNumber &&
      a.sectionNumber !== b.sectionNumber &&
      jaccard(a.text, b.text) >= 0.7 &&
      materialNumericDeltas(a.text, b.text).length === 0 &&
      modalTokens(a.text).join() === modalTokens(b.text).join();
    if (renumbered || isRenumberOnly(a.text, b.text)) {
      changes.push(row("moved", loc(a, `paragraph ${i + 1}`), loc(b, `paragraph ${j + 1}`), a.text, b.text));
      continue;
    }
    if (isTypoOrSpellingOnly(a.text, b.text) && materialNumericDeltas(a.text, b.text).length === 0) {
      changes.push(row("formatting", loc(a, `paragraph ${i + 1}`), loc(b, `paragraph ${j + 1}`), a.text, b.text));
      continue;
    }
    const focused = focusedTexts(a.text, b.text);
    changes.push(
      row("changed", loc(a, `paragraph ${i + 1}`), loc(b, `paragraph ${j + 1}`), focused.oldText, focused.newText),
    );
  }

  if (ops.length === 0) {
    leftSegs.forEach((seg, i) => {
      if (consumedLeft.has(i) || seg.boilerplate) return;
      changes.push(row("removed", loc(seg, `paragraph ${i + 1}`), null, seg.text, null));
    });
    rightSegs.forEach((seg, j) => {
      if (consumedRight.has(j) || seg.boilerplate) return;
      changes.push(row("added", null, loc(seg, `paragraph ${j + 1}`), null, seg.text));
    });
  }

  return changes.filter((change) => {
    if (!change.oldText && !change.newText) return false;
    if (change.changeType === "formatting" && isWhitespaceOnly(change.oldText ?? "", change.newText ?? "")) {
      return collapseWs(change.oldText ?? "") !== collapseWs(change.newText ?? "") || change.oldText !== change.newText;
    }
    return true;
  });
}

export function summaryDeniesSubstantiveChanges(summary: string): boolean {
  return /\bno substantive\b|\bno material (change|difference|amendment)/i.test(summary);
}

export function buildDeterministicMaterialSummary(changes: DiffChange[]): string {
  const material = changes.filter((change) => change.attention === "high_attention");
  if (material.length === 0) {
    return "No substantive contractual differences detected. Remaining differences are administrative, typographic, or formatting.";
  }
  const lines = material.slice(0, 8).map((change) => {
    const label = change.locationA ?? change.locationB ?? "Change";
    const before = collapseWs(change.oldText ?? "(none)").slice(0, 160);
    const after = collapseWs(change.newText ?? "(none)").slice(0, 160);
    return `${label}: ${before} → ${after}`;
  });
  return `Material contractual differences requiring review:\n${lines.join("\n")}`;
}
