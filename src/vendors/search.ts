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
export const MAX_SEARCHES = MAX_GROUPS + 1;

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

export function brandQuery(oem: string, city: string, country: Country): string {
  return `${oem} spare parts dealer in ${city}, ${country.name}`;
}

/**
 * The one search that names no brand, for the multi-brand shops that stock several makes. The
 * trade comes from the rules table, using the first group's manufacturer.
 */
export function genericQuery(oem: string, city: string, country: Country): string {
  const trade = genericVendorQueryFor(oem) ?? "spare parts";
  return `${trade} in ${city}, ${country.name}`;
}

/** Kilometres between two points on a sphere. Straight-line, not driving distance, and said so. */
export function haversineKm(a: Point, b: Point): number {
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
  groups: readonly BrandGroup[],
  country: Country,
  city: string,
  shared: Point | null,
): Promise<SupplierSearch> {
  if (groups.length === 0) return { suppliers: [], failure: null, origin: null };
  if (key === undefined || key === "") {
    return { suppliers: [], failure: "unavailable", origin: null };
  }
  const region = regionCodeFor(country);

  let origin: Origin | null = shared === null ? null : { ...shared, label: "you" };
  if (origin === null) {
    try {
      const point = await searchOrigin(key, `${city.trim()}, ${country.name}`, region);
      if (point === null) return { suppliers: [], failure: "city", origin: null };
      origin = { ...point, label: `${city.trim()} centre` };
    } catch (error) {
      const kind: PlacesFailure = error instanceof PlacesError ? error.kind : "unavailable";
      return { suppliers: [], failure: kind, origin: null };
    }
  }

  const calls: { oem: string | null; query: string }[] = groups
    .slice(0, MAX_GROUPS)
    .map((group) => ({ oem: group.oem, query: brandQuery(group.oem, city, country) }));
  calls.push({ oem: null, query: genericQuery(groups[0]!.oem, city, country) });

  const bias: Point = { lat: origin.lat, lng: origin.lng };
  const answers = await Promise.all(
    calls.slice(0, MAX_SEARCHES).map(async (call) => {
      try {
        const places = await searchText(key, call.query, {
          ...(region === undefined ? {} : { regionCode: region }),
          bias,
          biasRadiusM: BIAS_RADIUS_M,
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
  const partsOf = (oem: string): string[] =>
    (groups.find((g) => g.oem === oem)?.results ?? []).map(partKey);

  for (const { call, places } of answers) {
    for (const place of places) {
      let supplier = byId.get(place.id);
      if (supplier === undefined) {
        supplier = {
          place,
          matchedGroups: [],
          matchedParts: [],
          multiBrandOnly: true,
          distanceKm: place.location === null ? null : haversineKm(origin, place.location),
        };
        byId.set(place.id, supplier);
        order.push(place.id);
      }
      if (call.oem === null) continue;
      if (supplier.matchedGroups.includes(call.oem)) continue;
      supplier.matchedGroups.push(call.oem);
      supplier.multiBrandOnly = false;
      for (const key of partsOf(call.oem)) {
        if (!supplier.matchedParts.includes(key)) supplier.matchedParts.push(key);
      }
    }
  }

  const suppliers = order.map((id) => byId.get(id)!);
  const far = Number.POSITIVE_INFINITY;
  suppliers.sort(
    (a, b) =>
      b.matchedParts.length - a.matchedParts.length ||
      (a.distanceKm ?? far) - (b.distanceKm ?? far) ||
      (b.place.rating ?? 0) - (a.place.rating ?? 0),
  );
  return { suppliers, failure: null, origin };
}

/** Rounded the way a card reads it: one decimal under 10 km, whole kilometres above. */
export function formatDistance(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
