import { describe, expect, it } from "vitest";
import {
  assertSameOrganization,
  assertStorageKeyBelongsToOrganization,
  AuthorizationError,
  storageKeyForOrganization,
} from "./index";

describe("organization isolation helpers", () => {
  it("rejects cross-organization access", async () => {
    await expect(assertSameOrganization("org_a", "org_b")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("builds tenant-scoped storage keys", () => {
    const key = storageKeyForOrganization({
      organizationId: "org_1",
      documentId: "doc_1",
      versionId: "ver_1",
      filename: "Contract.pdf",
    });
    expect(key).toBe("org/org_1/documents/doc_1/versions/ver_1/Contract.pdf");
    expect(() => assertStorageKeyBelongsToOrganization(key, "org_1")).not.toThrow();
    expect(() => assertStorageKeyBelongsToOrganization(key, "org_2")).toThrow(AuthorizationError);
    const traversed = storageKeyForOrganization({
      organizationId: "org_1",
      documentId: "doc_1",
      versionId: "ver_1",
      filename: "../evil/payload.txt",
    });
    expect(traversed.split("/").includes("..")).toBe(false);
    expect(traversed).toBe("org/org_1/documents/doc_1/versions/ver_1/.._evil_payload.txt");
  });
});
