"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { DAYS, availableSlots, type CalendarRules, type Range, type WeekHours } from "@/lib/booking";
import { deleteCalendar, saveCalendar } from "@/app/(app)/calendar/actions";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type EditableCalendar = CalendarRules & {
  id: string; name: string; slug: string; description: string | null; host_member_id: string; location_type: string;
  location_detail: string | null; confirmation_note: string | null; active: boolean;
};

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Toronto",
  "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "Europe/London", "Asia/Karachi"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const sel = "h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs";
type N = number | "";

function Num({ name, label, value, onChange, min, max, help }: { name: string; label: string; value: N; onChange: (v: N) => void; min: number; max: number; help?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

export function CalendarEditor({ calendar: c, origin, team }: { calendar: EditableCalendar; origin: string; team: { id: string; name: string }[] }) {
  const [hours, setHours] = useState<WeekHours>(c.availability ?? {});
  const [tz, setTz] = useState(c.timezone);
  const [duration, setDuration] = useState<N>(c.duration_min);
  const [slotEvery, setSlotEvery] = useState<N>(c.slot_interval_min);
  const [before, setBefore] = useState<N>(c.buffer_before_min);
  const [after, setAfter] = useState<N>(c.buffer_after_min);
  const [notice, setNotice] = useState<N>(c.min_notice_hours);
  const [ahead, setAhead] = useState<N>(c.max_days_ahead);
  const [perDay, setPerDay] = useState<N>(c.max_per_day ?? "");
  const [location, setLocation] = useState(c.location_type);
  const [slug, setSlug] = useState(c.slug);

  const setDay = (d: number, ranges: Range[]) => setHours((h) => ({ ...h, [String(d)]: ranges }));
  const preview = useMemo(() => {
    try {
      const rules: CalendarRules = {
        timezone: tz, availability: hours, duration_min: Number(duration) || 30, slot_interval_min: Number(slotEvery) || 30,
        buffer_before_min: Number(before) || 0, buffer_after_min: Number(after) || 0, min_notice_hours: Number(notice) || 0,
        max_days_ahead: Math.min(Number(ahead) || 14, 365), max_per_day: perDay === "" ? null : Number(perDay),
      };
      const slots = availableSlots(rules, [], [], new Date(), undefined, 7);
      const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
      const t = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
      const m = new Map<string, string[]>();
      for (const s of slots) m.set(fmt(s), [...(m.get(fmt(s)) ?? []), t(s)]);
      return [...m.entries()].slice(0, 4);
    } catch { return []; }
  }, [tz, hours, duration, slotEvery, before, after, notice, ahead, perDay]);

  return (
    <ActionForm action={saveCalendar.bind(null, c.id)} className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <input type="hidden" name="availability" value={JSON.stringify(hours)} />
      <div className="grid content-start gap-6">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle><CardDescription>What clients see on the booking page.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={c.name} required maxLength={120} /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="slug">Link</Label>
              <div className="flex items-center gap-1 text-sm text-muted-foreground"><span className="shrink-0">{origin}/book/</span>
                <Input id="slug" name="slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required maxLength={60} /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="description">Description</Label><Textarea id="description" name="description" defaultValue={c.description ?? ""} rows={3} maxLength={2000} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="location_type">Where</Label>
                <select id="location_type" name="location_type" value={location} onChange={(e) => setLocation(e.target.value)} className={sel}>
                  <option value="google_meet">Google Meet (link made automatically)</option>
                  <option value="phone">Phone call (we call them)</option>
                  <option value="custom">Somewhere else (address or link)</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="host_member_id">Host</Label>
                <select id="host_member_id" name="host_member_id" defaultValue={c.host_member_id} className={sel}>
                  {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            {location === "custom" && (
              <div className="grid gap-1.5"><Label htmlFor="location_detail">Address or meeting link</Label>
                <Input id="location_detail" name="location_detail" defaultValue={c.location_detail ?? ""} maxLength={300} /></div>
            )}
            <div className="grid gap-1.5"><Label htmlFor="confirmation_note">Note on the confirmation (optional)</Label>
              <Input id="confirmation_note" name="confirmation_note" defaultValue={c.confirmation_note ?? ""} maxLength={1000}
                placeholder="e.g. Have your current website and Google profile handy." /></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox name="active" defaultChecked={c.active} />Live: people can book</label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Weekly hours</CardTitle><CardDescription>When you can take meetings, in the time zone below.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5 sm:max-w-sm">
              <Label htmlFor="timezone">Time zone</Label>
              <select id="timezone" name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} className={sel}>
                {[...new Set([tz, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            {ORDER.map((d) => {
              const ranges = hours[String(d)] ?? [];
              return (
                <div key={d} className="flex flex-wrap items-start gap-3 border-t pt-3">
                  <label className="flex w-32 items-center gap-2 pt-2 text-sm font-medium">
                    <Checkbox checked={ranges.length > 0} onCheckedChange={(v) => setDay(d, v === true ? [{ start: "09:00", end: "17:00" }] : [])} />{DAYS[d]}
                  </label>
                  <div className="grid flex-1 gap-2">
                    {!ranges.length && <span className="pt-2 text-sm text-muted-foreground">Unavailable</span>}
                    {ranges.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input type="time" value={r.start} className="w-32" aria-label={`${DAYS[d]} start`}
                          onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                        <span className="text-muted-foreground">–</span>
                        <Input type="time" value={r.end} className="w-32" aria-label={`${DAYS[d]} end`}
                          onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                        <Button type="button" size="icon" variant="ghost" aria-label="Remove" onClick={() => setDay(d, ranges.filter((_, j) => j !== i))}><X /></Button>
                      </div>
                    ))}
                  </div>
                  {ranges.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setDay(d, [...ranges, { start: "13:00", end: "17:00" }])}><Plus />Add hours</Button>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader><CardTitle>Booking rules</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Num name="duration_min" label="Meeting length (min)" value={duration} onChange={setDuration} min={5} max={480} />
            <Num name="slot_interval_min" label="Start times every (min)" value={slotEvery} onChange={setSlotEvery} min={5} max={240} help="e.g. 30 = 9:00, 9:30, 10:00…" />
            <Num name="buffer_before_min" label="Buffer before (min)" value={before} onChange={setBefore} min={0} max={240} />
            <Num name="buffer_after_min" label="Buffer after (min)" value={after} onChange={setAfter} min={0} max={240} help="Free time kept around each meeting" />
            <Num name="min_notice_hours" label="Minimum notice (hours)" value={notice} onChange={setNotice} min={0} max={720} help="No bookings sooner than this" />
            <Num name="max_days_ahead" label="Bookable up to (days ahead)" value={ahead} onChange={setAhead} min={1} max={365} />
            <Num name="max_per_day" label="Max meetings per day" value={perDay} onChange={setPerDay} min={1} max={50} help="Empty = no limit" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Next open times</CardTitle><CardDescription>What clients would see, before your Google Calendar and other bookings are taken out.</CardDescription></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {!preview.length && <p className="text-muted-foreground">No open times in the next week with these settings.</p>}
            {preview.map(([d, ts]) => (
              <div key={d}><span className="font-medium">{d}:</span> <span className="text-muted-foreground">{ts.slice(0, 8).join(", ")}{ts.length > 8 ? ` +${ts.length - 8} more` : ""}</span></div>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <SubmitButton>Save calendar</SubmitButton>
          <Button asChild variant="outline"><a href={`/book/${c.slug}`} target="_blank" rel="noreferrer">Open booking page</a></Button>
          <Button type="button" variant="ghost" className="ml-auto text-muted-foreground"
            onClick={async () => { if (window.confirm("Delete this calendar? Its booking link stops working and its bookings are deleted.")) await deleteCalendar(c.id); }}>
            <Trash2 />Delete
          </Button>
        </div>
      </div>
    </ActionForm>
  );
}
