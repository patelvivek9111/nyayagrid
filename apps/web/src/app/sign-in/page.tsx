import { redirect } from "next/navigation";
import { PageHeader, Panel } from "@nyayagrid/ui";

/**
 * Sign-in entry. Clerk's Account Portal (or a later embedded component) is the identity UI.
 * NyayaGrid never trusts a header-supplied user id on this path.
 */
export default function SignInPage() {
  const destination = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
  if (destination && !destination.startsWith("/sign-in")) {
    redirect(destination);
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow="NyayaGrid"
        title="Sign in"
        description="Identity is provided by Clerk when AUTH_PROVIDER=clerk. Local development uses AUTH_PROVIDER=dev instead."
      />
      <Panel title="Clerk is not configured for this process">
        <p className="text-sm text-ink/70">
          Set <code>AUTH_PROVIDER=clerk</code>, the Clerk keys, and{" "}
          <code>NEXT_PUBLIC_CLERK_SIGN_IN_URL</code> to your Clerk Account Portal. Until then this
          deployment cannot authenticate real users.
        </p>
      </Panel>
    </main>
  );
}
