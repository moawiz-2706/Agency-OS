import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load .env from the project root, no matter where Claude Desktop starts us.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../.env"), quiet: true });

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. Add it to agencyos/.env`);
  return v;
}

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

export const USER_AGENT =
  process.env.AGENCYOS_USER_AGENT ?? "AgencyOS-LeadAudit/0.1 (business website check)";
