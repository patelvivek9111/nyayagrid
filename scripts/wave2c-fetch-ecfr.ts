/**
 * Wave 2C — fetch bounded eCFR sections into a corpus bundle (no CourtListener).
 * Usage: npx tsx scripts/wave2c-fetch-ecfr.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchEcfrSection, resolveEcfrAsOfDate } from "../packages/research/src/corpus/adapters/ecfr";
import { sanitizeUntrustedLegalText } from "../packages/research/src/corpus/adapters/types";

const TARGETS: Array<{ title: number; part: string; section: string; topic: string }> = [
  // Labor / FLSA / FMLA
  { title: 29, part: "541", section: "541.300", topic: "flsa_professional" },
  { title: 29, part: "541", section: "541.400", topic: "flsa_computer" },
  { title: 29, part: "541", section: "541.500", topic: "flsa_outside_sales" },
  { title: 29, part: "541", section: "541.600", topic: "flsa_salary_level" },
  { title: 29, part: "541", section: "541.700", topic: "flsa_primary_duty" },
  { title: 29, part: "778", section: "778.113", topic: "overtime_hourly" },
  { title: 29, part: "778", section: "778.114", topic: "overtime_fixed_salary" },
  { title: 29, part: "825", section: "825.100", topic: "fmla_purpose" },
  { title: 29, part: "825", section: "825.110", topic: "fmla_eligible_employee" },
  { title: 29, part: "825", section: "825.200", topic: "fmla_amount_leave" },
  { title: 29, part: "1630", section: "1630.2", topic: "ada_definitions" },
  { title: 29, part: "1630", section: "1630.4", topic: "ada_discrimination" },
  { title: 29, part: "1604", section: "1604.11", topic: "eeoc_sexual_harassment" },
  // Consumer / FTC / CFPB
  { title: 16, part: "429", section: "429.1", topic: "cooling_off_rule" },
  { title: 16, part: "310", section: "310.3", topic: "telemarketing_deceptive" },
  { title: 16, part: "433", section: "433.2", topic: "holder_rule" },
  { title: 12, part: "1002", section: "1002.4", topic: "ecoa_discrimination" },
  { title: 12, part: "1026", section: "1026.18", topic: "tila_content_disclosures" },
  { title: 12, part: "1024", section: "1024.17", topic: "respa_escrow" },
  // Privacy / security
  { title: 16, part: "314", section: "314.4", topic: "glba_safeguards" },
  { title: 45, part: "164", section: "164.502", topic: "hipaa_uses_disclosures" },
  { title: 45, part: "164", section: "164.508", topic: "hipaa_authorization" },
  { title: 45, part: "164", section: "164.512", topic: "hipaa_uses_without_auth" },
  // Admin / FOIA-related / EPA sample
  { title: 40, part: "50", section: "50.7", topic: "naaqs_pm" },
  { title: 40, part: "122", section: "122.21", topic: "npdes_application" },
  // SEC / commercial
  { title: 17, part: "230", section: "230.144", topic: "securities_rule_144" },
  { title: 17, part: "240", section: "240.10b-5", topic: "securities_10b5" },
  { title: 17, part: "243", section: "243.100", topic: "reg_fd" },
  // Immigration sample
  { title: 8, part: "214", section: "214.2", topic: "nonimmigrant_classes" },
  // HHS / ACA sample
  { title: 45, part: "147", section: "147.104", topic: "guaranteed_availability" },
  // DOT
  { title: 49, part: "391", section: "391.11", topic: "cdl_qualifications" },
  { title: 49, part: "395", section: "395.3", topic: "hours_of_service" },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const asOf = await resolveEcfrAsOfDate();
  const out: unknown[] = [];
  const failures: Array<{ section: string; status?: number; err?: string }> = [];

  for (const t of TARGETS) {
    await sleep(400);
    try {
      const fetched = await fetchEcfrSection(t.title, t.part, t.section, asOf);
      if (!fetched.ok) {
        failures.push({ section: `${t.title} CFR ${t.section}`, status: fetched.status });
        continue;
      }
      const raw = fetched.json as { html?: string; text?: string };
      const html = typeof raw.html === "string" ? raw.html : "";
      const text = sanitizeUntrustedLegalText(
        (html || (typeof raw.text === "string" ? raw.text : "")).replace(/<[^>]+>/g, " "),
      ).slice(0, 40_000);
      if (text.length < 40) {
        failures.push({ section: `${t.title} CFR ${t.section}`, err: "too_short" });
        continue;
      }
      const citation = `${t.title} CFR § ${t.section}`;
      const extId = `us-${t.title}-cfr-${t.section.replace(/\./g, "-")}`;
      out.push({
        title: `${citation}`,
        shortTitle: citation,
        authorityType: "regulation",
        jurisdiction: "United States",
        authorityState: "US",
        citation,
        sourceProvider: "us-primary-corpus",
        sourceExternalId: extId,
        canonicalSourceUrl: `https://www.ecfr.gov/current/title-${t.title}/part-${t.part}/section-${t.section}`,
        hierarchyPath: [
          { level: "title", ref: String(t.title), label: `Title ${t.title}` },
          { level: "part", ref: t.part, label: `Part ${t.part}` },
          { level: "section", ref: t.section, label: t.section },
        ],
        bundleSourceClass: "PRIMARY_OFFICIAL",
        bundlePracticeAreas: ["federal", "regulation"],
        content: `${citation}\n\n${text}`,
        sections: [{ sectionRef: t.section, content: text.slice(0, 2000) }],
        currentnessStatus: "current_as_of_source_date",
        effectiveDate: asOf,
        sourceMetadata: {
          retrievalMethod: "ecfr_renderer_live",
          retrievedAt: new Date().toISOString(),
          asOfDate: asOf,
          statuteTopic: t.topic,
          sourceOwner: "U.S. Government Publishing Office / eCFR",
          adapter: "ecfr",
        },
      });
      console.error(`ok ${citation} chars=${text.length}`);
    } catch (e) {
      failures.push({
        section: `${t.title} CFR ${t.section}`,
        err: String(e instanceof Error ? e.message : e).slice(0, 200),
      });
    }
  }

  const path = resolve("packages/research/corpus/bundles/expansion-wave2c-cfr.json");
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ok: true, written: path, count: out.length, asOf, failures }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
