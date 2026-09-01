import { describe, expect, it } from "vitest";
import {
  caseAskHref,
  continueHref,
  genericAskRedirect,
  isClientGuestRole,
  shouldSkipFirmCreation,
  slugFromFirmName,
} from "./first-run";

describe("first-run routing", () => {
  it("A. new user with no org goes to firm creation", () => {
    expect(shouldSkipFirmCreation(0)).toBe(false);
    expect(
      continueHref({
        organizationCount: 0,
        caseCount: 0,
        canCreateMatter: true,
        roleKey: null,
      }),
    ).toBe("/app/onboarding");
  });

  it("B. successful firm (org exists, zero Cases) continues to Case creation", () => {
    expect(
      continueHref({
        organizationCount: 1,
        caseCount: 0,
        canCreateMatter: true,
        roleKey: "owner",
      }),
    ).toBe("/app/cases/new");
  });

  it("C. org exists + zero Cases + cannot create → Cases list, not a dead end", () => {
    expect(
      continueHref({
        organizationCount: 1,
        caseCount: 0,
        canCreateMatter: false,
        roleKey: "staff",
      }),
    ).toBe("/app/cases");
  });

  it("D. org exists + Cases → Cases list, no forced Case creation", () => {
    expect(
      continueHref({
        organizationCount: 1,
        caseCount: 3,
        canCreateMatter: true,
        roleKey: "lawyer",
      }),
    ).toBe("/app/cases");
  });

  it("E. invited user skips firm creation", () => {
    expect(shouldSkipFirmCreation(1)).toBe(true);
  });

  it("guest is sent to the portal, not professional onboarding", () => {
    expect(isClientGuestRole("client_guest")).toBe(true);
    expect(
      continueHref({
        organizationCount: 1,
        caseCount: 2,
        canCreateMatter: false,
        roleKey: "client_guest",
      }),
    ).toBe("/portal");
    expect(
      genericAskRedirect({
        organizationCount: 1,
        caseCount: 0,
        roleKey: "client_guest",
      }),
    ).toBe("/portal");
  });

  it("generic Ask is redirected before a Case exists", () => {
    expect(
      genericAskRedirect({
        organizationCount: 0,
        caseCount: 0,
        roleKey: null,
      }),
    ).toBe("/app/onboarding");
    expect(
      genericAskRedirect({
        organizationCount: 1,
        caseCount: 0,
        roleKey: "owner",
      }),
    ).toBe("/app/cases");
    expect(
      genericAskRedirect({
        organizationCount: 1,
        caseCount: 2,
        roleKey: "lawyer",
      }),
    ).toBeNull();
  });

  it("Case Ask href stays matter-scoped", () => {
    expect(caseAskHref("matter-1")).toBe("/app/cases/matter-1/chats");
  });

  it("slug helper does not invent sample firm names", () => {
    expect(slugFromFirmName("Patel Law")).toBe("patel-law");
    expect(slugFromFirmName("")).toBe("firm");
  });
});
