import "server-only";
import { GoogleAuthError } from "../mail/google.ts";
import type { Busy } from "../booking.ts";

// The few Google Calendar calls bookings need, over plain fetch: busy times (so
// slots skip them) and creating / deleting the meeting event (with a Google Meet
// link; Google emails the invite to the client).

export const CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
export const CALENDAR_MISSING = "Please allow The Sentinel Systems to see when you're busy and add events (tick every box on Google's screen)";

async function gcal<T>(access: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new GoogleAuthError("Google Calendar access expired: reconnect it on the Calendar page");
  if (!res.ok) throw new Error(`Google Calendar: ${json.error?.message ?? res.status}`);
  return json as T;
}

/** Busy times in the member's main calendar between two instants. */
export async function busyTimes(access: string, from: Date, to: Date): Promise<Busy[]> {
  const r = await gcal<{ calendars?: Record<string, { busy?: Busy[] }> }>(access, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }),
  });
  return r.calendars?.primary?.busy ?? [];
}

export type NewEvent = {
  summary: string; description: string; start: string; end: string; timezone: string;
  attendee: { email: string; name: string }; meet: boolean; location: string | null; requestId: string;
};

/** Add the meeting to the member's calendar and invite the client (Google sends the email). */
export async function createEvent(access: string, e: NewEvent) {
  const body = {
    summary: e.summary, description: e.description,
    start: { dateTime: e.start, timeZone: e.timezone }, end: { dateTime: e.end, timeZone: e.timezone },
    attendees: [{ email: e.attendee.email, displayName: e.attendee.name }],
    ...(e.location ? { location: e.location } : {}),
    ...(e.meet ? { conferenceData: { createRequest: { requestId: e.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
    reminders: { useDefault: true },
  };
  const r = await gcal<{ id: string; hangoutLink?: string }>(access, "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", {
    method: "POST", body: JSON.stringify(body),
  });
  return { id: r.id, meetUrl: r.hangoutLink ?? null };
}

/** Remove a cancelled meeting (Google tells the client). Already gone is fine. */
export async function deleteEvent(access: string, id: string) {
  try {
    await gcal(access, `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`, { method: "DELETE" });
  } catch (e) {
    if (!/404|410|Not Found|deleted/i.test(String(e))) throw e;
  }
}
