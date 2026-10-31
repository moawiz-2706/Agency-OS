import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { memberName } from "@/lib/crm";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordForm } from "@/components/password-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  const { member } = await currentMember();
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const providers = new Set((user?.identities ?? []).map((i) => i.provider));

  return (
    <>
      <PageHeader title="Account" description={`${memberName(member)} · ${user?.email ?? ""}`} />

      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sign-in methods</CardTitle>
            <CardDescription>Any of these gets you into AgencyOS.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="outline" className={providers.has("google") ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}>
              {providers.has("google") && <CheckCircle2 />}Google {providers.has("google") ? "connected" : "(sign in with Google once to connect)"}
            </Badge>
            <Badge variant="outline">Email link</Badge>
            <Badge variant="outline">Password</Badge>
          </CardContent>
        </Card>

        <Card className={reset ? "border-primary/30 shadow-sm" : undefined}>
          <CardHeader>
            <CardTitle>{reset ? "Choose a new password" : "Set or change your password"}</CardTitle>
            <CardDescription>At least 8 characters. Then you can sign in with your email and password.</CardDescription>
          </CardHeader>
          <CardContent><PasswordForm /></CardContent>
        </Card>
      </div>
    </>
  );
}
