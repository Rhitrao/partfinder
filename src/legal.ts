// The two public pages Google's Places API policies require: Terms of Use and a Privacy Policy,
// each incorporating Google's own.
//
// They are public, unlike /parts/vendors, because a policy nobody can read is not a policy. They
// are static text with no form, no query parameter and nothing user-supplied on them, so there is
// nothing on either page to escape.

import { renderDocument } from "./page";

/** The Google terms a user of the vendor pages is also agreeing to. */
export const GOOGLE_MAPS_TERMS_URL = "https://maps.google.com/help/terms_maps/";

/** The Google privacy policy that covers what a vendor search sends to Google. */
export const GOOGLE_PRIVACY_URL = "https://policies.google.com/privacy";

const LEGAL_STYLE = `
.legal h2 { margin-top: 1.75rem; }
.legal li { margin: .35rem 0; }
`;

function page(title: string, body: string): string {
  return renderDocument(
    `<main class="legal">
      <h1>${title}</h1>
      ${body}
    </main>`,
    LEGAL_STYLE,
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

      <h2>Vendor listings</h2>

      <p>The vendor pages list shops from Google Maps, through the Google Places API. Partfinder
      does not keep a vendor list, does not scrape any site, and vets nobody. A shop being listed
      is not a statement that it stocks your part, that it is authorised by any manufacturer, or
      that it is any good. Ask it yourself.</p>

      <p>By using the vendor pages you also agree to the
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
        <li>There is no analytics, no tracking pixel, and no third-party script. The page runs no
        JavaScript at all.</li>
      </ul>

      <h2>Cookies</h2>

      <p>One cookie, and only if you use the vendor pages: <code>pf_vendor</code>, set when you
      enter the vendor passcode, so you are not asked again for 30 days. It holds a value derived
      from the passcode, not your passcode and nothing about you. Nothing else sets a cookie.</p>

      <h2>What goes to Google</h2>

      <p>A vendor search sends the manufacturer names and the city you typed to the Google Places
      API, so that Google can answer with shops. Asking for a shop's contact details sends that
      shop's place ID. Nothing else is sent, and what you pasted is never sent. Google's handling
      of those requests is covered by the
      <a href="${GOOGLE_PRIVACY_URL}">Google Privacy Policy</a>.</p>

      <h2>Links out</h2>

      <p>Most buttons on Partfinder open somewhere else: Google, Google Maps, WhatsApp, your mail
      client, a manufacturer's own site. Once you follow one, that site's own privacy policy
      applies, not this one.</p>

      <p>Questions: <a href="https://rohitrao.in/">rohitrao.in</a>.</p>`,
  );
}
