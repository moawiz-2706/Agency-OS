import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMember } from "@/lib/team";
import { memberName } from "@/lib/crm";
import { NavLinks } from "@/components/nav-links";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, member } = await currentMember();
  if (!user) redirect("/login");

  if (!member) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 text-center">
        <h1 className="text-xl font-semibold">Not on the team</h1>
        <p className="mt-2 text-sm text-slate-500">
          {user.email} is signed in but isn&apos;t an active team member. Ask the owner to add you.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button className="btn w-full">Sign out</button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
          <Link href="/" className="font-semibold">AgencyOS</Link>
          <NavLinks />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: member.color }} />
              {memberName(member)}
            </span>
            <form action="/auth/signout" method="post">
              <button className="text-slate-500 hover:text-slate-900">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
