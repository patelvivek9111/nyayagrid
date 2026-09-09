import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  clerkHandshakeResponse,
  config,
  runProfessionalMiddleware,
  type ClerkBrowserAuth,
} from "./middleware";

const middlewareSource = readFileSync(resolve(__dirname, "middleware.ts"), "utf8");
const clerkSessionSource = readFileSync(resolve(__dirname, "lib/clerk-session.ts"), "utf8");
const flyStaging = readFileSync(resolve(__dirname, "../../../fly.staging.toml"), "utf8");

function request(path: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(new URL(path, "https://staging.nyayagrid.com"), { headers });
}

function clerkAuth(
  status: ClerkBrowserAuth["status"],
  headers: Headers = new Headers(),
): ClerkBrowserAuth {
  return { status, headers };
}

describe("professional middleware", () => {
  it("A. AUTH_PROVIDER=dev is unchanged and never calls Clerk", async () => {
    const authenticate = vi.fn(async () => {
      throw new Error("Clerk must not run in DevAuth");
    });
    const response = await runProfessionalMiddleware(request("/app"), {
      authProvider: "dev",
      authenticate,
    });
    expect(authenticate).not.toHaveBeenCalled();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.status).not.toBe(307);
  });

  it("B. Clerk signed-out request uses the existing sign-in redirect", async () => {
    const response = await runProfessionalMiddleware(request("/app/cases/abc"), {
      authProvider: "clerk",
      authenticate: async () => clerkAuth("signed-out"),
    });
    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBe(
      "https://staging.nyayagrid.com/sign-in?returnTo=%2Fapp%2Fcases%2Fabc&reason=session",
    );
    expect(location).not.toMatch(/__clerk|__session=/);
  });

  it("C. Clerk valid signed-in request is allowed", async () => {
    const response = await runProfessionalMiddleware(request("/app"), {
      authProvider: "clerk",
      authenticate: async () => clerkAuth("signed-in"),
    });
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("D. Clerk handshake response is returned unchanged", async () => {
    const headers = new Headers();
    headers.set("Location", "https://clerk.staging.nyayagrid.com/v1/client/handshake");
    headers.append(
      "Set-Cookie",
      "__session=handshake-token; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    const clerk = clerkAuth("handshake", headers);
    const response = await runProfessionalMiddleware(
      request("/app?__clerk_handshake=SHOULD_NOT_APPEAR_IN_RETURN"),
      { authProvider: "clerk", authenticate: async () => clerk },
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://clerk.staging.nyayagrid.com/v1/client/handshake",
    );
    expect(response.headers.get("location")).not.toContain("/sign-in");
  });

  it("E. Set-Cookie from handshake is preserved", () => {
    const headers = new Headers();
    headers.set("Location", "https://clerk.staging.nyayagrid.com/v1/client/handshake");
    headers.append(
      "Set-Cookie",
      "__session=example; Domain=.staging.nyayagrid.com; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    headers.append("Set-Cookie", "__client_uat=1; Path=/; Secure; SameSite=Lax");
    const response = clerkHandshakeResponse(headers);
    const cookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")];
    expect(cookies.some((cookie) => cookie?.startsWith("__session="))).toBe(true);
    expect(cookies.some((cookie) => cookie?.startsWith("__client_uat="))).toBe(true);
    expect(cookies.join("\n")).not.toContain("/sign-in");
  });

  it("F. Location from handshake is preserved", () => {
    const location = "https://clerk.staging.nyayagrid.com/v1/client/handshake?redirect_url=/app";
    const headers = new Headers();
    headers.set("Location", location);
    const response = clerkHandshakeResponse(headers);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(location);
    expect(response.headers.get("location")).not.toContain("/sign-in");
  });

  it("G. __client_uat alone does not authenticate", async () => {
    const response = await runProfessionalMiddleware(
      request("/app", { cookie: "__client_uat=1710000000; __client_uat_abc=1710000000" }),
      {
        authProvider: "clerk",
        authenticate: async () => clerkAuth("signed-out"),
      },
    );
    expect(response.headers.get("x-middleware-next")).not.toBe("1");
    expect(response.headers.get("location")).toContain("/sign-in");
    expect(middlewareSource).not.toContain("__client_uat");
  });

  it("H. forged __session does not authenticate", async () => {
    const response = await runProfessionalMiddleware(
      request("/app", { cookie: "__session=forged.not-a-clerk-jwt" }),
      {
        authProvider: "clerk",
        authenticate: async () => clerkAuth("signed-out"),
      },
    );
    expect(response.headers.get("x-middleware-next")).not.toBe("1");
    expect(response.headers.get("location")).toContain("/sign-in?returnTo=%2Fapp&reason=session");
    expect(middlewareSource).not.toContain("clerkSessionPresent");
    expect(middlewareSource).toContain("authenticateRequest");
  });

  it("I. API Bearer behavior is not a middleware cookie requirement", () => {
    expect(config.matcher).toEqual(["/app/:path*", "/app"]);
    expect(config.matcher.join(" ")).not.toContain("/api");
    expect(clerkSessionSource).toContain("authenticateRequest");
    expect(clerkSessionSource).toContain("bearer ");
    expect(middlewareSource).not.toContain("authorization");
  });

  it("J. FEATURE_AGENTS remains 0", () => {
    expect(flyStaging).toMatch(/FEATURE_AGENTS\s*=\s*"0"/);
    expect(middlewareSource).not.toContain("FEATURE_AGENTS");
  });

  it("does not copy handshake tokens into returnTo", async () => {
    const response = await runProfessionalMiddleware(
      request("/app?__clerk_handshake=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig&tab=docs"),
      {
        authProvider: "clerk",
        authenticate: async () => clerkAuth("signed-out"),
      },
    );
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("returnTo=%2Fapp%3Ftab%3Ddocs");
    expect(decodeURIComponent(location)).not.toContain("__clerk_handshake");
    expect(decodeURIComponent(location)).not.toContain("eyJ");
  });
});
