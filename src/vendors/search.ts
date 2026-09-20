// Turning the part numbers the user carried over into Text Search calls, and the answers back
// into one list of vendors.
//
// The shape of the work: group the numbers by the manufacturer each one most likely belongs to,
// search once per group, add one search that names no brand at all, then merge by place id so a
// shop that came back for two brands is one row, not two.

import { outbound, type Country } from "../page";
import { extractHints, extractTokens, parse, type ParseResult } from "../parse";
import { genericVendorQueryFor } from "../rules";
import { PlacesError, searchText, type Place, type PlacesFailure } from "./places";

/** Brand groups searched per page view. */
export const MAX_GROUPS = 3;

/** Text Search calls per page view: one per brand group, plus the multi-brand one. */
export const MAX_SEARCHES = MAX_GROUPS + 1;

/** Vendors the user may ask at once. */
export const MAX_PICKS = 5;

/** Suppliers listed on the page. Four searches can return forty; nobody reads forty, and every
 * one of them is a map pin. */
export const MAX_LISTED = 15;

/** One manufacturer, and the numbers that were read as its parts. */
export interface BrandGroup {
  oem: string;
  results: ParseResult[];
}

/** A shop Google listed, and which of our searches it came back for. */
export interface Vendor {
  place: Place;
  /** The brand groups it was listed for, in group order. Empty means the multi-brand search only. */
  brands: string[];
  /** It came back for the multi-brand search too. */
  generic: boolean;
}

/** The numbers on this page: parsed, then filtered the same way the WhatsApp message filters them. */
export function partsFor(q: string): ParseResult[] {
  const hints = extractHints(q);
  return outbound(extractTokens(q).map((token) => parse(token, hints)));
}

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

export interface VendorSearch {
  vendors: Vendor[];
  /** Null when the search ran. Otherwise why the page shows link-outs instead. */
  failure: PlacesFailure | null;
}

/**
 * At most MAX_SEARCHES Text Search calls, run together, merged by place id and sorted by how many
 * of the user's brands each shop came back for. Array sort is stable, so shops tied on that stay
 * in the order Google returned them.
 *
 * A quota error on any call means today's limit is gone, so the whole page falls back. Otherwise
 * the page is built from whatever calls did answer; it falls back only when none of them did.
 */
export async function findVendors(
  key: string | undefined,
  groups: readonly BrandGroup[],
  country: Country,
  city: string,
): Promise<VendorSearch> {
  if (groups.length === 0) return { vendors: [], failure: null };
  if (key === undefined || key === "") return { vendors: [], failure: "unavailable" };

  const calls: { oem: string | null; query: string }[] = groups
    .slice(0, MAX_GROUPS)
    .map((group) => ({ oem: group.oem, query: brandQuery(group.oem, city, country) }));
  calls.push({ oem: null, query: genericQuery(groups[0]!.oem, city, country) });

  const region = regionCodeFor(country);
  const answers = await Promise.all(
    calls.slice(0, MAX_SEARCHES).map(async (call) => {
      try {
        return { call, places: await searchText(key, call.query, region), failure: null };
      } catch (error) {
        const kind: PlacesFailure = error instanceof PlacesError ? error.kind : "unavailable";
        return { call, places: [] as Place[], failure: kind };
      }
    }),
  );

  const failures = answers.map((a) => a.failure).filter((f): f is PlacesFailure => f !== null);
  if (failures.includes("quota")) return { vendors: [], failure: "quota" };
  if (failures.length === answers.length) return { vendors: [], failure: "unavailable" };

  const byId = new Map<string, Vendor>();
  const order: string[] = [];
  for (const { call, places } of answers) {
    for (const place of places) {
      let vendor = byId.get(place.id);
      if (vendor === undefined) {
        vendor = { place, brands: [], generic: false };
        byId.set(place.id, vendor);
        order.push(place.id);
      }
      if (call.oem === null) vendor.generic = true;
      else if (!vendor.brands.includes(call.oem)) vendor.brands.push(call.oem);
    }
  }
  const vendors = order.map((id) => byId.get(id)!);
  vendors.sort((a, b) => b.brands.length - a.brands.length);
  return { vendors, failure: null };
}

/** The scope field's value for "every part on this page". */
export const SCOPE_ALL = "all";

/** The scope field's value for "only the brands this shop was listed for". */
export function scopeOnly(vendor: Vendor): string {
  return `only:${vendor.brands.join("|")}`;
}

/**
 * All parts when the shop came back for every brand the user asked about, or for none of them:
 * a shop found only by the multi-brand search was never tied to one brand in the first place.
 */
export function defaultsToAllParts(vendor: Vendor, groupCount: number): boolean {
  return vendor.brands.length === 0 || vendor.brands.length >= groupCount;
}

/**
 * The parts one vendor's message carries. The scope field comes back from a form, so it is read
 * as a list of manufacturer names and nothing else; a name no group has is simply not matched.
 * A scope that matches nothing falls back to every part, because an empty requirement is not a
 * message anybody can answer.
 */
export function scopedParts(scope: string, all: readonly ParseResult[]): ParseResult[] {
  if (!scope.startsWith("only:")) return [...all];
  const wanted = new Set(scope.slice("only:".length).split("|").filter((name) => name !== ""));
  const picked = all.filter((result) => wanted.has(result.candidates[0]?.oem ?? ""));
  return picked.length > 0 ? picked : [...all];
}
