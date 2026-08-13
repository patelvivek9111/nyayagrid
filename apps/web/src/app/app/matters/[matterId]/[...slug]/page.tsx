import { redirect } from "next/navigation";

type Params = { params: Promise<{ matterId: string; slug: string[] }> };

export default async function LegacyNestedMatterPage({ params }: Params) {
  const { matterId, slug } = await params;
  const rest = slug.filter(Boolean).join("/");
  redirect(rest ? `/app/cases/${matterId}/${rest}` : `/app/cases/${matterId}`);
}
