import { AlertTriangle, CheckCircle2, Mail, RefreshCw } from "lucide-react";
import { disconnectGmail, saveMailSettings, setSendingEnabled, syncMyInbox } from "@/app/(app)/mail-actions";
import { ago } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type MailAccountRow = {
  email: string; from_name: string | null; signature: string | null; daily_limit: number; connected: boolean;
  needs_reconnect: boolean; last_error: string | null; last_sync_at: string | null; last_sent_at: string | null;
  sent_24h: number; sending_enabled: boolean;
};

const SIGNATURE_EXAMPLE = "Moawiz\nYour Agency · +1 555 000 0000\n123 Main St, Suite 100, Austin, TX 78701";

export function MailAccountCard({ account, sendingEnabled, isOwner, status, reason, fallbackName }: {
  account: MailAccountRow | null; sendingEnabled: boolean; isOwner: boolean; status?: string; reason?: string; fallbackName: string;
}) {
  const connected = !!account?.connected && !account.needs_reconnect;
  return (
    <Card className={status ? "border-primary/30 shadow-sm" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="size-4" />Gmail</CardTitle>
        <CardDescription>
          Emails you send from a lead go out from this inbox, and replies, bounces and emails you send from Gmail itself sync back to the CRM every 5 minutes.
          Only emails to and from your leads are stored; the rest of your inbox is never saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {status === "connected" && <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" />Gmail connected. The first sync looks back 14 days.</p>}
        {status === "error" && <p className="flex items-start gap-2 text-sm text-red-700"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{reason || "Couldn't connect Gmail."}</p>}

        <div className="flex flex-wrap items-center gap-3">
          {connected ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 />{account!.email}</Badge>
          ) : account?.needs_reconnect ? (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800"><AlertTriangle />{account.email}: needs reconnecting</Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
          <Button asChild variant={connected ? "outline" : "default"} size="sm">
            {/* A plain link: the OAuth flow is a full-page redirect to Google. */}
            <a href="/auth/gmail/connect">{connected ? "Reconnect / switch inbox" : account?.needs_reconnect ? "Reconnect Gmail" : "Connect Gmail"}</a>
          </Button>
          {connected && (
            <>
              <ActionForm action={syncMyInbox}><SubmitButton size="sm" variant="secondary"><RefreshCw />Sync now</SubmitButton></ActionForm>
              <ActionForm action={disconnectGmail}><SubmitButton size="sm" variant="ghost">Disconnect</SubmitButton></ActionForm>
            </>
          )}
        </div>
        {account && (
          <p className="text-xs text-muted-foreground">
            Last sync {ago(account.last_sync_at)} · last send {ago(account.last_sent_at)} · {account.sent_24h}/{account.daily_limit} sent in the last 24h
            {account.last_error && <span className="block text-red-700">Last problem: {account.last_error}</span>}
          </p>
        )}

        {account && (
          <ActionForm action={saveMailSettings} className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div>
              <Label className="mb-1.5 text-xs text-muted-foreground">Name people see</Label>
              <Input name="from_name" defaultValue={account.from_name ?? fallbackName} />
            </div>
            <div>
              <Label className="mb-1.5 text-xs text-muted-foreground">Max emails / day</Label>
              <Input name="daily_limit" type="number" min={1} max={40} defaultValue={account.daily_limit} />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 text-xs text-muted-foreground">Signature (required: your name and a real postal address; the law requires the address in every email)</Label>
              <Textarea name="signature" rows={4} defaultValue={account.signature ?? ""} placeholder={SIGNATURE_EXAMPLE} required />
              <p className="mt-1 text-xs text-muted-foreground">Added under every email, followed by: Not interested? Reply &quot;no&quot; and I won&apos;t email again.</p>
            </div>
            <SubmitButton className="w-fit">Save email settings</SubmitButton>
          </ActionForm>
        )}

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
