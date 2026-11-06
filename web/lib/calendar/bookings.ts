import "server-only";
import { randomUUID } from "node:crypto";
import { availableSlots, dayIn, isBookable, type Busy, type CalendarRules, type WeekHours } from "../booking.ts";
import { decryptToken } from "../mail/crypto.ts";
import { GoogleAuthError, accessToken, revokeToken } from "../mail/google.ts";
import { workerDb, type Rpc } from "../mail/worker.ts";
import { busyTimes, createEvent, deleteEvent } from "./google-calendar.ts";

// The public booking page and staff cancellations, through the server: the database
// only lets this code in with MAILER_SECRET (no service-role key), like the website form.

export type PublicCalendar = CalendarRules & {
  id: string; slug: string; name: string; description: string | null; host_member_id: string; host_name: string | null;
  location_type: "google_meet" | "phone" | "custom"; location_detail: string | null; confirmation_note: string | null;
  busy: Busy[]; booked: Busy[];
};
type GoogleAccount = { email: string; token: string; check_conflicts: boolean; add_events: boolean };

export async function publicCalendar(slug: string): Promise<PublicCalendar | null> {
  if (!/^[a-z0-9-]{1,60}$/i.test(slug)) return null;
  const c = await workerDb()<PublicCalendar | null>("mailer_booking_calendar", { p_slug: slug });
  return c ? { ...c, availability: (c.availability ?? {}) as WeekHours } : null;
}

/** A fresh access token for the host's Google Calendar, or null (not connected, or it failed: noted on the Calendar page). */
async function hostGoogle(rpc: Rpc, memberId: string): Promise<(GoogleAccount & { access: string }) | null> {
  const a = await rpc<GoogleAccount | null>("mailer_calendar_account", { p_member: memberId }).catch(() => null);
  if (!a) return null;
  try {
    return { ...a, access: await accessToken(decryptToken(a.token, a.email)) };
  } catch (e) {
    await rpc("mailer_calendar_error", { p_member: memberId, p_error: e instanceof Error ? e.message : String(e), p_reconnect: e instanceof GoogleAuthError }).catch(() => {});
    return null;
  }
}

/** Everything that blocks time: the host's bookings, plus their Google Calendar when it's connected. */
async function busyFor(rpc: Rpc, c: PublicCalendar, now: Date) {
  const g = await hostGoogle(rpc, c.host_member_id);
  if (!g?.check_conflicts) return c.busy;
  const to = new Date(now.getTime() + (c.max_days_ahead + 1) * 86400_000);
  try {
    return [...c.busy, ...(await busyTimes(g.access, now, to))];
  } catch (e) {
    await rpc("mailer_calendar_error", { p_member: c.host_member_id, p_error: e instanceof Error ? e.message : String(e), p_reconnect: e instanceof GoogleAuthError }).catch(() => {});
    return c.busy;
  }
}

/** Bookable times from `fromDay` (calendar time zone) for up to `days` days. */
export async function slotsFor(slug: string, fromDay: string | null, days: number) {
  const c = await publicCalendar(slug);
  if (!c) return null;
  const now = new Date();
  const busy = await busyFor(workerDb(), c, now);
  return { slots: availableSlots(c, busy, c.booked, now, fromDay ?? dayIn(c.timezone, now), Math.min(Math.max(days, 1), 62)), timezone: c.timezone };
}

const LOCATION = (c: PublicCalendar) =>
  c.location_type === "google_meet" ? "Google Meet (link in the invite)"
    : c.location_type === "phone" ? "Phone call: we'll call you on the number you gave"
      : c.location_detail ?? null;

export type BookingForm = { start: string; name: string; email: string; phone: string; company: string; notes: string };

/** Save a booking made on the public page, then add it to the host's Google Calendar. */
export async function createBooking(slug: string, f: BookingForm, page: string, ipHash: string) {
  const rpc = workerDb();
  const c = await publicCalendar(slug);
  if (!c) throw new Error("this calendar is closed");
  const now = new Date();
  if (!isBookable(c, await busyFor(rpc, c, now), c.booked, now, f.start)) throw new Error("that time was just taken");
  const b = await rpc<{ id: string; token: string; start: string; end: string; company_id: string }>("mailer_booking_create", {
    p_calendar: c.id, p_start: new Date(f.start).toISOString(), p_name: f.name, p_email: f.email, p_phone: f.phone,
    p_company: f.company, p_notes: f.notes, p_page: page, p_ip_hash: ipHash,
  });

  let meetUrl: string | null = null;
  const g = await hostGoogle(rpc, c.host_member_id);
  if (g?.add_events) {
    try {
      const ev = await createEvent(g.access, {
        summary: `${c.name}: ${f.name}${f.company ? ` (${f.company})` : ""}`,
        description: [
          `Booked through The Sentinel Systems.`, `Name: ${f.name}`, `Email: ${f.email}`,
          f.phone && `Phone: ${f.phone}`, f.company && `Company: ${f.company}`, f.notes && `\nNotes:\n${f.notes}`,
        ].filter(Boolean).join("\n"),
        start: b.start, end: b.end, timezone: c.timezone, attendee: { email: f.email, name: f.name },
        meet: c.location_type === "google_meet", location: c.location_type === "custom" ? c.location_detail : null, requestId: randomUUID(),
      });
      meetUrl = ev.meetUrl;
      await rpc("mailer_booking_event", { p_booking: b.id, p_event_id: ev.id, p_meet_url: ev.meetUrl });
    } catch (e) {
      // The booking stands; the team sees it in AgencyOS even if Google refused.
      await rpc("mailer_calendar_error", { p_member: c.host_member_id, p_error: e instanceof Error ? e.message : String(e), p_reconnect: e instanceof GoogleAuthError }).catch(() => {});
    }
  }
  return { token: b.token, start: b.start, end: b.end, meetUrl, location: LOCATION(c), invited: !!g?.add_events, note: c.confirmation_note };
}

export type BookingInfo = {
  id: string; name: string; email: string; start: string; end: string; status: "booked" | "cancelled"; meet_url: string | null;
  calendar: string; slug: string; timezone: string; location_type: string; location_detail: string | null; host_name: string | null;
};

export async function bookingByToken(token: string) {
  if (!/^[a-f0-9]{32,80}$/.test(token)) return null;
  return workerDb()<BookingInfo | null>("mailer_booking_by_token", { p_token: token });
}

async function removeGoogleEvent(rpc: Rpc, r: { host_member_id: string | null; google_event_id: string | null }) {
  if (!r.host_member_id || !r.google_event_id) return;
  const g = await hostGoogle(rpc, r.host_member_id);
  if (g) await deleteEvent(g.access, r.google_event_id).catch(() => {});
}

/** The client cancels with their link. */
export async function cancelByToken(token: string, reason: string) {
  const rpc = workerDb();
  const r = await rpc<{ host_member_id: string | null; google_event_id: string | null }>("mailer_booking_cancel", { p_token: token, p_reason: reason });
  await removeGoogleEvent(rpc, r);
}

/** Staff cancelled in AgencyOS (cancel_booking already ran as them): remove the Google event too. */
export async function afterStaffCancel(r: { host_member_id: string | null; google_event_id: string | null }) {
  await removeGoogleEvent(workerDb(), r);
}

/** Disconnecting: revoke the grant at Google before the token is deleted. */
export async function revokeCalendar(memberId: string) {
  const a = await workerDb()<GoogleAccount | null>("mailer_calendar_account", { p_member: memberId }).catch(() => null);
  if (a) await revokeToken(decryptToken(a.token, a.email)).catch(() => {});
}
