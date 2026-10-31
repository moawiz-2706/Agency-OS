import type { WebsiteSignals } from "./signals.js";

// What we sell, keyed the same way everywhere: companies.recommended_offers,
// research_reports.recommended_offer, the MCP tools, the research CSVs and the web filter.
export const OFFERS = {
  online_booking:       { title: "Online booking + reminders" },
  missed_call_textback: { title: "Missed-call text-back + chat" },
  speed_to_lead:        { title: "Speed-to-lead for paid leads" },
  review_automation:    { title: "Review automation" },
  website_gbp:          { title: "Website + Google Business Profile" },
  ghl_optimisation:     { title: "GoHighLevel optimisation" },
  fsm_integration:      { title: "Field-service software integration" },
} as const;

export type OfferKey = keyof typeof OFFERS;
export const OFFER_KEYS = Object.keys(OFFERS) as OfferKey[];
export const isOfferKey = (v: unknown): v is OfferKey => typeof v === "string" && v in OFFERS;

export type Offer = { key: OfferKey; title: string; priority: number; reasons: string[] };

export type OfferInput = {
  website: string | null;
  rating: number | null;
  review_count: number | null;
  signals?: WebsiteSignals | null;
};

const FSM: Record<string, string> = { servicetitan: "ServiceTitan", jobber: "Jobber", housecall_pro: "Housecall Pro" };

/**
 * Rank what to pitch from what we can see. Rules need evidence: no audit means no
 * site-based offers, and missing review data never counts as "few reviews".
 * Priority is a 0-100 sort key: paid leads going cold first, an existing GHL setup last.
 */
export function recommendOffers(c: OfferInput, now = new Date()): Offer[] {
  const out: Offer[] = [];
  const add = (key: OfferKey, priority: number, reasons: string[]) => out.push({ key, title: OFFERS[key].title, priority, reasons });
  const s = c.signals?.reachable ? c.signals : null;

  if (s) {
    const ads = s.has_ad_pixel ? s.ad_pixels.map((p) => p.replace(/_/g, " ")).join(", ") : "";
    if (s.has_ad_pixel && !s.has_online_booking && !s.has_chat_widget) {
      add("speed_to_lead", 90, [`Runs ads (${ads})`, "No online booking or chat to catch those leads"]);
    }
    if (!s.has_online_booking) {
      add("online_booking", 80, ["No online booking found; customers have to call or fill a form"]);
    }
    if (!s.has_chat_widget && !s.has_sms_cta) {
      add("missed_call_textback", 75, ["No chat widget and no \"text us\" option"]);
    }
    const fsm = s.booking_tools.filter((t) => t in FSM).map((t) => FSM[t]);
    if (fsm.length) add("fsm_integration", 45, [`Uses ${fsm.join(", ")}`]);
  }

  const reviewReasons: string[] = [];
  if (c.review_count != null && c.review_count < 50) reviewReasons.push(`Only ${c.review_count} Google reviews`);
  if (c.rating != null && c.rating < 4.3) reviewReasons.push(`Google rating ${c.rating}`);
  if (reviewReasons.length) add("review_automation", 60, reviewReasons);

  const siteReasons: string[] = [];
  if (!c.website) siteReasons.push("No website");
  if (s?.copyright_year && now.getFullYear() - s.copyright_year >= 2) siteReasons.push(`Copyright ${s.copyright_year} in the footer`);
  if (s && !s.mobile_viewport) siteReasons.push("Not mobile-friendly");
  if (siteReasons.length) add("website_gbp", c.website ? 55 : 70, siteReasons);

  if (s?.uses_ghl) add("ghl_optimisation", 20, ["Already uses GoHighLevel/LeadConnector"]);

  return out.sort((a, b) => b.priority - a.priority);
}
