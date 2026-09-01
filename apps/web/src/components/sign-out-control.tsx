"use client";

import { ACTIVE_ORG_STORAGE_KEY, clerkHostedSignInUrl, clerkSignOutHref } from "@/lib/auth-return";

export function SignOutControl({ className }: { className?: string }) {
  function signOut() {
    try {
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    } catch {
      // ignore quota / private mode
    }
    const origin = window.location.origin;
    window.location.assign(clerkSignOutHref(clerkHostedSignInUrl(), origin));
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
