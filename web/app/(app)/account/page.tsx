import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { memberName } from "@/lib/crm";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordForm } from "@/components/password-form";
import { MailAccountCard, type MailAccountRow } from "@/components/mail-account-card";
import { mailSetupCheck } from "@/lib/mail/setup-check";
import { headers } from "next/headers";
import { saveBookingUrl } from "@/app/(app)/mail-actions";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ reset?: string; mail?: string; reason?: string }> }) {
  const { reset, mail, reason } = await searchParams;
  const { member } = await currentMember();
  const supabase = await supabaseServer();
  const [{ data: { user } }, mailRes, sendingRes, pauseRes, checks, bookingRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("my_mail_accounts"),
    supabase.rpc("sending_enabled"),
    supabase.rpc("sending_pause_info"),   // missing until migration 0008 runs: then just no note
    mailSetupCheck(await headers()),
    supabase.rpc("booking_url"),   // missing until migration 0012 runs
  ]);
  const mailAccounts = (mailRes.data as MailAccountRow[] | null) ?? [];
  const providers = new Set((user?.identities ?? []).map((i) => i.provider));

  return (
    <>
      <PageHeader title="Account" description={`${memberName(member)} · ${user?.email ?? ""}`} />

      <div className="grid max-w-3xl gap-6">
        <MailAccountCard accounts={mailAccounts} sendingEnabled={sendingRes.data === true}
          pausedReason={(pauseRes.data as { reason?: string } | null)?.reason ?? null} isOwner={member?.role === "owner"}
          status={mail} reason={reason} fallbackName={memberName(member)} checks={checks} />

        <Card>
          <CardHeader>
            <CardTitle>Booking link</CardTitle>
            <CardDescription>Your calendar page (e.g. the booking section of thesentinelsystems.com). It goes into suggested replies to interested leads.</CardDescription>
          </CardHeader>
          <CardContent>
            {member?.role === "owner" ? (
              <ActionForm action={saveBookingUrl} className="flex flex-wrap gap-2">
                <Input name="booking_url" type="url" defaultValue={(bookingRes.data as string | null) ?? ""} placeholder="https://thesentinelsystems.com/#book" className="min-w-64 flex-1" />
                <SubmitButton>Save</SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-sm">{(bookingRes.data as string | null) ?? <span className="text-muted-foreground">Not set yet (an owner sets it).</span>}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sign-in methods</CardTitle>
            <CardDescription>Any of these gets you into The Sentinel Systems.</CardDescription>
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
