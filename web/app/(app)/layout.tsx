import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { currentMember, teamMembers } from "@/lib/team";
import { initials, memberColor, memberName } from "@/lib/crm";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, member } = await currentMember();
  if (!user) redirect("/login");

  if (!member) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="space-y-4 pt-6">
            <ShieldAlert className="mx-auto size-10 text-muted-foreground" />
            <div>
              <h1 className="text-lg font-semibold">Not on the team</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {user.email} is signed in but isn&apos;t an active team member. Ask the owner to add you.
              </p>
            </div>
            <form action="/auth/signout" method="post"><Button variant="outline" className="w-full">Sign out</Button></form>
          </CardContent>
        </Card>
      </main>
    );
  }

  const team = await teamMembers();
  const me = {
    name: memberName(member), email: member.email, initials: initials(member),
    color: memberColor(team, member.id), role: member.role,
  };
  return <AppShell me={me}>{children}</AppShell>;
}
