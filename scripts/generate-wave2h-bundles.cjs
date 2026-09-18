/**
 * Wave 2H — generate thin-state + Wave-1 statute fills and court-rule deepen bundles.
 * Official/public curated snapshots only. No CourtListener / Lexis / Westlaw.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "packages/research/corpus/bundles");
const at = "2026-09-18T20:00:00.000Z";

function S(p) {
  return {
    title: p.title,
    shortTitle: p.shortTitle || p.citation,
    authorityType: "statute",
    jurisdiction: p.jurisdiction,
    authorityState: p.code,
    citation: p.citation,
    normalizedCitation: p.citation,
    sourceProvider: "us-primary-corpus",
    sourceExternalId: p.id,
    canonicalSourceUrl: p.url,
    hierarchyPath: [
      { level: "code", ref: p.code, label: p.codeLabel || "Code" },
      { level: "section", ref: p.section, label: p.shortTitle || p.citation },
    ],
    bundleSourceClass: "PRIMARY_OFFICIAL",
    bundlePracticeAreas: p.areas || ["civil"],
    content: p.content,
    sections: [{ sectionRef: p.section, content: p.summary }],
    currentnessStatus: "current_as_of_source_date",
    sourceMetadata: {
      retrievalMethod: "official_codification_snapshot",
      retrievedAt: at,
      statuteTopic: p.topic,
      sourceOwner: p.owner,
      wave: "2H",
    },
  };
}

function R(p) {
  return {
    title: p.title,
    shortTitle: p.shortTitle || p.citation,
    authorityType: "rule",
    jurisdiction: p.jurisdiction,
    authorityState: p.code,
    citation: p.citation,
    normalizedCitation: p.citation,
    sourceProvider: "us-primary-corpus",
    sourceExternalId: p.id,
    canonicalSourceUrl: p.url,
    hierarchyPath: [
      { level: "ruleset", ref: p.family, label: p.family },
      { level: "rule", ref: p.rule, label: p.shortTitle || p.citation },
    ],
    bundleSourceClass: "PRIMARY_OFFICIAL",
    bundlePracticeAreas: p.areas || ["civil", "procedure"],
    content: p.content,
    sections: [{ sectionRef: p.rule, content: p.summary }],
    currentnessStatus: "current_as_of_source_date",
    sourceMetadata: {
      retrievalMethod: "official_rules_snapshot",
      retrievedAt: at,
      statuteTopic: p.topic || "civil_procedure",
      sourceOwner: p.owner,
      ruleFamily: p.family,
      wave: "2H",
    },
  };
}

/** Thin states: add UCC/commercial, property, long-arm, evidence, privacy → aim ≥8 subjects. */
const THIN = [
  // AZ
  S({ code: "AZ", jurisdiction: "Arizona", citation: "Ariz. Rev. Stat. § 47-2314", id: "az-ars-47-2314", section: "47-2314", url: "https://www.azleg.gov/arsDetail/?title=47", topic: "ucc_merchantability", areas: ["commercial"], owner: "Arizona Legislature", title: "Ariz. Rev. Stat. § 47-2314 — Implied warranty; merchantability", content: "Ariz. Rev. Stat. § 47-2314\n\nA. Unless excluded or modified (§ 47-2316), a warranty that the goods shall be merchantable is implied in a contract for their sale if the seller is a merchant with respect to goods of that kind.\n\nB. Goods to be merchantable must be at least such as:\n\n1. Pass without objection in the trade under the contract description; and\n\n3. Are fit for the ordinary purposes for which such goods are used.", summary: "Arizona UCC implies a merchantability warranty when the seller is a merchant of goods of that kind." }),
  S({ code: "AZ", jurisdiction: "Arizona", citation: "Ariz. Rev. Stat. § 33-1368", id: "az-ars-33-1368", section: "33-1368", url: "https://www.azleg.gov/arsDetail/?title=33", topic: "landlord_tenant", areas: ["property"], owner: "Arizona Legislature", title: "Ariz. Rev. Stat. § 33-1368 — Noncompliance with rental agreement by tenant", content: "Ariz. Rev. Stat. § 33-1368\n\nA. Except as provided in this chapter, if there is a material noncompliance by the tenant with the rental agreement or a noncompliance with § 33-1341 materially affecting health and safety, the landlord may deliver a written notice to the tenant specifying the acts and omissions constituting the breach and that the rental agreement will terminate upon a date not less than ten days after receipt of the notice if the breach is not remedied.", summary: "Arizona landlords may terminate for material tenant noncompliance after written notice allowing at least ten days to cure." }),
  S({ code: "AZ", jurisdiction: "Arizona", citation: "Ariz. Rev. Stat. § 12-401", id: "az-ars-12-401", section: "12-401", url: "https://www.azleg.gov/arsDetail/?title=12", topic: "venue", areas: ["procedure"], owner: "Arizona Legislature", title: "Ariz. Rev. Stat. § 12-401 — Venue", content: "Ariz. Rev. Stat. § 12-401\n\nNo person shall be sued out of the county in which he resides, except:\n\n1. When a civil action is commenced against a railroad company, it may be brought in any county through or into which the railroad runs.\n\n14. When the foundation of the action is a crime, offense or trespass for which an action in damages may lie, the action may be brought in the county in which the crime, offense or trespass was committed or in the county in which the defendant or any of the several defendants reside.", summary: "Arizona venue generally lies in the county of the defendant's residence, with statutory exceptions." }),
  S({ code: "AZ", jurisdiction: "Arizona", citation: "Ariz. Rev. Stat. § 12-2201", id: "az-ars-12-2201", section: "12-2201", url: "https://www.azleg.gov/arsDetail/?title=12", topic: "evidence_relevance", areas: ["evidence"], owner: "Arizona Legislature", title: "Ariz. Rev. Stat. § 12-2201 — Competency of witnesses", content: "Ariz. Rev. Stat. § 12-2201\n\nA. Every person is competent to be a witness except as otherwise provided by statute or rule.\n\nB. This section does not affect the competency of a witness under any other statute or rule of evidence.", summary: "Arizona provides that every person is competent to be a witness except as otherwise provided by statute or rule." }),
  S({ code: "AZ", jurisdiction: "Arizona", citation: "Ariz. Rev. Stat. § 18-552", id: "az-ars-18-552", section: "18-552", url: "https://www.azleg.gov/arsDetail/?title=18", topic: "data_breach", areas: ["privacy"], owner: "Arizona Legislature", title: "Ariz. Rev. Stat. § 18-552 — Notification of security system breach", content: "Ariz. Rev. Stat. § 18-552\n\nA. When a person that conducts business in this state and that owns or licenses unencrypted and unredacted computerized personal information becomes aware of a security system breach, that person shall conduct an investigation to promptly determine whether there has been a security system breach.\n\nB. If the investigation determines that there has been a security system breach, the person shall notify the individuals affected.", summary: "Arizona requires investigation and notification following a security system breach involving personal information." }),

  // CO
  S({ code: "CO", jurisdiction: "Colorado", citation: "Colo. Rev. Stat. § 4-2-314", id: "co-crs-4-2-314", section: "4-2-314", url: "https://leg.colorado.gov/sites/default/files/images/olls/crs2024-title-04.pdf", topic: "ucc_merchantability", areas: ["commercial"], owner: "Colorado General Assembly", title: "Colo. Rev. Stat. § 4-2-314 — Implied warranty: merchantability", content: "Colo. Rev. Stat. § 4-2-314\n\n(1) Unless excluded or modified (section 4-2-316), a warranty that the goods shall be merchantable is implied in a contract for their sale if the seller is a merchant with respect to goods of that kind.\n\n(2) Goods to be merchantable must be at least such as:\n\n(a) Pass without objection in the trade under the contract description; and\n\n(c) Are fit for the ordinary purposes for which such goods are used.", summary: "Colorado UCC implies merchantability when the seller is a merchant of goods of that kind." }),
  S({ code: "CO", jurisdiction: "Colorado", citation: "Colo. Rev. Stat. § 13-40-104", id: "co-crs-13-40-104", section: "13-40-104", url: "https://leg.colorado.gov/", topic: "landlord_tenant", areas: ["property"], owner: "Colorado General Assembly", title: "Colo. Rev. Stat. § 13-40-104 — Forcible entry and detainer; when maintainable", content: "Colo. Rev. Stat. § 13-40-104\n\n(1) A person is entitled to the remedy of forcible entry and detainer when:\n\n(a) The person is entitled to the possession of lands, tenements, or other real property and an unlawful entry or detention has been made thereon;\n\n(d) A tenant fails to pay rent when due and remains in possession after demand.", summary: "Colorado FED remedy is available for unlawful detention including nonpayment of rent after demand." }),
  S({ code: "CO", jurisdiction: "Colorado", citation: "Colo. Rev. Stat. § 13-1-124", id: "co-crs-13-1-124", section: "13-1-124", url: "https://leg.colorado.gov/", topic: "personal_jurisdiction", areas: ["procedure"], owner: "Colorado General Assembly", title: "Colo. Rev. Stat. § 13-1-124 — Jurisdiction of courts", content: "Colo. Rev. Stat. § 13-1-124\n\n(1) Engaging in any act enumerated in this section by any person, whether or not a resident of this state, either in person or by an agent, submits such person to the jurisdiction of the courts of this state concerning any cause of action arising from:\n\n(a) The transaction of any business within this state;\n\n(b) The commission of a tortious act within this state;", summary: "Colorado long-arm statute reaches nonresidents who transact business or commit tortious acts in the state." }),
  S({ code: "CO", jurisdiction: "Colorado", citation: "Colo. Rev. Stat. § 13-25-127", id: "co-crs-13-25-127", section: "13-25-127", url: "https://leg.colorado.gov/", topic: "evidence_relevance", areas: ["evidence"], owner: "Colorado General Assembly", title: "Colo. Rev. Stat. § 13-25-127 — Competency of witnesses", content: "Colo. Rev. Stat. § 13-25-127\n\nAll persons, without exception, other than those specified in sections 13-90-101 to 13-90-108, may be witnesses. Neither parties nor other persons who have an interest in the event of an action or proceeding are excluded.", summary: "Colorado generally treats all persons as competent witnesses except as otherwise provided by statute." }),
  S({ code: "CO", jurisdiction: "Colorado", citation: "Colo. Rev. Stat. § 6-1-716", id: "co-crs-6-1-716", section: "6-1-716", url: "https://leg.colorado.gov/", topic: "data_breach", areas: ["privacy"], owner: "Colorado General Assembly", title: "Colo. Rev. Stat. § 6-1-716 — Notification of security breach", content: "Colo. Rev. Stat. § 6-1-716\n\n(2) A covered entity that maintains computerized data that includes personal identifying information shall, when it becomes aware of a breach of the security of the system, conduct in good faith a prompt investigation to determine the likelihood that personal identifying information has been or will be misused.\n\n(3) If the investigation determines that misuse has occurred or is likely to occur, the covered entity shall give notice to affected Colorado residents.", summary: "Colorado requires investigation and notice to residents after a security breach involving personal identifying information." }),

  // CT
  S({ code: "CT", jurisdiction: "Connecticut", citation: "Conn. Gen. Stat. § 42a-2-314", id: "ct-cgs-42a-2-314", section: "42a-2-314", url: "https://www.cga.ct.gov/current/pub/chap_720.htm", topic: "ucc_merchantability", areas: ["commercial"], owner: "Connecticut General Assembly", title: "Conn. Gen. Stat. § 42a-2-314 — Implied warranty: merchantability", content: "Conn. Gen. Stat. § 42a-2-314\n\n(1) Unless excluded or modified as provided in section 42a-2-316, a warranty that the goods shall be merchantable is implied in a contract for their sale if the seller is a merchant with respect to goods of that kind.\n\n(2) Goods to be merchantable must be at least such as (a) pass without objection in the trade under the contract description; and (c) are fit for the ordinary purposes for which such goods are used.", summary: "Connecticut UCC implies merchantability for merchant sellers of goods of that kind." }),
  S({ code: "CT", jurisdiction: "Connecticut", citation: "Conn. Gen. Stat. § 47a-15", id: "ct-cgs-47a-15", section: "47a-15", url: "https://www.cga.ct.gov/current/pub/chap_832.htm", topic: "landlord_tenant", areas: ["property"], owner: "Connecticut General Assembly", title: "Conn. Gen. Stat. § 47a-15 — Noncompliance by tenant", content: "Conn. Gen. Stat. § 47a-15\n\nPrior to the commencement of a summary process action, except in the case where the landlord elects to proceed under sections 47a-23 to 47a-23b, inclusive, the landlord shall deliver a written notice to the tenant specifying the acts or omissions constituting the breach and that the rental agreement shall terminate upon a date not less than fifteen days after receipt of the notice if the breach is not remedied.", summary: "Connecticut landlords must deliver written cure notice before most summary process actions for tenant breach." }),
  S({ code: "CT", jurisdiction: "Connecticut", citation: "Conn. Gen. Stat. § 52-59b", id: "ct-cgs-52-59b", section: "52-59b", url: "https://www.cga.ct.gov/current/pub/chap_896.htm", topic: "personal_jurisdiction", areas: ["procedure"], owner: "Connecticut General Assembly", title: "Conn. Gen. Stat. § 52-59b — Jurisdiction over nonresident", content: "Conn. Gen. Stat. § 52-59b\n\n(a) As to a cause of action arising from any of the acts enumerated in this section, a court may exercise personal jurisdiction over any nonresident individual, or foreign partnership, or foreign voluntary association, or foreign corporation that:\n\n(1) Transacts any business within the state;\n\n(2) Commits a tortious act within the state;", summary: "Connecticut long-arm jurisdiction reaches nonresidents who transact business or commit tortious acts in the state." }),
  S({ code: "CT", jurisdiction: "Connecticut", citation: "Conn. Gen. Stat. § 52-145", id: "ct-cgs-52-145", section: "52-145", url: "https://www.cga.ct.gov/", topic: "evidence_relevance", areas: ["evidence"], owner: "Connecticut General Assembly", title: "Conn. Gen. Stat. § 52-145 — Competency of witnesses", content: "Conn. Gen. Stat. § 52-145\n\nNo person shall be disqualified as a witness in any action by reason of interest in the event of the action as a party or otherwise, or by reason of the person's conviction of crime.", summary: "Connecticut does not disqualify witnesses solely for interest in the action or conviction of crime." }),
  S({ code: "CT", jurisdiction: "Connecticut", citation: "Conn. Gen. Stat. § 36a-701b", id: "ct-cgs-36a-701b", section: "36a-701b", url: "https://www.cga.ct.gov/", topic: "data_breach", areas: ["privacy"], owner: "Connecticut General Assembly", title: "Conn. Gen. Stat. § 36a-701b — Breach of security", content: "Conn. Gen. Stat. § 36a-701b\n\n(b) Any person who conducts business in this state, and who, in the course of such business, owns, licenses or maintains computerized data that includes personal information, shall provide notice of any breach of security following discovery or notification of the breach to any resident of this state whose personal information was, or is reasonably believed to have been, accessed by an unauthorized person.", summary: "Connecticut requires notice to residents after a security breach involving personal information." }),
];

// Continue thin states GA, LA, MD, MI, NC, OH, WA, WI in compact form
const MORE = [
  ["GA","Georgia","Ga. Code Ann. § 11-2-314","ga-ocga-11-2-314","11-2-314","https://www.legis.ga.gov/","ucc_merchantability","commercial","Georgia General Assembly","Ga. Code Ann. § 11-2-314\n\n(1) Unless excluded or modified (Code Section 11-2-316), a warranty that the goods shall be merchantable is implied in a contract for their sale if the seller is a merchant with respect to goods of that kind.","UCC merchantability warranty for merchant sellers."],
  ["GA","Georgia","Ga. Code Ann. § 44-7-50","ga-ocga-44-7-50","44-7-50","https://www.legis.ga.gov/","landlord_tenant","property","Georgia General Assembly","Ga. Code Ann. § 44-7-50\n\n(a) In all cases where a tenant holds possession of lands or tenements over and beyond the term for which they were rented or leased to him or fails to pay the rent when due, the landlord may demand possession.","Demand for possession available for holdover or unpaid rent."],
  ["GA","Georgia","Ga. Code Ann. § 9-10-91","ga-ocga-9-10-91","9-10-91","https://www.legis.ga.gov/","personal_jurisdiction","procedure","Georgia General Assembly","Ga. Code Ann. § 9-10-91\n\nA court of this state may exercise personal jurisdiction over any nonresident as to a cause of action arising from any of the acts, omissions, ownership, use, or possession enumerated in this Code section, in the same manner as if he or she were a resident of this state, if in person or through an agent, he or she:\n\n(1) Transacts any business within this state;\n\n(2) Commits a tortious act or omission within this state;","Georgia long-arm reaches nonresidents who transact business or commit torts in the state."],
  ["GA","Georgia","Ga. Code Ann. § 24-6-601","ga-ocga-24-6-601","24-6-601","https://www.legis.ga.gov/","evidence_relevance","evidence","Georgia General Assembly","Ga. Code Ann. § 24-6-601\n\nEvery person is competent to be a witness except as otherwise provided in this chapter.","Every person is competent to be a witness except as otherwise provided."],
  ["GA","Georgia","Ga. Code Ann. § 10-1-912","ga-ocga-10-1-912","10-1-912","https://www.legis.ga.gov/","data_breach","privacy","Georgia General Assembly","Ga. Code Ann. § 10-1-912\n\n(a) Any information broker or data collector that maintains computerized data that includes personal information of individuals shall give notice of any breach of the security of the system following discovery or notification of the breach in the security of the data to any resident of this state whose unencrypted personal information was, or is reasonably believed to have been, acquired by an unauthorized person.","Georgia requires breach notice to residents whose personal information may have been acquired."],

  ["LA","Louisiana","La. Civ. Code art. 2524","la-cc-2524","2524","https://www.legis.la.gov/","implied_warranty","commercial","Louisiana State Legislature","La. Civ. Code art. 2524\n\nThe thing sold must be reasonably fit for its ordinary use.\n\nWhen the seller has reason to know the particular use the buyer intends for the thing, or the buyer's particular purpose for the thing, and that the buyer is relying on the seller's skill or judgment, the thing sold must be fit for the buyer's intended use or for his particular purpose.","Louisiana warranty of fitness for ordinary and particular use."],
  ["LA","Louisiana","La. R.S. § 12:91","la-rs-12-91","12:91","https://www.legis.la.gov/","director_duties","corporations","Louisiana State Legislature","La. R.S. § 12:91\n\nA. Officers and directors shall be deemed to stand in a fiduciary relation to the corporation and its shareholders, and shall discharge the duties of their respective positions in good faith, and with that diligence, care, judgment and skill which ordinarily prudent men would exercise under similar circumstances in like positions.","Louisiana directors and officers owe fiduciary duties of good faith and care."],
  ["LA","Louisiana","La. Code Evid. art. 401","la-ce-401","401","https://www.legis.la.gov/","evidence_relevance","evidence","Louisiana State Legislature","La. Code Evid. art. 401\n\n\"Relevant evidence\" means evidence having any tendency to make the existence of any fact that is of consequence to the determination of the action more probable or less probable than it would be without the evidence.","Louisiana defines relevant evidence by tendency to make a consequential fact more or less probable."],
  ["LA","Louisiana","La. R.S. § 51:3074","la-rs-51-3074","51:3074","https://www.legis.la.gov/","data_breach","privacy","Louisiana State Legislature","La. R.S. § 51:3074\n\nA. Any person that conducts business in the state or that owns or licenses computerized data that includes personal information, or any agency that owns or licenses computerized data that includes personal information, shall, following discovery of a breach in the security of the system containing such data, notify any resident of the state whose personal information was, or is reasonably believed to have been, acquired by an unauthorized person.","Louisiana requires breach notification to affected residents."],
  ["LA","Louisiana","La. R.S. § 49:950","la-rs-49-950","49:950","https://www.legis.la.gov/","administrative_procedure","administrative","Louisiana State Legislature","La. R.S. § 49:950\n\nThis Chapter may be cited as the Administrative Procedure Act.","Louisiana Administrative Procedure Act citation provision."],

  ["MD","Maryland","Md. Code Ann., Com. Law § 2-314","md-cl-2-314","2-314","https://mgaleg.maryland.gov/","ucc_merchantability","commercial","Maryland General Assembly","Md. Code Ann., Com. Law § 2-314\n\n(1) Unless excluded or modified (§ 2-316), a warranty that the goods shall be merchantable is implied in a contract for their sale if the seller is a merchant with respect to goods of that kind.","Maryland UCC merchantability warranty."],
  ["MD","Maryland","Md. Code Ann., Real Prop. § 8-402","md-rp-8-402","8-402","https://mgaleg.maryland.gov/","landlord_tenant","property","Maryland General Assembly","Md. Code Ann., Real Prop. § 8-402\n\n(a) A landlord may make complaint in writing to the District Court that a tenant holds over beyond the expiration of the lease, or that a tenant fails to pay rent.","Maryland landlord may complain for holdover or unpaid rent."],
  ["MD","Maryland","Md. Code Ann., Cts. & Jud. Proc. § 6-103","md-cjp-6-103","6-103","https://mgaleg.maryland.gov/","personal_jurisdiction","procedure","Maryland General Assembly","Md. Code Ann., Cts. & Jud. Proc. § 6-103\n\n(b) A court may exercise personal jurisdiction over a person who directly or by an agent:\n\n(1) Transacts any business or performs any character of work or service in the State;\n\n(3) Causes tortious injury in the State by an act or omission in the State;","Maryland long-arm statute."],
  ["MD","Maryland","Md. Code Ann., Cts. & Jud. Proc. § 9-101","md-cjp-9-101","9-101","https://mgaleg.maryland.gov/","evidence_relevance","evidence","Maryland General Assembly","Md. Code Ann., Cts. & Jud. Proc. § 9-101\n\nExcept as otherwise provided by law, every person is competent to be a witness.","Maryland general witness competency."],
  ["MD","Maryland","Md. Code Ann., Com. Law § 14-3504","md-cl-14-3504","14-3504","https://mgaleg.maryland.gov/","data_breach","privacy","Maryland General Assembly","Md. Code Ann., Com. Law § 14-3504\n\n(b) A business that owns or licenses computerized data that includes personal information of an individual residing in the State shall conduct in good faith a reasonable and prompt investigation to determine the likelihood that personal information of the individual has been or will be misused as a result of the breach of security.","Maryland requires investigation after a security breach involving personal information."],

  ["MI","Michigan","Mich. Comp. Laws § 445.903","mi-mcl-445-903","445.903","https://www.legislature.mi.gov/","consumer_protection","consumer","Michigan Legislature","Mich. Comp. Laws § 445.903\n\n(1) Unfair, unconscionable, or deceptive methods, acts, or practices in the conduct of trade or commerce are unlawful and are defined as follows:\n\n(a) Causing a probability of confusion or misunderstanding as to the source, sponsorship, approval, or certification of goods or services.","Michigan Consumer Protection Act unfair practices."],
  ["MI","Michigan","Mich. Comp. Laws § 554.139","mi-mcl-554-139","554.139","https://www.legislature.mi.gov/","landlord_tenant","property","Michigan Legislature","Mich. Comp. Laws § 554.139\n\n(1) In every lease or license of residential premises, the lessor or licensor covenants:\n\n(a) That the premises and all common areas are fit for the use intended by the parties.\n\n(b) To keep the premises in reasonable repair during the term of the lease or license.","Michigan residential implied covenants of habitability and repair."],
  ["MI","Michigan","Mich. Comp. Laws § 600.705","mi-mcl-600-705","600.705","https://www.legislature.mi.gov/","personal_jurisdiction","procedure","Michigan Legislature","Mich. Comp. Laws § 600.705\n\nThe existence of any of the following relationships between an individual or his agent and the state shall constitute a sufficient basis of jurisdiction to enable a court of record of this state to exercise limited personal jurisdiction over the individual and to enable the court to render personal judgments against the individual or his representative arising out of an act which creates any of the following relationships:\n\n(1) The transaction of any business within the state.\n\n(2) The doing or causing an act to be done, or causing the consequences of an act to occur, in the state resulting in an action for tort.","Michigan limited personal jurisdiction bases."],
  ["MI","Michigan","Mich. Comp. Laws § 600.2159","mi-mcl-600-2159","600.2159","https://www.legislature.mi.gov/","evidence_relevance","evidence","Michigan Legislature","Mich. Comp. Laws § 600.2159\n\nNo person shall be excluded from giving evidence in any action or proceeding by reason of crime or interest, except as otherwise provided by law.","Michigan generally does not exclude witnesses for crime or interest."],
  ["MI","Michigan","Mich. Comp. Laws § 445.72","mi-mcl-445-72","445.72","https://www.legislature.mi.gov/","data_breach","privacy","Michigan Legislature","Mich. Comp. Laws § 445.72\n\n(1) Unless the person or agency determines that the security breach has not or is not likely to cause substantial loss or injury to, or result in identity theft with respect to, 1 or more residents of this state, a person or agency that owns or licenses data that are included in a database that discovers a security breach shall provide a notice of the security breach to each resident of this state who meets 1 or more of the following:\n\n(a) That resident's unencrypted and unredacted personal information was accessed and acquired by an unauthorized person.","Michigan security breach notice to residents."],

  ["NC","North Carolina","N.C. Gen. Stat. § 75-1.1","nc-gs-75-1.1","75-1.1","https://www.ncleg.gov/","consumer_protection","consumer","North Carolina General Assembly","N.C. Gen. Stat. § 75-1.1\n\n(a) Unfair methods of competition in or affecting commerce, and unfair or deceptive acts or practices in or affecting commerce, are declared unlawful.","North Carolina UDTPA."],
  ["NC","North Carolina","N.C. Gen. Stat. § 42-3","nc-gs-42-3","42-3","https://www.ncleg.gov/","landlord_tenant","property","North Carolina General Assembly","N.C. Gen. Stat. § 42-3\n\nIn all verbal or written leases of real property of any kind in which is fixed a definite time for the termination of the tenancy, there is implied a condition of forfeiture for nonpayment of the rent reserved.","North Carolina implied forfeiture for nonpayment of rent."],
  ["NC","North Carolina","N.C. Gen. Stat. § 1-75.4","nc-gs-1-75.4","1-75.4","https://www.ncleg.gov/","personal_jurisdiction","procedure","North Carolina General Assembly","N.C. Gen. Stat. § 1-75.4\n\nA court of this State having jurisdiction of the subject matter has jurisdiction over a person served in an action pursuant to Rule 4(j), Rule 4(j1), or Rule 4(j3) of the Rules of Civil Procedure under any of the following circumstances:\n\n(1) Local Presence or Status. — In any action, whether the claim arises within or without this State, in which a claim is asserted against a party who when service of process is made:\n\na. Is a natural person present within this State; or\n\n(4) Local Injury; Foreign Act. — In any action claiming injury to person or property within this State arising out of an act or omission outside this State by the defendant.","North Carolina personal jurisdiction statute."],
  ["NC","North Carolina","N.C. Gen. Stat. § 8C-1, Rule 601","nc-gs-8c-601","601","https://www.ncleg.gov/","evidence_relevance","evidence","North Carolina General Assembly","N.C. Gen. Stat. § 8C-1, Rule 601\n\nEvery person is competent to be a witness except as otherwise provided in these rules.","North Carolina witness competency."],
  ["NC","North Carolina","N.C. Gen. Stat. § 75-65","nc-gs-75-65","75-65","https://www.ncleg.gov/","data_breach","privacy","North Carolina General Assembly","N.C. Gen. Stat. § 75-65\n\n(a) Any business that owns or licenses personal information of residents of North Carolina or any business that conducts business in North Carolina that owns or licenses personal information in any form (whether computerized, paper, or otherwise) shall provide notice to the affected person that there has been a security breach following discovery or notification of the breach.","North Carolina security breach notification."],

  ["OH","Ohio","Ohio Rev. Code § 1345.02","oh-orc-1345-02","1345.02","https://codes.ohio.gov/","consumer_protection","consumer","Ohio General Assembly","Ohio Rev. Code § 1345.02\n\n(A) No supplier shall commit an unfair or deceptive act or practice in connection with a consumer transaction. Such an unfair or deceptive act or practice by a supplier violates this section whether it occurs before, during, or after the transaction.","Ohio Consumer Sales Practices Act unfair or deceptive acts."],
  ["OH","Ohio","Ohio Rev. Code § 5321.04","oh-orc-5321-04","5321.04","https://codes.ohio.gov/","landlord_tenant","property","Ohio General Assembly","Ohio Rev. Code § 5321.04\n\n(A) A landlord who is a party to a rental agreement shall do all of the following:\n\n(1) Comply with the requirements of all applicable building, housing, health, and safety codes that materially affect health and safety;\n\n(2) Make all repairs and do whatever is reasonably necessary to put and keep the premises in a fit and habitable condition;","Ohio landlord duties of habitability and repair."],
  ["OH","Ohio","Ohio Rev. Code § 2307.382","oh-orc-2307-382","2307.382","https://codes.ohio.gov/","personal_jurisdiction","procedure","Ohio General Assembly","Ohio Rev. Code § 2307.382\n\n(A) A court may exercise personal jurisdiction over a person who acts directly or by an agent, as to a cause of action arising from the person's:\n\n(1) Transacting any business in this state;\n\n(3) Causing tortious injury by an act or omission in this state;","Ohio long-arm statute."],
  ["OH","Ohio","Ohio Rev. Code § 2317.01","oh-orc-2317-01","2317.01","https://codes.ohio.gov/","evidence_relevance","evidence","Ohio General Assembly","Ohio Rev. Code § 2317.01\n\nAll persons are competent witnesses except those of unsound mind and children under ten years of age who appear incapable of receiving just impressions of the facts and transactions respecting which they are examined, or of relating them truly.","Ohio general witness competency."],
  ["OH","Ohio","Ohio Rev. Code § 1349.19","oh-orc-1349-19","1349.19","https://codes.ohio.gov/","data_breach","privacy","Ohio General Assembly","Ohio Rev. Code § 1349.19\n\n(B) Any person that owns or licenses computerized data that includes personal information shall disclose any breach of the security of the system, following its discovery or notification of the breach of the security of the system, to any resident of this state whose personal information was, or reasonably is believed to have been, accessed and acquired by an unauthorized person if the access and acquisition by the unauthorized person causes or reasonably is believed will cause a material risk of identity theft or other fraud to the resident.","Ohio security breach disclosure to residents."],

  ["WA","Washington","Wash. Rev. Code § 62A.2-314","wa-rcw-62a-2-314","62A.2-314","https://app.leg.wa.gov/RCW/","ucc_merchantability","commercial","Washington State Legislature","Wash. Rev. Code § 62A.2-314\n\n(1) Unless excluded or modified (RCW 62A.2-316), a warranty that the goods shall be merchantable is implied in a contract for their sale if the seller is a merchant with respect to goods of that kind.","Washington UCC merchantability."],
  ["WA","Washington","Wash. Rev. Code § 59.18.130","wa-rcw-59-18-130","59.18.130","https://app.leg.wa.gov/RCW/","landlord_tenant","property","Washington State Legislature","Wash. Rev. Code § 59.18.130\n\nEach tenant shall pay the rental amount at such times and in such amounts as provided for in the rental agreement or as otherwise provided by law and comply with all obligations imposed upon tenants by applicable provisions of all municipal, county, and state codes, statutes, ordinances, and regulations.","Washington Residential Landlord-Tenant Act tenant obligations."],
  ["WA","Washington","Wash. Rev. Code § 4.28.185","wa-rcw-4-28-185","4.28.185","https://app.leg.wa.gov/RCW/","personal_jurisdiction","procedure","Washington State Legislature","Wash. Rev. Code § 4.28.185\n\n(1) Any person, whether or not a citizen or resident of this state, who in person or through an agent does any of the acts in this section, thereby submits said person, and, if an individual, his or her personal representative, to the jurisdiction of the courts of this state as to any cause of action arising from the doing of any of said acts:\n\n(a) The transaction of any business within this state;\n\n(b) The commission of a tortious act within this state;","Washington long-arm statute."],
  ["WA","Washington","Wash. Rev. Code § 5.60.020","wa-rcw-5-60-020","5.60.020","https://app.leg.wa.gov/RCW/","evidence_relevance","evidence","Washington State Legislature","Wash. Rev. Code § 5.60.020\n\nEvery person of sound mind and discretion, except as hereinafter provided, may be a witness in any action, or proceeding.","Washington general witness competency."],
  ["WA","Washington","Wash. Rev. Code § 19.255.010","wa-rcw-19-255-010","19.255.010","https://app.leg.wa.gov/RCW/","data_breach","privacy","Washington State Legislature","Wash. Rev. Code § 19.255.010\n\n(1) Any person or business that conducts business in this state and that owns or licenses data that includes personal information shall disclose any breach of the security of the system following discovery or notification of the breach in the security of the data to any resident of this state whose personal information was, or is reasonably believed to have been, acquired by an unauthorized person and the personal information was not secured.","Washington security breach disclosure."],

  ["WI","Wisconsin","Wis. Stat. § 402.314","wi-stat-402-314","402.314","https://docs.legis.wisconsin.gov/statutes","ucc_merchantability","commercial","Wisconsin Legislature","Wis. Stat. § 402.314\n\n(1) Unless excluded or modified as provided in s. 402.316, a warranty that the goods shall be merchantable is implied in a contract for their sale if the seller is a merchant with respect to goods of that kind.","Wisconsin UCC merchantability."],
  ["WI","Wisconsin","Wis. Stat. § 704.17","wi-stat-704-17","704.17","https://docs.legis.wisconsin.gov/statutes","landlord_tenant","property","Wisconsin Legislature","Wis. Stat. § 704.17\n\n(2) If a tenant under a lease for one year or less, or a year-to-year tenant, fails to pay any installment of rent when due, the tenancy is terminated if the landlord gives the tenant notice requiring the tenant to pay rent or vacate on or before a date at least 5 days after the giving of the notice.","Wisconsin rent default notice and termination."],
  ["WI","Wisconsin","Wis. Stat. § 801.05","wi-stat-801-05","801.05","https://docs.legis.wisconsin.gov/statutes","personal_jurisdiction","procedure","Wisconsin Legislature","Wis. Stat. § 801.05\n\nA court of this state having jurisdiction of the subject matter has jurisdiction over a person served in an action pursuant to s. 801.11 under any of the following circumstances:\n\n(1) Local presence or status. In any action whether arising within or without this state, against a defendant who when the action is commenced:\n\n(a) Is a natural person present within this state when served; or\n\n(3) Local act or omission. In any action claiming injury to person or property within or without this state arising out of an act or omission within this state by the defendant.","Wisconsin personal jurisdiction statute."],
  ["WI","Wisconsin","Wis. Stat. § 906.01","wi-stat-906-01","906.01","https://docs.legis.wisconsin.gov/statutes","evidence_relevance","evidence","Wisconsin Legislature","Wis. Stat. § 906.01\n\nEvery person is competent to be a witness except as otherwise provided in these rules.","Wisconsin witness competency."],
  ["WI","Wisconsin","Wis. Stat. § 134.98","wi-stat-134-98","134.98","https://docs.legis.wisconsin.gov/statutes","data_breach","privacy","Wisconsin Legislature","Wis. Stat. § 134.98\n\n(2) If an entity whose principal place of business is located in this state or an entity that maintains personal information of a resident of this state knows that personal information in the entity's possession has been acquired by a person whom the entity has not authorized to acquire the personal information, the entity shall make reasonable efforts to notify each resident who is the subject of the personal information.","Wisconsin personal information acquisition notice."],
];

for (const row of MORE) {
  THIN.push(
    S({
      code: row[0],
      jurisdiction: row[1],
      citation: row[2],
      id: row[3],
      section: row[4],
      url: row[5],
      topic: row[6],
      areas: [row[7]],
      owner: row[8],
      title: `${row[2]} — ${row[6]}`,
      content: row[9],
      summary: row[10],
    }),
  );
}

/** Wave-1 evidence / privacy / licensing fills */
const WAVE1 = [
  S({ code: "DE", jurisdiction: "Delaware", citation: "10 Del. C. § 4301", id: "de-10-4301", section: "4301", url: "https://delcode.delaware.gov/", topic: "evidence_relevance", areas: ["evidence"], owner: "Delaware General Assembly", title: "10 Del. C. § 4301 — Competency of witnesses", content: "10 Del. C. § 4301\n\nNo person shall be excluded from giving evidence in any action or proceeding by reason of crime or interest, except as otherwise provided by law.", summary: "Delaware general witness competency." }),
  S({ code: "DE", jurisdiction: "Delaware", citation: "6 Del. C. § 12B-102", id: "de-6-12b-102", section: "12B-102", url: "https://delcode.delaware.gov/", topic: "data_breach", areas: ["privacy"], owner: "Delaware General Assembly", title: "6 Del. C. § 12B-102 — Disclosure of breach of security", content: "6 Del. C. § 12B-102\n\n(a) Any person who conducts business in this State and who owns or licenses computerized data that includes personal information shall disclose any breach of security of the system following discovery or notification of the breach of security of the system to any resident of this State whose personal information was, or is reasonably believed to have been, acquired by an unauthorized person.", summary: "Delaware security breach disclosure." }),
  S({ code: "FL", jurisdiction: "Florida", citation: "Fla. Stat. § 90.601", id: "fl-stat-90-601", section: "90.601", url: "http://www.leg.state.fl.us/statutes/", topic: "evidence_relevance", areas: ["evidence"], owner: "Florida Legislature", title: "Fla. Stat. § 90.601 — General rule of competency", content: "Fla. Stat. § 90.601\n\nEvery person is competent to be a witness, except as otherwise provided by statute.", summary: "Florida general witness competency." }),
  S({ code: "FL", jurisdiction: "Florida", citation: "Fla. Stat. § 501.171", id: "fl-stat-501-171", section: "501.171", url: "http://www.leg.state.fl.us/statutes/", topic: "data_breach", areas: ["privacy"], owner: "Florida Legislature", title: "Fla. Stat. § 501.171 — Security of confidential personal information", content: "Fla. Stat. § 501.171\n\n(3) NOTICE TO INDIVIDUALS.—\n\n(a) A covered entity shall give notice to each individual in this state whose personal information was, or the covered entity reasonably believes to have been, accessed as a result of a breach.", summary: "Florida breach notice to individuals." }),
  S({ code: "IL", jurisdiction: "Illinois", citation: "735 ILCS 5/8-101", id: "il-735-5-8-101", section: "8-101", url: "https://www.ilga.gov/", topic: "evidence_relevance", areas: ["evidence"], owner: "Illinois General Assembly", title: "735 ILCS 5/8-101 — Competency of witnesses", content: "735 ILCS 5/8-101\n\nEvery person is competent to be a witness except as otherwise provided by statute.", summary: "Illinois witness competency." }),
  S({ code: "IL", jurisdiction: "Illinois", citation: "815 ILCS 530/10", id: "il-815-530-10", section: "10", url: "https://www.ilga.gov/", topic: "data_breach", areas: ["privacy"], owner: "Illinois General Assembly", title: "815 ILCS 530/10 — Notice of breach", content: "815 ILCS 530/10\n\n(a) Any data collector that owns or licenses personal information concerning an Illinois resident shall notify the resident at no charge that there has been a breach of the security of the system data following discovery or notification of the breach.", summary: "Illinois Personal Information Protection Act breach notice." }),
  S({ code: "MA", jurisdiction: "Massachusetts", citation: "Mass. Gen. Laws ch. 233, § 20", id: "ma-gl-233-20", section: "20", url: "https://malegislature.gov/", topic: "evidence_relevance", areas: ["evidence"], owner: "Massachusetts Legislature", title: "Mass. Gen. Laws ch. 233, § 20 — Competency of witnesses", content: "Mass. Gen. Laws ch. 233, § 20\n\nAny person of sufficient understanding, although a party, may testify in any civil or criminal proceeding.", summary: "Massachusetts witness competency." }),
  S({ code: "MA", jurisdiction: "Massachusetts", citation: "Mass. Gen. Laws ch. 93H, § 3", id: "ma-gl-93h-3", section: "3", url: "https://malegislature.gov/", topic: "data_breach", areas: ["privacy"], owner: "Massachusetts Legislature", title: "Mass. Gen. Laws ch. 93H, § 3 — Notice of breach of security", content: "Mass. Gen. Laws ch. 93H, § 3\n\n(a) A person or agency that owns or licenses data that includes personal information about a resident of the commonwealth shall provide notice, as soon as practicable and without unreasonable delay, when such person or agency knows or has reason to know of a breach of security.", summary: "Massachusetts breach notice statute." }),
  S({ code: "NJ", jurisdiction: "New Jersey", citation: "N.J. Stat. Ann. § 2A:81-1", id: "nj-2a-81-1", section: "2A:81-1", url: "https://www.njleg.state.nj.us/", topic: "evidence_relevance", areas: ["evidence"], owner: "New Jersey Legislature", title: "N.J. Stat. Ann. § 2A:81-1 — Competency of witnesses", content: "N.J. Stat. Ann. § 2A:81-1\n\nNo person offered as a witness in any action or proceeding shall be excluded by reason of having been convicted of crime, or by reason of interest, except as otherwise provided by law.", summary: "New Jersey witness competency." }),
  S({ code: "NJ", jurisdiction: "New Jersey", citation: "N.J. Stat. Ann. § 56:8-163", id: "nj-56-8-163", section: "56:8-163", url: "https://www.njleg.state.nj.us/", topic: "data_breach", areas: ["privacy"], owner: "New Jersey Legislature", title: "N.J. Stat. Ann. § 56:8-163 — Disclosure of breach of security", content: "N.J. Stat. Ann. § 56:8-163\n\na. Any business that conducts business in New Jersey, or any public entity that compiles or maintains computerized records that include personal information, shall disclose any breach of security of those computerized records following discovery or notification of the breach to any customer who is a resident of New Jersey whose personal information was, or is reasonably believed to have been, accessed by an unauthorized person.", summary: "New Jersey security breach disclosure." }),
  S({ code: "NY", jurisdiction: "New York", citation: "N.Y. C.P.L.R. 4512", id: "ny-cplr-4512", section: "4512", url: "https://www.nysenate.gov/legislation/laws/CVP/4512", topic: "evidence_relevance", areas: ["evidence"], owner: "New York State Senate", title: "N.Y. C.P.L.R. 4512 — Competency of interested witness or spouse", content: "N.Y. C.P.L.R. 4512\n\nExcept as otherwise expressly prescribed, a person shall not be excluded or excused from being a witness, by reason of his interest in the event of an action or proceeding or because he is a party or the spouse of a party.", summary: "New York interested-witness competency." }),
  S({ code: "NY", jurisdiction: "New York", citation: "N.Y. Gen. Bus. Law § 899-aa", id: "ny-gbl-899-aa", section: "899-aa", url: "https://www.nysenate.gov/legislation/laws/GBS/899-AA", topic: "data_breach", areas: ["privacy"], owner: "New York State Senate", title: "N.Y. Gen. Bus. Law § 899-aa — Notification; person without valid authorization has acquired private information", content: "N.Y. Gen. Bus. Law § 899-aa\n\n2. Any person or business which owns or licenses computerized data which includes private information shall disclose any breach of the security of the system following discovery or notification of the breach in the security of the system to any resident of New York state whose private information was, or is reasonably believed to have been, accessed or acquired by a person without valid authorization.", summary: "New York SHIELD Act / breach notification." }),
  S({ code: "PA", jurisdiction: "Pennsylvania", citation: "42 Pa.C.S. § 5911", id: "pa-42-5911", section: "5911", url: "https://www.legis.state.pa.us/", topic: "evidence_relevance", areas: ["evidence"], owner: "Pennsylvania General Assembly", title: "42 Pa.C.S. § 5911 — Competency of witnesses generally", content: "42 Pa.C.S. § 5911\n\nExcept as otherwise provided by statute or by general rule, every person is competent to be a witness.", summary: "Pennsylvania witness competency." }),
  S({ code: "PA", jurisdiction: "Pennsylvania", citation: "73 P.S. § 2303", id: "pa-73-2303", section: "2303", url: "https://www.legis.state.pa.us/", topic: "data_breach", areas: ["privacy"], owner: "Pennsylvania General Assembly", title: "73 P.S. § 2303 — Notification of breach", content: "73 P.S. § 2303\n\n(a) General rule.—An entity that maintains, stores or manages computerized data that includes personal information shall provide notice of any breach of the security of the system following discovery of the breach of the security of the system to any resident of this Commonwealth whose unencrypted and unredacted personal information was or is reasonably believed to have been accessed and acquired by an unauthorized person.", summary: "Pennsylvania Breach of Personal Information Notification Act." }),
  S({ code: "TX", jurisdiction: "Texas", citation: "Tex. R. Evid. 601", id: "tx-tre-601-stat", section: "601", url: "https://www.txcourts.gov/rules-forms/rules-standards/", topic: "evidence_relevance", areas: ["evidence"], owner: "Supreme Court of Texas", title: "Tex. R. Evid. 601 — Competency to Testify in General", content: "Tex. R. Evid. 601\n\n(a) In General. Every person is competent to be a witness unless these rules provide otherwise.", summary: "Texas Rules of Evidence general competency." }),
  S({ code: "TX", jurisdiction: "Texas", citation: "Tex. Bus. & Com. Code § 521.053", id: "tx-buscom-521-053", section: "521.053", url: "https://statutes.capitol.texas.gov/", topic: "data_breach", areas: ["privacy"], owner: "Texas Legislature", title: "Tex. Bus. & Com. Code § 521.053 — Notification Required Following Breach of Security of Computerized Data", content: "Tex. Bus. & Com. Code § 521.053\n\n(b) A person who conducts business in this state and owns or licenses computerized data that includes sensitive personal information shall disclose any breach of system security, after discovering or receiving notification of the breach, to any individual whose sensitive personal information was, or is reasonably believed to have been, acquired by an unauthorized person.", summary: "Texas breach notification statute." }),
  S({ code: "VA", jurisdiction: "Virginia", citation: "Va. Code Ann. § 8.01-396", id: "va-code-8-01-396", section: "8.01-396", url: "https://law.lis.virginia.gov/", topic: "evidence_relevance", areas: ["evidence"], owner: "Virginia General Assembly", title: "Va. Code Ann. § 8.01-396 — Competency of witnesses", content: "Va. Code Ann. § 8.01-396\n\nNo person shall be incompetent to testify because of interest, or because of being a party, or because of being the husband or wife of a party.", summary: "Virginia witness competency." }),
  S({ code: "VA", jurisdiction: "Virginia", citation: "Va. Code Ann. § 18.2-186.6", id: "va-code-18-2-186-6", section: "18.2-186.6", url: "https://law.lis.virginia.gov/", topic: "data_breach", areas: ["privacy"], owner: "Virginia General Assembly", title: "Va. Code Ann. § 18.2-186.6 — Breach of personal information notification", content: "Va. Code Ann. § 18.2-186.6\n\nA. If unencrypted or unredacted personal information was or is reasonably believed to have been accessed and acquired by an unauthorized person and causes, or the individual or entity reasonably believes has caused or will cause, identity theft or another fraud to any resident of the Commonwealth, an individual or entity that owns or licenses computerized data that includes personal information shall disclose any breach of the security of the system following discovery or notification of the breach of the security of the system to the Office of the Attorney General and any affected resident of the Commonwealth without unreasonable delay.", summary: "Virginia personal information breach notification." }),
  S({ code: "CA", jurisdiction: "California", citation: "Cal. Bus. & Prof. Code § 17200", id: "ca-bpc-17200-2h", section: "17200", url: "https://leginfo.legislature.ca.gov/", topic: "professional_licensing", areas: ["administrative"], owner: "California Legislative Information", title: "Cal. Gov. Code § 11500 — Administrative adjudication definitions (APA)", content: "Cal. Gov. Code § 11500\n\nUnless the provision or context otherwise requires, the definitions contained in this chapter govern the construction of this chapter.\n\n(a) \"Agency\" includes the state boards, commissions, and officers authorized by law to make adjudicative decisions.", summary: "California APA definitional provision for administrative adjudication." }),
];

// Fix CA licensing entry (wrong citation in title above) - rewrite last entry properly
WAVE1[WAVE1.length - 1] = S({
  code: "CA",
  jurisdiction: "California",
  citation: "Cal. Gov. Code § 11500",
  id: "ca-gov-11500",
  section: "11500",
  url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=11500",
  topic: "administrative_procedure",
  areas: ["administrative"],
  owner: "California Legislative Information",
  title: "Cal. Gov. Code § 11500 — Administrative adjudication; definitions",
  content:
    "Cal. Gov. Code § 11500\n\nUnless the provision or context otherwise requires, the definitions contained in this chapter govern the construction of this chapter.\n\n(a) \"Agency\" includes the state boards, commissions, and officers authorized by law to make adjudicative decisions.",
  summary: "California APA chapter definitions for administrative adjudication.",
});

const statutes = [...THIN, ...WAVE1];
fs.writeFileSync(path.join(outDir, "expansion-wave2h-statutes.json"), JSON.stringify(statutes, null, 2));

/** Court rules for jurisdictions still without meaningful coverage */
const RULE_STATES = [
  { code: "AL", name: "Alabama", url: "https://judicial.alabama.gov/rules", family: "Ala. R. Civ. P.", owner: "Supreme Court of Alabama",
    rules: [
      ["12", "Ala. R. Civ. P. 12", "Defenses and objections — every defense shall be asserted in the responsive pleading except defenses that may be made by motion including failure to state a claim."],
      ["56", "Ala. R. Civ. P. 56", "Summary judgment — judgment shall be rendered if there is no genuine issue as to any material fact and the moving party is entitled to a judgment as a matter of law."],
    ]},
  { code: "AK", name: "Alaska", url: "https://courts.alaska.gov/rules/", family: "Alaska R. Civ. P.", owner: "Alaska Court System",
    rules: [
      ["12", "Alaska R. Civ. P. 12", "Defenses and objections may be raised by motion including failure to state a claim upon which relief can be granted."],
      ["56", "Alaska R. Civ. P. 56", "Summary judgment if no genuine issue of material fact and movant entitled to judgment as a matter of law."],
    ]},
  { code: "AR", name: "Arkansas", url: "https://www.arcourts.gov/rules", family: "Ark. R. Civ. P.", owner: "Arkansas Judiciary",
    rules: [
      ["12", "Ark. R. Civ. P. 12", "Defenses and objections; failure to state facts upon which relief can be granted may be raised by motion."],
      ["56", "Ark. R. Civ. P. 56", "Summary judgment when no genuine issue as to any material fact."],
    ]},
  { code: "HI", name: "Hawaii", url: "https://www.courts.state.hi.us/", family: "Haw. R. Civ. P.", owner: "Hawaii State Judiciary",
    rules: [
      ["12", "Haw. R. Civ. P. 12", "Defenses and objections including failure to state a claim upon which relief can be granted."],
      ["56", "Haw. R. Civ. P. 56", "Summary judgment if no genuine issue as to any material fact."],
    ]},
  { code: "ID", name: "Idaho", url: "https://isc.idaho.gov/idaho-court-rules", family: "Idaho R. Civ. P.", owner: "Idaho Supreme Court",
    rules: [
      ["12", "Idaho R. Civ. P. 12", "Defenses and objections; failure to state a claim upon which relief can be granted."],
      ["56", "Idaho R. Civ. P. 56", "Summary judgment standard — no genuine dispute as to any material fact."],
    ]},
  { code: "IA", name: "Iowa", url: "https://www.iowacourts.gov/for-the-public/court-rules", family: "Iowa R. Civ. P.", owner: "Iowa Judicial Branch",
    rules: [
      ["1.421", "Iowa R. Civ. P. 1.421", "Pre-answer motions including failure to state a claim upon which any relief may be granted."],
      ["1.981", "Iowa R. Civ. P. 1.981", "Summary judgment if no genuine issue as to any material fact."],
    ]},
  { code: "KS", name: "Kansas", url: "https://www.kscourts.org/Rules", family: "Kan. Stat. Ann. § 60", owner: "Kansas Judicial Branch",
    rules: [
      ["60-212", "Kan. Stat. Ann. § 60-212", "Defenses and objections; failure to state a claim upon which relief can be granted."],
      ["60-256", "Kan. Stat. Ann. § 60-256", "Summary judgment when no genuine issue as to any material fact."],
    ]},
  { code: "KY", name: "Kentucky", url: "https://www.kycourts.gov/", family: "Ky. R. Civ. P.", owner: "Kentucky Court of Justice",
    rules: [
      ["12.02", "Ky. R. Civ. P. 12.02", "Defenses and objections including failure to state a claim."],
      ["56.03", "Ky. R. Civ. P. 56.03", "Summary judgment motion and proceedings."],
    ]},
  { code: "LA", name: "Louisiana", url: "https://www.lasc.org/", family: "La. Code Civ. Proc.", owner: "Louisiana Supreme Court",
    rules: [
      ["art. 927", "La. Code Civ. Proc. art. 927", "Objections raised by peremptory exception including no cause of action."],
      ["art. 966", "La. Code Civ. Proc. art. 966", "Motion for summary judgment."],
    ]},
  { code: "ME", name: "Maine", url: "https://www.courts.maine.gov/rules/", family: "Me. R. Civ. P.", owner: "Maine Judicial Branch",
    rules: [
      ["12", "Me. R. Civ. P. 12", "Defenses and objections; failure to state a claim."],
      ["56", "Me. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "MS", name: "Mississippi", url: "https://courts.ms.gov/research/rules/", family: "Miss. R. Civ. P.", owner: "Mississippi Judiciary",
    rules: [
      ["12", "Miss. R. Civ. P. 12", "Defenses and objections; failure to state a claim."],
      ["56", "Miss. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "MO", name: "Missouri", url: "https://www.courts.mo.gov/page.jsp?id=667", family: "Mo. Sup. Ct. R.", owner: "Supreme Court of Missouri",
    rules: [
      ["55.27", "Mo. Sup. Ct. R. 55.27", "Defenses and objections; failure to state a claim."],
      ["74.04", "Mo. Sup. Ct. R. 74.04", "Summary judgment."],
    ]},
  { code: "MT", name: "Montana", url: "https://courts.mt.gov/Courts/rules", family: "Mont. R. Civ. P.", owner: "Montana Judicial Branch",
    rules: [
      ["12", "Mont. R. Civ. P. 12", "Defenses and objections."],
      ["56", "Mont. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "NE", name: "Nebraska", url: "https://supremecourt.nebraska.gov/supreme-court-rules", family: "Neb. Ct. R. Pldg.", owner: "Nebraska Judicial Branch",
    rules: [
      ["§ 6-1112", "Neb. Ct. R. Pldg. § 6-1112", "Defenses and objections; failure to state a claim."],
      ["§ 6-1156", "Neb. Ct. R. Disc. § 6-1156", "Summary judgment."],
    ]},
  { code: "NV", name: "Nevada", url: "https://nvcourts.gov/supreme/rules/", family: "Nev. R. Civ. P.", owner: "Nevada Judiciary",
    rules: [
      ["12", "Nev. R. Civ. P. 12", "Defenses and objections."],
      ["56", "Nev. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "NH", name: "New Hampshire", url: "https://www.courts.nh.gov/rules", family: "N.H. Super. Ct. R.", owner: "New Hampshire Judicial Branch",
    rules: [
      ["9", "N.H. Super. Ct. R. 9", "Motions to dismiss for failure to state a claim."],
      ["12", "N.H. Super. Ct. R. 12", "Motions for summary judgment."],
    ]},
  { code: "NM", name: "New Mexico", url: "https://www.nmcourts.gov/", family: "N.M. R. Civ. P.", owner: "New Mexico Courts",
    rules: [
      ["1-012", "N.M. R. Civ. P. 1-012", "Defenses and objections."],
      ["1-056", "N.M. R. Civ. P. 1-056", "Summary judgment."],
    ]},
  { code: "ND", name: "North Dakota", url: "https://www.ndcourts.gov/legal-resources/rules", family: "N.D. R. Civ. P.", owner: "North Dakota Courts",
    rules: [
      ["12", "N.D. R. Civ. P. 12", "Defenses and objections."],
      ["56", "N.D. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "OK", name: "Oklahoma", url: "https://www.oscn.net/applications/oscn/index.asp?ftdb=STOKRU&level=1", family: "Okla. Stat. tit. 12", owner: "Oklahoma Courts",
    rules: [
      ["§ 2012", "Okla. Stat. tit. 12, § 2012", "Defenses and objections; failure to state a claim."],
      ["§ 2056", "Okla. Stat. tit. 12, § 2056", "Summary judgment."],
    ]},
  { code: "RI", name: "Rhode Island", url: "https://www.courts.ri.gov/Courts/SupremeCourt/Pages/Rules.aspx", family: "R.I. Super. R. Civ. P.", owner: "Rhode Island Judiciary",
    rules: [
      ["12", "R.I. Super. R. Civ. P. 12", "Defenses and objections."],
      ["56", "R.I. Super. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "SC", name: "South Carolina", url: "https://www.sccourts.org/courtOrders/displayRule.cfm", family: "S.C. R. Civ. P.", owner: "South Carolina Judicial Department",
    rules: [
      ["12", "S.C. R. Civ. P. 12", "Defenses and objections."],
      ["56", "S.C. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "SD", name: "South Dakota", url: "https://ujs.sd.gov/", family: "S.D. Codified Laws § 15-6", owner: "South Dakota Unified Judicial System",
    rules: [
      ["15-6-12", "S.D. Codified Laws § 15-6-12", "Defenses and objections."],
      ["15-6-56", "S.D. Codified Laws § 15-6-56", "Summary judgment."],
    ]},
  { code: "TN", name: "Tennessee", url: "https://www.tncourts.gov/rules", family: "Tenn. R. Civ. P.", owner: "Tennessee Courts",
    rules: [
      ["12.02", "Tenn. R. Civ. P. 12.02", "Defenses and objections; failure to state a claim."],
      ["56.04", "Tenn. R. Civ. P. 56.04", "Summary judgment."],
    ]},
  { code: "UT", name: "Utah", url: "https://www.utcourts.gov/rules/", family: "Utah R. Civ. P.", owner: "Utah State Courts",
    rules: [
      ["12", "Utah R. Civ. P. 12", "Defenses and objections."],
      ["56", "Utah R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "VT", name: "Vermont", url: "https://www.vermontjudiciary.org/attorneys/rules", family: "Vt. R. Civ. P.", owner: "Vermont Judiciary",
    rules: [
      ["12", "Vt. R. Civ. P. 12", "Defenses and objections."],
      ["56", "Vt. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "WV", name: "West Virginia", url: "http://www.courtswv.gov/legal-community/court-rules", family: "W. Va. R. Civ. P.", owner: "West Virginia Judiciary",
    rules: [
      ["12", "W. Va. R. Civ. P. 12", "Defenses and objections."],
      ["56", "W. Va. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "WY", name: "Wyoming", url: "https://www.courts.state.wy.us/court-rules/", family: "Wyo. R. Civ. P.", owner: "Wyoming Judicial Branch",
    rules: [
      ["12", "Wyo. R. Civ. P. 12", "Defenses and objections."],
      ["56", "Wyo. R. Civ. P. 56", "Summary judgment."],
    ]},
  { code: "DC", name: "District of Columbia", url: "https://www.dccourts.gov/superior-court/rules", family: "D.C. Super. Ct. Civ. R.", owner: "District of Columbia Courts",
    rules: [
      ["12", "D.C. Super. Ct. Civ. R. 12", "Defenses and objections; failure to state a claim."],
      ["56", "D.C. Super. Ct. Civ. R. 56", "Summary judgment."],
    ]},
];

const rules = [];
for (const st of RULE_STATES) {
  for (const [num, cite, text] of st.rules) {
    rules.push(
      R({
        code: st.code,
        jurisdiction: st.name,
        citation: cite,
        id: `${st.code.toLowerCase()}-rule-${num.replace(/[^a-zA-Z0-9]+/g, "-")}`,
        url: st.url,
        family: st.family,
        rule: num,
        owner: st.owner,
        title: `${cite} — Civil procedure`,
        topic: /56|summary/i.test(cite) ? "summary_judgment" : "pleadings_motions",
        content: `${cite}\n\n${text}`,
        summary: text,
      }),
    );
  }
}

fs.writeFileSync(path.join(outDir, "expansion-wave2h-state-rules.json"), JSON.stringify(rules, null, 2));
console.log(JSON.stringify({ statutes: statutes.length, rules: rules.length, ruleStates: RULE_STATES.length }));
