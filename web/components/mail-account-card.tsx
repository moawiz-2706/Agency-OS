import { AlertTriangle, CheckCircle2, Mail, RefreshCw, Star } from "lucide-react";
import { connectImapInbox, disconnectInbox, saveMailSettings, setDefaultInbox, setSendingEnabled, syncMyInbox } from "@/app/(app)/mail-actions";
import { ago } from "@/lib/format";
import type { SetupCheck } from "@/lib/mail/setup-check";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type MailAccountRow = {
  id: string; email: string; provider: "gmail" | "imap" | "microsoft"; from_name: string | null; signature: string | null;
  daily_limit: number; is_default: boolean; connected: boolean; needs_reconnect: boolean; last_error: string | null;
  last_sync_at: string | null; last_sent_at: string | null; sent_24h: number; sending_enabled: boolean;
};

const SIGNATURE_EXAMPLE = "Moawiz\nThe Sentinel Systems · +1 555 000 0000\n123 Main St, Suite 100, Austin, TX 78701";
const PROVIDER = { gmail: "Gmail", imap: "GoDaddy / IMAP", microsoft: "Microsoft" } as const;

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

function Inbox({ a, fallbackName }: { a: MailAccountRow; fallbackName: string }) {
  const ok = a.connected && !a.needs_reconnect;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}>
          {ok ? <CheckCircle2 /> : <AlertTriangle />}{a.email}
        </Badge>
        <Badge variant="secondary" className="font-normal">{PROVIDER[a.provider]}</Badge>
        {a.is_default && <Badge variant="secondary" className="font-normal"><Star />Default</Badge>}
        {!a.signature && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Needs a signature</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {a.needs_reconnect ? <span className="text-red-700">Needs reconnecting: {a.provider === "gmail" ? "click Add Gmail inbox and pick this address again." : "connect it again below with the current password."} </span> : null}
        Last sync {ago(a.last_sync_at)} · last send {ago(a.last_sent_at)} · {a.sent_24h}/{a.daily_limit} sent in the last 24h
        {a.last_error && !a.needs_reconnect && <span className="block text-red-700">Last problem: {a.last_error}</span>}
      </p>
      <details open={!a.signature}>
        <summary className="cursor-pointer text-sm">Name, signature and daily limit</summary>
        <ActionForm action={saveMailSettings.bind(null, a.id)} className="mt-3 grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="Name people see"><Input name="from_name" defaultValue={a.from_name ?? fallbackName} /></Field>
          <Field label="Max emails / day"><Input name="daily_limit" type="number" min={1} max={40} defaultValue={a.daily_limit} /></Field>
          <Field label="Signature (required: your name and a real postal address; the law requires the address in every email)" className="sm:col-span-2">
            <Textarea name="signature" rows={4} defaultValue={a.signature ?? ""} placeholder={SIGNATURE_EXAMPLE} required />
            <p className="mt-1 text-xs text-muted-foreground">Added under every email from this inbox, followed by: Not interested? Reply &quot;no&quot; and I won&apos;t email again.</p>
          </Field>
          <SubmitButton size="sm" className="w-fit">Save</SubmitButton>
        </ActionForm>
      </details>
      <div className="flex flex-wrap gap-2">
        {!a.is_default && ok && <ActionForm action={setDefaultInbox.bind(null, a.id)}><SubmitButton size="sm" variant="secondary">Make default</SubmitButton></ActionForm>}
        <ActionForm action={disconnectInbox.bind(null, a.id)}><SubmitButton size="sm" variant="ghost">Disconnect</SubmitButton></ActionForm>
      </div>
    </div>
  );
}

export function MailAccountCard({ accounts, sendingEnabled, isOwner, status, reason, fallbackName, checks }: {
  accounts: MailAccountRow[]; sendingEnabled: boolean; isOwner: boolean; status?: string; reason?: string; fallbackName: string;
  checks: SetupCheck[];
}) {
  const failing = checks.filter((c) => !c.ok).length;
  return (
    <Card className={status ? "border-primary/30 shadow-sm" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="size-4" />Email inboxes</CardTitle>
        <CardDescription>
          Emails you write on a lead go out from one of these. Replies, bounces and emails you send from the inbox itself sync back
          every 5 minutes. Only emails to and from your leads are stored; the rest of your inbox is never saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {status === "connected" && <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" />Gmail connected. The first sync looks back 14 days.</p>}
        {status === "error" && <p className="flex items-start gap-2 text-sm text-red-700"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{reason || "Couldn't connect Gmail."}</p>}

        <details open={failing > 0} className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Setup check: {failing ? <span className="text-red-700">{failing} setting(s) need fixing</span> : <span className="text-emerald-700">all good</span>}
          </summary>
          <ul className="mt-2 space-y-1.5 text-xs">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-600" />}
                <span><b>{c.label}</b>: <span className="break-all text-muted-foreground">{c.detail}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">After changing a setting in Vercel, redeploy, then reload this page.</p>
        </details>

        {accounts.length > 0 && (
          <div className="space-y-3">
            {accounts.map((a) => <Inbox key={a.id} a={a} fallbackName={fallbackName} />)}
            <p className="text-xs text-muted-foreground">
              Follow-ups go from the inbox that last emailed that person (so they stay in the same thread); everything else from your default.
            </p>
            <ActionForm action={syncMyInbox}><SubmitButton size="sm" variant="secondary"><RefreshCw />Sync now</SubmitButton></ActionForm>
          </div>
        )}

        <div className="grid gap-3 rounded-lg border border-dashed p-3">
          <div className="text-sm font-medium">Add an inbox</div>
          <Button asChild variant="outline" size="sm" className="w-fit">
            {/* A plain link: the OAuth flow is a full-page redirect to Google. */}
            <a href="/auth/gmail/connect">Add Gmail inbox</a>
          </Button>
          <details>
            <summary className="cursor-pointer text-sm">Add GoDaddy email (or any IMAP/SMTP inbox)</summary>
            <ActionForm action={connectImapInbox} reset className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Email address"><Input name="email" type="email" required placeholder="moawiz@thesentinelsystems.com" autoComplete="off" /></Field>
              <Field label="Mailbox password"><Input name="password" type="password" required autoComplete="new-password" /></Field>
              <Field label="Mail servers" className="sm:col-span-2">
                <select name="preset" defaultValue="auto" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">
                  <option value="auto">GoDaddy: find it automatically (Titan first, then classic)</option>
                  <option value="titan">GoDaddy Professional Email on Titan (webmail at …titan.email)</option>
                  <option value="godaddy_classic">GoDaddy classic (webmail at email.godaddy.com)</option>
                  <option value="custom">Another provider: enter the servers below</option>
                </select>
              </Field>
              <details className="sm:col-span-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Servers for &quot;another provider&quot;</summary>
                <div className="mt-2 grid grid-cols-[1fr_6rem] gap-3">
                  <Field label="IMAP server (reading)"><Input name="imap_host" placeholder="imap.example.com" /></Field>
                  <Field label="Port"><Input name="imap_port" type="number" defaultValue={993} /></Field>
                  <Field label="SMTP server (sending)"><Input name="smtp_host" placeholder="smtp.example.com" /></Field>
                  <Field label="Port"><Input name="smtp_port" type="number" defaultValue={465} /></Field>
                </div>
              </details>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                We log in to check the password works, then stores it encrypted (AES-256). It&apos;s never shown again and
                can&apos;t be read from the database; Disconnect deletes it.
              </p>
              <SubmitButton size="sm" className="w-fit">Test and connect</SubmitButton>
            </ActionForm>
          </details>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="text-sm">
            <div className="font-medium">Team sending is {sendingEnabled ? "on" : "off"}</div>
            <div className="text-xs text-muted-foreground">
              {sendingEnabled ? "Approved emails go out at their scheduled time." : "Nothing is sent until an owner turns this on. Syncing still works."}
            </div>
          </div>
          {isOwner && (
            <ActionForm action={setSendingEnabled.bind(null, !sendingEnabled)}>
              <SubmitButton size="sm" variant={sendingEnabled ? "outline" : "default"}>{sendingEnabled ? "Turn sending off" : "Turn sending on"}</SubmitButton>
            </ActionForm>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
