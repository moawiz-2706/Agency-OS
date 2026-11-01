import Link from "next/link";
import type { Metadata } from "next";
import {
  AlertTriangle, Archive, ArrowLeft, ChevronLeft, ChevronRight, CornerUpLeft, ExternalLink, FileText, ImageOff, Inbox,
  Paperclip, PenSquare, RefreshCw, Search, Send, ShieldAlert, Star, Trash2, X,
} from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { TEAM_TZ, ago } from "@/lib/format";
import { myImapInboxes } from "@/lib/mail/worker";
import { FOLDERS, FOLDER_LABEL, loadMailbox, webmailUrl, type Folder, type MailboxView } from "@/lib/mail/mailbox";
import { emailDocument, forwardBlock, forwardSubject, hasRemoteImages, quoteReply, replyRecipients, replySubject } from "@/lib/mail/compose";
import { ComposeForm, EmailFrame, MessageActions, type ComposeMode } from "@/components/mailbox";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Mailbox" };
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PAGE = 25;
const FOLDER_ICON = { inbox: Inbox, sent: Send, drafts: FileText, archive: Archive, junk: ShieldAlert, trash: Trash2 } as const;
type Lead = { company_id: string; name: string };
type Params = { inbox?: string; folder?: string; page?: string; uid?: string; q?: string; compose?: string; to?: string; images?: string };

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TZ }).format(x);
  return new Intl.DateTimeFormat("en-GB", day(d) === day(new Date())
    ? { timeZone: TEAM_TZ, hour: "2-digit", minute: "2-digit" }
    : { timeZone: TEAM_TZ, day: "numeric", month: "short" }).format(d);
}

export default async function MailboxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { member } = await currentMember();
  const inboxes = member ? await myImapInboxes(member.id).catch(() => []) : [];

  if (!inboxes.length) {
    return (
      <>
        <PageHeader title="Mailbox" description="Read, write and reply to email from your own inbox." />
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Connect a GoDaddy (or other IMAP) inbox on the <Link href="/account" className="underline">Account page</Link> to use it here.
          Gmail inboxes are read in Gmail itself.
        </CardContent></Card>
      </>
    );
  }

  const inbox = inboxes.find((i) => i.id === sp.inbox) ?? inboxes[0];
  const folder: Folder = (FOLDERS as readonly string[]).includes(sp.folder ?? "") ? (sp.folder as Folder) : "inbox";
  const page = Math.max(0, Math.floor(Number(sp.page) || 0));
  const uid = Number(sp.uid) || null;
  const q = sp.q?.trim().slice(0, 100) || null;
  const compose = (["new", "reply", "replyall", "forward"] as const).find((m) => m === sp.compose) ?? null;
  const images = sp.images === "1";

  const href = (p: Partial<Record<keyof Params, string | number | null>>) => {
    const base: Record<string, string | number | null> = { inbox: inbox.id, folder, page, q, uid, compose: null, images: null };
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...base, ...p })) {
      if (v === null || v === undefined || v === "" || (k === "page" && v === 0) || (k === "folder" && v === "inbox")) continue;
      query.set(k, String(v));
    }
    if (inboxes.length === 1) query.delete("inbox");
    const s = query.toString();
    return s ? `/mailbox?${s}` : "/mailbox";
  };

  let view: MailboxView = { folders: ["inbox"], unread: 0, total: 0, items: [], message: null };
  let error: string | null = null;
  try {
    view = await loadMailbox(inbox.settings, { folder, page, size: PAGE, q, uid: compose === "new" ? null : uid });
  } catch (e) {
    error = e instanceof Error ? e.message : "Couldn't read this inbox";
  }
  const message = view.message;

  // Which senders/recipients are leads in the CRM (team-visible data, through RLS).
  const supabase = await supabaseServer();
  const addrs = [...new Set([...view.items.flatMap((m) => [m.from, ...m.to]), ...(message?.addresses ?? []), sp.to?.toLowerCase() ?? ""])]
    .filter((a) => a && a !== inbox.email);
  const leads = new Map<string, Lead>();
  const [contactsRes, accountsRes] = await Promise.all([
    addrs.length ? supabase.from("contacts").select("email,company_id,companies(name)").in("email", addrs.slice(0, 300)) : null,
    compose ? supabase.rpc("my_mail_accounts") : null,
  ]);
  for (const c of (contactsRes?.data ?? []) as unknown as { email: string; company_id: string; companies: { name: string } | null }[]) {
    leads.set(c.email.toLowerCase(), { company_id: c.company_id, name: c.companies?.name ?? "Lead" });
  }
  const signature = ((accountsRes?.data ?? []) as { id: string; signature: string | null }[]).find((a) => a.id === inbox.id)?.signature;
  const leadFor = (m: { from: string; to: string[] }) => (folder === "sent" || folder === "drafts" ? m.to.map((a) => leads.get(a)).find(Boolean) : leads.get(m.from));
  const messageLead = message?.addresses.map((a) => leads.get(a)).find(Boolean);
  const webmail = webmailUrl(inbox.imapHost);
  const pages = Math.max(1, Math.ceil(view.total / PAGE));
  const paneOpen = !!message || !!compose;

  // Compose defaults: a new email (optionally to someone), or a reply/forward of the open message.
  let composeProps: Parameters<typeof ComposeForm>[0] | null = null;
  if (compose && (compose === "new" || message)) {
    const mode: ComposeMode = compose;
    const recips = message && (mode === "reply" || mode === "replyall") ? replyRecipients(message, inbox.email, mode === "replyall") : null;
    composeProps = {
      inboxes: inboxes.map((i) => ({ id: i.id, email: i.email })), inboxId: inbox.id, mode,
      src: message && mode !== "new" ? { folder, uid: message.uid } : null,
      defaults: {
        to: recips ? recips.to.join(", ") : mode === "new" ? sp.to ?? "" : "",
        cc: recips ? recips.cc.join(", ") : "",
        subject: !message || mode === "new" ? "" : mode === "forward" ? forwardSubject(message.subject) : replySubject(message.subject),
      },
      quoted: !message || mode === "new" ? null : mode === "forward" ? forwardBlock(message, TEAM_TZ) : quoteReply(message, TEAM_TZ),
      hasFiles: !!message?.attachments.length,
      hasSignature: !!signature?.trim(),
      done: href({ folder: mode === "new" ? "sent" : folder, uid: mode === "new" ? null : uid, page: mode === "new" ? 0 : page, q: mode === "new" ? null : q }),
      cancel: href({ compose: null }),
    };
  }

  return (
    <>
      <PageHeader title="Mailbox" description={inbox.email}>
        {inboxes.length > 1 && inboxes.map((i) => (
          <Button key={i.id} asChild size="sm" variant={i.id === inbox.id ? "secondary" : "ghost"}>
            <Link href={`/mailbox?inbox=${i.id}`}>{i.email}</Link>
          </Button>
        ))}
        <Button asChild size="sm" variant="outline"><Link href={href({ uid: null, compose: null })}><RefreshCw />Refresh</Link></Button>
        {webmail && <Button asChild size="sm" variant="ghost"><a href={webmail} target="_blank" rel="noreferrer">Webmail <ExternalLink /></a></Button>}
        <Button asChild size="sm"><Link href={href({ compose: "new", uid: null })}><PenSquare />Compose</Link></Button>
      </PageHeader>

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[10.5rem_minmax(0,1fr)]">
        {/* Folders: a column on desktop, a scrolling row on phones. */}
        <nav className={cn("flex gap-1 overflow-x-auto lg:flex-col", paneOpen && "hidden lg:flex")} aria-label="Folders">
          {view.folders.map((f) => {
            const Icon = FOLDER_ICON[f];
            return (
              <Button key={f} asChild size="sm" variant={f === folder ? "secondary" : "ghost"} className="shrink-0 justify-start">
                <Link href={href({ folder: f, page: 0, uid: null, q: null })}>
                  <Icon />{FOLDER_LABEL[f]}
                  {f === "inbox" && view.unread > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{view.unread}</span>}
                </Link>
              </Button>
            );
          })}
        </nav>

        <div className={cn("grid min-w-0 gap-4", paneOpen && "xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]")}>
          <Card className={cn("min-w-0 gap-0 overflow-hidden py-0", paneOpen && "hidden xl:block")}>
            <form action="/mailbox" className="flex items-center gap-2 border-b p-2">
              {inboxes.length > 1 && <input type="hidden" name="inbox" value={inbox.id} />}
              {folder !== "inbox" && <input type="hidden" name="folder" value={folder} />}
              <Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
              <Input name="q" defaultValue={q ?? ""} placeholder={`Search ${FOLDER_LABEL[folder]}`} className="h-8 border-0 shadow-none focus-visible:ring-0" />
              {q && <Button asChild size="icon" variant="ghost" className="size-8" aria-label="Clear search"><Link href={href({ q: null, page: 0, uid: null })}><X /></Link></Button>}
            </form>
            {view.items.length === 0 && !error ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{q ? `Nothing in ${FOLDER_LABEL[folder]} matches “${q}”.` : "No messages here."}</p>
            ) : (
              <ul className="divide-y">
                {view.items.map((m) => {
                  const lead = leadFor(m);
                  const unread = !m.seen && folder !== "sent" && folder !== "drafts";
                  const outgoing = folder === "sent" || folder === "drafts";
                  return (
                    <li key={m.uid}>
                      <Link href={href({ uid: m.uid, compose: null })} className={cn("block px-4 py-3 transition-colors hover:bg-accent/60", m.uid === uid && "bg-accent")}>
                        <div className="flex items-center gap-2 text-sm">
                          {unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                          <span className={cn("min-w-0 flex-1 truncate", unread ? "font-semibold" : "font-medium")}>
                            {outgoing ? `To: ${m.to[0] ?? ""}${m.to.length > 1 ? ` +${m.to.length - 1}` : ""}` : m.fromName || m.from}
                          </span>
                          {m.answered && <CornerUpLeft className="size-3.5 text-muted-foreground" aria-label="Replied" />}
                          {m.flagged && <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Starred" />}
                          <span className="shrink-0 text-xs text-muted-foreground">{when(m.date)}</span>
                        </div>
                        <div className={cn("mt-0.5 truncate text-sm", unread ? "text-foreground" : "text-muted-foreground")}>{m.subject}</div>
                        {lead && <Badge variant="outline" className="mt-1.5 border-sky-200 bg-sky-50 font-normal text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">Lead · {lead.name}</Badge>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {pages > 1 && (
              <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                {page > 0
                  ? <Button asChild size="sm" variant="ghost"><Link href={href({ page: page - 1, uid: null })}><ChevronLeft />Newer</Link></Button>
                  : <span className="w-16" />}
                Page {page + 1} of {pages} · {view.total}
                {page + 1 < pages
                  ? <Button asChild size="sm" variant="ghost"><Link href={href({ page: page + 1, uid: null })}>Older<ChevronRight /></Link></Button>
                  : <span className="w-16" />}
              </div>
            )}
          </Card>

          {composeProps && (
            <Card className="min-w-0 py-0">
              <div className="space-y-4 p-4">
                <div className="flex items-center gap-2">
                  <Link href={composeProps.cancel} className="text-muted-foreground hover:text-foreground xl:hidden" aria-label="Back"><ArrowLeft className="size-4" /></Link>
                  <h2 className="text-lg font-semibold">
                    {{ new: "New email", reply: "Reply", replyall: "Reply all", forward: "Forward" }[composeProps.mode]}
                  </h2>
                  {messageLead && composeProps.mode !== "new" && <Badge variant="outline" className="font-normal">Lead · {messageLead.name}</Badge>}
                </div>
                <ComposeForm {...composeProps} />
              </div>
            </Card>
          )}

          {message && !composeProps && (
            <Card className="min-w-0 gap-0 py-0">
              <div className="space-y-3 border-b p-4">
                <Link href={href({ uid: null })} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground xl:hidden"><ArrowLeft className="size-4" />Back</Link>
                <h2 className="text-lg font-semibold break-words">{message.subject}</h2>
                <div className="space-y-0.5 text-sm">
                  <div className="break-words"><span className="text-muted-foreground">From </span>{message.fromText}</div>
                  {message.toText && <div className="break-words"><span className="text-muted-foreground">To </span>{message.toText}</div>}
                  {message.ccText && <div className="break-words"><span className="text-muted-foreground">Cc </span>{message.ccText}</div>}
                  <div className="text-xs text-muted-foreground">{message.date ? `${new Date(message.date).toLocaleString("en-GB", { timeZone: TEAM_TZ })} · ${ago(message.date)}` : ""}</div>
                </div>
                <MessageActions
                  inboxId={inbox.id} folder={folder} uid={message.uid} flagged={message.flagged} back={href({ uid: null })}
                  href={(c) => href({ compose: c })}
                />
                {messageLead && (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/leads/${messageLead.company_id}#email`}>Open lead · {messageLead.name}</Link>
                  </Button>
                )}
              </div>
              <div className="space-y-3 p-4">
                {message.html ? (
                  <>
                    {hasRemoteImages(message.html) && (
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <ImageOff className="size-3.5" />
                        {images ? "Images from the internet are shown." : "Images from the internet are hidden, so the sender can't tell you opened it."}
                        <Link className="underline" href={href({ images: images ? null : "1" })}>{images ? "Hide them" : "Show images"}</Link>
                      </p>
                    )}
                    <EmailFrame title={message.subject} doc={emailDocument(message.html, { images })} />
                  </>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text || "(This email has no text.)"}</p>
                )}
                {message.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    {message.attachments.map((a) => (
                      <a key={a.index} download
                        href={`/api/mailbox/attachment?${new URLSearchParams({ inbox: inbox.id, folder, uid: String(message.uid), i: String(a.index) })}`}
                        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                        <Paperclip className="size-3.5" />{a.filename} · {Math.max(1, Math.round(a.size / 1024))} KB
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {compose && compose !== "new" && !message && !error && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">That email isn&apos;t here any more.</CardContent></Card>
          )}
        </div>
      </div>
    </>
  );
}
