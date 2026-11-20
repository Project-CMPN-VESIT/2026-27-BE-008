import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const cookieStore = await cookies();
  const isAdmin = cookieStore.get("finpilot_admin_auth")?.value === "true";
  if (isAdmin) {
    redirect("/admin");
  }
  redirect("/home");
}
