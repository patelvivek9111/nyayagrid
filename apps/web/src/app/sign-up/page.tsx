import { redirect } from "next/navigation";
import { PageHeader, Panel } from "@nyayagrid/ui";

export default function SignUpPage() {
  const destination = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL;
  if (destination && !destination.startsWith("/sign-up")) {
    redirect(destination);
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow="NyayaGrid"
        title="Create an account"
        description="Sign-up is hosted by Clerk when AUTH_PROVIDER=clerk."
      />
      <Panel title="Clerk is not configured for this process">
        <p className="text-sm text-ink/70">
          Set <code>NEXT_PUBLIC_CLERK_SIGN_UP_URL</code> to your Clerk Account Portal sign-up URL.
        </p>
      </Panel>
    </main>
  );
}
