"use client";

import { useState } from "react";
import { CalendarCheck2, CalendarX2, Loader2 } from "lucide-react";
import type { BookingInfo } from "@/lib/calendar/bookings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const when = (iso: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));

export function ManageBooking({ token, booking: b, past }: { token: string; booking: BookingInfo; past: boolean }) {
  const [status, setStatus] = useState(b.status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/book/manage/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Couldn't cancel");
      setStatus("cancelled");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-start justify-center bg-muted/40 px-4 py-10">
      <div className="grid w-full max-w-lg gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
        {status === "cancelled" ? <CalendarX2 className="mx-auto size-10 text-muted-foreground" /> : <CalendarCheck2 className="mx-auto size-10 text-emerald-600" />}
        <h1 className="text-xl font-semibold">{status === "cancelled" ? "This meeting is cancelled" : b.calendar}</h1>
        <p>{when(b.start)}</p>
        <p className="text-sm text-muted-foreground">{b.name}{b.host_name ? ` with ${b.host_name}` : ""} · The Sentinel Systems</p>
        {status === "booked" && b.meet_url && <a href={b.meet_url} className="text-sm font-medium text-primary underline" target="_blank" rel="noreferrer">Google Meet link</a>}
        {status === "booked" && !past && (
          <div className="grid gap-2 text-left">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" rows={2} maxLength={500} />
            <Button variant="outline" onClick={cancel} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Cancel this meeting</Button>
          </div>
        )}
        <a href={`/book/${b.slug}`} className="text-sm text-primary underline">{status === "cancelled" ? "Book a new time" : "Book a different time"}</a>
        {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
