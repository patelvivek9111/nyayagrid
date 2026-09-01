import { US_STATES } from "./states";
import type { CourtRecord } from "./types";

const HIGH_COURT_NAME: Record<string, string> = {
  ME: "Maine Supreme Judicial Court",
  MA: "Massachusetts Supreme Judicial Court",
  MD: "Supreme Court of Maryland",
  NY: "New York Court of Appeals",
  WV: "Supreme Court of Appeals of West Virginia",
  DC: "District of Columbia Court of Appeals",
};

const HIGH_ALIASES: Record<string, string[]> = {
  NY: ["N.Y. Court of Appeals", "New York Court of Appeals"],
  MD: ["Maryland Supreme Court", "Court of Appeals of Maryland"],
  DC: ["D.C. Court of Appeals"],
};

function highCourtName(code: string, stateName: string): string {
  return HIGH_COURT_NAME[code] ?? `${stateName} Supreme Court`;
}

/**
 * Architecture for state courts: last-resort, one intermediate bucket, and a general trial bucket.
 * County and local courts are not enumerated in Phase 6S.
 */
export const STATE_COURTS: CourtRecord[] = US_STATES.flatMap((state) => {
  const highName = highCourtName(state.code, state.name);
  const high: CourtRecord = {
    id: `st-${state.code.toLowerCase()}-high`,
    name: highName,
    shortName: `${state.code} high`,
    jurisdictionType: "state",
    state: state.code,
    level: "state_high",
    federalCircuit: null,
    active: true,
    aliases: [highName, `${state.name} Supreme Court`, ...(HIGH_ALIASES[state.code] ?? [])],
  };
  const appellate: CourtRecord = {
    id: `st-${state.code.toLowerCase()}-app`,
    name: `${state.name} intermediate appellate courts`,
    shortName: `${state.code} app.`,
    jurisdictionType: "state",
    state: state.code,
    level: "state_appellate",
    federalCircuit: null,
    active: true,
    aliases: [
      `${state.name} Court of Appeals`,
      `${state.name} Superior Court, Appellate Division`,
    ],
  };
  const trial: CourtRecord = {
    id: `st-${state.code.toLowerCase()}-trial`,
    name: `${state.name} trial courts of general jurisdiction`,
    shortName: `${state.code} trial`,
    jurisdictionType: "state",
    state: state.code,
    level: "state_trial",
    federalCircuit: null,
    active: true,
    aliases: [`${state.name} trial court`, `${state.name} Superior Court`, `${state.name} Circuit Court`],
  };
  return [high, appellate, trial];
});

const EXTRA_STATE_COURTS: CourtRecord[] = [
  {
    id: "st-ny-trial",
    name: "New York Supreme Court (trial)",
    shortName: "N.Y. Sup. Ct.",
    jurisdictionType: "state",
    state: "NY",
    level: "state_trial",
    federalCircuit: null,
    active: true,
    aliases: ["New York Supreme Court", "N.Y. Supreme Court"],
  },
  {
    id: "st-tx-crim-high",
    name: "Texas Court of Criminal Appeals",
    shortName: "Tex. Crim. App.",
    jurisdictionType: "state",
    state: "TX",
    level: "state_high",
    federalCircuit: null,
    active: true,
    aliases: ["Texas Court of Criminal Appeals"],
  },
  {
    id: "st-ok-crim-high",
    name: "Oklahoma Court of Criminal Appeals",
    shortName: "Okla. Crim. App.",
    jurisdictionType: "state",
    state: "OK",
    level: "state_high",
    federalCircuit: null,
    active: true,
    aliases: ["Oklahoma Court of Criminal Appeals"],
  },
  {
    id: "st-pa-super",
    name: "Superior Court of Pennsylvania",
    shortName: "Pa. Super.",
    jurisdictionType: "state",
    state: "PA",
    level: "state_appellate",
    federalCircuit: null,
    active: true,
    aliases: ["Pennsylvania Superior Court", "Pa. Super."],
  },
];

export const ALL_STATE_COURTS: CourtRecord[] = [...STATE_COURTS, ...EXTRA_STATE_COURTS];
