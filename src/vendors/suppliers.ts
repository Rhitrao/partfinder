// The Suppliers section: shops from Google, inline on /parts/, under the part cards.
//
// Everything here is rendered from one Text Search round. Nothing is stored, nothing is logged,
// and a place id travels no further than the links on this page.

import { findDealerLocator } from "../dealers";
import {
  anchor,
  cardTitle,
  escapeHtml,
  mapsUrl,
  partKey,
  requirementMessage,
  suppliersUrl,
  whatsappUrl,
  type Country,
} from "../page";
import type { ParseResult } from "../parse";
import { WHATSAPP_LABEL, phoneFor } from "./phone";
import {
  areaOf,
  formatDistance,
  type LinkOut,
  type Scope,
  type Supplier,
} from "./search";

/**
 * Google's attribution for Places results shown without a Google map, and for the map itself.
 *
 * The policies page allows the words "Google Maps" in place of the logo where space is limited,
 * which is the case on a phone-width page, and there is no logo image here because no page loads
 * a Google image outside the map. The policies also require Google Maps content to be told apart
 * from everything else on the page, and the attribution to carry an accessibility label reading
 * "Google Maps". googleMapsBox() is the only way this attribution renders, so the border, the
 * label and the words cannot drift apart.
 */
export const ATTRIBUTION = "Google Maps";

export function googleMapsBox(inner: string): string {
  return `<section class="gmaps" aria-label="${ATTRIBUTION}">
          ${inner}
          <p class="attribution">${ATTRIBUTION}</p>
        </section>`;
}


/**
 * What a failed supplier search says. One message for all of them - a spent quota, a missing key,
 * a timeout, a 500, a body that would not parse - because the user can do the same thing about
 * each: use the links under "Search on Google instead". Neither Google's error text nor which
 * case it was reaches the browser, and nothing is logged.
 */
export const SUPPLIERS_UNAVAILABLE = "Supplier list unavailable right now";

/** What the map box says until the script replaces it, and forever if the script never runs. */
export const MAP_UNAVAILABLE = "Map unavailable. The list below has everything.";

/** The box the map is drawn into. Its text is the no-JavaScript answer. */
export function renderMapBox(): string {
  return `<div class="map" id="pf-map">${MAP_UNAVAILABLE}</div>`;
}

/**
 * The link-outs: what the page offers when it cannot list shops itself. One set per brand, plus
 * the manufacturer's own dealer locator where one has been confirmed. These fetch nothing and
 * need no key, so the section is useful with Google's API shut off entirely.
 */
export function renderFallback(
  blocks: readonly LinkOut[],
  country: Country,
  city: string,
): string {
  if (blocks.length === 0) return "";
  return blocks
    .map((block) => {
      const { heading, oem, result } = block;
      const locator = oem === null ? undefined : findDealerLocator(oem, country.code);
      // A number nobody placed names no brand, so there is no Maps search for one and no dealer
      // locator to offer. The supplier search on its own is still the answer it has.
      return `<div class="group">
          <h3>${escapeHtml(heading)}</h3>
          ${oem === null ? "" : anchor(mapsUrl(oem, country, city), `${oem} parts shops on Google Maps`)}
          ${anchor(suppliersUrl(result, country, city), "Search suppliers on Google")}
          ${locator ? anchor(locator.url, `Authorised ${oem} dealers`) : ""}
        </div>`;
    })
    .join("\n        ");
}

/** All the map is told about a shop: its number, its name and where it is. Nothing else. */
export interface Pin {
  n: number;
  name: string;
  lat: number;
  lng: number;
}

/** One pin per listed shop Google gave coordinates for, numbered as the list numbers it. */
export function pinsFor(suppliers: readonly Supplier[]): Pin[] {
  const pins: Pin[] = [];
  suppliers.forEach((supplier, index) => {
    const { location, name } = supplier.place;
    if (location === null) return;
    pins.push({ n: index + 1, name: name === "" ? "Unnamed listing" : name, ...location });
  });
  return pins;
}

/**
 * JSON safe to put between <script> tags. Escaping "<" is what stops a shop called
 * "</script><script>..." from ending the block early and becoming code; ">" and "&" go with it,
 * and U+2028/U+2029 because they are line terminators to a JavaScript parser.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export const NO_CITY = "Add your city to see suppliers near you.";

export const ALL_INDIA = "All India";

/**
 * The two places a search can look, as links that keep the query.
 *
 * Links rather than buttons, because this works with JavaScript off and because a scope is a
 * different page rather than a different state: it is in the address, and nowhere else. With no
 * city there is only one of them, since there is no city to be near.
 */
export function renderScopeChips(input: ScopeInput): string {
  const { scope, city, query } = input;
  const where = city.trim();
  const chip = (label: string, to: Scope, current: boolean): string => {
    const params = new URLSearchParams(query);
    if (to === "india") params.set("scope", "india");
    else params.delete("scope");
    return (
      `<a class="chip filter" href="/parts/?${escapeHtml(params.toString())}"` +
      ` aria-pressed="${current ? "true" : "false"}">${escapeHtml(label)}</a>`
    );
  };
  const chips = [
    ...(where === "" ? [] : [chip(`Near ${where}`, "near", scope === "near")]),
    chip(ALL_INDIA, "india", scope === "india"),
  ];
  return `<div class="scopes">
          ${chips.join("\n          ")}
        </div>`;
}

export interface ScopeInput {
  scope: Scope;
  city: string;
  /** The page's own parameters, so a chip keeps the query it was rendered beside. */
  query: Record<string, string>;
}

/**
 * What the section says when the user gave everything it needs - a number, a brand, a city - and
 * the supplier search still cannot run because this Worker is not configured for it.
 *
 * It names no key, because which key is missing is our problem and not the visitor's, and a page
 * that named one would be telling every passer-by where the gap is. The point of the line is
 * only that the page never again looks like a page that simply had nothing more to offer.
 */
export const NOT_CONFIGURED = "Supplier search isn't set up right now.";

/** No city, or nothing set up: the section is the link-outs, under a line saying which it is. */
export function renderLinkOuts(
  blocks: readonly LinkOut[],
  country: Country,
  city: string,
  notice = "",
): string {
  const where = city.trim();
  return `<section class="suppliers">
        <h2>Suppliers${where === "" ? "" : ` near ${escapeHtml(where)}`}</h2>
        ${notice === "" ? "" : `<p class="warn">${escapeHtml(notice)}</p>`}
        ${renderFallback(blocks, country, city)}
      </section>`;
}

/** What the status line says while the page's script is fetching the list. */
export const FINDING = "Finding suppliers\u2026";

/** What a browser with no JavaScript is told, since the list only ever arrives by fetch. */
export const NO_SCRIPT = "Turn on JavaScript to see suppliers here.";

/**
 * "Use my location" is rendered here rather than by the script, so the section is complete in the
 * HTML, and hidden until the script unhides it: without JavaScript there is nothing behind it.
 */
const LOCATE_BUTTON =
  `<button type="button" class="locate" id="pf-locate-button" hidden>Use my location</button>`;

/**
 * Grey rows in the shape of the cards that will replace them. Decoration, so hidden from AT.
 *
 * One bar per line a real shop card has - name, the facts line, the address, the actions row -
 * at the heights those lines occupy, so the page does not jump when the list arrives. .ghost and
 * .shop share their border, padding and margin rules in the stylesheet for the same reason.
 */
function renderGhosts(): string {
  const row = `<li class="ghost">
              <span class="ghostbar name"></span>
              <span class="ghostbar short"></span>
              <span class="ghostbar"></span>
              <span class="ghostbar actions"></span>
            </li>`;
  return `<ol class="ghosts" id="pf-ghosts" aria-hidden="true">
            ${[row, row, row].join("\n            ")}
          </ol>`;
}

/** "Suppliers near Bengaluru", or "Suppliers in India" when there is no city to be near. */
export function suppliersHeading(scope: Scope, city: string): string {
  const where = city.trim();
  return scope === "near" && where !== ""
    ? `Suppliers near ${escapeHtml(where)}`
    : "Suppliers in India";
}

export interface PendingInput {
  /** The by-hand link-outs, for no JavaScript and for a search that will not answer. */
  blocks: readonly LinkOut[];
  country: Country;
  city: string;
  scope: Scope;
  /** The page's own parameters, for the scope chips' links. */
  query: Record<string, string>;
  /** Public by design: Turnstile reads it off the widget's own element. */
  siteKey: string;
  /** Whether to draw the map box at all. Without a browser key nothing can fill it. */
  map: boolean;
}

/**
 * The Suppliers section as the server renders it: a heading, a status line, three grey
 * placeholders, an empty list, the Turnstile widget and the way out if none of it works.
 *
 * Nothing here has been fetched. The section is a promise the page's script keeps by posting to
 * /parts/api/suppliers with a Turnstile token; until then, and forever without JavaScript, the
 * link-outs under "Search on Google instead" are the answer. Google's attribution box is drawn
 * now rather than with the cards, so the cards can never appear without it.
 */
export function renderPending(input: PendingInput): string {
  const { blocks, country, city, siteKey, map } = input;
  const where = city.trim();
  const inner = [
    ...(map ? [renderMapBox()] : []),
    renderGhosts(),
    `<div id="pf-list"></div>`,
  ];
  return `<section class="suppliers">
        <div class="suphead">
          <h2>${suppliersHeading(input.scope, city)}</h2>
          <p class="status" id="pf-status" aria-live="polite">${escapeHtml(FINDING)}</p>
        </div>
        ${renderScopeChips({ scope: input.scope, city, query: input.query })}
        ${googleMapsBox(inner.join("\n          "))}
        <div class="turnstile" id="pf-turnstile" data-sitekey="${escapeHtml(siteKey)}"
          data-appearance="interaction-only"></div>
        <div id="pf-locate">${LOCATE_BUTTON}</div>
        <noscript>
          <p class="warn">${escapeHtml(NO_SCRIPT)}</p>
          ${renderFallback(blocks, country, city)}
        </noscript>
        <details class="elsewhere" id="pf-elsewhere">
          <summary>Search on Google instead</summary>
          ${renderFallback(blocks, country, city)}
        </details>
      </section>`;
}

export interface CardsInput {
  suppliers: readonly Supplier[];
  /** Every part number the page is asking about, before any shop's brands narrow it. */
  parts: readonly ParseResult[];
  /** Quantity per part key, for the messages. */
  quantities: Record<string, number>;
  /** A line for the supplier, from "More options". */
  note: string;
  /** What distances are measured from: "you" or "<city> centre". */
  originLabel: string;
  /** Near a city, or the whole country. Decides whether a card says how far or where. */
  scope: Scope;
  /** Shops past MAX_LISTED, counted rather than hidden. */
  omitted: number;
}

export const NO_SUPPLIERS = "Google listed no shops for these brands in this city.";

export const MATCH_NOTE =
  "Matched by the brands Google lists each shop for. Listed doesn't mean in stock. Ask them.";

/**
 * The cards, and only the cards: what POST /parts/api/suppliers puts in its html field.
 *
 * The heading, the map box, Google's attribution and the link-outs are already on the page, so
 * this renders what was not known until Google answered - the note about what a match means, the
 * filter slot the script fills, and one numbered row per shop. Every value in it is escaped here,
 * on the server, because this is the one string the page's script is allowed to insert as HTML.
 */
export function renderSupplierCards(input: CardsInput): string {
  const { suppliers, omitted } = input;
  const parts: string[] = [
    `<p class="caveat">${escapeHtml(MATCH_NOTE)}</p>`,
    // JavaScript fills this with "All / 1U-3352 / 40/300893". Empty and invisible without it.
    `<div class="filters" id="pf-filters"></div>`,
  ];
  parts.push(
    suppliers.length === 0
      ? `<p class="nothing">${escapeHtml(NO_SUPPLIERS)}</p>`
      : `<ol class="shops">
          ${suppliers.map((supplier, i) => renderShop(supplier, i + 1, input)).join("\n          ")}
          </ol>`,
  );
  if (omitted > 0) {
    parts.push(
      `<p class="note">Showing the first ${suppliers.length}. ${omitted} more were left out.</p>`,
    );
  }
  return parts.join("\n        ");
}

/** "4.3 * (120)", or "" when the key's tier returned no rating. */
function ratingLine(supplier: Supplier): string {
  const { rating, ratingCount } = supplier.place;
  if (rating === null) return "";
  const count = ratingCount === null ? "" : ` (${ratingCount})`;
  return `<span class="srating">${escapeHtml(rating.toFixed(1))} &#9733;${escapeHtml(count)}</span>`;
}

function openLine(supplier: Supplier): string {
  const { openNow } = supplier.place;
  if (openNow === null) return "";
  return `<span class="sopen">${openNow ? "Open now" : "Closed now"}</span>`;
}

/** Same rule as the page's: a link that leaves the site is marked, one place, for both. */
function link(href: string, text: string, className = "link"): string {
  return anchor(href, text, className);
}

/** The parts one shop is listed for, in page order. */
function matchedOf(supplier: Supplier, parts: readonly ParseResult[]): ParseResult[] {
  return parts.filter((part) => supplier.matchedParts.includes(partKey(part)));
}

/**
 * One shop, and everything needed to ask it.
 *
 * The number ties the card to its map pin. "Ask about" names the parts this shop was listed for,
 * and each brand beside them, because "listed for Caterpillar" is the whole of what Google told
 * us. A shop only the multi-brand search found says that instead, rather than claiming a brand.
 *
 * The WhatsApp link is a plain href with the message already in it, so it works with no
 * JavaScript at all. A shop listed for some of the parts but not all gets a second link for every
 * part, because without JavaScript there is no toggle to switch between them.
 */
function renderShop(supplier: Supplier, number: number, input: CardsInput): string {
  const { place, distanceKm, matchedGroups, multiBrandOnly } = supplier;
  const { parts, quantities, note, originLabel } = input;
  const name = place.name === "" ? "Unnamed listing" : place.name;
  const phone = phoneFor(place);
  const matched = matchedOf(supplier, parts);
  const asking = matched.length > 0 ? matched : parts;
  const message = requirementMessage(asking, { name, note, quantities });
  const everything = requirementMessage(parts, { name, note, quantities });

  const lines = [
    `<p class="sname"><span class="pin">${number}</span> ${escapeHtml(name)}</p>`,
  ];
  const facts: string[] = [];
  if (distanceKm !== null) {
    facts.push(
      `<span class="sdist">${escapeHtml(formatDistance(distanceKm))} from ` +
        `${escapeHtml(originLabel)}</span>`,
    );
  } else {
    // All India, with no location shared: a distance from a city nobody named means nothing, so
    // the card says where the shop is instead.
    const area = areaOf(place);
    if (area !== "") facts.push(`<span class="sarea">${escapeHtml(area)}</span>`);
  }
  const rated = ratingLine(supplier);
  if (rated !== "") facts.push(rated);
  const open = openLine(supplier);
  if (open !== "") facts.push(open);
  if (facts.length > 0) lines.push(`<p class="sfacts">${facts.join(" &middot; ")}</p>`);

  const address = place.shortAddress === "" ? place.address : place.shortAddress;
  if (address !== "") lines.push(`<p class="saddr">${escapeHtml(address)}</p>`);

  if (multiBrandOnly) {
    lines.push(`<p class="sask">General earthmoving spares: ask about all parts</p>`);
  } else {
    const chips = matched
      .map((part) => {
        // What the card is called, never its key. A described part's key is desc:EX200:pin
        // pivot, which is plumbing, and this chip is the one place it reached a reader.
        const label = cardTitle(part);
        const oem = part.candidates[0]?.oem ?? "";
        const brand = matchedGroups.includes(oem) ? oem : matchedGroups[0] ?? oem;
        // A shop found by the words around a number was listed for no brand at all, so there is
        // nothing to have been listed for. It read "(listed for )".
        const listed = brand === "" ? "" : ` (listed for ${escapeHtml(brand)})`;
        return `<span class="chip">${escapeHtml(label)}${listed}</span>`;
      })
      .join("\n              ");
    lines.push(`<p class="sask">Ask about:</p>
            <div class="chips">
              ${chips}
            </div>`);
  }

  const actions = [
    `<label class="select"><input type="checkbox" class="pick" data-n="${number}"> Select</label>`,
  ];
  if (phone.whatsapp !== null) {
    actions.push(link(whatsappUrl(message, phone.whatsapp), WHATSAPP_LABEL, "whatsapp"));
  }
  if (phone.tel !== null) actions.push(link(`tel:${phone.tel}`, "Call", "link secondary"));
  else actions.push(`<p class="note">No WhatsApp number listed</p>`);
  if (place.website !== "") actions.push(link(place.website, "Website", "link secondary"));
  if (place.mapsUri !== "") actions.push(link(place.mapsUri, "Map", "link secondary"));
  if (phone.whatsapp !== null && matched.length > 0 && matched.length < parts.length) {
    // No JavaScript means no toggle, so the wider message is its own link.
    actions.push(link(whatsappUrl(everything, phone.whatsapp), "WhatsApp: all parts", "noscript-all"));
  }
  lines.push(`<div class="actions">
            ${actions.join("\n            ")}
          </div>`);

  return `<li class="shop" id="pf-shop-${number}">
            ${lines.join("\n            ")}
          </li>`;
}
