// The seven offers, keyed exactly as in packages/core/src/offers.ts, the
// recommended_offers jsonb and research_reports.recommended_offer.
export const OFFER_TITLE = {
  online_booking: "Online booking + reminders",
  missed_call_textback: "Missed-call text-back + chat",
  speed_to_lead: "Speed-to-lead for paid leads",
  review_automation: "Review automation",
  website_gbp: "Website + Google Business Profile",
  ghl_optimisation: "GoHighLevel optimisation",
  fsm_integration: "Field-service software integration",
} as const;

export type OfferKey = keyof typeof OFFER_TITLE;
export const OFFER_KEYS = Object.keys(OFFER_TITLE) as OfferKey[];
export const isOfferKey = (v: unknown): v is OfferKey => typeof v === "string" && v in OFFER_TITLE;

export type RecommendedOffer = { key: OfferKey; title: string; priority: number; reasons: string[] };

export const SOURCE_LABEL: Record<string, string> = { claude: "Claude", external_ai: "External AI", manual: "Manual" };
