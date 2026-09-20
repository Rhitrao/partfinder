// The /parts/vendors pages: the passcode gate and the vendor search form.
//
// Server-rendered HTML, no client-side JavaScript, the same shell and stylesheet as the public
// page. Nothing the user types here is stored or logged.

import { COUNTRIES, escapeHtml, renderDocument, type Country } from "../page";
import {
  MAX_PICKS,
  SCOPE_ALL,
  defaultsToAllParts,
  scopeOnly,
  type BrandGroup,
  type Vendor,
} from "./search";

/** Rules only the vendor pages need, so the public page does not carry them. */
export const VENDOR_STYLE = `
.gate { max-width: 22rem; }
.gate p { font-size: .95rem; }
.warn { font-weight: 600; }
.back { font-size: .9rem; margin-top: 2rem; }
.back a { color: inherit; }
.caveat { font-weight: 600; }
.vendors { list-style: none; margin: 1rem 0 0; padding: 0; }
.vendor { border: 1px solid currentColor; border-radius: .5rem; padding: .75rem; margin: 1rem 0; }
.vname { font-weight: 700; margin: 0; }
.vaddr, .vfound, .vcount { font-size: .9rem; margin: .15rem 0; opacity: .85; }
.pick { display: block; margin-top: .6rem; font-weight: 600; }
.pick input, .scope input { width: auto; margin-right: .4rem; }
.scope { border: 0; padding: .4rem 0 0; margin: 0; }
.scope legend { font-size: .85rem; opacity: .85; padding: 0; }
.scope label { display: block; font-weight: 400; font-size: .95rem; }
.attribution { font-size: .9rem; margin-top: 1rem; opacity: .85; }
.pickhint { font-size: .9rem; opacity: .85; }
`;

/** The whole vendor document: the shared shell, plus the vendor rules. */
export function renderVendorDocument(main: string): string {
  return renderDocument(main, VENDOR_STYLE);
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

export const WRONG_PASSCODE = "That passcode didn't match.";

/**
 * The passcode form.
 *
 * `next` is where to go once the passcode is accepted: the path and query string the browser was
 * asking for. It is a hidden field rather than a query parameter so that nothing the user typed
 * is copied into the login URL, and the login handler re-reads it from a fixed list of paths and
 * parameters, so it can never become an open redirect.
 */
export function renderGate(next: string, message = ""): string {
  const notice = message === "" ? "" : `\n      <p class="warn">${escapeHtml(message)}</p>`;
  return renderVendorDocument(`<main class="gate">
      <h1>Find vendors</h1>
      <p>Vendor search is not public. Enter the passcode to continue.</p>${notice}
      <form method="POST" action="/parts/vendors/login">
        ${hidden("next", next)}
        <label for="passcode">Passcode</label>
        <input id="passcode" name="passcode" type="password" autocomplete="current-password">
        <button type="submit">Continue</button>
      </form>
      <p class="back"><a href="/parts/">Back to Partfinder</a></p>
    </main>`);
}

export interface VendorSearchInput {
  /** The part numbers to find vendors for, as carried from the public page. */
  q: string;
  city: string;
  country: Country;
  /** Shown above the form. Not user text. */
  notice?: string;
  /** Everything below the form: the vendor list, or the fallback links. */
  body?: string;
}

export const CITY_REQUIRED = "Enter a city, so the search has somewhere to look.";

export const NOTHING_TO_SEARCH =
  "Nothing to search for: no part number here was recognised, so there is no brand to look up.";

/** Never Google's own words. A page says what the user can do, not what went wrong at Google. */
export const UNAVAILABLE = "Vendor search isn't available right now.";

function renderSearchForm(input: VendorSearchInput): string {
  const { q, city, country } = input;
  const options = COUNTRIES.map(
    (c) =>
      `<option value="${escapeHtml(c.code)}"${c.code === country.code ? " selected" : ""}>` +
      `${escapeHtml(c.name)}</option>`,
  ).join("\n          ");
  return `<form method="GET" action="/parts/vendors/">
        <label for="q">Part numbers</label>
        <input id="q" name="q" type="text" value="${escapeHtml(q)}" placeholder="Part numbers">
        <label for="city">City</label>
        <input id="city" name="city" type="text" value="${escapeHtml(city)}" placeholder="City">
        <label for="country">Country</label>
        <select id="country" name="country">
          ${options}
        </select>
        <button type="submit">Find vendors</button>
      </form>`;
}

/** The vendor search page: the form, then whatever the caller found (or could not find). */
export function renderVendorSearch(input: VendorSearchInput): string {
  const sections: string[] = [];
  if (input.notice) sections.push(`<p class="warn">${escapeHtml(input.notice)}</p>`);
  sections.push(renderSearchForm(input));
  if (input.body) sections.push(input.body);
  const back = `/parts/?q=${encodeURIComponent(input.q)}`;
  sections.push(
    `<p class="back"><a href="${escapeHtml(back)}">Back to Partfinder</a> &middot; ` +
      `<a href="/parts/vendors/logout">Sign out</a></p>`,
  );
  return renderVendorDocument(`<main>
      <h1>Find vendors</h1>
      <p class="lede">Shops Google lists for these brands in your city. Partfinder stores no
      vendor list and vets nobody.</p>
      ${sections.join("\n      ")}
    </main>`);
}

/** Above every vendor list, in the same words each time. A listing is not an answer about stock. */
export function listingCaveat(city: string): string {
  return (
    `These are shops Google lists for these brands in ${city.trim()}. ` +
    `Being listed doesn't mean they have your part in stock. Ask them.`
  );
}

/**
 * Google's attribution for Places results.
 *
 * The Maps Platform terms require the attribution Google specifies in its documentation to be
 * shown, unmodified, wherever its content appears. The Places API policies page, which is where
 * the exact wording lives, could not be opened from the machine this was written on
 * (developers.google.com is refused by the egress proxy), so this is the fallback the step prompt
 * asked for. It is flagged in the step report and must be checked against the policies page
 * before this reaches anyone but its author.
 */
export const ATTRIBUTION = "Listings from Google Maps";

/** "Caterpillar", "Caterpillar and JCB", "Caterpillar, JCB and Komatsu". */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function radio(name: string, value: string, label: string, checked: boolean): string {
  return (
    `<label><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(value)}"` +
    `${checked ? " checked" : ""}> ${escapeHtml(label)}</label>`
  );
}

function renderVendor(vendor: Vendor, groupCount: number): string {
  const { place, brands } = vendor;
  const field = `scope_${place.id}`;
  const allParts = defaultsToAllParts(vendor, groupCount);
  const lines = [
    `<p class="vname">${escapeHtml(place.name === "" ? "Unnamed listing" : place.name)}</p>`,
  ];
  if (place.address !== "") lines.push(`<p class="vaddr">${escapeHtml(place.address)}</p>`);
  lines.push(
    brands.length > 0
      ? `<p class="vfound">Found for: ${escapeHtml(brands.join(", "))}</p>`
      : `<p class="vfound">Found by the multi-brand search, not by a brand name.</p>`,
  );
  // "0 of your 2 brands" adds nothing to the line above it, so only branded rows get a count.
  if (groupCount > 1 && brands.length > 0) {
    lines.push(
      `<p class="vcount">Appeared for ${brands.length} of your ${groupCount} brands</p>`,
    );
  }
  if (place.mapsUri !== "") {
    lines.push(`<a class="link" href="${escapeHtml(place.mapsUri)}">Open in Google Maps</a>`);
  }
  lines.push(
    `<label class="pick"><input type="checkbox" name="v" value="${escapeHtml(place.id)}"> ` +
      `Ask this shop</label>`,
  );
  if (brands.length === 0) {
    // No brand was ever tied to this shop, so "only its brands" would name nothing.
    lines.push(`<input type="hidden" name="${escapeHtml(field)}" value="${SCOPE_ALL}">`);
  } else {
    lines.push(
      `<fieldset class="scope">
            <legend>Which parts to ask about</legend>
            ${radio(field, SCOPE_ALL, "All parts", allParts)}
            ${radio(field, scopeOnly(vendor), `Only ${nameList(brands)}'s parts`, !allParts)}
          </fieldset>`,
    );
  }
  return `<li class="vendor">
          ${lines.join("\n          ")}
        </li>`;
}

export interface VendorListInput {
  vendors: readonly Vendor[];
  groups: readonly BrandGroup[];
  /** Manufacturers past the group cap, named rather than hidden. */
  notSearched: readonly string[];
  /** Vendors found beyond the ones listed. */
  omitted: number;
  q: string;
  city: string;
  country: Country;
}

export const NO_VENDORS = "Google listed no shops for these brands in this city.";

/** The vendor list: one form, one row per shop, and Google's attribution under it. */
export function renderVendorList(input: VendorListInput): string {
  const { vendors, groups, notSearched, omitted, q, city, country } = input;
  const parts = [`<p class="caveat">${escapeHtml(listingCaveat(city))}</p>`];
  if (notSearched.length > 0) {
    parts.push(
      `<p class="warn">Searched for ${escapeHtml(nameList(groups.map((g) => g.oem)))} only. ` +
        `Not searched for: ${escapeHtml(nameList([...notSearched]))}.</p>`,
    );
  }
  if (vendors.length === 0) {
    parts.push(`<p class="nothing">${NO_VENDORS}</p>`);
    parts.push(`<p class="attribution">${escapeHtml(ATTRIBUTION)}</p>`);
    return parts.join("\n      ");
  }
  const rows = vendors.map((vendor) => renderVendor(vendor, groups.length)).join("\n        ");
  if (omitted > 0) {
    parts.push(
      `<p class="note">Showing the first ${vendors.length}. ${omitted} more were left out.</p>`,
    );
  }
  parts.push(`<form method="GET" action="/parts/vendors/contact">
        ${hidden("q", q)}
        ${hidden("city", city)}
        ${hidden("country", country.code)}
        <ol class="vendors">
        ${rows}
        </ol>
        <p class="pickhint">Pick up to ${MAX_PICKS}.</p>
        <button type="submit">Get contact details</button>
      </form>`);
  parts.push(`<p class="attribution">${escapeHtml(ATTRIBUTION)}</p>`);
  return parts.join("\n      ");
}
