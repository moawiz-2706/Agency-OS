import Link from "next/link";
import { AlertTriangle, CornerDownRight, Mail, Send } from "lucide-react";
import { approveAllForLead, approveEmail, cancelEmail, markReplyHandled, queueEmail, sendEmailNow, updateEmail } from "@/app/(app)/mail-actions";
import { memberName, type Member } from "@/lib/crm";
import { TEAM_TZ, ago } from "@/lib/format";
import { isoToZonedLocal, zonedLocalToIso } from "@/lib/tz";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type OutreachMessage = {
  id: string; contact_id: string; member_id: string | null; step: number; status: string; source: string;
  subject: string; body: string; scheduled_for: string | null; sent_at: string | null; error: string | null; created_at: string;
};
export type InboundMessage = {
  id: string; contact_id: string | null; from_email: string; subject: string | null; body_text: string | null; snippet: string | null;
  received_at: string | null; classification: string | null; handled: boolean;
};
export type MyMailAccount = {
  email: string; daily_limit: number; connected: boolean; needs_reconnect: boolean; last_error: string | null;
  sent_24h: number; sending_enabled: boolean; signature: string | null;
} | null;
type EmailContact = { id: string; full_name: string | null; email: string | null; do_not_contact: boolean; consent_basis: string };

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "" },
  pending_approval: { label: "Needs approval", className: "border-amber-200 bg-amber-50 text-amber-800" },
  approved: { label: "Scheduled", className: "border-sky-200 bg-sky-50 text-sky-800" },
  queued: { label: "Sending", className: "border-sky-200 bg-sky-50 text-sky-800" },
  sent: { label: "Sent", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  failed: { label: "Failed", className: "border-red-200 bg-red-50 text-red-700" },
  cancelled: { label: "Stopped", className: "text-muted-foreground" },
};
const REPLY: Record<string, { label: string; className: string }> = {
  unsubscribe: { label: "Asked to stop", className: "border-red-200 bg-red-50 text-red-700" },
  out_of_office: { label: "Out of office", className: "text-muted-foreground" },
  bounce: { label: "Bounced", className: "border-red-200 bg-red-50 text-red-700" },
};

function when(iso: string | null, tz: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Next weekday 7:45 AM in the lead's time zone: when trade owners read email. */
function nextMorning(tz: string, now = new Date()) {
  const today = isoToZonedLocal(now.toISOString(), tz).slice(0, 10);
  for (let i = 0; i < 8; i++) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const day = d.toISOString().slice(0, 10);
    const iso = zonedLocalToIso(`${day}T07:45`, tz);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && iso && new Date(iso) > now) return `${day}T07:45`;
  }
  return `${today}T07:45`;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

export function EmailPanel({ companyId, tz, contacts, messages, replies, account, meId, team }: {
  companyId: string; tz: string; contacts: EmailContact[]; messages: OutreachMessage[]; replies: InboundMessage[];
  account: MyMailAccount; meId: string | null; team: Member[];
}) {
  const who = (id: string | null) => (id ? memberName(team.find((m) => m.id === id)) : "Someone");
  const contactName = (id: string | null) => {
    const ct = contacts.find((x) => x.id === id);
    return ct ? ct.full_name || ct.email || "contact" : "contact";
  };
  const emailable = contacts.filter((ct) => ct.email && !ct.do_not_contact && ct.consent_basis !== "unknown");
  const mine = (m: OutreachMessage) => m.member_id === meId;
  const open = (m: OutreachMessage) => ["draft", "pending_approval", "approved", "failed"].includes(m.status);
  const toApprove = messages.filter((m) => mine(m) && m.status === "pending_approval").length;
  const firstSent = messages.find((m) => m.status === "sent");

  const items = [
    ...messages.map((m) => ({ at: m.sent_at ?? m.scheduled_for ?? m.created_at, key: `o${m.id}`, m, r: null })),
    ...replies.map((r) => ({ at: r.received_at ?? "", key: `i${r.id}`, m: null, r })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const warning = !account ? <>Connect your Gmail on the <Link href="/account" className="underline">Account page</Link> to send from here.</>
    : account.needs_reconnect || !account.connected ? <>Your Gmail needs reconnecting on the <Link href="/account" className="underline">Account page</Link>.</>
    : !account.signature ? <>Add your signature (with your postal address) on the <Link href="/account" className="underline">Account page</Link> before sending.</>
    : !account.sending_enabled ? <>Sending is switched off for the team (an owner turns it on in Account). Emails wait until then.</>
    : null;

  return (
    <Card id="email">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="size-4" />Email</CardTitle>
        <CardDescription>
          {account?.connected ? <>Sending as <b>{account.email}</b> · {account.sent_24h}/{account.daily_limit} in the last 24h · times shown in their time zone ({tz}) and yours</>
            : "Emails go out from your own Gmail, and replies sync back here."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {warning && <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{warning}</span></p>}
        {toApprove > 1 && (
          <ActionForm action={approveAllForLead.bind(null, companyId)}>
            <SubmitButton size="sm" variant="secondary">Approve all {toApprove} of mine</SubmitButton>
          </ActionForm>
        )}

        {items.length > 0 && (
          <ol className="space-y-3">
            {items.map(({ key, m, r }) => m ? (
              <li key={key} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={STATUS[m.status]?.className}>{STATUS[m.status]?.label ?? m.status}</Badge>
                  <span className="font-medium">Email {m.step}</span>
                  <span className="text-muted-foreground">to {contactName(m.contact_id)} · by {who(m.member_id)}{m.source === "gmail" ? " (sent from Gmail)" : ""}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {m.sent_at ? <>Sent {when(m.sent_at, tz)} their time · {when(m.sent_at, TEAM_TZ)} yours · {ago(m.sent_at)}</>
                    : m.status === "cancelled" ? null
                    : <>Sends {when(m.scheduled_for, tz)} their time · {when(m.scheduled_for, TEAM_TZ)} yours</>}
                </div>
                <div className="mt-1.5 font-medium">{m.subject}</div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Show message</summary>
                  <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{m.body}</p>
                </details>
                {m.error && <p className="mt-1.5 text-xs text-red-700">{m.error}</p>}
                {open(m) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {mine(m) && m.status !== "approved" && (
                      <ActionForm action={approveEmail.bind(null, m.id, companyId)}><SubmitButton size="sm">Approve</SubmitButton></ActionForm>
                    )}
                    {mine(m) && (
                      <ActionForm action={sendEmailNow.bind(null, m.id, companyId)}><SubmitButton size="sm" variant="secondary"><Send />Send now</SubmitButton></ActionForm>
                    )}
                    <ActionForm action={cancelEmail.bind(null, m.id, companyId)}><SubmitButton size="sm" variant="ghost">Cancel</SubmitButton></ActionForm>
                    {mine(m) && (
                      <details className="w-full">
                        <summary className="cursor-pointer text-xs text-muted-foreground">Edit</summary>
                        <ActionForm action={updateEmail.bind(null, m.id, companyId, tz)} className="mt-2 grid gap-3">
                          <Input name="subject" defaultValue={m.subject} required />
                          <Textarea name="body" defaultValue={m.body} rows={8} required />
                          <Field label={`Send at (their time, ${tz})`}>
                            <Input name="send_at" type="datetime-local" defaultValue={isoToZonedLocal(m.scheduled_for, tz)} />
                          </Field>
                          <SubmitButton size="sm" className="w-fit">Save</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </div>
                )}
              </li>
            ) : r && (
              <li key={key} className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <CornerDownRight className="size-4 text-sky-700" />
                  <span className="font-medium">{r.classification === "bounce" ? "Bounce" : `Reply from ${contactName(r.contact_id)}`}</span>
                  {r.classification && REPLY[r.classification] && <Badge variant="outline" className={REPLY[r.classification].className}>{REPLY[r.classification].label}</Badge>}
                  <span className="text-xs text-muted-foreground">{when(r.received_at, TEAM_TZ)} yours · {ago(r.received_at)}</span>
                </div>
                {r.subject && <div className="mt-1 text-xs text-muted-foreground">{r.subject}</div>}
                <p className="mt-1.5 whitespace-pre-wrap">{r.body_text || r.snippet}</p>
                {r.classification !== "bounce" && r.classification !== "out_of_office" && (
                  <ActionForm action={markReplyHandled.bind(null, r.id, !r.handled)} className="mt-2">
                    <SubmitButton size="sm" variant={r.handled ? "ghost" : "secondary"}>{r.handled ? "Mark as not handled" : "Mark handled"}</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ol>
        )}

        <details open={items.length === 0} className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Write an email</summary>
          {emailable.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No contact here can be emailed yet (needs an email address and a consent basis, and not marked do-not-contact).</p>
          ) : (
            <ActionForm action={queueEmail.bind(null, companyId, tz)} reset className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="To">
                <Select name="contact_id" defaultValue={emailable[0].id}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{emailable.map((ct) => <SelectItem key={ct.id} value={ct.id}>{ct.full_name ? `${ct.full_name} · ${ct.email}` : ct.email}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={`Send at (their time, ${tz})`}>
                <Input name="send_at" type="datetime-local" defaultValue={nextMorning(tz)} />
              </Field>
              <Field label="Subject" className="sm:col-span-2">
                <Input name="subject" required defaultValue={firstSent ? `Re: ${firstSent.subject.replace(/^\s*(re:\s*)+/i, "")}` : ""} />
              </Field>
              <Field label="Message" className="sm:col-span-2">
                <Textarea name="body" rows={8} required placeholder={"Hi Darin,\n\n…"} />
              </Field>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Your signature and the opt-out line are added automatically. Follow-ups to the same person go as a reply in the same Gmail thread.
              </p>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox name="approve" defaultChecked /> Approve and schedule it now (untick to save it for review)
              </label>
              <SubmitButton className="w-fit">Save email</SubmitButton>
            </ActionForm>
          )}
        </details>
      </CardContent>
    </Card>
  );
}
