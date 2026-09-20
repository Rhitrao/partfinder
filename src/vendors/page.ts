// The passcode gate, and the link-outs the Suppliers section falls back to.
//
// Since step 6 the gate is all that is left under /parts/vendors: the search and the contact page
// moved onto /parts/ itself. Server-rendered HTML, the same shell and stylesheet as every other
// page. Nothing the user types here is stored or logged.

import { escapeHtml, renderDocument } from "../page";

export const VENDOR_STYLE = `
.gate { max-width: 22rem; }
.gate p { font-size: .95rem; }
.warn { font-weight: 600; }
.back { font-size: .9rem; margin-top: 2rem; }
.back a { color: inherit; }
`;

/** The whole vendor document: the shared shell, plus the vendor rules. */
export function renderVendorDocument(main: string): string {
  return renderDocument(main, { extraStyle: VENDOR_STYLE });
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

