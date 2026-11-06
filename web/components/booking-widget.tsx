"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarCheck2, ChevronLeft, ChevronRight, Clock, Globe, Loader2, MapPin, Phone, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type BookingCalendar = {
  slug: string; name: string; description: string | null; host_name: string | null; duration_min: number;
  timezone: string; location_type: "google_meet" | "phone" | "custom"; location_detail: string | null; max_days_ahead: number;
};
type Done = { start: string; end: string; meetUrl: string | null; location: string | null; invited: boolean; note: string | null; manage: string };

const ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
  "America/Toronto", "America/Winnipeg", "America/Regina", "America/Edmonton", "America/Vancouver", "America/Halifax", "America/St_Johns",
  "Europe/London", "Asia/Karachi",
];
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const dayKey = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const longDate = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(iso));
const zoneLabel = (tz: string) => tz.replace(/^.*\//, "").replace(/_/g, " ");

function Location({ c }: { c: BookingCalendar }) {
  if (c.location_type === "google_meet") return <span className="flex items-center gap-2"><Video className="size-4" />Google Meet video call</span>;
  if (c.location_type === "phone") return <span className="flex items-center gap-2"><Phone className="size-4" />Phone call (we call you)</span>;
  return c.location_detail ? <span className="flex items-center gap-2"><MapPin className="size-4" />{c.location_detail}</span> : null;
}

export function BookingWidget({ calendar: c, embed }: { calendar: BookingCalendar; embed: boolean }) {
  const [tz, setTz] = useState(c.timezone);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);     // "YYYY-MM"
  const [day, setDay] = useState<string | null>(null);         // "YYYY-MM-DD" in tz
  const [slot, setSlot] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [opened] = useState(() => Date.now());

  // The visitor's own time zone (after hydration, so the server render matches).
  useEffect(() => {
    const id = setTimeout(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || c.timezone); } catch { /* keep the calendar's */ } });
    return () => clearTimeout(id);
  }, [c.timezone]);

  async function load() {
    try {
      const r = await fetch(`/api/book/${c.slug}?days=${Math.min(c.max_days_ahead, 62)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't load times");
      setSlots(j.slots as string[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load times");
      setSlots([]);
    }
  }
  useEffect(() => {
    const id = setTimeout(() => void load());   // after the first paint
    return () => clearTimeout(id);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Inside an iframe on the website: tell the page how tall we are.
  useEffect(() => {
    if (!embed) return;
    const send = () => window.parent?.postMessage({ type: "sentinel-booking-height", height: document.documentElement.scrollHeight }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [embed]);

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots ?? []) { const k = dayKey(s, tz); m.set(k, [...(m.get(k) ?? []), s]); }
    return m;
  }, [slots, tz]);
  const firstDay = [...byDay.keys()].sort()[0] ?? null;
  const shownMonth = month ?? (firstDay ?? dayKey(new Date().toISOString(), tz)).slice(0, 7);
  const months = [...new Set([...byDay.keys()].map((d) => d.slice(0, 7)))].sort();
  const [y, mo] = shownMonth.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const step = (n: number) => { const d = new Date(Date.UTC(y, mo - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); setDay(null); };
  const selectedDay = day ?? null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!slot) return;
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    if (Date.now() - opened < 2500) { setError("Please take a moment to check your details."); return; }
    setSending(true);
    setError(null);
    try {
      const r = await fetch(`/api/book/${c.slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, start: slot }) });
      const j = await r.json();
      if (j.taken) { setSlot(null); await load(); }
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Couldn't book");
      if (j.spam) return;
      setDone(j as Done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't book");
    } finally {
      setSending(false);
    }
  }

  const info = (
    <div className="grid min-w-0 content-start gap-3 border-b p-4 sm:p-6 md:border-r md:border-b-0">
      {c.host_name && <p className="text-sm font-medium text-muted-foreground">{c.host_name} · The Sentinel Systems</p>}
      <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
      <div className="grid gap-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2"><Clock className="size-4" />{c.duration_min} minutes</span>
        <Location c={c} />
        {slot && <span className="flex items-center gap-2 font-medium text-foreground"><CalendarCheck2 className="size-4" />{time(slot, tz)}, {longDate(slot, tz)}</span>}
      </div>
      {c.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{c.description}</p>}
    </div>
  );

  if (done) {
    return (
      <Shell embed={embed}>
        <div className="grid justify-items-center gap-3 p-8 text-center">
          <CalendarCheck2 className="size-12 text-emerald-600" />
          <h1 className="text-2xl font-semibold">You&apos;re booked</h1>
          <p className="text-lg">{time(done.start, tz)} – {time(done.end, tz)}, {longDate(done.start, tz)}</p>
          <p className="text-sm text-muted-foreground">{zoneLabel(tz)} time · {c.name}{c.host_name ? ` with ${c.host_name}` : ""}</p>
          {done.meetUrl && <a href={done.meetUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline">Google Meet link</a>}
          {!done.meetUrl && done.location && <p className="text-sm">{done.location}</p>}
          <p className="max-w-md text-sm text-muted-foreground">
            {done.invited ? "A calendar invite is on its way to your email." : "We've got your booking and will confirm by email."}
            {done.note ? ` ${done.note}` : ""}
          </p>
          <a href={done.manage} target={embed ? "_top" : undefined} className="text-sm text-muted-foreground underline">Need to cancel or change it?</a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell embed={embed}>
      <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {info}
        <div className="grid min-w-0 content-start gap-4 p-4 sm:p-6">
          {!slot ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Select a date &amp; time</h2>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" aria-label="Previous month" disabled={!months.length || shownMonth <= months[0]} onClick={() => step(-1)}><ChevronLeft /></Button>
                  <span className="w-28 text-center text-sm font-medium">{new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
                  <Button size="icon" variant="ghost" aria-label="Next month" disabled={!months.length || shownMonth >= months[months.length - 1]} onClick={() => step(1)}><ChevronRight /></Button>
                </div>
              </div>
              {slots === null ? (
                <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="grid grid-cols-7 gap-1 text-center text-sm">
                  {WEEK.map((w) => <div key={w} className="py-1 text-xs font-medium text-muted-foreground">{w}</div>)}
                  {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
                  {Array.from({ length: daysIn }, (_, i) => {
                    const d = `${shownMonth}-${String(i + 1).padStart(2, "0")}`;
                    const open = byDay.has(d);
                    return (
                      <button key={d} type="button" disabled={!open} onClick={() => setDay(d)} aria-label={d}
                        className={cn("mx-auto flex aspect-square w-full max-w-10 items-center justify-center rounded-full",
                          open ? "bg-primary/10 font-semibold text-primary hover:bg-primary/20" : "text-muted-foreground/50",
                          selectedDay === d && "bg-primary text-primary-foreground hover:bg-primary")}>
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
              )}
              {slots && !slots.length && !error && <p className="text-center text-sm text-muted-foreground">No times are open right now. Please check back soon.</p>}
              {selectedDay && (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">{longDate(byDay.get(selectedDay)![0], tz)}</p>
                  <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {byDay.get(selectedDay)!.map((s) => (
                      <Button key={s} variant="outline" className="border-primary/40 font-medium text-primary hover:bg-primary/5" onClick={() => setSlot(s)}>{time(s, tz)}</Button>
                    ))}
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Globe className="size-4 shrink-0" />
                <select value={tz} onChange={(e) => setTz(e.target.value)} className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm" aria-label="Time zone">
                  {[...new Set([tz, ...ZONES])].map((z) => <option key={z} value={z}>{zoneLabel(z)} time ({z})</option>)}
                </select>
              </label>
            </>
          ) : (
            <form onSubmit={submit} className="grid gap-3">
              <button type="button" onClick={() => setSlot(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back</button>
              <h2 className="font-semibold">Enter your details</h2>
              <div className="grid gap-1.5"><Label htmlFor="bk_name">Name *</Label><Input id="bk_name" name="name" required maxLength={120} autoComplete="name" /></div>
              <div className="grid gap-1.5"><Label htmlFor="bk_email">Email *</Label><Input id="bk_email" name="email" type="email" required maxLength={200} autoComplete="email" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label htmlFor="bk_phone">Phone{c.location_type === "phone" ? " *" : ""}</Label>
                  <Input id="bk_phone" name="phone" type="tel" maxLength={40} required={c.location_type === "phone"} autoComplete="tel" /></div>
                <div className="grid gap-1.5"><Label htmlFor="bk_company">Business name</Label><Input id="bk_company" name="company" maxLength={160} autoComplete="organization" /></div>
              </div>
              <div className="grid gap-1.5"><Label htmlFor="bk_notes">What would you like to talk about?</Label><Textarea id="bk_notes" name="notes" rows={3} maxLength={2000} /></div>
              <input type="text" name="company_url" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
              <Button type="submit" size="lg" disabled={sending}>{sending && <Loader2 className="animate-spin" />}Schedule meeting</Button>
              <p className="text-xs text-muted-foreground">By booking you agree we may contact you about this meeting.</p>
            </form>
          )}
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ embed, children }: { embed: boolean; children: React.ReactNode }) {
  if (embed) return <div className="overflow-hidden rounded-xl border bg-card">{children}</div>;
  return (
    <div className="flex min-h-dvh items-start justify-center bg-muted/40 px-3 py-6 sm:px-4 sm:py-10">
      <div className="w-full max-w-4xl overflow-hidden rounded-xl border bg-card shadow-sm">{children}</div>
    </div>
  );
}
