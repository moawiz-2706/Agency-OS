import { normalizeDomain, type LeadSearch, type LeadSource, type Place } from "./lead-source.js";

// Google Places API (New) — Text Search
// https://developers.google.com/maps/documentation/places/web-service/text-search
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// Only ask for what we store. Phone/website/rating fields are billed at a higher
// tier, so keep this list tight.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.types",
  "places.primaryType",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

type AddressComponent = { longText: string; shortText: string; types: string[] };

type RawPlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  types?: string[];
  primaryType?: string;
  googleMapsUri?: string;
};

function component(cs: AddressComponent[] | undefined, type: string, short = false) {
  const c = cs?.find((x) => x.types.includes(type));
  return c ? (short ? c.shortText : c.longText) : null;
}

export function toPlace(p: RawPlace): Place {
  const cs = p.addressComponents;
  return {
    google_place_id: p.id,
    name: p.displayName?.text ?? "(unnamed)",
    address: p.formattedAddress ?? null,
    city: component(cs, "locality") ?? component(cs, "sublocality") ?? component(cs, "postal_town"),
    region: component(cs, "administrative_area_level_1", true),
    country: component(cs, "country", true),
    postal_code: component(cs, "postal_code"),
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    website_domain: normalizeDomain(p.websiteUri),
    rating: p.rating ?? null,
    review_count: p.userRatingCount ?? null,
    business_status: p.businessStatus ?? null,
    types: p.types ?? [],
    primary_type: p.primaryType ?? null,
    google_maps_uri: p.googleMapsUri ?? null,
  };
}

/** Text search with pagination (Google returns max 20 per page, ~60 total). */
export class GooglePlacesSource implements LeadSource {
  readonly name = "google_places";

  constructor(private readonly apiKey: string) {}

  async search(opts: LeadSearch): Promise<Place[]> {
    const out: Place[] = [];
    let pageToken: string | undefined;

    while (out.length < opts.maxResults) {
      const body: Record<string, unknown> = {
        textQuery: opts.query,
        regionCode: opts.regionCode,
        pageSize: Math.min(20, opts.maxResults - out.length),
      };
      if (pageToken) body.pageToken = pageToken;

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Google Places ${res.status}: ${(await res.text()).slice(0, 400)}`);
      }
      const json = (await res.json()) as { places?: RawPlace[]; nextPageToken?: string };
      for (const p of json.places ?? []) out.push(toPlace(p));
      pageToken = json.nextPageToken;
      if (!pageToken || !json.places?.length) break;
      await new Promise((r) => setTimeout(r, 1500)); // token needs a moment to become valid
    }
    return out.slice(0, opts.maxResults);
  }
}
