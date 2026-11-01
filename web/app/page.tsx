import { redirect } from "next/navigation";

// Staff-only site: there is no public home page. Signed-in people go to the dashboard;
// the proxy sends everyone else to /login first.
export default function Home() {
  redirect("/dashboard");
}
