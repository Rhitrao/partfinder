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
import type { PlacesFailure } from "./places";
import { scopeOnly, scopedParts, type BrandGroup, type Vendor } from "./search";

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

export const NO_SUPPLIERS = "Google listed no shops for these brands in this city.";

/** Shown to everyone who is not signed in, wherever the Suppliers section would have been. */
export const SIGN_IN_PROMPT = "Sign in to see suppliers here";

/** What the map box says until the script replaces it, and forever if the script never runs. */
export const MAP_UNAVAILABLE = "Map unavailable. The list below has everything.";

export const QUOTA_REACHED = "Vendor search hit today's Google limit. Use the links below instead.";
export const UNAVAILABLE = "Vendor search isn't available right now. Use the links below instead.";

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
export function pinsFor(vendors: readonly Vendor[]): Pin[] {
  const pins: Pin[] = [];
  vendors.forEach((vendor, index) => {
    const { location, name } = vendor.place;
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

/** The box the map is drawn into. Its text is the no-JavaScript answer. */
export function renderMapBox(): string {
  return `<div class="map" id="pf-map">${MAP_UNAVAILABLE}</div>`;
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
  vendors: readonly Vendor[];
  groups: readonly BrandGroup[];
  /** Every part number the page is asking about, before any shop's brands narrow it. */
  parts: readonly ParseResult[];
  city: string;
  country: Country;
  /** Null when the search ran. Otherwise why the section shows link-outs instead. */
  failure: PlacesFailure | null;
  /** Shops past MAX_LISTED, counted rather than hidden. */
  omitted: number;
  /** The map box and its scripts, when a key and a located shop are both present. */
  map?: string;
}

function heading(city: string): string {
  return `<h2>Suppliers near ${escapeHtml(city.trim())}</h2>`;
}

/** The whole section, or the fallback when Google would not answer. */
export function renderSuppliers(input: SuppliersInput): string {
  const { vendors, groups, city, country, failure, omitted } = input;
  if (failure !== null) {
    return `<section class="suppliers">
        ${heading(city)}
        <p class="warn">${failure === "quota" ? QUOTA_REACHED : UNAVAILABLE}</p>
        ${renderFallback(groups, country, city)}
      </section>`;
  }

  const inner = [`<p class="caveat">${escapeHtml(listingCaveat(city))}</p>`];
  if (input.map) inner.push(input.map);
  inner.push(
    vendors.length === 0
      ? `<p class="nothing">${NO_SUPPLIERS}</p>`
      : `<ol class="shops">
          ${vendors.map((vendor, i) => renderShop(vendor, i + 1, input)).join("\n          ")}
          </ol>`,
  );

  const more =
    omitted > 0
      ? `\n        <p class="note">Showing the first ${vendors.length}. ${omitted} more were left out.</p>`
      : "";
  return `<section class="suppliers">
        ${heading(city)}
        ${googleMapsBox(inner.join("\n          "))}${more}
      </section>`;
}

/** "Caterpillar", "Caterpillar and JCB", "Caterpillar, JCB and Komatsu". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "4.3 (128 ratings)", or "" when the key's tier returned no rating. */
function ratingLine(vendor: Vendor): string {
  const { rating, ratingCount } = vendor.place;
  if (rating === null) return "";
  const count = ratingCount === null ? "" : ` (${ratingCount} ${ratingCount === 1 ? "rating" : "ratings"})`;
  return `<p class="srating">Rated ${escapeHtml(rating.toFixed(1))} on Google${escapeHtml(count)}</p>`;
}

/**
 * One shop. The number is what ties the row to its map pin, so it is shown, not just used as an
 * id, and the list is an <ol> whose markers are hidden in favour of it.
 *
 * Two WhatsApp buttons when the shop came back for some of the brands but not all: the first asks
 * about everything on the page, the second only about the brands Google listed this shop for. The
 * user picks; step 5's radio buttons and its second page are both gone.
 */
function renderShop(vendor: Vendor, number: number, input: SuppliersInput): string {
  const { place, brands } = vendor;
  const { parts, groups } = input;
  const name = place.name === "" ? "Unnamed listing" : place.name;
  const phone = phoneFor(place);

  const lines = [
    `<p class="sname">${number}. ${escapeHtml(name)}</p>`,
  ];
  if (place.address !== "") lines.push(`<p class="saddr">${escapeHtml(place.address)}</p>`);
  const rated = ratingLine(vendor);
  if (rated !== "") lines.push(rated);
  lines.push(
    brands.length > 0
      ? `<p class="sfound">Found for: ${escapeHtml(brands.join(", "))}</p>`
      : `<p class="sfound">Found by the multi-brand search, not by a brand name.</p>`,
  );
  if (groups.length > 1 && brands.length > 0) {
    lines.push(`<p class="scount">Appeared for ${brands.length} of your ${groups.length} brands</p>`);
  }

  if (phone.display === "") {
    lines.push(`<p class="note">${NO_PHONE}</p>`);
  } else {
    lines.push(`<p class="sphone">${escapeHtml(phone.display)}</p>`);
  }
  if (phone.whatsapp !== null) {
    const everything = requirementMessage(parts, { name });
    lines.push(link(whatsappUrl(everything, phone.whatsapp), WHATSAPP_LABEL, "whatsapp"));
    // Only worth a second button when it would actually ask for something narrower.
    const partial = brands.length > 0 && brands.length < groups.length;
    if (partial) {
      const scoped = scopedParts(scopeOnly(vendor), parts);
      if (scoped.length < parts.length) {
        const narrower = requirementMessage(scoped, { name });
        lines.push(
          link(
            whatsappUrl(narrower, phone.whatsapp),
            `WhatsApp: only ${nameList(brands)} parts`,
            "whatsapp",
          ),
        );
      }
    }
  }
  if (phone.tel !== null) lines.push(link(`tel:${phone.tel}`, "Call"));
  if (place.website !== "") lines.push(link(place.website, "Website"));
  if (place.mapsUri !== "") lines.push(link(place.mapsUri, "Open in Google Maps"));

  return `<li class="shop" id="pf-shop-${number}">
            ${lines.join("\n            ")}
          </li>`;
}
