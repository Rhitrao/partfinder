// The Suppliers section: shops from Google, inline on /parts/, under the part cards.
//
// Everything here is rendered from one Text Search round. Nothing is stored, nothing is logged,
// and a place id travels no further than the links on this page.

import {
  escapeHtml,
  mapsUrl,
  requirementMessage,
  suppliersUrl,
  whatsappUrl,
  type Country,
} from "../page";
import type { ParseResult } from "../parse";
import { NO_PHONE, WHATSAPP_LABEL, phoneFor } from "./phone";
import type { SupplierFailure } from "./search";
import { formatDistance, type BrandGroup, type Supplier } from "./search";

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

function link(href: string, text: string, className = "link"): string {
  return `<a class="${className}" href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}

/** Above every listing, in the same words each time. A listing is not an answer about stock. */
export function listingCaveat(city: string): string {
  return (
    `These are shops Google lists for these brands in ${city.trim()}. ` +
    `Being listed doesn't mean they have your part in stock. Ask them.`
  );
}

/** Shown to everyone who is not signed in, wherever the Suppliers section would have been. */
export const SIGN_IN_PROMPT = "Sign in to see suppliers here";

/** What the map box says until the script replaces it, and forever if the script never runs. */
export const MAP_UNAVAILABLE = "Map unavailable. The list below has everything.";

/** The box the map is drawn into. Its text is the no-JavaScript answer. */
export function renderMapBox(): string {
  return `<div class="map" id="pf-map">${MAP_UNAVAILABLE}</div>`;
}

/**
 * What a failed supplier search says. One message for all of them - a spent quota, a missing key,
 * a timeout, a 500, a body that would not parse - because the user can do the same thing about
 * each: use the links below. Neither Google's error text nor which case it was reaches the page,
 * and nothing is logged.
 */
export const SUPPLIERS_UNAVAILABLE = "Supplier list unavailable right now";

/**
 * The fallback under either message: step 4's own link-outs, one set per brand group. These fetch
 * nothing and need no key, so the section is still useful with Google's API shut off entirely.
 */
export function renderFallback(
  groups: readonly BrandGroup[],
  country: Country,
  city: string,
): string {
  if (groups.length === 0) return "";
  return groups
    .map((group) => {
      const first = group.results[0]!;
      return `<div class="group">
        <h3>${escapeHtml(group.oem)}</h3>
        ${link(suppliersUrl(first, country, city), `Find suppliers in ${country.name}`)}
        ${link(mapsUrl(group.oem, country, city), `${group.oem} parts shops on Google Maps`)}
      </div>`;
    })
    .join("\n      ");
}

/** The passcode form, carrying enough to come back to this exact page afterwards. */
export function signInUrl(q: string, city: string, country: Country): string {
  return (
    `/parts/vendors/login?q=${encodeURIComponent(q)}` +
    `&city=${encodeURIComponent(city.trim())}&country=${encodeURIComponent(country.code)}`
  );
}

/** The one line a signed-out visitor sees in place of the shops. */
export function renderSignIn(q: string, city: string, country: Country): string {
  return `<section class="suppliers">
        <h2>Suppliers</h2>
        <p class="signin"><a href="${escapeHtml(signInUrl(q, city, country))}">${SIGN_IN_PROMPT}</a>,
        or use the Where-to-buy links on each card.</p>
      </section>`;
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

/**
 * The pin data, the code that draws the map, and Google's loader. Everything carries the nonce.
 *
 * The data is a JSON block rather than anything interpolated into code, so a shop's name is never
 * parsed as JavaScript. initMap is defined before the loader runs, which is what &callback=initMap
 * needs; the loader is async, so the list is on screen whether or not the map ever arrives, and
 * every failure path leaves the box's own text in place.
 */
export function renderMapScripts(pins: readonly Pin[], key: string, nonce: string): string {
  const n = escapeHtml(nonce);
  const loader =
    "https://maps.googleapis.com/maps/api/js" +
    `?key=${encodeURIComponent(key)}&callback=initMap&loading=async`;
  return `
    <script type="application/json" id="pf-pins" nonce="${n}">${jsonForScript(pins)}</script>
    <script nonce="${n}">
window.initMap = async function () {
  var box = document.getElementById("pf-map");
  var data = document.getElementById("pf-pins");
  if (!box || !data) return;
  var pins;
  try { pins = JSON.parse(data.textContent || "[]"); } catch (e) { return; }
  if (!pins.length) return;
  try {
    var maps = await google.maps.importLibrary("maps");
    var markers = await google.maps.importLibrary("marker");
    box.textContent = "";
    var map = new maps.Map(box, {
      mapId: "DEMO_MAP_ID",
      zoom: 12,
      center: { lat: pins[0].lat, lng: pins[0].lng }
    });
    var bounds = new google.maps.LatLngBounds();
    pins.forEach(function (pin) {
      var position = { lat: pin.lat, lng: pin.lng };
      var glyph = new markers.PinElement({ glyph: String(pin.n) });
      var marker = new markers.AdvancedMarkerElement({
        map: map,
        position: position,
        title: pin.name,
        content: glyph.element,
        gmpClickable: true
      });
      marker.addListener("gmp-click", function () {
        var row = document.getElementById("pf-shop-" + pin.n);
        if (row) row.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      bounds.extend(position);
    });
    map.fitBounds(bounds);
  } catch (e) {
    box.textContent = ${jsonForScript(MAP_UNAVAILABLE)};
  }
};
    </script>
    <script src="${escapeHtml(loader)}" async nonce="${n}"></script>`;
}

export interface SuppliersInput {
  suppliers: readonly Supplier[];
  groups: readonly BrandGroup[];
  /** Every part number the page is asking about, before any shop's brands narrow it. */
  parts: readonly ParseResult[];
  /** Quantity per part key, for the messages. */
  quantities: Record<string, number>;
  /** A line for the supplier, from "More options". */
  note: string;
  city: string;
  country: Country;
  /** What distances are measured from: "you" or "<city> centre". */
  originLabel: string;
  /** Null when the search ran. Otherwise why the section shows link-outs instead. */
  failure: SupplierFailure | null;
  /** Shops past MAX_LISTED, counted rather than hidden. */
  omitted: number;
  /** The map box, when a key and a located shop are both present. */
  map?: string;
}

export const NO_SUPPLIERS = "Google listed no shops for these brands in this city.";

export const MATCH_NOTE =
  "Matched by the brands Google lists each shop for. Listed doesn't mean in stock. Ask them.";

export function cityNotFound(city: string): string {
  return `Couldn't find ${city.trim()}. Check the spelling.`;
}

function heading(suppliers: readonly Supplier[], city: string, originLabel: string): string {
  const where = originLabel === "you" ? "you" : city.trim();
  return `<h2>Suppliers near ${escapeHtml(where)} (${suppliers.length})</h2>`;
}

/** The whole section, or the fallback when Google would not answer. */
export function renderSuppliers(input: SuppliersInput): string {
  const { suppliers, groups, city, country, failure, omitted, originLabel } = input;
  if (failure !== null) {
    const message = failure === "city" ? cityNotFound(city) : SUPPLIERS_UNAVAILABLE;
    return `<section class="suppliers">
        <h2>Suppliers</h2>
        <p class="warn">${escapeHtml(message)}</p>
        ${renderFallback(groups, country, city)}
      </section>`;
  }

  const inner: string[] = [];
  if (input.map) inner.push(input.map);
  inner.push(
    suppliers.length === 0
      ? `<p class="nothing">${NO_SUPPLIERS}</p>`
      : `<ol class="shops">
          ${suppliers.map((supplier, i) => renderShop(supplier, i + 1, input)).join("\n          ")}
          </ol>`,
  );

  const more =
    omitted > 0
      ? `\n        <p class="note">Showing the first ${suppliers.length}. ${omitted} more were left out.</p>`
      : "";
  return `<section class="suppliers">
        ${heading(suppliers, city, originLabel)}
        <p class="caveat">${escapeHtml(MATCH_NOTE)}</p>
        ${googleMapsBox(inner.join("\n          "))}${more}
      </section>`;
}

/** One shop. The number is what ties the card to its map pin. Enriched in the next commit. */
function renderShop(supplier: Supplier, number: number, input: SuppliersInput): string {
  const { place, distanceKm } = supplier;
  const name = place.name === "" ? "Unnamed listing" : place.name;
  const lines = [
    `<p class="sname"><span class="pin">${number}</span> ${escapeHtml(name)}</p>`,
  ];
  if (distanceKm !== null) {
    lines.push(
      `<p class="sdist">${escapeHtml(formatDistance(distanceKm))} from ` +
        `${escapeHtml(input.originLabel)}</p>`,
    );
  }
  const address = place.shortAddress === "" ? place.address : place.shortAddress;
  if (address !== "") lines.push(`<p class="saddr">${escapeHtml(address)}</p>`);
  return `<li class="shop" id="pf-shop-${number}">
            ${lines.join("\n            ")}
          </li>`;
}
