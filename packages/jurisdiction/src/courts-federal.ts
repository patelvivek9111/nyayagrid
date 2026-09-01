import type { CourtRecord, CourtLevel } from "./types";

export const FEDERAL_CIRCUITS: Array<{
  id: string;
  number: string;
  name: string;
  shortName: string;
  aliases: string[];
}> = [
  { id: "1", number: "1", name: "United States Court of Appeals for the First Circuit", shortName: "1st Cir.", aliases: ["CA1", "First Circuit"] },
  { id: "2", number: "2", name: "United States Court of Appeals for the Second Circuit", shortName: "2d Cir.", aliases: ["CA2", "Second Circuit"] },
  { id: "3", number: "3", name: "United States Court of Appeals for the Third Circuit", shortName: "3d Cir.", aliases: ["CA3", "Third Circuit"] },
  { id: "4", number: "4", name: "United States Court of Appeals for the Fourth Circuit", shortName: "4th Cir.", aliases: ["CA4", "Fourth Circuit"] },
  { id: "5", number: "5", name: "United States Court of Appeals for the Fifth Circuit", shortName: "5th Cir.", aliases: ["CA5", "Fifth Circuit"] },
  { id: "6", number: "6", name: "United States Court of Appeals for the Sixth Circuit", shortName: "6th Cir.", aliases: ["CA6", "Sixth Circuit"] },
  { id: "7", number: "7", name: "United States Court of Appeals for the Seventh Circuit", shortName: "7th Cir.", aliases: ["CA7", "Seventh Circuit"] },
  { id: "8", number: "8", name: "United States Court of Appeals for the Eighth Circuit", shortName: "8th Cir.", aliases: ["CA8", "Eighth Circuit"] },
  { id: "9", number: "9", name: "United States Court of Appeals for the Ninth Circuit", shortName: "9th Cir.", aliases: ["CA9", "Ninth Circuit"] },
  { id: "10", number: "10", name: "United States Court of Appeals for the Tenth Circuit", shortName: "10th Cir.", aliases: ["CA10", "Tenth Circuit"] },
  { id: "11", number: "11", name: "United States Court of Appeals for the Eleventh Circuit", shortName: "11th Cir.", aliases: ["CA11", "Eleventh Circuit"] },
  { id: "dc", number: "dc", name: "United States Court of Appeals for the District of Columbia Circuit", shortName: "D.C. Cir.", aliases: ["CADC", "DC Circuit", "D.C. Circuit"] },
  { id: "fed", number: "fed", name: "United States Court of Appeals for the Federal Circuit", shortName: "Fed. Cir.", aliases: ["CAFC", "Federal Circuit"] },
];

type DistrictDef = {
  id: string;
  state: string | null;
  circuit: string;
  name: string;
  shortName: string;
  aliases?: string[];
};

const DISTRICTS: DistrictDef[] = [
  { id: "us-d-me", state: "ME", circuit: "1", name: "District of Maine", shortName: "D. Me.", aliases: ["DME"] },
  { id: "us-d-ma", state: "MA", circuit: "1", name: "District of Massachusetts", shortName: "D. Mass.", aliases: ["DMA"] },
  { id: "us-d-nh", state: "NH", circuit: "1", name: "District of New Hampshire", shortName: "D.N.H.", aliases: ["DNH"] },
  { id: "us-d-ri", state: "RI", circuit: "1", name: "District of Rhode Island", shortName: "D.R.I.", aliases: ["DRI"] },
  { id: "us-d-pr", state: null, circuit: "1", name: "District of Puerto Rico", shortName: "D.P.R.", aliases: ["DPR"] },
  { id: "us-d-ct", state: "CT", circuit: "2", name: "District of Connecticut", shortName: "D. Conn.", aliases: ["DCT"] },
  { id: "us-d-ny-ed", state: "NY", circuit: "2", name: "Eastern District of New York", shortName: "E.D.N.Y.", aliases: ["EDNY"] },
  { id: "us-d-ny-nd", state: "NY", circuit: "2", name: "Northern District of New York", shortName: "N.D.N.Y.", aliases: ["NDNY"] },
  { id: "us-d-ny-sd", state: "NY", circuit: "2", name: "Southern District of New York", shortName: "S.D.N.Y.", aliases: ["SDNY"] },
  { id: "us-d-ny-wd", state: "NY", circuit: "2", name: "Western District of New York", shortName: "W.D.N.Y.", aliases: ["WDNY"] },
  { id: "us-d-vt", state: "VT", circuit: "2", name: "District of Vermont", shortName: "D. Vt.", aliases: ["DVT"] },
  { id: "us-d-de", state: "DE", circuit: "3", name: "District of Delaware", shortName: "D. Del.", aliases: ["DDE"] },
  { id: "us-d-nj", state: "NJ", circuit: "3", name: "District of New Jersey", shortName: "D.N.J.", aliases: ["DNJ"] },
  { id: "us-d-pa-ed", state: "PA", circuit: "3", name: "Eastern District of Pennsylvania", shortName: "E.D. Pa.", aliases: ["EDPA", "E.D. Pennsylvania"] },
  { id: "us-d-pa-md", state: "PA", circuit: "3", name: "Middle District of Pennsylvania", shortName: "M.D. Pa.", aliases: ["MDPA", "M.D. Pennsylvania"] },
  { id: "us-d-pa-wd", state: "PA", circuit: "3", name: "Western District of Pennsylvania", shortName: "W.D. Pa.", aliases: ["WDPA", "W.D. Pennsylvania"] },
  { id: "us-d-vi", state: null, circuit: "3", name: "District of the Virgin Islands", shortName: "D.V.I.", aliases: ["DVI"] },
  { id: "us-d-md", state: "MD", circuit: "4", name: "District of Maryland", shortName: "D. Md.", aliases: ["DMD"] },
  { id: "us-d-nc-ed", state: "NC", circuit: "4", name: "Eastern District of North Carolina", shortName: "E.D.N.C.", aliases: ["EDNC"] },
  { id: "us-d-nc-md", state: "NC", circuit: "4", name: "Middle District of North Carolina", shortName: "M.D.N.C.", aliases: ["MDNC"] },
  { id: "us-d-nc-wd", state: "NC", circuit: "4", name: "Western District of North Carolina", shortName: "W.D.N.C.", aliases: ["WDNC"] },
  { id: "us-d-sc", state: "SC", circuit: "4", name: "District of South Carolina", shortName: "D.S.C.", aliases: ["DSC"] },
  { id: "us-d-va-ed", state: "VA", circuit: "4", name: "Eastern District of Virginia", shortName: "E.D. Va.", aliases: ["EDVA"] },
  { id: "us-d-va-wd", state: "VA", circuit: "4", name: "Western District of Virginia", shortName: "W.D. Va.", aliases: ["WDVA"] },
  { id: "us-d-wv-nd", state: "WV", circuit: "4", name: "Northern District of West Virginia", shortName: "N.D.W. Va.", aliases: ["NDWV"] },
  { id: "us-d-wv-sd", state: "WV", circuit: "4", name: "Southern District of West Virginia", shortName: "S.D.W. Va.", aliases: ["SDWV"] },
  { id: "us-d-la-ed", state: "LA", circuit: "5", name: "Eastern District of Louisiana", shortName: "E.D. La.", aliases: ["EDLA"] },
  { id: "us-d-la-md", state: "LA", circuit: "5", name: "Middle District of Louisiana", shortName: "M.D. La.", aliases: ["MDLA"] },
  { id: "us-d-la-wd", state: "LA", circuit: "5", name: "Western District of Louisiana", shortName: "W.D. La.", aliases: ["WDLA"] },
  { id: "us-d-ms-nd", state: "MS", circuit: "5", name: "Northern District of Mississippi", shortName: "N.D. Miss.", aliases: ["NDMS"] },
  { id: "us-d-ms-sd", state: "MS", circuit: "5", name: "Southern District of Mississippi", shortName: "S.D. Miss.", aliases: ["SDMS"] },
  { id: "us-d-tx-ed", state: "TX", circuit: "5", name: "Eastern District of Texas", shortName: "E.D. Tex.", aliases: ["EDTX"] },
  { id: "us-d-tx-nd", state: "TX", circuit: "5", name: "Northern District of Texas", shortName: "N.D. Tex.", aliases: ["NDTX"] },
  { id: "us-d-tx-sd", state: "TX", circuit: "5", name: "Southern District of Texas", shortName: "S.D. Tex.", aliases: ["SDTX"] },
  { id: "us-d-tx-wd", state: "TX", circuit: "5", name: "Western District of Texas", shortName: "W.D. Tex.", aliases: ["WDTX"] },
  { id: "us-d-ky-ed", state: "KY", circuit: "6", name: "Eastern District of Kentucky", shortName: "E.D. Ky.", aliases: ["EDKY"] },
  { id: "us-d-ky-wd", state: "KY", circuit: "6", name: "Western District of Kentucky", shortName: "W.D. Ky.", aliases: ["WDKY"] },
  { id: "us-d-mi-ed", state: "MI", circuit: "6", name: "Eastern District of Michigan", shortName: "E.D. Mich.", aliases: ["EDMI"] },
  { id: "us-d-mi-wd", state: "MI", circuit: "6", name: "Western District of Michigan", shortName: "W.D. Mich.", aliases: ["WDMI"] },
  { id: "us-d-oh-nd", state: "OH", circuit: "6", name: "Northern District of Ohio", shortName: "N.D. Ohio", aliases: ["NDOH"] },
  { id: "us-d-oh-sd", state: "OH", circuit: "6", name: "Southern District of Ohio", shortName: "S.D. Ohio", aliases: ["SDOH"] },
  { id: "us-d-tn-ed", state: "TN", circuit: "6", name: "Eastern District of Tennessee", shortName: "E.D. Tenn.", aliases: ["EDTN"] },
  { id: "us-d-tn-md", state: "TN", circuit: "6", name: "Middle District of Tennessee", shortName: "M.D. Tenn.", aliases: ["MDTN"] },
  { id: "us-d-tn-wd", state: "TN", circuit: "6", name: "Western District of Tennessee", shortName: "W.D. Tenn.", aliases: ["WDTN"] },
  { id: "us-d-il-cd", state: "IL", circuit: "7", name: "Central District of Illinois", shortName: "C.D. Ill.", aliases: ["CDIL"] },
  { id: "us-d-il-nd", state: "IL", circuit: "7", name: "Northern District of Illinois", shortName: "N.D. Ill.", aliases: ["NDIL"] },
  { id: "us-d-il-sd", state: "IL", circuit: "7", name: "Southern District of Illinois", shortName: "S.D. Ill.", aliases: ["SDIL"] },
  { id: "us-d-in-nd", state: "IN", circuit: "7", name: "Northern District of Indiana", shortName: "N.D. Ind.", aliases: ["NDIN"] },
  { id: "us-d-in-sd", state: "IN", circuit: "7", name: "Southern District of Indiana", shortName: "S.D. Ind.", aliases: ["SDIN"] },
  { id: "us-d-wi-ed", state: "WI", circuit: "7", name: "Eastern District of Wisconsin", shortName: "E.D. Wis.", aliases: ["EDWI"] },
  { id: "us-d-wi-wd", state: "WI", circuit: "7", name: "Western District of Wisconsin", shortName: "W.D. Wis.", aliases: ["WDWI"] },
  { id: "us-d-ar-ed", state: "AR", circuit: "8", name: "Eastern District of Arkansas", shortName: "E.D. Ark.", aliases: ["EDAR"] },
  { id: "us-d-ar-wd", state: "AR", circuit: "8", name: "Western District of Arkansas", shortName: "W.D. Ark.", aliases: ["WDAR"] },
  { id: "us-d-ia-nd", state: "IA", circuit: "8", name: "Northern District of Iowa", shortName: "N.D. Iowa", aliases: ["NDIA"] },
  { id: "us-d-ia-sd", state: "IA", circuit: "8", name: "Southern District of Iowa", shortName: "S.D. Iowa", aliases: ["SDIA"] },
  { id: "us-d-mn", state: "MN", circuit: "8", name: "District of Minnesota", shortName: "D. Minn.", aliases: ["DMN"] },
  { id: "us-d-mo-ed", state: "MO", circuit: "8", name: "Eastern District of Missouri", shortName: "E.D. Mo.", aliases: ["EDMO"] },
  { id: "us-d-mo-wd", state: "MO", circuit: "8", name: "Western District of Missouri", shortName: "W.D. Mo.", aliases: ["WDMO"] },
  { id: "us-d-ne", state: "NE", circuit: "8", name: "District of Nebraska", shortName: "D. Neb.", aliases: ["DNE"] },
  { id: "us-d-nd", state: "ND", circuit: "8", name: "District of North Dakota", shortName: "D.N.D.", aliases: ["DND"] },
  { id: "us-d-sd", state: "SD", circuit: "8", name: "District of South Dakota", shortName: "D.S.D.", aliases: ["DSD"] },
  { id: "us-d-ak", state: "AK", circuit: "9", name: "District of Alaska", shortName: "D. Alaska", aliases: ["DAK"] },
  { id: "us-d-az", state: "AZ", circuit: "9", name: "District of Arizona", shortName: "D. Ariz.", aliases: ["DAZ"] },
  { id: "us-d-ca-cd", state: "CA", circuit: "9", name: "Central District of California", shortName: "C.D. Cal.", aliases: ["CDCA"] },
  { id: "us-d-ca-ed", state: "CA", circuit: "9", name: "Eastern District of California", shortName: "E.D. Cal.", aliases: ["EDCA"] },
  { id: "us-d-ca-nd", state: "CA", circuit: "9", name: "Northern District of California", shortName: "N.D. Cal.", aliases: ["NDCA"] },
  { id: "us-d-ca-sd", state: "CA", circuit: "9", name: "Southern District of California", shortName: "S.D. Cal.", aliases: ["SDCA"] },
  { id: "us-d-hi", state: "HI", circuit: "9", name: "District of Hawaii", shortName: "D. Haw.", aliases: ["DHI"] },
  { id: "us-d-id", state: "ID", circuit: "9", name: "District of Idaho", shortName: "D. Idaho", aliases: ["DID"] },
  { id: "us-d-mt", state: "MT", circuit: "9", name: "District of Montana", shortName: "D. Mont.", aliases: ["DMT"] },
  { id: "us-d-nv", state: "NV", circuit: "9", name: "District of Nevada", shortName: "D. Nev.", aliases: ["DNV"] },
  { id: "us-d-or", state: "OR", circuit: "9", name: "District of Oregon", shortName: "D. Or.", aliases: ["DOR"] },
  { id: "us-d-wa-ed", state: "WA", circuit: "9", name: "Eastern District of Washington", shortName: "E.D. Wash.", aliases: ["EDWA"] },
  { id: "us-d-wa-wd", state: "WA", circuit: "9", name: "Western District of Washington", shortName: "W.D. Wash.", aliases: ["WDWA"] },
  { id: "us-d-gu", state: null, circuit: "9", name: "District of Guam", shortName: "D. Guam", aliases: ["DGU"] },
  { id: "us-d-mp", state: null, circuit: "9", name: "District of the Northern Mariana Islands", shortName: "D.N. Mar. I.", aliases: ["DMP", "DNMI"] },
  { id: "us-d-co", state: "CO", circuit: "10", name: "District of Colorado", shortName: "D. Colo.", aliases: ["DCO"] },
  { id: "us-d-ks", state: "KS", circuit: "10", name: "District of Kansas", shortName: "D. Kan.", aliases: ["DKS"] },
  { id: "us-d-nm", state: "NM", circuit: "10", name: "District of New Mexico", shortName: "D.N.M.", aliases: ["DNM"] },
  { id: "us-d-ok-ed", state: "OK", circuit: "10", name: "Eastern District of Oklahoma", shortName: "E.D. Okla.", aliases: ["EDOK"] },
  { id: "us-d-ok-nd", state: "OK", circuit: "10", name: "Northern District of Oklahoma", shortName: "N.D. Okla.", aliases: ["NDOK"] },
  { id: "us-d-ok-wd", state: "OK", circuit: "10", name: "Western District of Oklahoma", shortName: "W.D. Okla.", aliases: ["WDOK"] },
  { id: "us-d-ut", state: "UT", circuit: "10", name: "District of Utah", shortName: "D. Utah", aliases: ["DUT"] },
  { id: "us-d-wy", state: "WY", circuit: "10", name: "District of Wyoming", shortName: "D. Wyo.", aliases: ["DWY"] },
  { id: "us-d-al-md", state: "AL", circuit: "11", name: "Middle District of Alabama", shortName: "M.D. Ala.", aliases: ["MDAL"] },
  { id: "us-d-al-nd", state: "AL", circuit: "11", name: "Northern District of Alabama", shortName: "N.D. Ala.", aliases: ["NDAL"] },
  { id: "us-d-al-sd", state: "AL", circuit: "11", name: "Southern District of Alabama", shortName: "S.D. Ala.", aliases: ["SDAL"] },
  { id: "us-d-fl-md", state: "FL", circuit: "11", name: "Middle District of Florida", shortName: "M.D. Fla.", aliases: ["MDFL"] },
  { id: "us-d-fl-nd", state: "FL", circuit: "11", name: "Northern District of Florida", shortName: "N.D. Fla.", aliases: ["NDFL"] },
  { id: "us-d-fl-sd", state: "FL", circuit: "11", name: "Southern District of Florida", shortName: "S.D. Fla.", aliases: ["SDFL"] },
  { id: "us-d-ga-md", state: "GA", circuit: "11", name: "Middle District of Georgia", shortName: "M.D. Ga.", aliases: ["MDGA"] },
  { id: "us-d-ga-nd", state: "GA", circuit: "11", name: "Northern District of Georgia", shortName: "N.D. Ga.", aliases: ["NDGA"] },
  { id: "us-d-ga-sd", state: "GA", circuit: "11", name: "Southern District of Georgia", shortName: "S.D. Ga.", aliases: ["SDGA"] },
  { id: "us-d-dc", state: "DC", circuit: "dc", name: "District of Columbia", shortName: "D.D.C.", aliases: ["DDC"] },
];

function court(
  id: string,
  name: string,
  shortName: string,
  level: CourtLevel,
  state: string | null,
  circuit: string | null,
  aliases: string[],
): CourtRecord {
  return {
    id,
    name,
    shortName,
    jurisdictionType: "federal",
    state,
    level,
    federalCircuit: circuit,
    active: true,
    aliases: [...new Set([name, shortName, ...aliases, `U.S. District Court for the ${name}`, `United States District Court for the ${name}`])],
  };
}

export const FEDERAL_COURTS: CourtRecord[] = [
  {
    id: "us-scotus",
    name: "Supreme Court of the United States",
    shortName: "U.S.",
    jurisdictionType: "federal",
    state: null,
    level: "scotus",
    federalCircuit: null,
    active: true,
    aliases: ["SCOTUS", "U.S. Supreme Court", "Supreme Court of the United States", "United States Supreme Court"],
  },
  ...FEDERAL_CIRCUITS.map((circuit) => ({
    id: `us-ca-${circuit.id}`,
    name: circuit.name,
    shortName: circuit.shortName,
    jurisdictionType: "federal" as const,
    state: null,
    level: "circuit" as const,
    federalCircuit: circuit.id,
    active: true,
    aliases: [...circuit.aliases, circuit.name, circuit.shortName],
  })),
  ...DISTRICTS.map((district) =>
    court(district.id, district.name, district.shortName, "district", district.state, district.circuit, [
      ...(district.aliases ?? []),
    ]),
  ),
];

export function circuitShortName(circuitId: string | null | undefined): string | null {
  if (!circuitId) return null;
  return FEDERAL_CIRCUITS.find((circuit) => circuit.id === circuitId)?.shortName ?? null;
}
