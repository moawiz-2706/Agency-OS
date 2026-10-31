/** Our time zone: every date in the app is shown in it, plus the lead's own on the lead page. */
export const TEAM_TZ = process.env.NEXT_PUBLIC_TEAM_TIME_ZONE || "Asia/Karachi";

export function minutes(m: number | null | undefined) {
  const v = m ?? 0;
  if (v < 60) return `${v}m`;
  const h = Math.floor(v / 60), r = v % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function dateTime(iso: string | null | undefined, tz = TEAM_TZ) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function dateOnly(iso: string | null | undefined, tz = TEAM_TZ) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.round(f / 60)}m`;
    if (f < 86400) return `in ${Math.round(f / 3600)}h`;
    return `in ${Math.round(f / 86400)}d`;
  }
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function money(cents: number | null | undefined, currency = "USD") {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

/**
 * The dashboard's time window, fixed once per request: now, the start of the
 * last `days`, the start of the period before it, and each day in the window (TEAM_TZ).
 */
export function periodWindow(days: number, at = new Date()) {
  const now = at.getTime();
  const daysAgo = (n: number) => new Date(now - n * 86400_000);
  return {
    now: at.toISOString(),
    since: daysAgo(days).toISOString(),
    prevSince: daysAgo(2 * days).toISOString(),
    dayKeys: Array.from({ length: days }, (_, i) => teamDay(daysAgo(days - 1 - i))),
  };
}

/** Calendar day of an instant in TEAM_TZ, as "YYYY-MM-DD". */
export function teamDay(iso: string | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Short label for a "YYYY-MM-DD" day, e.g. "31 Oct". */
export function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The time it is now somewhere else, e.g. "9:42 am Thu". */
export function localNow(tz: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", weekday: "short" }).format(new Date());
  } catch {
    return null;
  }
}

/** Offset of a time zone from UTC at a given instant, in minutes. */
function offsetMinutes(tz: string, at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - at.getTime()) / 60000;
}

/** "2026-11-02T09:30" typed in a datetime-local field, read as TEAM_TZ, to an ISO instant. */
export function teamLocalToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off = offsetMinutes(TEAM_TZ, new Date(guess));
  return new Date(guess - off * 60000).toISOString();
}

/** ISO instant to the value a datetime-local field needs, in TEAM_TZ. */
export function isoToTeamLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const shifted = new Date(d.getTime() + offsetMinutes(TEAM_TZ, d) * 60000);
  return shifted.toISOString().slice(0, 16);
}
