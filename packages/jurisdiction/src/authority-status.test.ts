import { describe, expect, it } from "vitest";
import { evaluateAuthorityStatus, relateCourts, superiorCourtId } from "./index";

describe("court hierarchy", () => {
  it("places EDPA under the Third Circuit and the Third Circuit under SCOTUS", () => {
    expect(superiorCourtId("us-d-pa-ed")).toBe("us-ca-3");
    expect(superiorCourtId("us-ca-3")).toBe("us-scotus");
    expect(superiorCourtId("st-pa-trial")).toBe("st-pa-app");
    expect(superiorCourtId("st-nj-app")).toBe("st-nj-high");
  });

  it("treats the Third Circuit as superior to EDPA and the Second Circuit as parallel", () => {
    const same = relateCourts({ forumCourtId: "us-d-pa-ed", authorityCourtId: "us-ca-3" });
    expect(same.courtRelationship).toBe("SUPERIOR");
    expect(same.sameJurisdiction).toBe(true);
    const sister = relateCourts({ forumCourtId: "us-d-pa-ed", authorityCourtId: "us-ca-2" });
    expect(sister.courtRelationship).toBe("PARALLEL");
    expect(sister.parallelJurisdiction).toBe(true);
    const foreign = relateCourts({ forumCourtId: "st-pa-trial", authorityCourtId: "st-nj-high" });
    expect(foreign.foreignJurisdiction).toBe(true);
  });
});

describe("authority status matrix", () => {
  it("SCOTUS binds a federal constitutional question", () => {
    const status = evaluateAuthorityStatus({
      questionJurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      issueType: "FEDERAL_CONSTITUTIONAL",
      authorityCourtId: "us-scotus",
    });
    expect(status.classification).toBe("BINDING");
    expect(status.reasonCode).toBe("SCOTUS_FEDERAL_QUESTION");
    expect(status.abstention).toBeNull();
    expect(status.confidence).toBe("high");
  });

  it("Third Circuit binds EDPA and DNJ on a federal question", () => {
    for (const forumCourtId of ["us-d-pa-ed", "us-d-nj"]) {
      const status = evaluateAuthorityStatus({
        questionJurisdiction: "US",
        forumCourtId,
        issueType: "FEDERAL_STATUTORY",
        authorityCourtId: "us-ca-3",
      });
      expect(status.classification).toBe("BINDING");
      expect(status.reasonCode).toBe("CIRCUIT_TERRITORIAL_BINDING");
    }
  });

  it("Second Circuit is persuasive in EDPA", () => {
    const status = evaluateAuthorityStatus({
      questionJurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      issueType: "FEDERAL_STATUTORY",
      authorityCourtId: "us-ca-2",
    });
    expect(status.classification).toBe("PERSUASIVE");
    expect(status.reasonCode).toBe("SISTER_CIRCUIT");
  });

  it("EDPA does not bind EDPA or DNJ", () => {
    const same = evaluateAuthorityStatus({
      questionJurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      issueType: "FEDERAL_STATUTORY",
      authorityCourtId: "us-d-pa-ed",
    });
    expect(same.classification).toBe("PERSUASIVE");
    expect(same.reasonCode).toBe("SAME_DISTRICT_NOT_PRECEDENT");
    const sister = evaluateAuthorityStatus({
      questionJurisdiction: "US",
      forumCourtId: "us-d-nj",
      issueType: "FEDERAL_STATUTORY",
      authorityCourtId: "us-d-pa-ed",
    });
    expect(sister.classification).toBe("PERSUASIVE");
    expect(sister.reasonCode).toBe("SISTER_DISTRICT");
  });

  it("Pennsylvania high and intermediate courts control a PA state-law issue in a PA trial court", () => {
    const high = evaluateAuthorityStatus({
      questionJurisdiction: "PA",
      forumCourtId: "st-pa-trial",
      issueType: "STATE_LAW",
      authorityCourtId: "st-pa-high",
    });
    expect(high.classification).toBe("BINDING");
    expect(high.reasonCode).toBe("STATE_HIGH_COURT");
    const superior = evaluateAuthorityStatus({
      questionJurisdiction: "PA",
      forumCourtId: "st-pa-trial",
      issueType: "STATE_LAW",
      authorityCourtId: "st-pa-super",
    });
    expect(superior.classification).toBe("BINDING");
    expect(superior.reasonCode).toBe("INTERMEDIATE_BINDS_TRIAL");
  });

  it("New Jersey Supreme Court is outside a Pennsylvania state-law issue", () => {
    const status = evaluateAuthorityStatus({
      questionJurisdiction: "PA",
      forumCourtId: "st-pa-trial",
      issueType: "STATE_LAW",
      authorityCourtId: "st-nj-high",
    });
    expect(status.classification).toBe("OUT_OF_JURISDICTION");
    expect(status.reasonCode).toBe("SISTER_STATE");
  });

  it("a federal district applying state law follows the state high court, not its circuit", () => {
    const stateHigh = evaluateAuthorityStatus({
      questionJurisdiction: "PA",
      forumCourtId: "us-d-pa-ed",
      issueType: "STATE_LAW",
      authorityCourtId: "st-pa-high",
    });
    expect(stateHigh.classification).toBe("BINDING");
    expect(stateHigh.reasonCode).toBe("ERIE_STATE_HIGH_COURT");
    const circuit = evaluateAuthorityStatus({
      questionJurisdiction: "PA",
      forumCourtId: "us-d-pa-ed",
      issueType: "STATE_LAW",
      authorityCourtId: "us-ca-3",
    });
    expect(circuit.classification).toBe("NONCONTROLLING");
    expect(circuit.reasonCode).toBe("ERIE_FEDERAL_PREDICTION_NOT_STATE_LAW");
    const scotus = evaluateAuthorityStatus({
      questionJurisdiction: "PA",
      forumCourtId: "us-d-pa-ed",
      issueType: "STATE_LAW",
      authorityCourtId: "us-scotus",
    });
    expect(scotus.classification).toBe("NONCONTROLLING");
    expect(scotus.reasonCode).toBe("SCOTUS_DOES_NOT_CONTROL_STATE_LAW");
  });

  it("abstains when jurisdiction or court metadata is missing", () => {
    const jurisdiction = evaluateAuthorityStatus({
      forumCourtId: "us-d-pa-ed",
      issueType: "FEDERAL_STATUTORY",
      authorityCourtId: "us-ca-3",
    });
    expect(jurisdiction.classification).toBe("UNKNOWN");
    expect(jurisdiction.abstention).toBe("JURISDICTION_UNKNOWN");
    const court = evaluateAuthorityStatus({
      questionJurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      issueType: "FEDERAL_STATUTORY",
    });
    expect(court.classification).toBe("UNKNOWN");
    expect(court.reasonCode).toBe("MISSING_COURT_METADATA");
    expect(court.abstention).toBe("INSUFFICIENT_AUTHORITY");
  });

  it("does not hardcode Pennsylvania: Ninth Circuit binds Nevada and not EDPA", () => {
    const home = evaluateAuthorityStatus({
      questionJurisdiction: "US",
      forumCourtId: "us-d-nv",
      issueType: "FEDERAL_CONSTITUTIONAL",
      authorityCourtId: "us-ca-9",
    });
    expect(home.classification).toBe("BINDING");
    const away = evaluateAuthorityStatus({
      questionJurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      issueType: "FEDERAL_CONSTITUTIONAL",
      authorityCourtId: "us-ca-9",
    });
    expect(away.classification).toBe("PERSUASIVE");
  });

  it("respects appellate districts and split criminal high courts", () => {
    const outside = evaluateAuthorityStatus({
      questionJurisdiction: "CA",
      forumCourtId: "st-ca-trial",
      issueType: "STATE_LAW",
      authorityCourtId: "st-ca-app",
      forumAppellateDistrictId: "1",
      authorityAppellateDistrictId: "4",
    });
    expect(outside.classification).toBe("NONCONTROLLING");
    expect(outside.reasonCode).toBe("INTERMEDIATE_OUTSIDE_DISTRICT");

    const missingSubject = evaluateAuthorityStatus({
      questionJurisdiction: "TX",
      forumCourtId: "st-tx-trial",
      issueType: "STATE_LAW",
      authorityCourtId: "st-tx-crim-high",
    });
    expect(missingSubject.classification).toBe("UNKNOWN");
    expect(missingSubject.abstention).toBe("INSUFFICIENT_CONTEXT");

    const criminal = evaluateAuthorityStatus({
      questionJurisdiction: "TX",
      forumCourtId: "st-tx-trial",
      issueType: "STATE_LAW",
      subjectMatter: "criminal",
      authorityCourtId: "st-tx-crim-high",
    });
    expect(criminal.classification).toBe("BINDING");
    expect(criminal.reasonCode).toBe("STATE_CRIMINAL_HIGH_COURT");
  });

  it("does not treat the Federal Circuit as the territorial court for EDPA", () => {
    const status = evaluateAuthorityStatus({
      questionJurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      issueType: "FEDERAL_STATUTORY",
      authorityCourtId: "us-ca-fed",
    });
    expect(status.classification).toBe("PERSUASIVE");
    expect(status.reasonCode).toBe("SPECIALIZED_COURT_NOT_TERRITORIAL");
    expect(status.authorityLevel).toBe("SPECIALIZED_FEDERAL");
  });

  it("keeps an explanation payload for every classification", () => {
    const status = evaluateAuthorityStatus({
      questionJurisdiction: "US",
      forumCourtId: "us-d-pa-ed",
      issueType: "FEDERAL_CONSTITUTIONAL",
      authorityCourtId: "us-scotus",
      currentness: "current",
      sourceMetadata: { provider: "synthetic" },
    });
    expect(status.courtRelationship).toBe("SUPERIOR");
    expect(status.currentnessConsideration.length).toBeGreaterThan(0);
    expect(status.sourceMetadata.provider).toBe("synthetic");
  });
});
