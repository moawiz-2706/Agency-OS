import { GooglePlacesSource, robotsAllows, safeFetch, type LeadSource } from "@agencyos/adapters";
import { env } from "@agencyos/db";
import { USER_AGENT } from "./config.js";

// Core builds adapters from config, so adapters never read env or decide anything.

let places: LeadSource | null = null;

export function leadSource(): LeadSource {
  places ??= new GooglePlacesSource(env("GOOGLE_PLACES_API_KEY"));
  return places;
}

export const web = {
  fetch: (url: string) => safeFetch(url, { userAgent: USER_AGENT }),
  robotsAllows: (url: string) => robotsAllows(url, { userAgent: USER_AGENT }),
};
