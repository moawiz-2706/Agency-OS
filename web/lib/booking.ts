// Booking calendars (migration 0016): which times can be booked. Works like a
// GoHighLevel personal calendar: weekly hours in the calendar's time zone, a meeting
// length, a slot interval, buffers around meetings, minimum notice, how far ahead,
// and a daily cap. Busy times (other bookings, the host's Google Calendar) block slots.
// No app imports, so it runs in the browser and under `node --test`.

import { offsetMinutes, zonedLocalToIso } from "./tz.ts";

export type Range = { start: string; end: string };            // "09:00"–"17:00"
export type WeekHours = Record<string, Range[]>;                // "0" (Sunday) … "6" (Saturday)
export type CalendarRules = {
  timezone: string; availability: WeekHours; duration_min: number; slot_interval_min: number;
  buffer_before_min: number; buffer_after_min: number; min_notice_hours: number; max_days_ahead: number; max_per_day: number | null;
};
export type Busy = { start: string; end: string };              // ISO instants

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DEFAULT_HOURS: WeekHours = Object.fromEntries(
  DAYS.map((_, i) => [String(i), i === 0 || i === 6 ? [] : [{ start: "09:00", end: "17:00" }]]));

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Today's date in a time zone, as YYYY-MM-DD. */
export function dayIn(tz: string, at = new Date()) {
  return new Date(at.getTime() + offsetMinutes(tz, at) * 60000).toISOString().slice(0, 10);
}

/** Problems with a calendar's settings, in plain words (empty when it can be saved). */
export function rulesProblems(r: CalendarRules): string[] {
  const out: string[] = [];
  try { new Intl.DateTimeFormat("en-US", { timeZone: r.timezone }); } catch { out.push("Pick a valid time zone"); }
  const int = (v: number, lo: number, hi: number, what: string) => { if (!Number.isInteger(v) || v < lo || v > hi) out.push(`${what} must be ${lo}–${hi}`); };
  int(r.duration_min, 5, 480, "Meeting length (minutes)");
  int(r.slot_interval_min, 5, 240, "Slot interval (minutes)");
  int(r.buffer_before_min, 0, 240, "Buffer before (minutes)");
  int(r.buffer_after_min, 0, 240, "Buffer after (minutes)");
  int(r.min_notice_hours, 0, 720, "Minimum notice (hours)");
  int(r.max_days_ahead, 1, 365, "Booking window (days)");
  if (r.max_per_day !== null) int(r.max_per_day, 1, 50, "Max bookings per day");
  let any = false;
  for (const [d, ranges] of Object.entries(r.availability ?? {})) {
    for (const x of ranges ?? []) {
      any = true;
      if (!/^\d{2}:\d{2}$/.test(x.start) || !/^\d{2}:\d{2}$/.test(x.end) || toMin(x.start) >= toMin(x.end)) {
        out.push(`${DAYS[Number(d)] ?? "A day"}: the start time must be before the end time`);
      }
    }
  }
  if (!any) out.push("Open at least one day");
  return out;
}

/** A slot [start, end) clashes with a busy time when they'd be closer than the buffers: after one, before the other. */
const clashes = (start: number, end: number, b: Busy, before: number, after: number) =>
  start - before < Date.parse(b.end) + after && Date.parse(b.start) - before < end + after;

/**
 * Bookable start times (ISO), oldest first, from `fromDay` for `days` days (calendar
 * time zone). `busy` blocks with the buffers added around each slot; `booked` are this
 * calendar's own bookings, counted against the daily cap.
 */
export function availableSlots(r: CalendarRules, busy: Busy[], booked: Busy[], now: Date, fromDay?: string, days?: number): string[] {
  const today = dayIn(r.timezone, now);
  const first = fromDay && fromDay > today ? fromDay : today;
  const last = addDays(today, r.max_days_ahead - 1);
  const earliest = now.getTime() + r.min_notice_hours * 3600_000;
  const before = r.buffer_before_min * 60_000, after = r.buffer_after_min * 60_000, len = r.duration_min * 60_000;
  const out: string[] = [];
  for (let day = first, i = 0; day <= last && (days === undefined || i < days); day = addDays(day, 1), i++) {
    const ranges = r.availability[String(weekday(day))] ?? [];
    if (!ranges.length) continue;
    if (r.max_per_day !== null && booked.filter((b) => dayIn(r.timezone, new Date(b.start)) === day).length >= r.max_per_day) continue;
    for (const range of ranges) {
      for (let m = toMin(range.start); m + r.duration_min <= toMin(range.end); m += r.slot_interval_min) {
        const iso = zonedLocalToIso(`${day}T${hhmm(m)}`, r.timezone);
        if (!iso) continue;
        const start = Date.parse(iso);
        if (start < earliest) continue;
        if (busy.some((b) => clashes(start, start + len, b, before, after))) continue;
        if (!out.includes(iso)) out.push(iso);
      }
    }
  }
  return out.sort();
}

/** True when `startIso` is one of the bookable times right now (checked again before saving a booking). */
export function isBookable(r: CalendarRules, busy: Busy[], booked: Busy[], now: Date, startIso: string) {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return false;
  const day = dayIn(r.timezone, new Date(start));
  return availableSlots(r, busy, booked, now, day, 1).includes(new Date(start).toISOString());
}

/** A URL-safe calendar name: "Discovery Call (15 min)" -> "discovery-call-15-min". */
export function slugify(v: string) {
  return v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** The booking form's fields, checked (bots fill the hidden `company_url`). */
export function checkBookingForm(d: Record<string, unknown>):
  { ok: true; form: { start: string; name: string; email: string; phone: string; company: string; notes: string } } | { ok: false; error: string } | { ok: "spam" } {
  const s = (k: string, max: number) => (typeof d[k] === "string" ? (d[k] as string).trim().slice(0, max) : "");
  if (s("company_url", 10)) return { ok: "spam" };
  const form = { start: s("start", 40), name: s("name", 120), email: s("email", 200).toLowerCase(), phone: s("phone", 40), company: s("company", 160), notes: s("notes", 2000) };
  if (!form.name) return { ok: false, error: "Please enter your name" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return { ok: false, error: "Please enter a valid email address" };
  if (!Number.isFinite(Date.parse(form.start))) return { ok: false, error: "Pick a time" };
  return { ok: true, form };
}
