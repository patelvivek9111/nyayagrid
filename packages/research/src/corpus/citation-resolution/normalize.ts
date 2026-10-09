/**
 * Canonical citation normalization + target-key generation for the resolution engine.
 * Pure functions — safe for dry-run and production paths.
 */

export type VolReporterPage = {
  family: string;
  volume: number;
  page: number;
  reporter: string;
  series: string;
};

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeCitationWhitespace(raw: string): string {
  return collapseWhitespace(raw)
    .replace(/\s*§\s*/g, " § ")
    .replace(/\s+,/g, ",");
}

/** Recover common reporter punctuation variants (in-memory only unless applied intentionally). */
export function experimentalNormalize(raw: string | null | undefined): string | null {
  let c = normalizeCitationWhitespace(raw || "");
  if (!c) return null;
  c = c.replace(/\bF\.?\s*Supp\.+\s*(2d|3d|4th)?\b/gi, (_m, s: string | undefined) =>
    s ? `F.Supp.${s.toLowerCase()}` : "F.Supp.",
  );
  c = c.replace(/\bF\s*\.\s*(2d|3d|4th)\b/gi, (_m, s: string) => `F.${s.toLowerCase()}`);
  c = c.replace(/\bF(2d|3d|4th)\b/gi, (_m, s: string) => `F.${s.toLowerCase()}`);
  c = c.replace(/\bU\s*\.\s*S\s*\./gi, "U.S.");
  c = c.replace(/\bUS\b(?=\s+\d)/g, "U.S.");
  c = c.replace(/\bS\s*\.\s*Ct\s*\./gi, "S. Ct.");
  c = c.replace(/\bL\s*\.\s*Ed\s*\.?\s*(2d)?\b/gi, (_m, s: string | undefined) =>
    s ? "L. Ed. 2d" : "L. Ed.",
  );

  const usc = c.match(/^(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§\s*(.+)$/i);
  if (usc) return `${usc[1]} U.S.C. § ${usc[2]}`;

  const usReports = c.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (usReports) return `${usReports[1]} U.S. ${usReports[2]}`;

  const sct = c.match(/^(\d{1,3})\s+S\.?\s*Ct\.?\s+(\d{1,4})$/i);
  if (sct) return `${sct[1]} S. Ct. ${sct[2]}`;

  const led = c.match(/^(\d{1,3})\s+L\.?\s*Ed\.?\s*(2d)?\s+(\d{1,4})$/i);
  if (led) return led[2] ? `${led[1]} L. Ed. 2d ${led[3]}` : `${led[1]} L. Ed. ${led[3]}`;

  const fSupp = c.match(/^(\d{1,4})\s+F\.?\s*Supp\.?(?:\s?(2d|3d|4th))?\s+(\d{1,4})$/i);
  if (fSupp) {
    const series = fSupp[2] ? ` ${fSupp[2].toLowerCase()}` : "";
    return `${fSupp[1]} F. Supp.${series} ${fSupp[3]}`.replace(/\s+/g, " ").trim();
  }

  const fRep = c.match(/^(\d{1,4})\s+F\.?\s*(2d|3d|4th)\s+(\d{1,4})$/i);
  if (fRep) return `${fRep[1]} F.${fRep[2].toLowerCase()} ${fRep[3]}`;

  const fr = c.match(/^Fed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+(\d+[A-Za-z]?)$/i);
  if (fr) {
    const kind = fr[1].replace(/\s+/g, " ").trim().toLowerCase();
    let reporter = "Fed. R. Civ. P.";
    if (/^evid/i.test(kind)) reporter = "Fed. R. Evid.";
    else if (/^app/i.test(kind)) reporter = "Fed. R. App. P.";
    else if (/^crim/i.test(kind)) reporter = "Fed. R. Crim. P.";
    return `${reporter} ${fr[2]}`;
  }

  return c;
}

export function citationLookupAliases(normalizedOrRaw: string | null | undefined): string[] {
  const base = normalizeCitationWhitespace(normalizedOrRaw || "");
  if (!base) return [];
  const aliases = new Set<string>([base, base.replace(/\b(2D|3D|4TH)\b/g, (m) => m.toLowerCase())]);

  const usc = base.match(/^(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§\s*(.+)$/i);
  if (usc) {
    aliases.add(`${usc[1]} U.S.C. § ${usc[2]}`);
    aliases.add(`${usc[1]} USC § ${usc[2]}`);
  }

  const usRep = base.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (usRep) {
    aliases.add(`${usRep[1]} U.S. ${usRep[2]}`);
    aliases.add(`${usRep[1]} U. S. ${usRep[2]}`);
  }

  const sct = base.match(/^(\d{1,3})\s+S\.?\s*Ct\.?\s+(\d{1,4})$/i);
  if (sct) {
    aliases.add(`${sct[1]} S. Ct. ${sct[2]}`);
    aliases.add(`${sct[1]} S.Ct. ${sct[2]}`);
  }

  const fReporter = base.match(/^(\d{1,4})\s+F\.?\s*(Supp\.?)?\s*(2d|3d|4th)?\s+(\d{1,4})$/i);
  if (fReporter) {
    const vol = fReporter[1];
    const page = fReporter[4];
    const series = (fReporter[3] ?? "").toLowerCase();
    if (fReporter[2]) {
      aliases.add(`${vol} F. Supp.${series ? ` ${series}` : ""} ${page}`.replace(/\s+/g, " ").trim());
    } else if (series) {
      aliases.add(`${vol} F.${series} ${page}`);
      aliases.add(`${vol} F. ${series} ${page}`);
    }
  }

  const fr = base.match(/^Fed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+(\d+[A-Za-z]?)$/i);
  if (fr) {
    const lean = experimentalNormalize(base);
    if (lean) aliases.add(lean);
  }

  return [...aliases].filter(Boolean);
}

export function parseVolReporterPage(cite: string | null | undefined): VolReporterPage | null {
  const t = normalizeCitationWhitespace(cite || "");
  let m: RegExpMatchArray | null;
  m = t.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (m) return { family: "us_reports", volume: Number(m[1]), page: Number(m[2]), reporter: "U.S.", series: "" };
  m = t.match(/^(\d{1,3})\s+S\.?\s*Ct\.?\s+(\d{1,4})$/i);
  if (m) return { family: "s_ct", volume: Number(m[1]), page: Number(m[2]), reporter: "S. Ct.", series: "" };
  m = t.match(/^(\d{1,3})\s+L\.?\s*Ed\.?\s*(2d)?\s+(\d{1,4})$/i);
  if (m) {
    return {
      family: "l_ed",
      volume: Number(m[1]),
      page: Number(m[3]),
      reporter: m[2] ? "L. Ed. 2d" : "L. Ed.",
      series: m[2] || "",
    };
  }
  m = t.match(/^(\d{1,4})\s+F\.?\s*Supp\.?\s*(2d|3d|4th)?\s+(\d{1,4})$/i);
  if (m) {
    return {
      family: "federal_supplement",
      volume: Number(m[1]),
      page: Number(m[3]),
      reporter: m[2] ? `F.Supp.${m[2].toLowerCase()}` : "F.Supp.",
      series: (m[2] || "").toLowerCase(),
    };
  }
  m = t.match(/^(\d{1,4})\s+F\.?\s*(2d|3d|4th)\s+(\d{1,4})$/i);
  if (m) {
    return {
      family: "federal_reporter",
      volume: Number(m[1]),
      page: Number(m[3]),
      reporter: `F.${m[2].toLowerCase()}`,
      series: m[2].toLowerCase(),
    };
  }
  return null;
}

export function vrpKey(p: VolReporterPage | null): string | null {
  if (!p) return null;
  return `${p.family}|${p.volume}|${p.reporter}|${p.page}`;
}

/** Stable lowercase target key used for unique-target queue dedup. */
export function targetKey(raw: string | null | undefined, normalized?: string | null | undefined): string {
  const lean =
    experimentalNormalize(normalized || raw) ||
    experimentalNormalize(raw) ||
    normalizeCitationWhitespace(normalized || raw || "");
  return lean.toLowerCase().replace(/\s+/g, " ").trim() || "__empty__";
}

export function isLookupSuitableCitation(text: string | null | undefined): boolean {
  const t = experimentalNormalize(text) || normalizeCitationWhitespace(text || "");
  if (!t || t.length < 5) return false;
  if (/^(id\.?|ibid\.?|supra)\b/i.test(t)) return false;
  if (/\bU\.?\s*S\.?\s*C\.?\s*§/i.test(t)) return false;
  if (/\bC\.?\s*F\.?\s*R\.?\s*§/i.test(t)) return false;
  if (/^Fed\.\s*R\./i.test(t)) return false;
  if (parseVolReporterPage(t)) return true;
  return /\b\d{1,4}\s+[A-Za-z.]+\s+\d{1,4}\b/.test(t);
}
