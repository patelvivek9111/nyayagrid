import { describe, expect, it } from "vitest";
import { documents } from "./schema/index";
import {
  CLIENT_CONTACT_RELATIONSHIP_ROLES,
  clientContacts,
  contacts,
  documentFolders,
} from "./schema/phase18";

describe("PROF-CONTACT-01 / PROF-FOLDER-01 schema contract", () => {
  it("exports organization-scoped contacts distinct from clients", () => {
    expect(contacts).toBeTruthy();
    expect(contacts.organizationId).toBeTruthy();
    expect(contacts.displayName).toBeTruthy();
    expect(contacts.email).toBeTruthy();
    expect(contacts.phone).toBeTruthy();
    expect(contacts.title).toBeTruthy();
    expect(contacts.notes).toBeTruthy();
    expect(contacts.createdByUserId).toBeTruthy();
    expect(clientContacts.clientId).toBeTruthy();
    expect(clientContacts.contactId).toBeTruthy();
    expect(clientContacts.relationshipRole).toBeTruthy();
    expect(CLIENT_CONTACT_RELATIONSHIP_ROLES).toContain("primary");
    expect(CLIENT_CONTACT_RELATIONSHIP_ROLES).toContain("opposing_counsel");
  });

  it("exports matter-scoped document folders and documents.folderId", () => {
    expect(documentFolders).toBeTruthy();
    expect(documentFolders.matterId).toBeTruthy();
    expect(documentFolders.parentFolderId).toBeTruthy();
    expect(documentFolders.name).toBeTruthy();
    expect(documents.folderId).toBeTruthy();
  });
});
