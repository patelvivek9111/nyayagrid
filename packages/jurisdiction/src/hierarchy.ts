import { getCourtById } from "./registry";
import type { CourtRecord } from "./types";

/** Week 3 court-level labels. Specialized federal courts are not territorial circuits. */
export const HIERARCHY_LEVELS = [
  "SUPREME_COURT_US",
  "FEDERAL_CIRCUIT",
  "FEDERAL_DISTRICT",
  "STATE_SUPREME",
  "STATE_INTERMEDIATE",
  "STATE_TRIAL",
  "SPECIALIZED_FEDERAL",
  "OTHER",
] as const;
export type HierarchyLevel = (typeof HIERARCHY_LEVELS)[number];

export const COURT_RELATIONSHIPS = [
  "SUPERIOR",
  "INFERIOR",
  "SAME_COURT",
  "PARALLEL",
  "FOREIGN",
  "UNKNOWN",
] as const;
export type CourtRelationship = (typeof COURT_RELATIONSHIPS)[number];

export const JURISDICTION_RELATIONSHIPS = [
  "SAME",
  "PARENT",
  "CHILD",
  "PARALLEL",
  "FOREIGN",
  "UNKNOWN",
] as const;
export type JurisdictionRelationship = (typeof JURISDICTION_RELATIONSHIPS)[number];

/**
 * States whose criminal court of last resort is not the general supreme court.
 * Extend this table as split high courts are added to the registry.
 */
export const SPLIT_CRIMINAL_HIGH_COURTS: Record<string, string> = {
  TX: "st-tx-crim-high",
  OK: "st-ok-crim-high",
};

const RANK: Record<HierarchyLevel, number> = {
  SUPREME_COURT_US: 70,
  SPECIALIZED_FEDERAL: 55,
  FEDERAL_CIRCUIT: 50,
  FEDERAL_DISTRICT: 40,
  STATE_SUPREME: 50,
  STATE_INTERMEDIATE: 40,
  STATE_TRIAL: 30,
  OTHER: 0,
};

export function hierarchyLevel(court: CourtRecord | null | undefined): HierarchyLevel {
  if (!court) return "OTHER";
  if (court.id === "us-ca-fed" || court.federalCircuit === "fed") return "SPECIALIZED_FEDERAL";
  switch (court.level) {
    case "scotus":
      return "SUPREME_COURT_US";
    case "circuit":
      return "FEDERAL_CIRCUIT";
    case "district":
      return "FEDERAL_DISTRICT";
    case "state_high":
      return "STATE_SUPREME";
    case "state_appellate":
      return "STATE_INTERMEDIATE";
    case "state_trial":
      return "STATE_TRIAL";
    default:
      return "OTHER";
  }
}

export function superiorCourtId(courtId: string | null | undefined): string | null {
  const court = getCourtById(courtId);
  if (!court) return null;
  const level = hierarchyLevel(court);
  if (level === "FEDERAL_DISTRICT" && court.federalCircuit) return `us-ca-${court.federalCircuit}`;
  if (level === "FEDERAL_CIRCUIT" || level === "SPECIALIZED_FEDERAL") return "us-scotus";
  if (level === "STATE_TRIAL" && court.state) return `st-${court.state.toLowerCase()}-app`;
  if (level === "STATE_INTERMEDIATE" && court.state) return `st-${court.state.toLowerCase()}-high`;
  return null;
}

export type CourtHierarchyRelation = {
  forumCourtId: string | null;
  authorityCourtId: string | null;
  forumLevel: HierarchyLevel;
  authorityLevel: HierarchyLevel;
  courtRelationship: CourtRelationship;
  jurisdictionRelationship: JurisdictionRelationship;
  sameCourt: boolean;
  sameJurisdiction: boolean;
  parallelJurisdiction: boolean;
  foreignJurisdiction: boolean;
  superiorOfForumId: string | null;
};

function federalFamily(level: HierarchyLevel): boolean {
  return (
    level === "SUPREME_COURT_US" ||
    level === "FEDERAL_CIRCUIT" ||
    level === "FEDERAL_DISTRICT" ||
    level === "SPECIALIZED_FEDERAL"
  );
}

function stateFamily(level: HierarchyLevel): boolean {
  return level === "STATE_SUPREME" || level === "STATE_INTERMEDIATE" || level === "STATE_TRIAL";
}

/**
 * Deterministic court relationship. Does not decide binding force.
 * Geographic appellate districts, when both ids are supplied, are parallel rather than superior.
 */
export function relateCourts(params: {
  forumCourtId?: string | null;
  authorityCourtId?: string | null;
  forumAppellateDistrictId?: string | null;
  authorityAppellateDistrictId?: string | null;
}): CourtHierarchyRelation {
  const forum = getCourtById(params.forumCourtId);
  const authority = getCourtById(params.authorityCourtId);
  const forumLevel = hierarchyLevel(forum);
  const authorityLevel = hierarchyLevel(authority);
  const base: CourtHierarchyRelation = {
    forumCourtId: forum?.id ?? null,
    authorityCourtId: authority?.id ?? null,
    forumLevel,
    authorityLevel,
    courtRelationship: "UNKNOWN",
    jurisdictionRelationship: "UNKNOWN",
    sameCourt: false,
    sameJurisdiction: false,
    parallelJurisdiction: false,
    foreignJurisdiction: false,
    superiorOfForumId: superiorCourtId(forum?.id),
  };
  if (!forum || !authority) return base;

  if (forum.id === authority.id) {
    return {
      ...base,
      courtRelationship: "SAME_COURT",
      jurisdictionRelationship: "SAME",
      sameCourt: true,
      sameJurisdiction: true,
    };
  }

  const forumFederal = federalFamily(forumLevel);
  const authorityFederal = federalFamily(authorityLevel);
  const forumState = stateFamily(forumLevel);
  const authorityState = stateFamily(authorityLevel);

  if ((forumFederal && authorityState) || (forumState && authorityFederal)) {
    return {
      ...base,
      courtRelationship: "FOREIGN",
      jurisdictionRelationship: "FOREIGN",
      foreignJurisdiction: true,
    };
  }

  if (forumFederal && authorityFederal) {
    const sameCircuit =
      Boolean(forum.federalCircuit) &&
      Boolean(authority.federalCircuit) &&
      forum.federalCircuit === authority.federalCircuit &&
      forumLevel !== "SPECIALIZED_FEDERAL" &&
      authorityLevel !== "SPECIALIZED_FEDERAL";
    const authorityIsScotus = authorityLevel === "SUPREME_COURT_US";
    const forumIsScotus = forumLevel === "SUPREME_COURT_US";
    let courtRelationship: CourtRelationship = "PARALLEL";
    if (authorityIsScotus) courtRelationship = "SUPERIOR";
    else if (forumIsScotus) courtRelationship = "INFERIOR";
    else if (
      authorityLevel === "FEDERAL_CIRCUIT" &&
      forumLevel === "FEDERAL_DISTRICT" &&
      sameCircuit
    ) {
      courtRelationship = "SUPERIOR";
    } else if (
      forumLevel === "FEDERAL_CIRCUIT" &&
      authorityLevel === "FEDERAL_DISTRICT" &&
      sameCircuit
    ) {
      courtRelationship = "INFERIOR";
    }
    const jurisdictionRelationship: JurisdictionRelationship = authorityIsScotus
      ? "PARENT"
      : forumIsScotus
        ? "CHILD"
        : sameCircuit
          ? "SAME"
          : "PARALLEL";
    return {
      ...base,
      courtRelationship,
      jurisdictionRelationship,
      sameJurisdiction: jurisdictionRelationship === "SAME" || jurisdictionRelationship === "PARENT",
      parallelJurisdiction: jurisdictionRelationship === "PARALLEL",
    };
  }

  if (forum.state && authority.state && forum.state !== authority.state) {
    return {
      ...base,
      courtRelationship: "FOREIGN",
      jurisdictionRelationship: "FOREIGN",
      foreignJurisdiction: true,
    };
  }

  const districtMismatch =
    Boolean(params.forumAppellateDistrictId) &&
    Boolean(params.authorityAppellateDistrictId) &&
    params.forumAppellateDistrictId !== params.authorityAppellateDistrictId &&
    (forumLevel === "STATE_INTERMEDIATE" ||
      authorityLevel === "STATE_INTERMEDIATE" ||
      forumLevel === "STATE_TRIAL" ||
      authorityLevel === "STATE_TRIAL");

  if (districtMismatch) {
    return {
      ...base,
      courtRelationship: "PARALLEL",
      jurisdictionRelationship: "PARALLEL",
      sameJurisdiction: true,
      parallelJurisdiction: true,
    };
  }

  const forumRank = RANK[forumLevel];
  const authorityRank = RANK[authorityLevel];
  const courtRelationship: CourtRelationship =
    authorityRank > forumRank ? "SUPERIOR" : authorityRank < forumRank ? "INFERIOR" : "PARALLEL";
  return {
    ...base,
    courtRelationship,
    jurisdictionRelationship: "SAME",
    sameJurisdiction: true,
  };
}
