"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive, CalendarClock, Forward, Inbox, Loader2, MailOpen, Paperclip, Reply, ReplyAll, Send, ShieldCheck, Star, Trash2, X,
} from "lucide-react";
import { cancelScheduled, flagMessage, moveTo, sendFromMailbox } from "@/app/(app)/mailbox/actions";
import type { FlagOp, Folder } from "@/lib/mail/mailbox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type ComposeMode = "new" | "reply" | "replyall" | "forward";

/** Write, reply or forward. Sends straight away from the chosen inbox, then goes to `done`. */
export function ComposeForm({ inboxes, inboxId, mode, src, defaults, quoted, hasFiles, hasSignature, done, scheduledHref, cancel, tz, minLocal }: {
  inboxes: { id: string; email: string }[];
  inboxId: string;
  mode: ComposeMode;
  src: { folder: Folder; uid: number } | null;
  defaults: { to: string; cc: string; subject: string };
  quoted: string | null;
  hasFiles: boolean;
  hasSignature: boolean;
  done: string;
  scheduledHref: string;
  cancel: string;
  /** The team's time zone, and "now" in it for the date picker. */
  tz: string;
  minLocal: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showCc, setShowCc] = useState(!!defaults.cc);
  const [files, setFiles] = useState<File[]>([]);
  const [scheduling, setScheduling] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const total = files.reduce((t, f) => t + f.size, 0);

  return (
    <form
      className="space-y-3"
      action={(form) => {
        form.delete("files");
        for (const f of files) form.append("files", f);
        if (!scheduling) form.delete("send_at");
        start(async () => {
          const res = await sendFromMailbox(form);
          if (!res.ok) { toast.error(res.error); return; }
          toast.success(res.message ?? "Sent");
          router.push(scheduling ? scheduledHref : done);
        });
      }}
    >
      <input type="hidden" name="mode" value={mode} />
      {src && <><input type="hidden" name="src_folder" value={src.folder} /><input type="hidden" name="src_uid" value={src.uid} /></>}

      <div className="grid gap-1.5">
        <Label>From</Label>
        {mode === "new" && inboxes.length > 1 ? (
          <Select name="inbox" defaultValue={inboxId}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{inboxes.map((i) => <SelectItem key={i.id} value={i.id}>{i.email}</SelectItem>)}</SelectContent>
          </Select>
        ) : (
          <>
            <input type="hidden" name="inbox" value={inboxId} />
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{inboxes.find((i) => i.id === inboxId)?.email}</p>
          </>
        )}
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="to">To</Label>
          {!showCc && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowCc(true)}>Cc / Bcc</button>}
        </div>
        <Input id="to" name="to" defaultValue={defaults.to} placeholder="name@company.com, another@company.com" required autoFocus={!defaults.to} />
      </div>
      {showCc && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="cc">Cc</Label><Input id="cc" name="cc" defaultValue={defaults.cc} /></div>
          <div className="grid gap-1.5"><Label htmlFor="bcc">Bcc</Label><Input id="bcc" name="bcc" /></div>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" defaultValue={defaults.subject} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="body">Message</Label>
        <Textarea id="body" name="body" rows={10} autoFocus={!!defaults.to} required={mode !== "forward"} placeholder="Hi Darin,&#10;&#10;…" />
      </div>

      {quoted && (
        <details className="rounded-md border bg-muted/30 text-sm">
          <summary className="cursor-pointer px-3 py-2 text-muted-foreground">
            {mode === "forward" ? "Forwarded message (included)" : "Original message"}
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-2 font-sans text-xs text-muted-foreground">{quoted}</pre>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => {
          setFiles((cur) => [...cur, ...Array.from(e.target.files ?? [])]);
          e.target.value = "";
        }} />
        <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}><Paperclip />Attach files</Button>
        {files.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
            {f.name} · {Math.max(1, Math.round(f.size / 1024))} KB
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}><X className="size-3" /></button>
          </span>
        ))}
        {total > 4 * 1024 * 1024 && <span className="text-xs text-red-600">Over 4 MB in total: remove some files</span>}
      </div>

      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2"><Checkbox name="signature" defaultChecked={hasSignature} disabled={!hasSignature} />
          Add my signature{!hasSignature && <span className="text-muted-foreground">(add one on the Account page)</span>}
        </label>
        {(mode === "reply" || mode === "replyall") && quoted && (
          <label className="flex items-center gap-2"><Checkbox name="quote" defaultChecked /> Include the original message below my reply</label>
        )}
        {mode === "forward" && hasFiles && (
          <label className="flex items-center gap-2"><Checkbox name="keep_files" defaultChecked /> Include the original attachments</label>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        Sends from your inbox (now, or at the time you schedule) and files a copy in Sent. Leads on the never-contact list or without a consent basis are
        blocked; a new email to a lead gets the opt-out line and is logged on the lead.
      </p>

      {scheduling && (
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="send_at">Send at ({tz.replace(/_/g, " ")} time)</Label>
          <Input id="send_at" name="send_at" type="datetime-local" min={minLocal} required />
          {files.length > 0 && <span className="text-xs text-red-600">Scheduled emails can&apos;t carry attachments yet.</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || total > 4 * 1024 * 1024 || (scheduling && files.length > 0)}>
          {pending ? <Loader2 className="animate-spin" /> : scheduling ? <CalendarClock /> : <Send />}{scheduling ? "Schedule" : "Send"}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => setScheduling((v) => !v)}>
          {scheduling ? <><Send />Send now instead</> : <><CalendarClock />Schedule send</>}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => router.push(cancel)}>Discard</Button>
      </div>
    </form>
  );
}

/** Reply / forward links and the server-side actions on one message. */
export function MessageActions({ inboxId, folder, uid, flagged, href, back }: {
  inboxId: string; folder: Folder; uid: number; flagged: boolean;
  href: (compose: ComposeMode) => string; back: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, leave: boolean) => start(async () => {
    const res = await fn();
    if (!res.ok) { toast.error(res.error ?? "Something went wrong"); return; }
    if (res.message) toast.success(res.message);
    if (leave) router.push(back); else router.refresh();
  });
  const flag = (op: FlagOp, leave = false) => run(() => flagMessage(inboxId, folder, uid, op), leave);
  const move = (to: Folder) => run(() => moveTo(inboxId, folder, uid, to), true);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" onClick={() => router.push(href("reply"))}><Reply />Reply</Button>
      <Button size="sm" variant="outline" onClick={() => router.push(href("replyall"))}><ReplyAll />Reply all</Button>
      <Button size="sm" variant="outline" onClick={() => router.push(href("forward"))}><Forward />Forward</Button>
      <span className="mx-1 h-5 w-px bg-border" />
      <Button size="icon" variant="ghost" disabled={pending} title={flagged ? "Remove star" : "Star"} aria-label={flagged ? "Remove star" : "Star"} onClick={() => flag(flagged ? "unstar" : "star")}>
        <Star className={flagged ? "fill-amber-400 text-amber-400" : ""} />
      </Button>
      <Button size="icon" variant="ghost" disabled={pending} title="Mark unread" aria-label="Mark unread" onClick={() => flag("unread", true)}><MailOpen /></Button>
      {folder !== "archive" && folder !== "sent" && (
        <Button size="icon" variant="ghost" disabled={pending} title="Archive" aria-label="Archive" onClick={() => move("archive")}><Archive /></Button>
      )}
      {folder !== "inbox" && folder !== "sent" && folder !== "drafts" && (
        <Button size="icon" variant="ghost" disabled={pending} title={folder === "junk" ? "Not spam: move to Inbox" : "Move to Inbox"} aria-label="Move to Inbox" onClick={() => move("inbox")}><Inbox /></Button>
      )}
      {folder !== "trash" && (
        <Button size="icon" variant="ghost" disabled={pending} title="Delete (moves to Trash)" aria-label="Delete" onClick={() => move("trash")}><Trash2 /></Button>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** An HTML email in a sandboxed frame: no scripts, no forms, links open in a new tab. */
export function EmailFrame({ doc, title }: { doc: string; title: string }) {
  return (
    <iframe
      title={title}
      srcDoc={doc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="h-[65vh] w-full rounded-md border bg-white"
    />
  );
}

/** Cancel one email that's waiting to be sent. */
export function CancelScheduled({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      const res = await cancelScheduled(id);
      if (!res.ok) toast.error(res.error); else { toast.success(res.message ?? "Cancelled"); router.refresh(); }
    })}>
      {pending ? <Loader2 className="animate-spin" /> : <X />}Cancel
    </Button>
  );
}
