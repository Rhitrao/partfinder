// Turning the part numbers the user carried over into Text Search calls, and the answers back
// into one list of vendors.
//
// The shape of the work: group the numbers by the manufacturer each one most likely belongs to,
// search once per group, add one search that names no brand at all, then merge by place id so a
// shop that came back for two brands is one row, not two.

import { partKey, type Country } from "../page";
import type { ParseResult } from "../parse";
import { genericVendorQueryFor } from "../rules";
import {
  BIAS_RADIUS_M,
  PlacesError,
  searchOrigin,
  searchText,
  type Place,
  type PlacesFailure,
  type Point,
} from "./places";

/** Brand groups searched per page view. */
export const MAX_GROUPS = 3;

/** Text Search calls per page view: one per brand group, plus the multi-brand one. */
const MAX_SEARCHES = MAX_GROUPS + 1;

/** Suppliers listed on the page. Four searches can return forty; nobody reads forty, and every
 * one of them is a map pin. */
export const MAX_LISTED = 15;

/** One manufacturer, and the numbers that were read as its parts. */
export interface BrandGroup {
  oem: string;
  results: ParseResult[];
}

/** A shop Google listed, and what our searches found out about it. */
export interface Supplier {
  place: Place;
  /** The brand groups it was listed under, in group order. */
  matchedGroups: string[];
  /** The part keys in those groups: what its message asks about. */
  matchedParts: string[];
  /** It came back only for the search that named no brand. */
  multiBrandOnly: boolean;
  /** Straight-line kilometres from the origin, or null when either end has no coordinates. */
  distanceKm: number | null;
}

/** Where distances are measured from, and what to call that place on the card. */
export interface Origin extends Point {
  /** "you" when the browser shared a location, otherwise the city whose centre this is. */
  label: string;
}

/** Google would not answer, or would not place the city. */
export type SupplierFailure = PlacesFailure | "city";

/**
 * The numbers grouped by their first-ranked candidate's manufacturer, in the order the
 * manufacturers first appear. At most MAX_GROUPS groups are searched; any manufacturer past that
 * is returned separately so the page can say it was not searched for rather than hide it.
 */
export function groupByOem(results: readonly ParseResult[]): {
  groups: BrandGroup[];
  notSearched: string[];
} {
  const groups: BrandGroup[] = [];
  const notSearched: string[] = [];
  for (const result of results) {
    const oem = result.candidates[0]?.oem;
    if (oem === undefined) continue;
    const existing = groups.find((g) => g.oem === oem);
    if (existing) {
      existing.results.push(result);
    } else if (groups.length < MAX_GROUPS) {
      groups.push({ oem, results: [result] });
    } else if (!notSearched.includes(oem)) {
      notSearched.push(oem);
    }
  }
  return { groups, notSearched };
}

/** Places (New) wants a two-letter CLDR region. The "Other" country setting names none. */
export function regionCodeFor(country: Country): string | undefined {
  return /^[A-Z]{2}$/.test(country.code) ? country.code : undefined;
}

/**
 * Where a supplier search looks.
 *
 * "near" is a city the buyer named. "india" is the whole country, which is what a buyer wants
 * when the part is rare enough that nobody local will have it - and what they get when they
 * leave the city empty, instead of the nothing they used to get.
 */
export type Scope = "near" | "india";

/**
 * A search subject with a place attached. The near form is unchanged from step 7; the India form
 * names the country and nothing else, and its call carries no location bias at all.
 */
export function placed(subject: string, scope: Scope, city: string, country: Country): string {
  return scope === "india" ? `${subject} in India` : `${subject} in ${city}, ${country.name}`;
}

/**
 * The scope a page view searches at: what the buyer typed, and the flag the chips carry.
 *
 * With no city there is nowhere to be near, so the whole country is the only honest answer -
 * and a better one than the "add your city" the page used to stop at. Nothing about this is
 * stored: it is derived from the query on every render and every request.
 */
export function resolveScope(city: string, flag: string): Scope {
  if (city.trim() === "") return "india";
  return flag.trim().toLowerCase() === "india" ? "india" : "near";
}

/** What to look for when the brand is what matters. */
export function brandSubject(oem: string): string {
  return `${oem} spare parts dealer`;
}

export function brandQuery(
  oem: string,
  city: string,
  country: Country,
  scope: Scope = "near",
): string {
  return placed(brandSubject(oem), scope, city, country);
}

/**
 * The one search that names no brand, for the multi-brand shops that stock several makes. The
 * trade comes from the rules table, using the first group's manufacturer.
 */
export function genericQuery(
  oem: string,
  city: string,
  country: Country,
  scope: Scope = "near",
): string {
  const trade = genericVendorQueryFor(oem) ?? "spare parts";
  return placed(trade, scope, city, country);
}

/**
 * One Text Search call, and what it is about.
 *
 * Since step 9 a search is not always a brand: a described part is searched for by its name, and
 * a number nobody placed is searched for by the words the message carried around it. So the
 * thing driving a call is no longer a BrandGroup but this - a query, the parts it speaks for,
 * and the brand it names, if it names one.
 */
export interface Ask {
  /** The subject, before a place is attached. */
  subject: string;
  /** The brand this ask names, for the "listed for X" chip. Null when it names none. */
  oem: string | null;
  /** The part keys a shop answering this ask can be asked about. */
  parts: string[];
}

/** Brand queries per page view, and the ceiling on calls: the asks plus the one that names none. */
export const MAX_ASKS = MAX_GROUPS + 1;

/** At most this many brands are searched for one described part. */
const MAX_DESCRIBED_BRANDS = 2;

/**
 * Every search one page view should make, in priority order, capped at MAX_ASKS.
 *
 * Brands first, because a shop listed for Caterpillar is the strongest signal there is. Then one
 * ask per described part - its brands, then its name - and then the words around a number nobody
 * placed. The ask that names no brand goes last and only when there were brands: it is there to
 * catch the multi-brand shops, and without a brand group there is no trade to name.
 *
 * A number nobody placed and with no words around it gets no search at all. "9ZZ123456 spare
 * parts" is not a query, it is noise, and the card's Google links are the honest answer.
 */
export function asksFor(
  results: readonly ParseResult[],
  groups: readonly BrandGroup[],
): Ask[] {
  const asks: Ask[] = groups.slice(0, MAX_GROUPS).map((group) => ({
    subject: brandSubject(group.oem),
    oem: group.oem,
    parts: group.results.map(partKey),
  }));

  for (const result of results) {
    const key = partKey(result);
    if (result.described) {
      for (const brand of result.described.brands.slice(0, MAX_DESCRIBED_BRANDS)) {
        asks.push({ subject: brandSubject(brand), oem: brand, parts: [key] });
      }
      asks.push({ subject: `${result.described.name} supplier`, oem: null, parts: [key] });
      continue;
    }
    if (result.unplaced) {
      const words = (result.words ?? []).join(" ");
      if (words === "") continue;
      asks.push({ subject: `${words} spare parts`, oem: null, parts: [key] });
    }
  }

  if (groups.length > 0) {
    const trade = genericVendorQueryFor(groups[0]!.oem) ?? "spare parts";
    asks.push({ subject: trade, oem: null, parts: [] });
  }
  return asks.slice(0, MAX_ASKS);
}

/**
 * The shop's town or neighbourhood, from Google's own short address.
 *
 * Under All India a distance from a city the buyer did not name means nothing, so the card says
 * where the shop is instead. The last component of shortFormattedAddress is the locality;
 * a trailing postcode is dropped, because "Indiranagar 560038" is not how anyone says it.
 */
export function areaOf(place: Place): string {
  const parts = (place.shortAddress === "" ? place.address : place.shortAddress)
    .split(",")
    .map((piece) => piece.replace(/\b\d{6}\b/g, "").trim())
    .filter((piece) => piece !== "");
  return parts[parts.length - 1] ?? "";
}

/** Kilometres between two points on a sphere. Straight-line, not driving distance, and said so. */
function haversineKm(a: Point, b: Point): number {
  const radius = 6371;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface SupplierSearch {
  suppliers: Supplier[];
  /** Null when the search ran. Otherwise why the section shows link-outs instead. */
  failure: SupplierFailure | null;
  /** Where distances were measured from, when they were.  */
  origin: Origin | null;
}

/**
 * The whole supplier round: at most five calls, one to place the city and up to four searches.
 *
 * The origin call is first and alone, because the searches are biased towards it. When the browser
 * shared a location there is no origin call at all. The searches then run together, are merged by
 * place id, and are sorted by how many of the user's parts each shop can be asked about, then by
 * how near it is, then by its rating.
 *
 * A quota error on any call means today's limit is gone, so the whole section falls back.
 * Otherwise the section is built from whatever calls did answer.
 */
export async function findSuppliers(
  key: string | undefined,
  asks: readonly Ask[],
  country: Country,
  city: string,
  shared: Point | null,
  scope: Scope = "near",
): Promise<SupplierSearch> {
  if (asks.length === 0) return { suppliers: [], failure: null, origin: null };
  if (key === undefined || key === "") {
    return { suppliers: [], failure: "unavailable", origin: null };
  }
  const region = regionCodeFor(country);

  // All India places nothing and biases nothing, so it makes no origin call: there is no centre
  // to measure from and a bias would quietly turn it back into a local search. A location the
  // browser shared is still an origin, because "from you" means the same thing at any scope.
  let origin: Origin | null = shared === null ? null : { ...shared, label: "you" };
  if (origin === null && scope === "near") {
    try {
      const point = await searchOrigin(key, `${city.trim()}, ${country.name}`, region);
      if (point === null) return { suppliers: [], failure: "city", origin: null };
      origin = { ...point, label: `${city.trim()} centre` };
    } catch (error) {
      const kind: PlacesFailure = error instanceof PlacesError ? error.kind : "unavailable";
      return { suppliers: [], failure: kind, origin: null };
    }
  }

  const calls = asks.slice(0, MAX_SEARCHES).map((ask) => ({
    ask,
    query: placed(ask.subject, scope, city, country),
  }));

  const bias: Point | null = origin === null ? null : { lat: origin.lat, lng: origin.lng };
  const answers = await Promise.all(
    calls.map(async (call) => {
      try {
        const places = await searchText(key, call.query, {
          ...(region === undefined ? {} : { regionCode: region }),
          ...(bias === null ? {} : { bias, biasRadiusM: BIAS_RADIUS_M }),
        });
        return { call, places, failure: null };
      } catch (error) {
        const kind: PlacesFailure = error instanceof PlacesError ? error.kind : "unavailable";
        return { call, places: [] as Place[], failure: kind };
      }
    }),
  );

  const failures = answers.map((a) => a.failure).filter((f): f is PlacesFailure => f !== null);
  if (failures.includes("quota")) return { suppliers: [], failure: "quota", origin };
  if (failures.length === answers.length) {
    return { suppliers: [], failure: "unavailable", origin };
  }

  const byId = new Map<string, Supplier>();
  const order: string[] = [];

  for (const { call, places } of answers) {
    for (const place of places) {
      let supplier = byId.get(place.id);
      if (supplier === undefined) {
        supplier = {
          place,
          matchedGroups: [],
          matchedParts: [],
          multiBrandOnly: true,
          distanceKm:
            origin === null || place.location === null
              ? null
              : haversineKm(origin, place.location),
        };
        byId.set(place.id, supplier);
        order.push(place.id);
      }
      // An ask that names no brand still says which parts it was about: the part-name ask for a
      // described part, and the words around a number nobody placed, are both specific. Only the
      // trade ask speaks for no parts at all, and that is the one that leaves multiBrandOnly set.
      if (call.ask.parts.length === 0) continue;
      supplier.multiBrandOnly = false;
      if (call.ask.oem !== null && !supplier.matchedGroups.includes(call.ask.oem)) {
        supplier.matchedGroups.push(call.ask.oem);
      }
      for (const key of call.ask.parts) {
        if (!supplier.matchedParts.includes(key)) supplier.matchedParts.push(key);
      }
    }
  }

  const suppliers = order.map((id) => byId.get(id)!);
  const far = Number.POSITIVE_INFINITY;
  if (scope === "india" && shared === null) {
    // Nothing to measure from, so the second key is how well a shop is regarded: the rating,
    // weighted by how many people gave it. log10 of the count keeps a 5.0 from two reviews below
    // a 4.4 from six hundred, without letting the count alone decide.
    const standing = (supplier: Supplier): number =>
      (supplier.place.rating ?? 0) * Math.log10((supplier.place.ratingCount ?? 0) + 1);
    suppliers.sort(
      (a, b) => b.matchedParts.length - a.matchedParts.length || standing(b) - standing(a),
    );
  } else {
    suppliers.sort(
      (a, b) =>
        b.matchedParts.length - a.matchedParts.length ||
        (a.distanceKm ?? far) - (b.distanceKm ?? far) ||
        (b.place.rating ?? 0) - (a.place.rating ?? 0),
    );
  }
  return { suppliers, failure: null, origin };
}

/** Rounded the way a card reads it: one decimal under 10 km, whole kilometres above. */
export function formatDistance(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
