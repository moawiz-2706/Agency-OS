import Link from "next/link";
import { ReplyLabels } from "@/components/reply-labels";
import { suggestLabel } from "@/lib/replies";
import { stripQuoted } from "@/lib/mail/message";
import type { Metadata } from "next";
import { CornerDownRight } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { TEAM_TZ, ago, dateTime } from "@/lib/format";
import { approveAllMine, markReplyHandled } from "../mail-actions";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Inbox" };

type Reply = { id: string; company_id: string | null; from_email: string; subject: string | null; body_text: string | null; snippet: string | null;
  received_at: string | null; classification: string | null; companies: { name: string } | null };
type Pending = { id: string; company_id: string; step: number; status: string; subject: string; scheduled_for: string | null; error: string | null;
  companies: { name: string } | null };

export default async function InboxPage() {
  const supabase = await supabaseServer();
  const { member } = await currentMember();
  const [repliesRes, pendingRes] = await Promise.all([
    supabase.from("inbound_messages").select("id,company_id,from_email,subject,body_text,snippet,received_at,classification,companies(name),contacts(full_name)")
      .eq("handled", false).or("classification.is.null,classification.not.in.(out_of_office,bounce)")
      .order("received_at", { ascending: false }).limit(100),
    supabase.from("outreach_messages").select("id,company_id,step,status,subject,scheduled_for,error,companies(name)")
      .eq("member_id", member?.id ?? "").in("status", ["pending_approval", "failed"]).order("scheduled_for").limit(200),
  ]);
  const replies = (repliesRes.data ?? []) as unknown as (Reply & { contacts: { full_name: string | null } | null })[];
  const { data: bookingUrl } = await supabase.rpc("booking_url");   // missing until migration 0012: no link
  const myName = member?.full_name?.trim().split(/\s+/)[0] ?? null;
  const pending = (pendingRes.data ?? []) as unknown as Pending[];
  const toApprove = pending.filter((p) => p.status === "pending_approval");
  const failed = pending.filter((p) => p.status === "failed");

  return (
    <>
      <PageHeader title="Inbox" description="Replies from leads, and your emails that need you." />
      <div className="grid max-w-4xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Replies to handle ({replies.length})</CardTitle>
            <CardDescription>Synced from Gmail every 5 minutes. A reply stops that lead&apos;s scheduled follow-ups; &quot;no&quot; or &quot;unsubscribe&quot; also adds them to the never-contact list. Label each reply to move the lead along (the highlighted label is a suggestion).</CardDescription>
          </CardHeader>
          <CardContent>
            {replies.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No replies waiting.</p> : (
              <ul className="divide-y">
                {replies.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <CornerDownRight className="size-4 text-sky-700" />
                        {r.company_id ? <Link href={`/leads/${r.company_id}#email`} className="font-medium hover:underline">{r.companies?.name ?? "Lead"}</Link> : <span className="font-medium">Unknown lead</span>}
                        <span className="text-muted-foreground">{r.from_email}</span>
                        {r.classification === "unsubscribe" && <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Asked to stop</Badge>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{dateTime(r.received_at, TEAM_TZ)} · {ago(r.received_at)}{r.subject ? ` · ${r.subject}` : ""}</div>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{r.body_text || r.snippet}</p>
                      {r.company_id && (
                        <div className="mt-2">
                          <ReplyLabels id={r.id} current={r.classification} suggestion={suggestLabel(stripQuoted(r.body_text ?? r.snippet ?? ""))}
                            firstName={r.contacts?.full_name?.trim().split(/\s+/)[0] ?? null} myName={myName} bookingUrl={(bookingUrl as string | null) ?? null} />
                        </div>
                      )}
                    </div>
                    <ActionForm action={markReplyHandled.bind(null, r.id, true)}><SubmitButton size="sm" variant="secondary">Mark handled</SubmitButton></ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {[["Waiting for your approval", toApprove], ["Failed: check and retry", failed]].map(([title, list]) => (list as Pending[]).length > 0 && (
          <Card key={title as string}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>{title as string} ({(list as Pending[]).length})</CardTitle>
              {list === toApprove && toApprove.length > 1 && (
                <ActionForm action={approveAllMine}><SubmitButton size="sm">Approve all {toApprove.length}</SubmitButton></ActionForm>
              )}
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {(list as Pending[]).map((p) => (
                  <li key={p.id} className="py-2.5 text-sm">
                    <Link href={`/leads/${p.company_id}#email`} className="font-medium hover:underline">{p.companies?.name ?? "Lead"}</Link>
                    <span className="text-muted-foreground"> · Email {p.step} · {p.subject} · {dateTime(p.scheduled_for, TEAM_TZ)}</span>
                    {p.error && <p className="text-xs text-red-700">{p.error}</p>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
