/** A business found by a lead source, mapped to the `companies` columns it fills. */
export type Place = {
  google_place_id: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  website_domain: string | null;
  rating: number | null;
  review_count: number | null;
  business_status: string | null;
  types: string[];
  primary_type: string | null;
  google_maps_uri: string | null;
};

export type LeadSearch = {
  query: string;
  regionCode: "US" | "CA";
  maxResults: number;
};

/** Where leads come from. Google Places now; Yelp, licence boards, CSV later. */
export interface LeadSource {
  /** Stored in `companies.source` and `search_runs`. */
  readonly name: string;
  search(opts: LeadSearch): Promise<Place[]>;
}

export function normalizeDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
