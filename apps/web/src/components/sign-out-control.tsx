"use client";

import { ACTIVE_ORG_STORAGE_KEY } from "@/lib/auth-return";

export function SignOutControl({ className }: { className?: string }) {
  function signOut() {
    try {
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    } catch {
      // ignore quota / private mode
    }
    window.location.assign("/sign-out");
  }

  return (
    <button
      type="button"
      className={className}
      onClick={signOut}
      aria-label="Sign out"
    >
      Sign out
    </button>
  );
}
