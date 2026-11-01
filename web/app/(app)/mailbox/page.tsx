import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Inbox, Paperclip, Send, Star } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { TEAM_TZ, ago } from "@/lib/format";
import { myImapInboxes } from "@/lib/mail/worker";
import { listFolder, readMessage, webmailUrl, type Folder, type MailMessage, type MailboxItem } from "@/lib/mail/mailbox";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Mailbox" };
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PAGE = 25;
type Lead = { email: string; company_id: string; name: string };

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TZ }).format(d) === new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TZ }).format(new Date());
  return new Intl.DateTimeFormat("en-GB", sameDay
    ? { timeZone: TEAM_TZ, hour: "2-digit", minute: "2-digit" }
    : { timeZone: TEAM_TZ, day: "numeric", month: "short" }).format(d);
}

export default async function MailboxPage({ searchParams }: { searchParams: Promise<{ inbox?: string; folder?: string; page?: string; uid?: string }> }) {
  const sp = await searchParams;
  const { member } = await currentMember();
  const inboxes = member ? await myImapInboxes(member.id).catch(() => []) : [];

  if (!inboxes.length) {
    return (
      <>
        <PageHeader title="Mailbox" description="Your GoDaddy inbox, read live." />
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Connect a GoDaddy (or other IMAP) inbox on the <Link href="/account" className="underline">Account page</Link> to read it here.
          Gmail inboxes are read in Gmail itself.
        </CardContent></Card>
      </>
    );
  }

  const inbox = inboxes.find((i) => i.id === sp.inbox) ?? inboxes[0];
  const folder: Folder = sp.folder === "sent" ? "sent" : "inbox";
  const page = Math.max(0, Math.floor(Number(sp.page) || 0));
  const uid = Number(sp.uid) || null;
  const href = (p: Record<string, string | number | null>) => {
    const q = new URLSearchParams({ inbox: inbox.id, folder, page: String(page), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v ?? "")])) });
    for (const [k, v] of [...q.entries()]) if (!v || (k === "page" && v === "0")) q.delete(k);
    return `/mailbox?${q}`;
  };

  let list: { total: number; items: MailboxItem[] } = { total: 0, items: [] };
  let message: MailMessage | null = null;
  let error: string | null = null;
  try {
    [list, message] = await Promise.all([listFolder(inbox.settings, folder, page, PAGE), uid ? readMessage(inbox.settings, folder, uid) : null]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Couldn't read this inbox";
  }

  // Which senders/recipients are leads in the CRM (team-visible data, through RLS).
  const addrs = [...new Set([...list.items.flatMap((m) => [m.from, ...m.to]), ...(message?.addresses ?? [])])].filter((a) => a && a !== inbox.email);
  const leads = new Map<string, Lead>();
  if (addrs.length) {
    const supabase = await supabaseServer();
    const { data } = await supabase.from("contacts").select("email,company_id,companies(name)").in("email", addrs.slice(0, 300));
    for (const c of (data ?? []) as unknown as { email: string; company_id: string; companies: { name: string } | null }[]) {
      leads.set(c.email.toLowerCase(), { email: c.email, company_id: c.company_id, name: c.companies?.name ?? "Lead" });
    }
  }
  const leadFor = (m: { from: string; to: string[] }) => (folder === "sent" ? m.to.map((a) => leads.get(a)).find(Boolean) : leads.get(m.from));
  const webmail = webmailUrl(inbox.imapHost);
  const pages = Math.max(1, Math.ceil(list.total / PAGE));

  return (
    <>
      <PageHeader title="Mailbox" description={`${inbox.email} · read live from your mail server, nothing is copied into the CRM`} />

      <div className="flex flex-wrap items-center gap-2">
        {inboxes.length > 1 && inboxes.map((i) => (
          <Button key={i.id} asChild size="sm" variant={i.id === inbox.id ? "secondary" : "ghost"}>
            <Link href={`/mailbox?inbox=${i.id}`}>{i.email}</Link>
          </Button>
        ))}
        <div className="flex gap-1 rounded-lg border bg-card p-1">
          <Button asChild size="sm" variant={folder === "inbox" ? "secondary" : "ghost"}><Link href={href({ folder: "inbox", page: 0, uid: null })}><Inbox />Inbox</Link></Button>
          <Button asChild size="sm" variant={folder === "sent" ? "secondary" : "ghost"}><Link href={href({ folder: "sent", page: 0, uid: null })}><Send />Sent</Link></Button>
        </div>
        {webmail && <Button asChild size="sm" variant="outline" className="ml-auto"><a href={webmail} target="_blank" rel="noreferrer">Open webmail <ExternalLink /></a></Button>}
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}
        </p>
      )}

      <div className={cn("grid gap-4", message && "lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]")}>
        <Card className={cn("overflow-hidden py-0", message && "hidden lg:block")}>
          {list.items.length === 0 && !error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No messages here.</p>
          ) : (
            <ul className="divide-y">
              {list.items.map((m) => {
                const lead = leadFor(m);
                const active = m.uid === uid;
                return (
                  <li key={m.uid}>
                    <Link href={href({ uid: m.uid })} className={cn("block px-4 py-3 transition-colors hover:bg-accent/60", active && "bg-accent")}>
                      <div className="flex items-center gap-2 text-sm">
                        {!m.seen && folder === "inbox" && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                        <span className={cn("min-w-0 flex-1 truncate", !m.seen && folder === "inbox" ? "font-semibold" : "font-medium")}>
                          {folder === "sent" ? `To: ${m.to[0] ?? ""}` : m.fromName || m.from}
                        </span>
                        {m.flagged && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
                        <span className="shrink-0 text-xs text-muted-foreground">{when(m.date)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-sm text-muted-foreground">{m.subject}</div>
                      {lead && <Badge variant="outline" className="mt-1.5 border-sky-200 bg-sky-50 font-normal text-sky-800">Lead · {lead.name}</Badge>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <Button asChild size="sm" variant="ghost" disabled={page === 0}>
                <Link href={href({ page: Math.max(0, page - 1), uid: null })} aria-disabled={page === 0}><ChevronLeft />Newer</Link>
              </Button>
              Page {page + 1} of {pages} · {list.total} messages
              <Button asChild size="sm" variant="ghost" disabled={page + 1 >= pages}>
                <Link href={href({ page: Math.min(pages - 1, page + 1), uid: null })} aria-disabled={page + 1 >= pages}>Older<ChevronRight /></Link>
              </Button>
            </div>
          )}
        </Card>

        {message && (
          <Card className="min-w-0 py-0">
            <div className="space-y-3 border-b p-4">
              <Link href={href({ uid: null })} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"><ArrowLeft className="size-4" />Back</Link>
              <h2 className="text-lg font-semibold">{message.subject}</h2>
              <div className="space-y-0.5 text-sm">
                <div><span className="text-muted-foreground">From </span>{message.fromText}</div>
                {message.to && <div className="break-words"><span className="text-muted-foreground">To </span>{message.to}</div>}
                {message.cc && <div className="break-words"><span className="text-muted-foreground">Cc </span>{message.cc}</div>}
                <div className="text-xs text-muted-foreground">{message.date ? `${new Date(message.date).toLocaleString("en-GB", { timeZone: TEAM_TZ })} · ${ago(message.date)}` : ""}</div>
              </div>
              {(() => {
                const lead = message.addresses.map((a) => leads.get(a)).find(Boolean);
                return lead && (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/leads/${lead.company_id}#email`}>Open lead · {lead.name}</Link>
                  </Button>
                );
              })()}
            </div>
            <div className="p-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text || "(This email has no text content.)"}</p>
              {message.attachments.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                  {message.attachments.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
                      <Paperclip className="size-3.5" />{a.filename} · {Math.max(1, Math.round(a.size / 1024))} KB
                    </span>
                  ))}
                  {webmail && <span className="text-xs text-muted-foreground">Open webmail to download attachments.</span>}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
