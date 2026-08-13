import { describe, expect, it } from "vitest";
import { DevAuthProvider } from "./index";

describe("DevAuthProvider", () => {
  it("returns configured identity by default", async () => {
    const provider = new DevAuthProvider({
      userId: "dev_user_owner",
      email: "owner@example.nyayagrid.local",
      name: "Dev Owner",
    });
    const identity = await provider.getIdentity(new Headers());
    expect(identity?.subject).toBe("dev_user_owner");
  });

  it("supports anonymous override for tests", async () => {
    const provider = new DevAuthProvider({
      userId: "dev_user_owner",
      email: "owner@example.nyayagrid.local",
      name: "Dev Owner",
    });
    const identity = await provider.getIdentity(
      new Headers({ "x-nyayagrid-dev-user": "anonymous" }),
    );
    expect(identity).toBeNull();
  });
});
