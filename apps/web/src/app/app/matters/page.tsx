import { redirect } from "next/navigation";

/** Legacy professional path — Cases is the only workspace URL. */
export default function LegacyMattersIndexPage() {
  redirect("/app/cases");
}
