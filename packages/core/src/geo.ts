// State/province codes -> country and main time zone. Used to fill gaps in
// imported lists and, later, to send only during the lead's business hours.
// States that span zones use the zone most of their population is in.

const ET = "America/New_York", CT = "America/Chicago", MT = "America/Denver", PT = "America/Los_Angeles";

const US: Record<string, string> = {
  AL: CT, AK: "America/Anchorage", AZ: "America/Phoenix", AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET,
  FL: ET, GA: ET, HI: "Pacific/Honolulu", ID: MT, IL: CT, IN: ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET,
  MD: ET, MA: ET, MI: ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET, NJ: ET, NM: MT, NY: ET,
  NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET, SC: ET, SD: CT, TN: CT, TX: CT, UT: MT, VT: ET,
  VA: ET, WA: PT, WV: ET, WI: CT, WY: MT,
};

const CA: Record<string, string> = {
  AB: "America/Edmonton", BC: "America/Vancouver", MB: "America/Winnipeg", NB: "America/Moncton",
  NL: "America/St_Johns", NS: "America/Halifax", NT: "America/Yellowknife", NU: "America/Iqaluit",
  ON: "America/Toronto", PE: "America/Halifax", QC: "America/Toronto", SK: "America/Regina", YT: "America/Whitehorse",
};

const NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
  alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB",
  "newfoundland and labrador": "NL", newfoundland: "NL", "nova scotia": "NS", "northwest territories": "NT",
  nunavut: "NU", ontario: "ON", "prince edward island": "PE", quebec: "QC", "québec": "QC",
  saskatchewan: "SK", yukon: "YT",
};

/** "Texas" / "tx" -> "TX". Returns null when it isn't a US state or Canadian province. */
export function regionCode(raw?: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  const up = v.toUpperCase();
  if (US[up] || CA[up]) return up;
  return NAMES[v.toLowerCase()] ?? null;
}

/** "USA" / "United States" / "canada" -> "US" / "CA". */
export function countryCode(raw?: string | null): "US" | "CA" | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase().replace(/\./g, "");
  if (["us", "usa", "united states", "united states of america", "america"].includes(v)) return "US";
  if (["ca", "can", "canada"].includes(v)) return "CA";
  return null;
}

/** Country from a region code, when the list didn't say. CA wins only for real provinces. */
export function countryForRegion(region: string | null): "US" | "CA" | null {
  if (!region) return null;
  if (CA[region]) return "CA";
  if (US[region]) return "US";
  return null;
}

export function timezoneFor(country: "US" | "CA" | null, region: string | null): string | null {
  if (!region) return null;
  if (country === "CA") return CA[region] ?? null;
  if (country === "US") return US[region] ?? null;
  return US[region] ?? CA[region] ?? null;
}
