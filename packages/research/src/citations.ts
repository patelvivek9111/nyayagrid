import { inArray, or } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { legalAuthorities } from "@nyayagrid/database";

export type CitationConfidence = "high" | "low" | "unknown";

export type CitationKind = "case" | "statute" | "regulation" | "constitution" | "rule" | "other";

export type ParsedCitation = {
  /** Always the citation text exactly as it appeared in the source. */
  raw: string;
  /** Canonical form, or null when normalization would be a guess. */
  normalized: string | null;
  reporter?: string | null;
  volume?: number | null;
  page?: number | null;
  section?: string | null;
  type?: CitationKind | null;
  pinpoint?: string | null;
  parser?: string | null;
  confidence: CitationConfidence;
};

export interface CitationParser {
  readonly name: string;
  readonly type: CitationKind;
  /** Global regex used to locate candidate citations inside a body of text. */
  readonly pattern: RegExp;
  build(match: RegExpMatchArray): ParsedCitation | null;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeCitationWhitespace(raw: string): string {
  return collapseWhitespace(raw)
    .replace(/\s*§\s*/g, " § ")
    .replace(/\s+,/g, ",");
}

function toInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export class USReportsParser implements CitationParser {
  readonly name = "us-reports";
  readonly type: CitationKind = "case";
  readonly pattern = /\b(\d{1,3})\s+U\.\s*S\.\s+(\d{1,4})\b/g;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const volume = toInt(match[1]);
    const page = toInt(match[2]);
    if (volume === null || page === null) return null;
    return {
      raw: match[0],
      normalized: `${volume} U.S. ${page}`,
      reporter: "U.S.",
      volume,
      page,
      type: "case",
      parser: this.name,
      confidence: "high",
    };
  }
}

export class FederalReporterParser implements CitationParser {
  readonly name = "federal-reporter";
  readonly type: CitationKind = "case";
  readonly pattern = /\b(\d{1,4})\s+F\.?\s*(Supp\.?)?\s*(2d|3d|4th)?\s+(\d{1,4})\b/gi;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const volume = toInt(match[1]);
    const page = toInt(match[4]);
    if (volume === null || page === null) return null;
    const supplement = Boolean(match[2]);
    const series = match[3] ? match[3].toLowerCase() : "";
    const reporter = supplement
      ? `F. Supp.${series ? ` ${series}` : ""}`
      : `F.${series}`;
    return {
      raw: match[0],
      normalized: `${volume} ${reporter} ${page}`,
      reporter,
      volume,
      page,
      type: "case",
      parser: this.name,
      confidence: "high",
    };
  }
}

export class SupremeCourtReporterParser implements CitationParser {
  readonly name = "supreme-court-reporter";
  readonly type: CitationKind = "case";
  readonly pattern = /\b(\d{1,3})\s+(?:S\.?\s*Ct\.?|L\.?\s*Ed\.?(?:\s*2d)?)\s+(\d{1,4})\b/gi;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const volume = toInt(match[1]);
    const page = toInt(match[2]);
    if (volume === null || page === null) return null;
    const raw = match[0];
    const isLed = /L\.?\s*Ed/i.test(raw);
    const led2d = /2d/i.test(raw);
    const reporter = isLed ? (led2d ? "L. Ed. 2d" : "L. Ed.") : "S. Ct.";
    return {
      raw: match[0],
      normalized: `${volume} ${reporter} ${page}`,
      reporter,
      volume,
      page,
      type: "case",
      parser: this.name,
      confidence: "high",
    };
  }
}

export class StatuteCitationParser implements CitationParser {
  readonly name = "statute";
  readonly type: CitationKind = "statute";
  // The section group never absorbs a trailing period, so "§ 100." yields section "100".
  readonly pattern =
    /\b(?:(\d{1,2})\s+U\.?\s?S\.?\s?C\.?|([A-Z][A-Za-z'’.\- ]{2,60}?Code))\s*§+\s*(\d[A-Za-z0-9\-]*(?:\.[A-Za-z0-9\-]+)*(?:\([^)\s]{1,6}\))*)/g;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const section = match[3];
    if (!section) return null;
    const uscTitle = toInt(match[1]);
    if (uscTitle !== null) {
      return {
        raw: match[0],
        normalized: `${uscTitle} U.S.C. § ${section}`,
        reporter: "U.S.C.",
        volume: uscTitle,
        section,
        type: "statute",
        parser: this.name,
        confidence: "high",
      };
    }
    const code = match[2] ? collapseWhitespace(match[2]) : null;
    if (!code) return null;
    // Unknown code conventions: only whitespace is canonicalized, never the code name itself.
    return {
      raw: match[0],
      normalized: `${code} § ${section}`,
      reporter: code,
      section,
      type: "statute",
      parser: this.name,
      confidence: "low",
    };
  }
}

export class FederalRulesCitationParser implements CitationParser {
  readonly name = "federal-rules";
  readonly type: CitationKind = "rule";
  readonly pattern =
    /\bFed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s*(\d+[A-Za-z]?)\b/gi;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const kindRaw = (match[1] ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const rule = match[2];
    if (!rule) return null;
    let reporter = "Fed. R. Civ. P.";
    if (/^evid/i.test(kindRaw)) reporter = "Fed. R. Evid.";
    else if (/^app/i.test(kindRaw)) reporter = "Fed. R. App. P.";
    else if (/^crim/i.test(kindRaw)) reporter = "Fed. R. Crim. P.";
    return {
      raw: match[0],
      normalized: `${reporter} ${rule}`,
      reporter,
      section: rule,
      type: "rule",
      parser: this.name,
      confidence: "high",
    };
  }
}

/**
 * State admin-code forms including Wave-1/Wave-2K families:
 * Pa. Code, Fla. Admin. Code, VAC, DE Admin. Code, Ill. Admin. Code,
 * CMR, NYCRR, A.A.C., RICR, Conn. Agencies Regs., WAC, Minn. R., Wis. Admin. Code,
 * OAR, IAC, Ga. Comp. R. & Regs., W. Va. Code R., Tex. Admin. Code, COMAR, Ohio Admin. Code.
 */
export class StateAdminCodeCitationParser implements CitationParser {
  readonly name = "state-admin-code";
  readonly type: CitationKind = "regulation";
  readonly pattern =
    /\b(?:(\d{1,3})\s+Pa\.?\s*Code\s*§+\s*([\d.]+)|Fla\.?\s*Admin\.?\s*Code\s*R\.?\s*([\dA-Za-z.-]+)|(\d+)\s*VAC\s*([\d.-]+)|(\d+)\s+DE\s+Admin\.?\s*Code\s+([\d.]+)|Ill\.?\s*Admin\.?\s*Code\s+tit\.?\s*(\d+)\s*§+\s*([\d.]+)|(\d{1,3})\s+CMR\s+([\d.]+)|(\d{1,2})\s+NYCRR\s*§?\s*([\d.\-]+)|A\.?\s*A\.?\s*C\.?\s*(R[\d\-]+)|(\d{1,3})-RICR-([\d\-]+)|Conn\.?\s*Agencies\s+Regs\.?\s*§?\s*([\dA-Za-z.\-]+)|WAC\s+([\d\-]+)|Minn\.?\s*R\.?\s*([\d.]+)|Wis\.?\s*Admin\.?\s*Code\s+([A-Z][A-Za-z\-]*(?:\s+[A-Z][A-Za-z\-]*)?)\s*§+\s*([\d.]+)|Or\.?\s*Admin\.?\s*R\.?\s*([\d.\-]+)|(\d{1,3})\s+IAC\s+([\d.\-]+)|Ga\.?\s*Comp\.?\s*R\.?\s*&?\s*Regs\.?\s*([\d.\-]+)|W\.?\s*Va\.?\s*Code\s+R\.?\s*§?\s*([\d.\-]+)|(\d{1,3})\s+Tex\.?\s*Admin\.?\s*Code\s*§+\s*([\d.]+)|COMAR\s+([\d.]+)|Ohio\s+Admin\.?\s*Code\s+([\d\-.:]+)|(\d{1,3})\s+CCR\s+([\d\-]+)|Mich\.?\s*Admin\.?\s*Code\s+R\s+([\d.]+)|(\d{1,3})\s+NCAC\s+([\d.]+))\b/gi;

  build(match: RegExpMatchArray): ParsedCitation | null {
    if (match[1] && match[2]) {
      return {
        raw: match[0],
        normalized: `${match[1]} Pa. Code § ${match[2]}`,
        reporter: "Pa. Code",
        volume: toInt(match[1]),
        section: match[2],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[3]) {
      return {
        raw: match[0],
        normalized: `Fla. Admin. Code R. ${match[3]}`,
        reporter: "Fla. Admin. Code",
        section: match[3],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[4] && match[5]) {
      return {
        raw: match[0],
        normalized: `${match[4]}VAC${match[5]}`,
        reporter: "VAC",
        volume: toInt(match[4]),
        section: match[5],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[6] && match[7]) {
      return {
        raw: match[0],
        normalized: `${match[6]} DE Admin. Code ${match[7]}`,
        reporter: "DE Admin. Code",
        volume: toInt(match[6]),
        section: match[7],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[8] && match[9]) {
      return {
        raw: match[0],
        normalized: `Ill. Admin. Code tit. ${match[8]} § ${match[9]}`,
        reporter: "Ill. Admin. Code",
        volume: toInt(match[8]),
        section: match[9],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[10] && match[11]) {
      return {
        raw: match[0],
        normalized: `${match[10]} CMR ${match[11]}`,
        reporter: "CMR",
        volume: toInt(match[10]),
        section: match[11],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[12] && match[13]) {
      return {
        raw: match[0],
        normalized: `${match[12]} NYCRR § ${match[13]}`,
        reporter: "NYCRR",
        volume: toInt(match[12]),
        section: match[13],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[14]) {
      return {
        raw: match[0],
        normalized: `A.A.C. ${match[14]}`,
        reporter: "A.A.C.",
        section: match[14],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[15] && match[16]) {
      return {
        raw: match[0],
        normalized: `${match[15]}-RICR-${match[16]}`,
        reporter: "RICR",
        volume: toInt(match[15]),
        section: match[16],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[17]) {
      return {
        raw: match[0],
        normalized: `Conn. Agencies Regs. § ${match[17]}`,
        reporter: "Conn. Agencies Regs.",
        section: match[17],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[18]) {
      return {
        raw: match[0],
        normalized: `WAC ${match[18]}`,
        reporter: "WAC",
        section: match[18],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[19]) {
      return {
        raw: match[0],
        normalized: `Minn. R. ${match[19]}`,
        reporter: "Minn. R.",
        section: match[19],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[20] && match[21]) {
      return {
        raw: match[0],
        normalized: `Wis. Admin. Code ${match[20]} § ${match[21]}`,
        reporter: "Wis. Admin. Code",
        section: `${match[20]} § ${match[21]}`,
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[22]) {
      return {
        raw: match[0],
        normalized: `Or. Admin. R. ${match[22]}`,
        reporter: "Or. Admin. R.",
        section: match[22],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[23] && match[24]) {
      return {
        raw: match[0],
        normalized: `${match[23]} IAC ${match[24]}`,
        reporter: "IAC",
        volume: toInt(match[23]),
        section: match[24],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[25]) {
      return {
        raw: match[0],
        normalized: `Ga. Comp. R. & Regs. ${match[25]}`,
        reporter: "Ga. Comp. R. & Regs.",
        section: match[25],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[26]) {
      return {
        raw: match[0],
        normalized: `W. Va. Code R. § ${match[26]}`,
        reporter: "W. Va. Code R.",
        section: match[26],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[27] && match[28]) {
      return {
        raw: match[0],
        normalized: `${match[27]} Tex. Admin. Code § ${match[28]}`,
        reporter: "Tex. Admin. Code",
        volume: toInt(match[27]),
        section: match[28],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[29]) {
      return {
        raw: match[0],
        normalized: `COMAR ${match[29]}`,
        reporter: "COMAR",
        section: match[29],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[30]) {
      return {
        raw: match[0],
        normalized: `Ohio Admin. Code ${match[30]}`,
        reporter: "Ohio Admin. Code",
        section: match[30],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[31] && match[32]) {
      return {
        raw: match[0],
        normalized: `${match[31]} CCR ${match[32]}`,
        reporter: "CCR",
        volume: toInt(match[31]),
        section: match[32],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[33]) {
      return {
        raw: match[0],
        normalized: `Mich. Admin. Code R ${match[33]}`,
        reporter: "Mich. Admin. Code",
        section: match[33],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    if (match[34] && match[35]) {
      return {
        raw: match[0],
        normalized: `${match[34]} NCAC ${match[35]}`,
        reporter: "NCAC",
        volume: toInt(match[34]),
        section: match[35],
        type: "regulation",
        parser: this.name,
        confidence: "high",
      };
    }
    return null;
  }
}

/** State court rules: Pa.R.C.P., Fla. R. Civ. P., N.C. R. Civ. P., Ariz. R. Civ. P., etc. */
export class StateCourtRulesCitationParser implements CitationParser {
  readonly name = "state-court-rules";
  readonly type: CitationKind = "rule";
  readonly pattern =
    /\b(?:Pa\.?\s*R\.?\s*C\.?\s*P\.?\s*([\d.]+)|Pa\.?\s*R\.?\s*E\.?\s*([\d.]+)|Pa\.?\s*R\.?\s*A\.?\s*P\.?\s*([\d.]+)|Fla\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Va\.?\s*Sup\.?\s*Ct\.?\s*R\.?\s*([\d.:]+)|Cal\.?\s*Rules?\s+of\s+Court(?:\s*,?\s*rule)?\s*([\d.]+)|Tex\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\dA-Za-z.]+)|Mass\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|N\.?\s*J\.?\s*Ct\.?\s*R\.?\s*([\d.:\-]+)|Ill\.?\s*S\.?\s*Ct\.?\s*R\.?\s*([\d.]+)|Del\.?\s*Super\.?\s*Ct\.?\s*Civ\.?\s*R\.?\s*([\d.]+)|Ohio\s+Civ\.?\s*R\.?\s*([\d.]+)|Wash\.?\s*CR\s*([\d.]+)|Md\.?\s*Rule\s*([\d.\-]+)|C\.?\s*R\.?\s*C\.?\s*P\.?\s*([\d.]+)|MCR\s*([\d.]+)|N\.?\s*C\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|N\.?\s*C\.?\s*R\.?\s*Evid\.?\s*([\d.]+)|Ariz\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Ariz\.?\s*R\.?\s*Evid\.?\s*([\d.]+)|Conn\.?\s*Practice\s+Book\s*§?\s*([\d.\-]+)|Conn\.?\s*Code\s+Evid\.?\s*§?\s*([\d.\-]+)|Wis\.?\s*Stat\.?\s*§?\s*(802\.0[68]|904\.01)|Ind\.?\s*Trial\s+R\.?\s*([\d.]+)|Minn\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Or\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Ga\.?\s*Unif\.?\s*Super\.?\s*Ct\.?\s*R\.?\s*([\d.]+)|Ala\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Alaska\s+R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Ark\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Haw\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Idaho\s+R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Iowa\s+R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Ky\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|La\.?\s*Code\s+Civ\.?\s*Proc\.?\s*art\.?\s*([\d.]+)|Me\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Miss\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Mo\.?\s*Sup\.?\s*Ct\.?\s*R\.?\s*([\d.]+)|Mont\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Nev\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|N\.?\s*H\.?\s*Super\.?\s*Ct\.?\s*R\.?\s*([\d.]+)|N\.?\s*M\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.\-]+)|N\.?\s*D\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|R\.?\s*I\.?\s*Super\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|S\.?\s*C\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Tenn\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Utah\s+R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Vt\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|W\.?\s*Va\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|Wyo\.?\s*R\.?\s*Civ\.?\s*P\.?\s*([\d.]+)|D\.?\s*C\.?\s*Super\.?\s*Ct\.?\s*Civ\.?\s*R\.?\s*([\d.]+))\b/gi;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const specs: Array<{ idx: number; normalized: (s: string) => string; reporter: string }> = [
      { idx: 1, normalized: (s) => `Pa.R.C.P. ${s}`, reporter: "Pa.R.C.P." },
      { idx: 2, normalized: (s) => `Pa.R.E. ${s}`, reporter: "Pa.R.E." },
      { idx: 3, normalized: (s) => `Pa.R.A.P. ${s}`, reporter: "Pa.R.A.P." },
      { idx: 4, normalized: (s) => `Fla. R. Civ. P. ${s}`, reporter: "Fla. R. Civ. P." },
      { idx: 5, normalized: (s) => `Va. Sup. Ct. R. ${s}`, reporter: "Va. Sup. Ct. R." },
      { idx: 6, normalized: (s) => `Cal. Rules of Court, rule ${s}`, reporter: "Cal. Rules of Court" },
      { idx: 7, normalized: (s) => `Tex. R. Civ. P. ${s}`, reporter: "Tex. R. Civ. P." },
      { idx: 8, normalized: (s) => `Mass. R. Civ. P. ${s}`, reporter: "Mass. R. Civ. P." },
      { idx: 9, normalized: (s) => `N.J. Ct. R. ${s}`, reporter: "N.J. Ct. R." },
      { idx: 10, normalized: (s) => `Ill. S. Ct. R. ${s}`, reporter: "Ill. S. Ct. R." },
      { idx: 11, normalized: (s) => `Del. Super. Ct. Civ. R. ${s}`, reporter: "Del. Super. Ct. Civ. R." },
      { idx: 12, normalized: (s) => `Ohio Civ.R. ${s}`, reporter: "Ohio Civ.R." },
      { idx: 13, normalized: (s) => `Wash. CR ${s}`, reporter: "Wash. CR" },
      { idx: 14, normalized: (s) => `Md. Rule ${s}`, reporter: "Md. Rule" },
      { idx: 15, normalized: (s) => `C.R.C.P. ${s}`, reporter: "C.R.C.P." },
      { idx: 16, normalized: (s) => `MCR ${s}`, reporter: "MCR" },
      { idx: 17, normalized: (s) => `N.C. R. Civ. P. ${s}`, reporter: "N.C. R. Civ. P." },
      { idx: 18, normalized: (s) => `N.C. R. Evid. ${s}`, reporter: "N.C. R. Evid." },
      { idx: 19, normalized: (s) => `Ariz. R. Civ. P. ${s}`, reporter: "Ariz. R. Civ. P." },
      { idx: 20, normalized: (s) => `Ariz. R. Evid. ${s}`, reporter: "Ariz. R. Evid." },
      { idx: 21, normalized: (s) => `Conn. Practice Book § ${s}`, reporter: "Conn. Practice Book" },
      { idx: 22, normalized: (s) => `Conn. Code Evid. § ${s}`, reporter: "Conn. Code Evid." },
      { idx: 23, normalized: (s) => `Wis. Stat. § ${s}`, reporter: "Wis. Stat." },
      { idx: 24, normalized: (s) => `Ind. Trial R. ${s}`, reporter: "Ind. Trial R." },
      { idx: 25, normalized: (s) => `Minn. R. Civ. P. ${s}`, reporter: "Minn. R. Civ. P." },
      { idx: 26, normalized: (s) => `Or. R. Civ. P. ${s}`, reporter: "Or. R. Civ. P." },
      { idx: 27, normalized: (s) => `Ga. Unif. Super. Ct. R. ${s}`, reporter: "Ga. Unif. Super. Ct. R." },
      { idx: 28, normalized: (s) => `Ala. R. Civ. P. ${s}`, reporter: "Ala. R. Civ. P." },
      { idx: 29, normalized: (s) => `Alaska R. Civ. P. ${s}`, reporter: "Alaska R. Civ. P." },
      { idx: 30, normalized: (s) => `Ark. R. Civ. P. ${s}`, reporter: "Ark. R. Civ. P." },
      { idx: 31, normalized: (s) => `Haw. R. Civ. P. ${s}`, reporter: "Haw. R. Civ. P." },
      { idx: 32, normalized: (s) => `Idaho R. Civ. P. ${s}`, reporter: "Idaho R. Civ. P." },
      { idx: 33, normalized: (s) => `Iowa R. Civ. P. ${s}`, reporter: "Iowa R. Civ. P." },
      { idx: 34, normalized: (s) => `Ky. R. Civ. P. ${s}`, reporter: "Ky. R. Civ. P." },
      { idx: 35, normalized: (s) => `La. Code Civ. Proc. art. ${s}`, reporter: "La. Code Civ. Proc." },
      { idx: 36, normalized: (s) => `Me. R. Civ. P. ${s}`, reporter: "Me. R. Civ. P." },
      { idx: 37, normalized: (s) => `Miss. R. Civ. P. ${s}`, reporter: "Miss. R. Civ. P." },
      { idx: 38, normalized: (s) => `Mo. Sup. Ct. R. ${s}`, reporter: "Mo. Sup. Ct. R." },
      { idx: 39, normalized: (s) => `Mont. R. Civ. P. ${s}`, reporter: "Mont. R. Civ. P." },
      { idx: 40, normalized: (s) => `Nev. R. Civ. P. ${s}`, reporter: "Nev. R. Civ. P." },
      { idx: 41, normalized: (s) => `N.H. Super. Ct. R. ${s}`, reporter: "N.H. Super. Ct. R." },
      { idx: 42, normalized: (s) => `N.M. R. Civ. P. ${s}`, reporter: "N.M. R. Civ. P." },
      { idx: 43, normalized: (s) => `N.D. R. Civ. P. ${s}`, reporter: "N.D. R. Civ. P." },
      { idx: 44, normalized: (s) => `R.I. Super. R. Civ. P. ${s}`, reporter: "R.I. Super. R. Civ. P." },
      { idx: 45, normalized: (s) => `S.C. R. Civ. P. ${s}`, reporter: "S.C. R. Civ. P." },
      { idx: 46, normalized: (s) => `Tenn. R. Civ. P. ${s}`, reporter: "Tenn. R. Civ. P." },
      { idx: 47, normalized: (s) => `Utah R. Civ. P. ${s}`, reporter: "Utah R. Civ. P." },
      { idx: 48, normalized: (s) => `Vt. R. Civ. P. ${s}`, reporter: "Vt. R. Civ. P." },
      { idx: 49, normalized: (s) => `W. Va. R. Civ. P. ${s}`, reporter: "W. Va. R. Civ. P." },
      { idx: 50, normalized: (s) => `Wyo. R. Civ. P. ${s}`, reporter: "Wyo. R. Civ. P." },
      { idx: 51, normalized: (s) => `D.C. Super. Ct. Civ. R. ${s}`, reporter: "D.C. Super. Ct. Civ. R." },
    ];
    for (const spec of specs) {
      const value = match[spec.idx];
      if (!value) continue;
      return {
        raw: match[0],
        normalized: spec.normalized(value),
        reporter: spec.reporter,
        section: value,
        type: "rule",
        parser: this.name,
        confidence: "high",
      };
    }
    return null;
  }
}

export class RegulatoryCitationParser implements CitationParser {
  readonly name = "regulation";
  readonly type: CitationKind = "regulation";
  readonly pattern = /\b(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§*\s*(\d+(?:\.[0-9A-Za-z\-]+)*)/g;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const title = toInt(match[1]);
    const section = match[2];
    if (title === null || !section) return null;
    return {
      raw: match[0],
      normalized: `${title} C.F.R. § ${section}`,
      reporter: "C.F.R.",
      volume: title,
      section,
      type: "regulation",
      parser: this.name,
      confidence: "high",
    };
  }
}

/** Pennsylvania Consolidated Statutes and similar compiled-statute forms (e.g. 42 Pa.C.S. § 5525). */
export class StateCompiledStatuteParser implements CitationParser {
  readonly name = "state-compiled-statute";
  readonly type: CitationKind = "statute";
  readonly pattern =
    /\b(\d{1,3})\s+(Pa\.?\s*C\.?\s*S\.?(?:\s*Ann\.?)?|N\.?J\.?\s*S\.?A\.?|N\.?Y\.?\s*(?:C\.?L\.?S\.?|Consol\.)|Cal\.?\s*(?:Civ\.?\s*)?Code|Tex\.?\s*(?:Bus\.?\s*&?\s*Com\.?\s*)?Code|Fla\.?\s*Stat\.?(?:\s*Ann\.?)?|Ill\.?\s*Comp\.?\s*Stat\.?|Mass\.?\s*Gen\.?\s*Laws|Va\.?\s*Code\s*Ann\.?|Del\.?\s*Code\s*Ann\.?)\s*§+\s*(\d[\w.\-]*)/gi;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const title = toInt(match[1]);
    const codeRaw = match[2];
    const section = match[3];
    if (title === null || !codeRaw || !section) return null;
    const code = collapseWhitespace(codeRaw.replace(/\s+/g, " "));
    const canonicalCode = canonicalizeStateCodeLabel(code);
    return {
      raw: match[0],
      normalized: `${title} ${canonicalCode} § ${section}`,
      reporter: canonicalCode,
      volume: title,
      section,
      type: "statute",
      parser: this.name,
      confidence: "high",
    };
  }
}

function canonicalizeStateCodeLabel(code: string): string {
  const compact = code.replace(/\s+/g, " ").trim();
  if (/^Pa\.?\s*C\.?\s*S/i.test(compact)) return "Pa.C.S.";
  if (/^N\.?J\.?\s*S\.?A/i.test(compact)) return "N.J.S.A.";
  if (/^N\.?Y/i.test(compact)) return "N.Y. C.L.S.";
  if (/^Cal/i.test(compact)) return "Cal. Civ. Code";
  if (/^Tex/i.test(compact)) return "Tex. Bus. & Com. Code";
  if (/^Fla/i.test(compact)) return "Fla. Stat.";
  if (/^Ill/i.test(compact)) return "Ill. Comp. Stat.";
  if (/^Mass/i.test(compact)) return "Mass. Gen. Laws";
  if (/^Va/i.test(compact)) return "Va. Code Ann.";
  if (/^Del/i.test(compact)) return "Del. Code Ann.";
  return compact;
}

export class AtlanticReporterParser implements CitationParser {
  readonly name = "atlantic-reporter";
  readonly type: CitationKind = "case";
  readonly pattern = /\b(\d{1,4})\s+A\.(?:\s?(2d|3d))?\s+(\d{1,4})\b/g;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const volume = toInt(match[1]);
    const page = toInt(match[3]);
    if (volume === null || page === null) return null;
    const series = match[2];
    const reporter = series ? `A.${series}` : "A.";
    return {
      raw: match[0],
      normalized: `${volume} ${reporter} ${page}`,
      reporter,
      volume,
      page,
      type: "case",
      parser: this.name,
      confidence: "high",
    };
  }
}

export const DEFAULT_CITATION_PARSERS: CitationParser[] = [
  new StateCompiledStatuteParser(),
  new StateAdminCodeCitationParser(),
  new StateCourtRulesCitationParser(),
  new StatuteCitationParser(),
  new RegulatoryCitationParser(),
  new FederalRulesCitationParser(),
  new USReportsParser(),
  new FederalReporterParser(),
  new SupremeCourtReporterParser(),
  new AtlanticReporterParser(),
];

type CitationMatch = {
  citation: ParsedCitation;
  index: number;
  length: number;
};

const PINPOINT_PATTERN = /^\s*,?\s*at\s+(\d+(?:\s*[-–]\s*\d+)?)/;

function findMatches(text: string, parsers: CitationParser[]): CitationMatch[] {
  const matches: CitationMatch[] = [];
  for (const parser of parsers) {
    const pattern = new RegExp(parser.pattern.source, "g");
    let match = pattern.exec(text);
    while (match) {
      const built = parser.build(match);
      if (built && match.index !== undefined) {
        const pinpointMatch = PINPOINT_PATTERN.exec(text.slice(match.index + match[0].length));
        matches.push({
          citation: {
            ...built,
            pinpoint: pinpointMatch?.[1] ? collapseWhitespace(pinpointMatch[1]) : null,
          },
          index: match.index,
          length: match[0].length,
        });
      }
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
      match = pattern.exec(text);
    }
  }
  return matches.sort((a, b) => a.index - b.index || b.length - a.length);
}

function dropOverlaps(matches: CitationMatch[]): CitationMatch[] {
  const kept: CitationMatch[] = [];
  let cursor = -1;
  for (const match of matches) {
    if (match.index < cursor) continue;
    kept.push(match);
    cursor = match.index + match.length;
  }
  return kept;
}

/**
 * Parse a single citation string. Returns confidence "unknown" with normalized=null whenever the
 * input is ambiguous, so callers never store a confidently wrong canonical form.
 */
export function parseCitation(
  raw: string,
  parsers: CitationParser[] = DEFAULT_CITATION_PARSERS,
): ParsedCitation {
  const trimmed = raw.trim();
  const unresolved: ParsedCitation = {
    raw: trimmed,
    normalized: null,
    type: null,
    parser: null,
    confidence: "unknown",
  };
  if (!trimmed) return unresolved;

  for (const parser of parsers) {
    const flags = parser.pattern.flags.replace(/g/g, "");
    const anchored = new RegExp(`^(?:${parser.pattern.source})$`, flags);
    const match = anchored.exec(trimmed);
    if (!match) continue;
    const built = parser.build(match);
    if (built) return { ...built, raw: trimmed };
  }

  const embedded = dropOverlaps(findMatches(trimmed, parsers));
  const distinct = new Map(embedded.map((m) => [m.citation.normalized ?? m.citation.raw, m]));
  if (distinct.size !== 1) return unresolved;
  const only = [...distinct.values()][0];
  if (!only) return unresolved;
  return { ...only.citation, raw: trimmed };
}

/** Extract every citation found in a body of authority text, preserving raw spans. */
export function extractCitationsFromText(
  text: string,
  parsers: CitationParser[] = DEFAULT_CITATION_PARSERS,
): ParsedCitation[] {
  const kept = dropOverlaps(findMatches(text, parsers));
  const deduped = new Map<string, ParsedCitation>();
  for (const match of kept) {
    const key = `${match.citation.normalized ?? match.citation.raw}|${match.citation.pinpoint ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, match.citation);
  }
  return [...deduped.values()];
}

export type CitationResolution = {
  authorityId: string;
  matchedOn: "normalized_citation" | "citation";
};

/** Exact citation aliases for statute/reg/rule/case forms that differ only by punctuation. */
export function citationLookupAliases(normalizedOrRaw: string): string[] {
  const base = normalizeCitationWhitespace(normalizedOrRaw);
  if (!base) return [];
  const aliases = new Set<string>([base, base.replace(/\b(2D|3D|4TH)\b/g, (m) => m.toLowerCase())]);

  // U.S. reporter spacing: "558 U. S. 183" ↔ "558 U.S. 183"
  const usReporter = base.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (usReporter) {
    aliases.add(`${usReporter[1]} U.S. ${usReporter[2]}`);
    aliases.add(`${usReporter[1]} U. S. ${usReporter[2]}`);
  }

  // Federal reporter spacing: "503 F. 3d 284" ↔ "503 F.3d 284"
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

  // S. Ct. / L. Ed.
  const sct = base.match(/^(\d{1,3})\s+S\.?\s*Ct\.?\s+(\d{1,4})$/i);
  if (sct) {
    aliases.add(`${sct[1]} S. Ct. ${sct[2]}`);
    aliases.add(`${sct[1]} S.Ct. ${sct[2]}`);
  }
  const led = base.match(/^(\d{1,3})\s+L\.?\s*Ed\.?\s*(2d)?\s+(\d{1,4})$/i);
  if (led) {
    aliases.add(`${led[1]} L. Ed.${led[2] ? " 2d" : ""} ${led[3]}`.replace(/\s+/g, " ").trim());
  }

  // CFR ↔ C.F.R.
  const cfr = base.match(/^(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§\s*(.+)$/i);
  if (cfr) {
    aliases.add(`${cfr[1]} C.F.R. § ${cfr[2]}`);
    aliases.add(`${cfr[1]} CFR § ${cfr[2]}`);
  }

  // U.S.C. ↔ USC
  const usc = base.match(/^(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§\s*(.+)$/i);
  if (usc) {
    aliases.add(`${usc[1]} U.S.C. § ${usc[2]}`);
    aliases.add(`${usc[1]} USC § ${usc[2]}`);
  }

  // Fed. R. Civ. P. / Evid. / App. P. spacing variants
  const fr = base.match(/^Fed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+(\d+[A-Za-z]?)$/i);
  if (fr) {
    const kind = (fr[1] ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    let reporter = "Fed. R. Civ. P.";
    if (/^evid/i.test(kind)) reporter = "Fed. R. Evid.";
    else if (/^app/i.test(kind)) reporter = "Fed. R. App. P.";
    else if (/^crim/i.test(kind)) reporter = "Fed. R. Crim. P.";
    aliases.add(`${reporter} ${fr[2] ?? ""}`);
  }

  return [...aliases].filter(Boolean);
}

/**
 * Resolve a citation to a corpus authority. Returns null when nothing matches or when more than
 * one authority matches, because guessing between candidates would misattribute authority.
 */
export async function resolveCitationAgainstCorpus(
  db: Database,
  citation: string | ParsedCitation,
): Promise<CitationResolution | null> {
  const parsed = typeof citation === "string" ? parseCitation(citation) : citation;
  const raw = normalizeCitationWhitespace(parsed.raw);
  if (!raw && !parsed.normalized) return null;

  const lookupValues = new Set<string>();
  for (const value of [parsed.normalized, raw].filter(Boolean) as string[]) {
    for (const alias of citationLookupAliases(value)) lookupValues.add(alias);
  }
  if (lookupValues.size === 0) return null;

  const values = [...lookupValues];
  const rows = await db
    .select({
      id: legalAuthorities.id,
      normalizedCitation: legalAuthorities.normalizedCitation,
    })
    .from(legalAuthorities)
    .where(
      or(
        inArray(legalAuthorities.normalizedCitation, values),
        inArray(legalAuthorities.citation, values),
      ),
    )
    .limit(3);

  // Deduplicate by authority id; ambiguity across distinct authorities is unresolved.
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  if (unique.length !== 1) return null;
  const row = unique[0];
  if (!row) return null;
  return {
    authorityId: row.id,
    matchedOn:
      parsed.normalized &&
      row.normalizedCitation &&
      citationLookupAliases(parsed.normalized).includes(row.normalizedCitation)
        ? "normalized_citation"
        : "citation",
  };
}
