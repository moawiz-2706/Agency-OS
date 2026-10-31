import type { WebsiteSignals } from "./signals.js";

/**
 * Lead score for the "Never miss a lead" home-services offer (0-100).
 * Higher = more likely to need AND pay for missed-call text-back,
 * instant lead reply, booking and review automation.
 * Tune the weights once you see which leads actually reply.
 */
export type ScoreInput = {
  business_status: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  signals?: WebsiteSignals | null;
};

export type ScoreResult = {
  score: number;
  tier: "high" | "medium" | "low";
  disqualified: boolean;
  reasons: { points: number; reason: string }[];
};

export function scoreLead(c: ScoreInput): ScoreResult {
  const reasons: ScoreResult["reasons"] = [];
  const add = (points: number, reason: string) => reasons.push({ points, reason });

  if (c.business_status && c.business_status !== "OPERATIONAL") {
    return { score: 0, tier: "low", disqualified: true, reasons: [{ points: 0, reason: `Not operational (${c.business_status})` }] };
  }

  add(20, "Target niche, operating business");
  if (c.phone) add(5, "Has a phone line (missed-call text-back fits)");

  // Reputation gap -> review automation
  const reviews = c.review_count ?? 0;
  if (reviews < 50) add(15, `Only ${reviews} Google reviews`);
  else if (reviews < 150) add(8, `${reviews} Google reviews, room to grow`);
  else if (reviews > 1000) add(-10, `${reviews} reviews — likely large / already has systems`);

  if (c.rating != null && c.rating < 4.3) add(10, `Rating ${c.rating} below 4.3`);

  if (!c.website) {
    add(5, "No website (different offer: site + funnel)");
  } else {
    add(5, "Has website to research");
    const s = c.signals;
    if (s?.reachable) {
      if (!s.has_online_booking) add(15, "No online booking found");
      if (!s.has_chat_widget) add(10, "No chat / text widget");
      if (!s.has_sms_cta) add(3, "No 'text us' option");
      if (!s.has_review_widget) add(2, "No review widget");
      if (s.has_ad_pixel) add(15, `Pays for ads (${s.ad_pixels.join(", ")}) — paying for leads it may be missing`);
      if (!s.mobile_viewport) add(5, "Site not mobile-friendly");
      if (s.uses_ghl) add(-15, "Already uses GoHighLevel/LeadConnector");
      if (s.booking_tools.some((t) => ["servicetitan", "housecall_pro", "jobber"].includes(t))) {
        add(-5, "Uses a field-service platform (integration pitch instead)");
      }
    }
  }

  const score = Math.max(0, Math.min(100, reasons.reduce((n, r) => n + r.points, 0)));
  const tier = score >= 70 ? "high" : score >= 50 ? "medium" : "low";
  return { score, tier, disqualified: false, reasons };
}

export function statusForScore(r: ScoreResult): "qualified" | "review" | "new" | "disqualified" {
  if (r.disqualified) return "disqualified";
  if (r.tier === "high") return "qualified";
  if (r.tier === "medium") return "review";
  return "new";
}
