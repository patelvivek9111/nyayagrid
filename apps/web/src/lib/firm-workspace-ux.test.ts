import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  billingSummary,
  calendarKindLabel,
  calendarTrustLabel,
  clientTypeLabel,
  countMattersForClient,
  filterCalendarEvents,
  filterClients,
  filterInbox,
  formatDurationMinutes,
  holdScopeLabel,
  holdStatusLabel,
  inboxBucket,
  inviteStatusLabel,
  researchSessionKindLabel,
  authorityRelationshipLabel,
  roleLabel,
  timeSourceLabel,
  timeStatusLabel,
  timeSummary,
} from "./firm-workspace-ux";

const webRoot = resolve(__dirname, "../..");

describe("firm workspace presentation helpers", () => {
  it("labels clients without raw enums", () => {
    expect(clientTypeLabel("individual")).toBe("Individual");
    expect(clientTypeLabel("organization")).toBe("Organization");
  });

  it("filters clients by type and query", () => {
    const rows = [
      {
        id: "1",
        displayName: "Acme Co",
        clientType: "organization",
        email: null,
        status: "active",
      },
      {
        id: "2",
        displayName: "Jane Doe",
        clientType: "individual",
        email: "j@x.com",
        status: "active",
      },
    ];
    expect(filterClients(rows, { typeFilter: "organizations" })).toHaveLength(1);
    expect(filterClients(rows, { query: "jane" })[0]?.id).toBe("2");
  });

  it("counts linked cases without inventing data", () => {
    expect(
      countMattersForClient(
        [{ clientId: "1", clientDisplayName: "Acme Co" }, { clientDisplayName: "Acme Co" }],
        { id: "1", displayName: "Acme Co" },
      ),
    ).toBe(2);
  });

  it("formats calendar trust and filters", () => {
    expect(calendarKindLabel("deadline")).toBe("Deadline");
    expect(calendarTrustLabel("verified_deadline", "deadline")).toBe("Verified");
    const events = [
      {
        id: "a",
        kind: "deadline" as const,
        title: "Notice",
        dueAt: "2026-03-28T12:00:00.000Z",
        timezone: "America/New_York",
        matterId: "m",
        matterTitle: "Lease",
        source: "verified_deadline",
      },
      {
        id: "b",
        kind: "task" as const,
        title: "Follow up",
        dueAt: "2026-04-04T12:00:00.000Z",
        timezone: null,
        matterId: "m",
        matterTitle: "Lease",
        source: "task",
      },
    ];
    expect(filterCalendarEvents(events, "tasks")).toHaveLength(1);
  });

  it("formats time and invoice summaries", () => {
    expect(formatDurationMinutes(36)).toBe("0h 36m");
    expect(timeStatusLabel("suggested")).toBe("Suggested");
    expect(timeSourceLabel("manual")).toBe("Entered by you");
    expect(
      timeSummary([
        { minutes: 36, status: "posted" },
        { minutes: 12, status: "suggested" },
      ]),
    ).toEqual({ unpostedMinutes: 12, postedMinutes: 36, unpostedCount: 1, postedCount: 1 });
    expect(billingSummary([{ status: "draft" }, { status: "issued" }])).toEqual({
      draftCount: 1,
      issuedCount: 1,
    });
  });

  it("splits inbox pending vs filed and ignores discarded", () => {
    expect(inboxBucket("pending")).toBe("pending");
    expect(inboxBucket("filed")).toBe("filed");
    expect(inboxBucket("discarded")).toBe("other");
    expect(
      filterInbox(
        [
          {
            id: "1",
            fromAddress: "a@b.com",
            subject: "Hi",
            body: "x",
            status: "pending",
            documentId: null,
          },
          {
            id: "2",
            fromAddress: "a@b.com",
            subject: "Filed",
            body: "x",
            status: "filed",
            documentId: "d",
          },
        ],
        "pending",
      ),
    ).toHaveLength(1);
  });

  it("uses lawyer-facing access and hold labels", () => {
    expect(roleLabel("client_guest")).toBe("Client guest");
    expect(inviteStatusLabel({ acceptedAt: null, revokedAt: null })).toBe("Pending");
    expect(holdStatusLabel(null)).toBe("Active");
    expect(holdScopeLabel(null)).toBe("Whole organization");
    expect(researchSessionKindLabel("m1")).toBe("Linked to case");
    expect(researchSessionKindLabel(null)).toBe("Firm research");
    expect(authorityRelationshipLabel("controlling")).toBe("Controlling");
    expect(authorityRelationshipLabel("out_of_jurisdiction")).toBe("Other jurisdiction");
  });
});

describe("firm workspace pages stay presentation-only", () => {
  function src(rel: string) {
    return readFileSync(resolve(webRoot, rel), "utf8");
  }

  it("keeps org-scoped fetches and dialogs for create flows", () => {
    const clients = src("src/app/app/clients/page.tsx");
    const calendar = src("src/app/app/calendar/page.tsx");
    const time = src("src/app/app/time/page.tsx");
    const billing = src("src/app/app/billing/page.tsx");
    const inbox = src("src/app/app/inbox/page.tsx");
    const research = src("src/app/app/research/page.tsx");
    const settings = src("src/app/app/settings/page.tsx");
    const holds = src("src/app/app/compliance/page.tsx");

    expect(clients).toContain("`/api/v1/clients?organizationId=${orgId}`");
    expect(clients).toContain("+ New client");
    expect(clients).not.toContain("shouldShowWorkspaceSwitcher");
    expect(calendar).toContain("`/api/v1/calendar?organizationId=${organizationId}`");
    expect(calendar).toContain("No upcoming dated work.");
    expect(time).toContain("`/api/v1/time-entries?organizationId=${orgId}`");
    expect(time).toContain("+ Add time entry");
    expect(time).toContain("/api/v1/time-entries/suggest");
    expect(billing).toContain("`/api/v1/invoices?organizationId=${orgId}`");
    expect(billing).toContain("does not collect payment");
    expect(billing).toContain("not trust accounting");
    expect(inbox).toContain("`/api/v1/inbox?organizationId=${orgId}`");
    expect(inbox).toContain("+ Capture email");
    expect(inbox).toContain("does not send mail");
    expect(inbox).toContain("/file");
    expect(research).toContain("/query?organizationId=");
    expect(research).toContain("not a comprehensive survey");
    expect(research).not.toContain("shouldShowWorkspaceSwitcher");
    expect(settings).toContain("`/api/v1/organizations/${orgId}/members`");
    expect(settings).toContain("Assign to case");
    expect(settings).toContain('access: "read"');
    expect(holds).toContain("`/api/v1/organizations/${orgId}/compliance`");
    expect(holds).toContain("+ Place legal hold");
    expect(holds).toContain("does not enable");
  });

  it("does not change Agents gating", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
    expect(ask).toContain('assertFeatureEnabled("agents")');
  });
});
