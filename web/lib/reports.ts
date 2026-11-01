// Reports: the funnel and the deliverability numbers, worked out from rows the page
// reads through RLS. No app imports, so `node --test` can load it directly.

export type FunnelLead = {
  id: string; stage: string; trade: string | null; region: string | null; source: string | null; touches_count: number;
};
export const FUNNEL_STEPS = ["leads", "contacted", "replied", "interested", "meeting", "won"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export const FUNNEL_LABEL: Record<FunnelStep, string> = {
  leads: "Leads", contacted: "Contacted", replied: "Replied", interested: "Interested", meeting: "Meeting booked", won: "Won",
};

const RANK: Record<string, number> = {
  new: 0, researching: 1, ready: 2, nurture: 2, contacted: 3, replied: 4, interested: 5, meeting_booked: 6, proposal_sent: 7, won: 8,
};

/**
 * How far a lead got. Lost, nurture and disqualified leads don't say how far they went,
 * so they count as contacted if anyone touched them and as replied if they ever replied.
 */
export function reached(l: FunnelLead, repliedIds: Set<string>): Record<FunnelStep, boolean> {
  const r = RANK[l.stage] ?? -1;
  const replied = r >= 4 || repliedIds.has(l.id);
  return {
    leads: true,
    contacted: r >= 3 || l.touches_count > 0 || replied,
    replied,
    interested: r >= 5,
    meeting: r >= 6,
    won: l.stage === "won",
  };
}

export type FunnelRow = { key: string; counts: Record<FunnelStep, number> };

/** Funnel counts overall (key "All") or per trade / state / source. */
export function funnel(leads: FunnelLead[], repliedIds: Set<string>, by?: (l: FunnelLead) => string | null): FunnelRow[] {
  const rows = new Map<string, Record<FunnelStep, number>>();
  for (const l of leads) {
    const key = by ? by(l) || "Unknown" : "All";
    const c = rows.get(key) ?? { leads: 0, contacted: 0, replied: 0, interested: 0, meeting: 0, won: 0 };
    const got = reached(l, repliedIds);
    for (const s of FUNNEL_STEPS) if (got[s]) c[s]++;
    rows.set(key, c);
  }
  return [...rows].map(([key, counts]) => ({ key, counts })).sort((a, b) => b.counts.contacted - a.counts.contacted || b.counts.leads - a.counts.leads);
}

/** "12%" of b, or "–" when there's nothing to divide by. */
export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

export type DayRow = { day: string; sent: number; bounced: number; replies: number; unsubscribed: number };

/** Per-day sends, bounces, replies and unsubscribes for the last `days` days (team time zone days), newest first. */
export function deliverability(
  rows: { sent: string[]; bounced: string[]; replies: string[]; unsubscribed: string[] }, days: number, tz: string, now = new Date(),
): DayRow[] {
  const day = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
  const out = new Map<string, DayRow>();
  for (let i = 0; i < days; i++) {
    const d = day(new Date(now.getTime() - i * 86400_000));
    out.set(d, { day: d, sent: 0, bounced: 0, replies: 0, unsubscribed: 0 });
  }
  for (const k of ["sent", "bounced", "replies", "unsubscribed"] as const) {
    for (const at of rows[k]) { const r = out.get(day(at)); if (r) r[k]++; }
  }
  return [...out.values()];
}

/** Bounces over 3% of sends is the level where mailbox providers start to distrust a domain. */
export const bounceAlarm = (sent: number, bounced: number) => bounced >= 2 && bounced > 0.03 * Math.max(sent, 1);
