"use client";

import { useEffect } from "react";
import {
  CLERK_SESSION_KEEPALIVE_MS,
  CLERK_SESSION_KEEPALIVE_PATH,
  interpretClerkKeepAliveResponse,
} from "@/lib/clerk-session-keepalive";

export async function refreshClerkSessionKeepAlive(): Promise<
  "ok" | "handshake" | "signed-out"
> {
  try {
    const res = await fetch(CLERK_SESSION_KEEPALIVE_PATH, { method: "GET", cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    const result = interpretClerkKeepAliveResponse({
      ok: res.ok,
      errorCode: data.error?.code,
    });
    if (result === "handshake" && typeof window !== "undefined") {
      window.location.reload();
    }
    return result;
  } catch {
    return "signed-out";
  }
}

/** Keeps a Clerk browser session from expiring during long Ask/research work. */
export function ClerkSessionKeepAlive() {
  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshClerkSessionKeepAlive();
    };
    tick();
    const id = window.setInterval(tick, CLERK_SESSION_KEEPALIVE_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return null;
}
