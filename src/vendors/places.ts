// The Google Places API (New) client: the only place Partfinder talks to Google.
//
// Two endpoints, each asked for the narrowest field mask that answers the question. Field masks
// are what Places (New) bills on, so the search asks for Pro fields only - id, name, address and
// the Maps link - and the phone number and website, which cost more, are fetched only for the
// vendors the user actually picks.
//
// Nothing that comes back is stored: place ids travel in URLs and nowhere else. Nothing is logged,
// and no Google error text ever reaches a page.

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_URL = "https://places.googleapis.com/v1/places/";

/** The Pro-tier fields the vendor list shows, and not one field more. */
export const TEXT_SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.googleMapsUri";

/** Asked for once per vendor the user picked, never for the whole list. */
export const DETAILS_FIELD_MASK =
  "id,displayName,internationalPhoneNumber,nationalPhoneNumber,websiteUri,googleMapsUri";

/** Results per Text Search call. */
export const PAGE_SIZE = 10;

/** One fetch has this long to finish, so a slow Google cannot hold a request open. */
export const REQUEST_TIMEOUT_MS = 8000;

/** What the vendor list needs about a shop. */
export interface Place {
  id: string;
  name: string;
  address: string;
  mapsUri: string;
}

/** What the contact page needs, once the user has picked a shop. */
export interface PlaceContact {
  id: string;
  name: string;
  /** In E.164-ish form, e.g. "+91 98765 43210". Empty when Google has none. */
  internationalPhone: string;
  /** As written locally, e.g. "098765 43210". Empty when Google has none. */
  nationalPhone: string;
  website: string;
  mapsUri: string;
}

/**
 * "quota" is today's Google limit; everything else - a missing key, a timeout, a 500, a body that
 * does not parse - is "unavailable". Two kinds, because the page says something different about
 * the first. Neither carries Google's own message.
 */
export type PlacesFailure = "quota" | "unavailable";

export class PlacesError extends Error {
  constructor(readonly kind: PlacesFailure) {
    super(kind);
    this.name = "PlacesError";
  }
}

/** A 403 can mean many things; only these words make it a quota problem rather than a key problem. */
const QUOTA_WORDS = /quota|rate.?limit|limit exceeded|resource.?exhausted|too many requests/i;

async function callGoogle(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    // A timeout, a DNS failure or a dropped connection. Not logged, not shown.
    throw new PlacesError("unavailable");
  }
  if (!response.ok) {
    if (response.status === 429) throw new PlacesError("quota");
    if (response.status === 403) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }
      // Read only to tell the two cases apart. The text itself goes nowhere.
      if (QUOTA_WORDS.test(detail)) throw new PlacesError("quota");
    }
    throw new PlacesError("unavailable");
  }
  try {
    return await response.json();
  } catch {
    throw new PlacesError("unavailable");
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function displayName(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  return text((value as { text?: unknown }).text);
}

/**
 * Text Search. `regionCode` is a two-letter CLDR code, left out when the user's country setting is
 * "Other", which names no region. A 200 with no places is an empty list, not an error.
 */
export async function searchText(
  key: string,
  textQuery: string,
  regionCode: string | undefined,
): Promise<Place[]> {
  const body: Record<string, unknown> = { textQuery };
  if (regionCode !== undefined) body.regionCode = regionCode;
  body.languageCode = "en";
  body.pageSize = PAGE_SIZE;

  const payload = await callGoogle(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": TEXT_SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  const places = (payload as { places?: unknown }).places;
  if (!Array.isArray(places)) return [];
  const out: Place[] = [];
  for (const raw of places) {
    if (typeof raw !== "object" || raw === null) continue;
    const place = raw as Record<string, unknown>;
    const id = text(place.id);
    if (id === "") continue;
    out.push({
      id,
      name: displayName(place.displayName),
      address: text(place.formattedAddress),
      mapsUri: text(place.googleMapsUri),
    });
  }
  return out;
}

/** Place Details for one place id. */
export async function placeDetails(key: string, id: string): Promise<PlaceContact> {
  const payload = await callGoogle(DETAILS_URL + encodeURIComponent(id), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  });
  const place = (payload ?? {}) as Record<string, unknown>;
  return {
    id: text(place.id) === "" ? id : text(place.id),
    name: displayName(place.displayName),
    internationalPhone: text(place.internationalPhoneNumber),
    nationalPhone: text(place.nationalPhoneNumber),
    website: text(place.websiteUri),
    mapsUri: text(place.googleMapsUri),
  };
}
