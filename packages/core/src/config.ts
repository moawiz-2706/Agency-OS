/** Niche presets: the search phrases sent to Google Places. */
export const NICHES: Record<string, { label: string; queries: string[] }> = {
  hvac: { label: "HVAC", queries: ["HVAC contractor", "air conditioning repair", "furnace repair"] },
  roofing: { label: "Roofing", queries: ["roofing contractor", "roof repair"] },
  plumbing: { label: "Plumbing", queries: ["plumber", "plumbing company"] },
  electrical: { label: "Electrical", queries: ["electrician", "electrical contractor"] },
  cleaning: { label: "Cleaning", queries: ["house cleaning service", "commercial cleaning company"] },
  landscaping: { label: "Landscaping", queries: ["landscaping company", "lawn care service"] },
  pest_control: { label: "Pest control", queries: ["pest control service"] },
  garage_door: { label: "Garage door", queries: ["garage door repair"] },
};

/** Starter markets. Any "City, ST" string also works. */
export const STARTER_CITIES = [
  { city: "Dallas, TX", country: "US" },
  { city: "Houston, TX", country: "US" },
  { city: "Phoenix, AZ", country: "US" },
  { city: "Tampa, FL", country: "US" },
  { city: "Atlanta, GA", country: "US" },
  { city: "Charlotte, NC", country: "US" },
  { city: "Toronto, ON", country: "CA" },
  { city: "Calgary, AB", country: "CA" },
  { city: "Vancouver, BC", country: "CA" },
] as const;

/** Sent on every website check so site owners can see who is visiting. */
export const USER_AGENT =
  process.env.AGENCYOS_USER_AGENT ?? "AgencyOS-LeadAudit/0.1 (business website check)";

// Statuses the auto-scorer may change. Anything further along is yours.
export const AUTO_STATUSES = ["new", "review", "qualified"];

export const STATUSES = [
  "new", "qualified", "review", "ready_for_outreach", "contacted", "replied",
  "interested", "meeting_booked", "proposal_sent", "won", "lost", "disqualified",
] as const;
export type LeadStatus = (typeof STATUSES)[number];

export const CONSENT_BASES = [
  "unknown", "can_spam_b2b", "casl_implied_published", "casl_implied_relationship", "express",
] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];
