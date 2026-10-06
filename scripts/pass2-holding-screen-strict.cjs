#!/usr/bin/env node
/**
 * Strict read-only Neon holding screen for Deepening Pass 2.
 * Attaches only when a required phrase appears in source text.
 * Zero CourtListener. Zero mutations.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

/**
 * Each rule attaches only if every `required` phrase appears in content.
 * `proposition` must itself appear in content OR be assembled only from required phrases.
 * Prefer propositions that are literal substrings of the opinion when possible.
 */
const RULES = [
  {
    caseName: "Illinois v. Gates",
    citation: "462 U.S. 213",
    authorityId: "83949afa-33e2-4cec-8fe5-1e7b0138eef9",
    courtId: "us-scotus",
    dimension: "PROBABLE_CAUSE",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["totality-of-the-circumstances", "totality of the circumstances"],
    propositionCandidates: ["totality-of-the-circumstances approach", "totality of the circumstances"],
  },
  {
    caseName: "United States v. Leon",
    citation: "468 U.S. 897",
    authorityId: "c494cde9-c897-4bb4-a920-b7ea085fb468",
    courtId: "us-scotus",
    dimension: "GOOD_FAITH",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["good faith” exception", '"good faith" exception', "good faith exception", "“good faith” exception"],
    propositionCandidates: ["“good faith” exception", '"good faith" exception', "good faith"],
  },
  {
    caseName: "Welsh v. Wisconsin",
    citation: "466 U.S. 740",
    authorityId: "f6fac4af-1858-4098-9a36-12cfeca6649c",
    courtId: "us-scotus",
    dimension: "EXIGENCY",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAll: ["exigent circumstances", "home"],
    propositionCandidates: ["exigent circumstances"],
  },
  {
    caseName: "Hudson v. Michigan",
    citation: "547 U.S. 586",
    authorityId: "9fe84e04-d4dc-4aaa-b75f-c4ec005100dc",
    courtId: "us-scotus",
    dimension: "EXECUTION",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["knock-and-announce", "knock and announce"],
    propositionCandidates: ["knock-and-announce", "knock and announce"],
  },
  {
    caseName: "Davis v. United States",
    citation: "564 U.S. 229",
    authorityId: "e67d1763-da45-4c07-b2e8-625309542a1f",
    courtId: "us-scotus",
    dimension: "GOOD_FAITH",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAll: ["binding appellate precedent", "exclusionary rule"],
    propositionCandidates: ["searches conducted in objectively reasonable reliance on binding appellate precedent are not subject to the exclusionary rule"],
  },
  {
    caseName: "Kentucky v. King",
    citation: "563 U.S. 452",
    authorityId: "b8cfd34d-53f1-4be1-a8ae-4deb904ff1a5",
    courtId: "us-scotus",
    dimension: "EXIGENCY",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["exigent circumstances", "police-created exigency", "create the exigency"],
    propositionCandidates: ["exigent circumstances"],
  },
  {
    caseName: "Pennsylvania Board of Probation & Parole v. Scott",
    citation: "524 U.S. 357",
    authorityId: "255d3085-72dc-4e87-a5bc-56f7f8dd18f3",
    courtId: "us-scotus",
    dimension: "OTHER",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAll: ["exclusionary rule", "parole"],
    propositionCandidates: ["exclusionary rule"],
    note: "Parole/exclusionary context; not a standard warrant-dimension holding.",
  },
  {
    caseName: "Fuentes v. Shevin",
    citation: "407 U.S. 67",
    authorityId: "ba1412b6-17d0-4f2a-b075-37cc60f69658",
    courtId: "us-scotus",
    rejectReason: "NOT_WARRANT_SUPPRESSION_HOLDING",
  },
  {
    caseName: "United States v. Cronic",
    citation: "466 U.S. 648",
    authorityId: "d5a945f9-c188-4f05-8274-db66e486b4ac",
    courtId: "us-scotus",
    rejectReason: "NOT_WARRANT_SUPPRESSION_HOLDING",
  },
  {
    caseName: "Walder v. United States",
    citation: "347 U.S. 62",
    authorityId: "a3a5e8bb-5e26-422d-a4d8-b56af4a1d897",
    courtId: "us-scotus",
    dimension: "OTHER",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["impeach", "impeachment"],
    propositionCandidates: ["impeach"],
    note: "Impeachment use of evidence; not attached as a warrant-issue dimension.",
    attach: false,
  },
  {
    caseName: "Beck v. Ohio",
    citation: "379 U.S. 89",
    authorityId: "9d5f025e-aea1-4e90-9331-3f24bde88429",
    courtId: "us-scotus",
    dimension: "PROBABLE_CAUSE",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAll: ["probable cause", "arrest"],
    propositionCandidates: ["probable cause to make it"],
  },
  {
    caseName: "Henry v. United States",
    citation: "361 U.S. 98",
    authorityId: "f1298c51-3bd9-47d7-8aba-a3a983da61c0",
    courtId: "us-scotus",
    dimension: "PROBABLE_CAUSE",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAll: ["probable cause", "arrest"],
    propositionCandidates: ["probable cause for the arrest"],
  },
  {
    caseName: "United States v. Tracey",
    citation: "597 F.3d 140",
    authorityId: "37442c0b-fd17-4528-a929-515d6e1c2a0e",
    courtId: "us-ca-3",
    dimension: "GOOD_FAITH",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["good faith exception", "good faith", "Leon"],
    secondaryRequiredAny: ["warrant", "particularity", "affidavit"],
    propositionCandidates: ["good faith"],
  },
  {
    caseName: "United States v. Katzin",
    citation: "769 F.3d 163",
    authorityId: "5b443a32-2dd0-4aef-858b-8490b43caa1e",
    courtId: "us-ca-3",
    dimension: "GOOD_FAITH",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAll: ["GPS", "good faith"],
    propositionCandidates: ["good faith"],
  },
  {
    caseName: "United States v. Vasquez-Algarin",
    citation: "821 F.3d 467",
    authorityId: "07d6e7fb-d887-4e9f-8af7-121539e261b2",
    courtId: "us-ca-3",
    dimension: "SCOPE",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["third party", "third-party", "Payton"],
    secondaryRequiredAny: ["arrest warrant", "search warrant", "reside"],
    propositionCandidates: ["arrest warrant and a search warrant"],
  },
  {
    caseName: "United States v. Wright",
    citation: "777 F.3d 635",
    authorityId: "08399051-449b-47da-a266-ca68f4d8c016",
    courtId: "us-ca-3",
    dimension: "EXECUTION",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["sealing order", "list of items to be seized"],
    propositionCandidates: ["valid search warrant"],
  },
  {
    caseName: "In re Search Warrant No. 16-960-M-1 to Google",
    citation: "275 F.Supp.3d 605",
    authorityId: "40e6b507-2a06-4152-8df8-df4cb35615a3",
    courtId: "us-d-pa-ed",
    dimension: "PARTICULARITY",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["Stored Communications Act", "section 2703", "§ 2703"],
    propositionCandidates: ["search warrants", "Stored Communications Act"],
    persuasiveOnly: true,
  },
  {
    caseName: "In re Search Warrant No. 16-960-M-01 to Google",
    citation: "232 F.Supp.3d 708",
    authorityId: "65463744-8938-4d75-8a39-7778a80607ca",
    courtId: "us-d-pa-ed",
    dimension: "PARTICULARITY",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["Stored Communications Act", "section 2703", "§ 2703"],
    propositionCandidates: ["search warrants", "Stored Communications Act"],
    persuasiveOnly: true,
  },
  {
    caseName: "United States v. Mooty",
    citation: "96 F.Supp.3d 472",
    authorityId: "a0a9ad1b-af45-4d21-a46e-409b4ff50d86",
    courtId: "us-d-pa-ed",
    dimension: null,
    doctrine: "FEDERAL_CONSTITUTIONAL",
    requiredAny: ["search warrant", "probable cause", "good faith", "suppression"],
    attachOnlyIf: "suppression_or_search_warrant_holding",
    persuasiveOnly: true,
  },
  {
    caseName: "Bamont",
    citation: "163 F.Supp.3d 138",
    authorityId: "6e544395-7ba1-4f67-95fc-a086db946a4d",
    courtId: "us-d-pa-ed",
    rejectReason: "HOLDING_REVIEW_REQUIRED_NO_SAFE_SUPPRESSION_PROPOSITION",
  },
  {
    caseName: "Lawson",
    citation: "124 F.Supp.3d 394",
    authorityId: "971da801-b9f3-460d-9ad2-afc95dcf4f83",
    courtId: "us-d-pa-ed",
    rejectReason: "HOLDING_REVIEW_REQUIRED_NO_SAFE_SUPPRESSION_PROPOSITION",
  },
  {
    caseName: "In re T.B.",
    citation: "75 A.3d 485",
    authorityId: "739f13e5-71c9-40b4-a6ee-75d0ea581deb",
    courtId: "st-pa-super",
    dimension: null,
    doctrine: "STATE_CONSTITUTIONAL",
    requiredAny: ["unreasonable searches and seizures", "probable cause", "consent"],
    attachOnlyIf: "clear_search_holding",
  },
  {
    caseName: "Pustilnik",
    citation: "439 A.2d 1149",
    authorityId: "33068440-94da-422d-bfc8-8ff5bfece006",
    courtId: "st-pa-high",
    rejectReason: "NOT_SEARCH_OR_SUPPRESSION_AUTHORITY",
  },
  {
    caseName: "Ness",
    citation: "105 A.3d 1257",
    authorityId: "6aac6edc-63d2-44af-aed7-c954f027240d",
    courtId: "st-pa-high",
    rejectReason: "SOURCE_TOO_THIN_OR_WRONG_CASE",
  },
  {
    caseName: "Grigsby",
    citation: "47 A.3d 1176",
    authorityId: "7900a059-d314-4004-9eab-12d61a1f64d4",
    courtId: "st-pa-high",
    rejectReason: "SOURCE_TOO_THIN_OR_WRONG_CASE",
  },
];

function norm(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function includesCI(hay, needle) {
  return hay.toLowerCase().includes(String(needle).toLowerCase());
}

function findSpan(content, needle) {
  const hay = norm(content);
  const needleN = norm(needle);
  const idx = hay.toLowerCase().indexOf(needleN.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - 100);
  const end = Math.min(hay.length, idx + needleN.length + 160);
  return hay.slice(start, end);
}

function hasAny(content, list = []) {
  return list.some((item) => includesCI(content, item));
}

function hasAll(content, list = []) {
  return list.every((item) => includesCI(content, item));
}

function mapCourtId(raw, preferred) {
  if (preferred) return preferred;
  if (raw === "us-d-paed") return "us-d-pa-ed";
  return raw;
}

async function main() {
  const url = process.env.CORPUS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url || !/ep-jolly-brook-auhdpay3-pooler/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "certified Neon URL required" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 20, connect_timeout: 30 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const identity = await sql`
      select
        (select count(*)::int from legal_authorities where authority_type = 'case') as cases,
        (select count(*)::int from legal_authorities) as authorities
    `;
    const out = {
      ok: true,
      courtListenerRequests: 0,
      mutations: 0,
      identity: { hostOk: true, cases: identity[0].cases, authorities: identity[0].authorities },
      attached: [],
      rejected: [],
      screens: [],
    };

    for (const rule of RULES) {
      const rows = await sql`
        select id, title, citation, court_id, jurisdiction, treatment_status, currentness_status, canonical_source_url
        from legal_authorities where id = ${rule.authorityId}::uuid limit 1
      `;
      const authority = rows[0];
      if (!authority) {
        out.rejected.push({ caseName: rule.caseName, citation: rule.citation, reason: "AUTHORITY_NOT_FOUND" });
        continue;
      }
      const versions = await sql`
        select content, length(content)::int as content_length
        from legal_authority_versions
        where authority_id = ${authority.id}::uuid
        order by version_number desc
        limit 1
      `;
      const version = versions[0];
      if (!version?.content) {
        out.rejected.push({ caseName: rule.caseName, citation: rule.citation, authorityId: authority.id, reason: "SOURCE_TEXT_ABSENT" });
        continue;
      }
      if (rule.rejectReason) {
        out.rejected.push({
          caseName: rule.caseName,
          citation: authority.citation || rule.citation,
          authorityId: authority.id,
          title: authority.title,
          reason: rule.rejectReason,
          contentLength: version.content_length,
        });
        out.screens.push({
          caseName: rule.caseName,
          citation: authority.citation || rule.citation,
          authorityId: authority.id,
          sourceSupported: false,
          reason: rule.rejectReason,
          treatment: "UNVERIFIED",
        });
        continue;
      }
      if (rule.attach === false) {
        out.rejected.push({
          caseName: rule.caseName,
          citation: authority.citation || rule.citation,
          authorityId: authority.id,
          reason: "NOT_ATTACHED_TO_WARRANT_DIMENSION",
          note: rule.note || null,
        });
        continue;
      }

      const content = version.content;
      const passPrimary =
        (rule.requiredAll ? hasAll(content, rule.requiredAll) : true) &&
        (rule.requiredAny ? hasAny(content, rule.requiredAny) : true) &&
        (rule.secondaryRequiredAny ? hasAny(content, rule.secondaryRequiredAny) : true);

      if (!passPrimary) {
        out.rejected.push({
          caseName: rule.caseName,
          citation: authority.citation || rule.citation,
          authorityId: authority.id,
          reason: "REQUIRED_PHRASE_ABSENT",
        });
        continue;
      }

      if (rule.attachOnlyIf === "suppression_or_search_warrant_holding") {
        const ok =
          hasAny(content, ["motion to suppress", "suppression"]) &&
          hasAny(content, ["search warrant", "probable cause"]);
        if (!ok) {
          out.rejected.push({
            caseName: rule.caseName,
            citation: authority.citation || rule.citation,
            authorityId: authority.id,
            reason: "NO_CLEAR_SEARCH_SUPPRESSION_HOLDING",
          });
          continue;
        }
      }
      if (rule.attachOnlyIf === "clear_search_holding") {
        const ok = hasAny(content, ["search warrant", "consent", "probable cause"]) && hasAny(content, ["Fourth", "Article I", "unreasonable search"]);
        if (!ok) {
          out.rejected.push({
            caseName: rule.caseName,
            citation: authority.citation || rule.citation,
            authorityId: authority.id,
            reason: "NO_CLEAR_STATE_SEARCH_HOLDING",
            doctrineWarning: "Federal and Pennsylvania doctrines must stay separate.",
          });
          continue;
        }
      }

      let proposition = null;
      let sourceSpan = null;
      for (const candidate of rule.propositionCandidates || []) {
        const span = findSpan(content, candidate);
        if (span) {
          proposition = candidate;
          sourceSpan = span;
          break;
        }
      }
      if (!proposition || !sourceSpan) {
        out.rejected.push({
          caseName: rule.caseName,
          citation: authority.citation || rule.citation,
          authorityId: authority.id,
          reason: "PROPOSITION_NOT_IN_SOURCE",
        });
        continue;
      }

      // Prefer a longer literal holding sentence for Davis if present.
      if (rule.caseName === "Davis v. United States") {
        const long = "searches conducted in objectively reasonable reliance on binding appellate precedent are not subject to the exclusionary rule";
        const longSpan = findSpan(content, long);
        if (longSpan) {
          proposition = long;
          sourceSpan = longSpan;
        }
      }

      const attached = {
        caseName: rule.caseName,
        citation: authority.citation || rule.citation,
        authorityId: authority.id,
        courtId: mapCourtId(authority.court_id, rule.courtId),
        jurisdiction: authority.jurisdiction === "United States" ? "US" : authority.jurisdiction,
        dimension: rule.dimension || "OTHER",
        doctrine: rule.doctrine,
        proposition,
        sourceSpan,
        sourceSupported: true,
        treatment: "UNVERIFIED",
        treatmentStatusFromCorpus: authority.treatment_status,
        currentness: authority.currentness_status,
        sourceUrl: authority.canonical_source_url,
        persuasiveOnly: Boolean(rule.persuasiveOnly),
        note: rule.note || null,
        contentLength: version.content_length,
      };
      out.attached.push(attached);
      out.screens.push(attached);
    }

    await sql.unsafe("ROLLBACK");
    const outPath = path.join(process.cwd(), "packages/intelligence/src/prosecution/suppression-holding-screen.json");
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(
      JSON.stringify(
        {
          ok: true,
          cases: out.identity.cases,
          authorities: out.identity.authorities,
          attached: out.attached.map((row) => `${row.caseName}::${row.dimension}`),
          rejected: out.rejected.map((row) => `${row.caseName}:${row.reason}`),
          outPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
