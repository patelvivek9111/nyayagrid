import { redirect } from "next/navigation";

type Params = { params: Promise<{ matterId: string }> };

/** Legacy /app/matters/:id — next.config also catch-all redirects nested paths. */
export default async function LegacyMatterPage({ params }: Params) {
  const { matterId } = await params;
  redirect(`/app/cases/${matterId}`);
}
