"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { classifyReply } from "@/app/(app)/mail-actions";
import { REPLY_LABELS, suggestedReply, type ReplyLabel } from "@/lib/replies";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One-click labels for a reply (each moves the lead along), and a suggested answer to copy. */
export function ReplyLabels({ id, current, suggestion, firstName, myName, bookingUrl }: {
  id: string; current: string | null; suggestion: ReplyLabel | null;
  firstName: string | null; myName: string | null; bookingUrl: string | null;
}) {
  const [pending, start] = useTransition();
  const [draftFor, setDraftFor] = useState<ReplyLabel>((current as ReplyLabel) ?? suggestion ?? "interested");
  const draft = suggestedReply(draftFor, { first_name: firstName, my_name: myName, booking_url: bookingUrl });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {REPLY_LABELS.map((l) => (
          <Button key={l.key} size="sm" type="button" disabled={pending}
            variant={current === l.key ? "default" : suggestion === l.key ? "secondary" : "outline"}
            className={cn("h-7 px-2 text-xs", suggestion === l.key && current !== l.key && "ring-1 ring-primary/40")}
            title={suggestion === l.key ? "Suggested from the reply's words" : undefined}
            onClick={() => start(async () => {
              setDraftFor(l.key);
              const res = await classifyReply(id, l.key);
              if (res.ok) toast.success(res.message ?? "Labelled"); else toast.error(res.error);
            })}>
            {suggestion === l.key && current !== l.key && <Sparkles className="size-3" />}{l.label}
          </Button>
        ))}
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <details className="rounded-md border bg-muted/30 text-sm">
        <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">Suggested answer ({REPLY_LABELS.find((l) => l.key === draftFor)?.label})</summary>
        <div className="space-y-2 border-t px-3 py-2">
          <pre className="whitespace-pre-wrap font-sans text-sm">{draft}</pre>
          <Button size="sm" variant="outline" type="button" onClick={() => navigator.clipboard.writeText(draft).then(() => toast.success("Copied"))}>
            <Copy />Copy
          </Button>
          {!bookingUrl && <p className="text-xs text-muted-foreground">Add your booking link on the Account page and it goes in here.</p>}
        </div>
      </details>
    </div>
  );
}
