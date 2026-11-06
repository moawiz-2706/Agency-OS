"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, Check, Code2, Copy, ExternalLink, Link2, Pencil, Plus, Video } from "lucide-react";
import { cancelBookingAction, createCalendar, disconnectGoogleCalendar, setCalendarOptions, setTeamBookingLink } from "@/app/(app)/calendar/actions";
import { TEAM_TZ } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CalendarRow = { id: string; name: string; slug: string; duration_min: number; host_member_id: string; active: boolean; timezone: string };
export type MeetingRow = {
  id: string; name: string; email: string; phone: string | null; company_name: string | null; notes: string | null; start_at: string; end_at: string;
  status: "booked" | "cancelled"; meet_url: string | null; company_id: string | null; host_member_id: string | null; calendar_id: string;
  cancel_reason: string | null; host: string; calendar: string; mine: boolean;
};
type Google = { email: string; check_conflicts: boolean; add_events: boolean; last_error: string | null; needs_reconnect: boolean } | null;

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TEAM_TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const hm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TEAM_TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error("Couldn't copy"));
}

export function CalendarHome(p: {
  origin: string; calendars: (CalendarRow & { host: string; google: boolean })[]; meetings: MeetingRow[]; google: Google; isOwner: boolean;
  bookingUrl: string | null; gcal: string | null; reason: string | null; ready: boolean; now: number; team: { name: string; google: string | null; reconnect: boolean }[];
}) {
  const [who, setWho] = useState<"all" | "mine">("all");
  const [pending, start] = useTransition();
  const upcoming = p.meetings.filter((m) => (who === "all" || m.mine) && (m.status === "booked" || Date.parse(m.start_at) > p.now));
  const groups = new Map<string, MeetingRow[]>();
  for (const m of upcoming) groups.set(day(m.start_at), [...(groups.get(day(m.start_at)) ?? []), m]);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => {
    const r = await fn();
    if (r.ok) toast.success(r.message ?? "Done"); else toast.error(r.error ?? "Failed");
  });

  return (
    <div className="grid gap-6">
      {p.gcal === "connected" && <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">Google Calendar connected. Your busy times now block booking slots, and new bookings are added to your calendar.</p>}
      {p.gcal === "error" && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">Couldn&apos;t connect Google Calendar: {p.reason}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-2">
            <div className="flex-1"><CardTitle>Meetings</CardTitle><CardDescription>Booked by clients on your booking pages. Times in Pakistan time.</CardDescription></div>
            <div className="flex rounded-md border p-0.5">
              {(["all", "mine"] as const).map((w) => <Button key={w} size="sm" variant={who === w ? "secondary" : "ghost"} className="h-7" onClick={() => setWho(w)}>{w === "all" ? "Everyone" : "Mine"}</Button>)}
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!groups.size && <p className="py-6 text-center text-sm text-muted-foreground"><CalendarDays className="mx-auto mb-2 size-8" />No meetings booked yet. Share a booking link below.</p>}
            {[...groups.entries()].map(([d, ms]) => (
              <div key={d} className="grid gap-2">
                <h3 className="text-sm font-semibold">{d}</h3>
                {ms.map((m) => (
                  <div key={m.id} className={cn("grid gap-1 rounded-lg border p-3 text-sm", m.status === "cancelled" && "opacity-60")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular-nums">{hm(m.start_at)}–{hm(m.end_at)}</span>
                      <span className="font-medium">{m.name}</span>
                      {m.company_name && <span className="text-muted-foreground">· {m.company_name}</span>}
                      {m.status === "cancelled" && <Badge variant="outline">Cancelled</Badge>}
                      <span className="ml-auto text-xs text-muted-foreground">{m.calendar} · {m.host}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <a href={`mailto:${m.email}`} className="hover:underline">{m.email}</a>
                      {m.phone && <a href={`tel:${m.phone}`} className="hover:underline">{m.phone}</a>}
                      {m.meet_url && m.status === "booked" && <a href={m.meet_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline"><Video className="size-3.5" />Meet</a>}
                      {m.company_id && <Link href={`/leads/${m.company_id}`} className="text-primary hover:underline">Open lead</Link>}
                    </div>
                    {m.notes && <p className="text-xs whitespace-pre-line text-muted-foreground">&ldquo;{m.notes}&rdquo;</p>}
                    {m.cancel_reason && <p className="text-xs text-muted-foreground">Reason: {m.cancel_reason}</p>}
                    {m.status === "booked" && Date.parse(m.start_at) > p.now && (
                      <div><Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" disabled={pending}
                        onClick={() => { const r = window.prompt(`Cancel the meeting with ${m.name}? Optional reason for them:`); if (r !== null) run(() => cancelBookingAction(m.id, r)); }}>
                        Cancel meeting</Button></div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Your Google Calendar</CardTitle>
              <CardDescription>Connect it so your busy times block booking slots and every booking lands in your calendar with a Google Meet link.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {p.google ? (
                <>
                  <p className="flex items-center gap-2"><Check className="size-4 text-emerald-600" />Connected: <span className="font-medium">{p.google.email}</span></p>
                  {(p.google.needs_reconnect || p.google.last_error) && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                      {p.google.needs_reconnect ? "Google access expired: reconnect it." : `Last problem: ${p.google.last_error}`}
                    </p>
                  )}
                  <label className="flex items-center gap-2"><Checkbox checked={p.google.check_conflicts} disabled={pending}
                    onCheckedChange={(v) => run(() => setCalendarOptions(v === true, p.google!.add_events))} />Block slots when I&apos;m busy in Google Calendar</label>
                  <label className="flex items-center gap-2"><Checkbox checked={p.google.add_events} disabled={pending}
                    onCheckedChange={(v) => run(() => setCalendarOptions(p.google!.check_conflicts, v === true))} />Add bookings to my Google Calendar (and invite the client)</label>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline"><a href="/auth/gcal/connect">Reconnect</a></Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(disconnectGoogleCalendar)}>Disconnect</Button>
                  </div>
                </>
              ) : (
                <Button asChild disabled={!p.ready}><a href="/auth/gcal/connect"><CalendarDays />Connect Google Calendar</a></Button>
              )}
              <div className="grid gap-1 border-t pt-3 text-xs text-muted-foreground">
                {p.team.map((t) => <span key={t.name}>{t.name}: {t.google ? `${t.google}${t.reconnect ? " (needs reconnecting)" : ""}` : "not connected"}</span>)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>New booking calendar</CardTitle><CardDescription>A personal calendar with you as the host. You can change everything next.</CardDescription></CardHeader>
            <CardContent>
              <form action={createCalendar} className="flex flex-wrap gap-2">
                <Input name="name" placeholder="e.g. Discovery call" defaultValue="Discovery call" required className="min-w-40 flex-1" />
                <SubmitButton><Plus />Create</SubmitButton>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Booking calendars</h2>
        {!p.calendars.length && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No booking calendars yet. Create one above.</CardContent></Card>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {p.calendars.map((c) => {
            const url = `${p.origin}/book/${c.slug}`;
            const embed = `<iframe src="${url}?embed=1" style="width:100%;min-height:640px;border:0" title="${c.name}"></iframe>\n<script>addEventListener("message",function(e){if(e.data&&e.data.type==="sentinel-booking-height"){document.querySelectorAll('iframe[src^="${url}"]').forEach(function(f){f.style.height=e.data.height+"px"})}})</script>`;
            return (
              <Card key={c.id} className="gap-3">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle className="flex-1 truncate text-base">{c.name}</CardTitle>
                    <Badge variant="outline" className={c.active ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : ""}>{c.active ? "Live" : "Off"}</Badge>
                  </div>
                  <CardDescription>{c.duration_min} min · host {c.host}{c.google ? " · Google Calendar on" : ""}{p.bookingUrl === url ? " · team booking link" : ""}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  <code className="truncate rounded bg-muted px-2 py-1 text-xs">{url}</code>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => copy(url, "Link")}><Copy />Copy link</Button>
                    <Button size="sm" variant="outline" onClick={() => copy(embed, "Website code")}><Code2 />Website code</Button>
                    <Button asChild size="sm" variant="ghost"><a href={url} target="_blank" rel="noreferrer"><ExternalLink />Open</a></Button>
                    <Button asChild size="sm" variant="ghost"><Link href={`/calendar/${c.id}`}><Pencil />Edit</Link></Button>
                    {p.isOwner && p.bookingUrl !== url && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setTeamBookingLink(url))}><Link2 />Use as team booking link</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
