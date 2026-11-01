// Time zone helpers with no app imports, so `node --test` can load them directly.
import REGION_TZ from "./region-tz.json" with { type: "json" };

/** Offset of a time zone from UTC at a given instant, in minutes. */
export function offsetMinutes(tz: string, at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - at.getTime()) / 60000;
}

/** "2026-11-04T07:45" as wall-clock time in `tz`, to an ISO instant. */
export function zonedLocalToIso(local: string | null | undefined, tz: string): string | null {
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Two passes so a time just after a daylight-saving change lands on the right offset.
  const first = guess - offsetMinutes(tz, new Date(guess)) * 60000;
  return new Date(guess - offsetMinutes(tz, new Date(first)) * 60000).toISOString();
}

/** ISO instant to "YYYY-MM-DDTHH:mm" wall-clock time in `tz` (what a datetime-local field needs). */
export function isoToZonedLocal(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() + offsetMinutes(tz, d) * 60000).toISOString().slice(0, 16);
}

/** The lead's time zone: its own if set, else its state/province's main one. */
export function leadTimeZone(lead: { time_zone?: unknown; region?: unknown }): string {
  const own = typeof lead.time_zone === "string" ? lead.time_zone.trim() : "";
  if (own) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: own });
      return own;
    } catch { /* bad value: fall back */ }
  }
  const region = typeof lead.region === "string" ? lead.region.toUpperCase() : "";
  return (REGION_TZ as Record<string, string>)[region] ?? "America/New_York";
}
