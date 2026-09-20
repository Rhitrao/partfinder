// The /parts/vendors pages: the passcode gate and the vendor search form.
//
// Server-rendered HTML, no client-side JavaScript, the same shell and stylesheet as the public
// page. Nothing the user types here is stored or logged.

import { COUNTRIES, escapeHtml, renderDocument, type Country } from "../page";

/** Rules only the vendor pages need, so the public page does not carry them. */
export const VENDOR_STYLE = `
.gate { max-width: 22rem; }
.gate p { font-size: .95rem; }
.warn { font-weight: 600; }
.back { font-size: .9rem; margin-top: 2rem; }
.back a { color: inherit; }
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
