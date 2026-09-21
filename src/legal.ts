// The two public pages Google's Places API policies require: Terms of Use and a Privacy Policy,
// each incorporating Google's own.
//
// A policy nobody can read is not a policy, so both are public and linked from every page. They
// are static text with no form, no query parameter and nothing user-supplied on them, so there is
// nothing on either page to escape.

import { renderDocument } from "./page";

/** The Google terms a user of the supplier list is also agreeing to. */
export const GOOGLE_MAPS_TERMS_URL = "https://maps.google.com/help/terms_maps/";

/** The Google privacy policy that covers what a supplier search sends to Google. */
export const GOOGLE_PRIVACY_URL = "https://policies.google.com/privacy";

/** Cloudflare's, which covers what Turnstile checks about a browser. */
export const CLOUDFLARE_PRIVACY_URL = "https://www.cloudflare.com/privacypolicy/";

/**
 * Cloudflare's addendum for Turnstile itself, and a condition of using the widget the way
 * Partfinder does.
 *
 * Turnstile is rendered with data-appearance="interaction-only", so most visitors never see it
 * and are never asked anything - and Cloudflare requires a site running Turnstile invisibly to
 * reference this addendum in its own privacy policy. A check nobody can see is a check nobody
 * consented to unless the policy says it happens, so this link is not decoration.
 */
export const TURNSTILE_PRIVACY_URL = "https://www.cloudflare.com/turnstile-privacy-policy/";

const LEGAL_STYLE = `
.legal h2 { margin-top: 1.75rem; }
.legal li { margin: .35rem 0; }
`;

function page(title: string, body: string): string {
  return renderDocument(
    `<main class="legal wrap">
      <h1>${title}</h1>
      ${body}
    </main>`,
    { extraStyle: LEGAL_STYLE },
  );
}

export function renderTerms(): string {
  return page(
    "Terms of Use",
    `<p>Partfinder is an identification aid. It reads a part number and tells you which
      manufacturer's numbering format it matches. That is a guess from the shape of the number and
      nothing more: no catalogue, document or web page has been checked. Confirm the part, and
      whether it fits, with your supplier before you order.</p>

      <p>Partfinder shows no prices, no stock and no lead times, and never will. Industrial spares
      are quoted per account, never published.</p>

      <h2>Supplier listings</h2>

      <p>The supplier list on a results page comes from Google Maps, through the Google Places
      API. Partfinder does not keep a supplier list, does not scrape any site, and vets nobody. A
      shop being listed is not a statement that it stocks your part, that it is authorised by any
      manufacturer, or that it is any good. Ask it yourself.</p>

      <p>By using the supplier list you also agree to the
      <a href="${GOOGLE_MAPS_TERMS_URL}">Google Maps / Google Earth Additional Terms of
      Service</a>, which include the
      <a href="https://policies.google.com/terms">Google Terms of Service</a>.</p>

      <h2>Manufacturers</h2>

      <p>Partfinder is not affiliated with any manufacturer. Brand names identify the parts those
      manufacturers make.</p>

      <h2>No warranty</h2>

      <p>Partfinder is offered as is, with no warranty of any kind. You decide what to order and
      who to order it from.</p>

      <p>Questions: <a href="https://rohitrao.in/">rohitrao.in</a>.</p>`,
  );
}

export function renderPrivacy(): string {
  return page(
    "Privacy",
    `<p>The short version: Partfinder keeps nothing you type.</p>

      <h2>What is not kept</h2>

      <ul>
        <li>The part numbers you paste, the brand or machine, the city, a note to a supplier and a
        contact number are all read, used to build the page, and then gone. None of them is
        written to a database or a log.</li>
        <li>Cloudflare's Workers Logs are turned off for this Worker, so the request URL - which
        carries what you pasted - is not recorded on Cloudflare's side either. No Logpush is
        configured.</li>
        <li>A contact number you type is used to build the WhatsApp link and nothing else. It is
        never logged, stored or sent anywhere by Partfinder.</li>
        <li>Nothing from Google is cached except place IDs, which travel in a link and are not
        stored.</li>
        <li>There is no analytics and no tracking pixel. The only scripts anywhere on Partfinder
        are its own, Cloudflare Turnstile and Google's map, and they load only on a page that is
        showing you suppliers.</li>
      </ul>

      <h2>Cookies</h2>

      <ul>
        <li><code>pf_city</code> and <code>pf_country</code>, set when you type a city or pick a
        country, so you do not have to do it again. They hold only what you typed or picked.</li>
      </ul>

      <p>Both are readable only by this site, not by any script on the page. Nothing else sets a
      cookie, and neither is sent anywhere or joined to anything.</p>

      <h2>What goes to Google</h2>

      <p>Supplier searches send the brands, the city, and your rounded location if you share it
      to Google. That is the whole of it: the manufacturer names Partfinder read out of your
      numbers, the city you typed, and a location rounded to about a hundred metres if you shared
      one, so that Google can answer with shops near you. Nothing else is sent, and what you
      pasted is never sent. Google's handling of those requests is covered by the
      <a href="${GOOGLE_PRIVACY_URL}">Google Privacy Policy</a>.</p>

      <h2>Turnstile</h2>

      <p>To keep bots from using the supplier search, Cloudflare Turnstile checks the browser
      (Cloudflare's privacy policy:
      <a href="${CLOUDFLARE_PRIVACY_URL}">https://www.cloudflare.com/privacypolicy/</a>, and the
      <a href="${TURNSTILE_PRIVACY_URL}">Turnstile Privacy Addendum</a>, which covers the check
      itself). The check runs in your browser when a results page asks for suppliers, and usually
      shows you nothing at all - that is the point of it, and it is why the addendum is linked
      here rather than left to be found. Partfinder learns only whether it passed.</p>

      <h2>Your location</h2>

      <p>"Use my location" asks your browser where you are, and your browser asks you. If you say
      yes, the position is rounded to about a hundred metres and put in the address of that one
      page, so the supplier list can be sorted by distance. It is not stored: not in a cookie, not
      in a database, not in a log, and it is not carried into any message or link you send. Say
      no, or never ask, and distances are measured from the centre of the city you typed
      instead.</p>

      <h2>The map</h2>

      <p>When suppliers are shown, the map is loaded from Google, so Google receives your browser's
      request for it exactly as it does on any page with a Google Map: your IP address, your
      browser, and the address of this site. Partfinder sends Google the site's address only -
      "https://rohitrao.in/" - and never the page's query string, so what you pasted, the city you
      typed and any location you shared are not in that request. The map loads only on a page
      that is showing you shops. The same
      <a href="${GOOGLE_PRIVACY_URL}">Google Privacy Policy</a> covers the map.</p>

      <h2>Links out</h2>

      <p>Most buttons on Partfinder open somewhere else: Google, Google Maps, WhatsApp, your mail
      client, a manufacturer's own site. Once you follow one, that site's own privacy policy
      applies, not this one.</p>

      <p>Questions: <a href="https://rohitrao.in/">rohitrao.in</a>.</p>`,
  );
}
