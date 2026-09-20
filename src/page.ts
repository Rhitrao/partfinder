// The /parts page: one server-rendered HTML document, no client-side JavaScript.
// Offline only. Everything on the page comes from the parser in parse.ts; nothing is fetched,
// stored or logged. Every piece of user input is HTML-escaped wherever it appears.

import { DEALER_LOCATORS, findDealerLocator, type DealerLocator } from "./dealers";
import { THEME_COLOR } from "./manifest";
import { extractHints, extractTokens, parse, type ParseResult } from "./parse";

export interface Country {
  /** Form value. */
  code: string;
  name: string;
  /** Search domain, without the leading "www.". */
  domain: string;
  /** International dialling code, used only to turn a local number into a wa.me link. */
  dialCode?: string;
}

/** Country is a user setting. It only picks the search region; it never hides a result. */
export const COUNTRIES: readonly Country[] = [
  { code: "IN", name: "India", domain: "google.co.in", dialCode: "91" },
  { code: "AE", name: "UAE", domain: "google.ae", dialCode: "971" },
  { code: "SA", name: "Saudi Arabia", domain: "google.com.sa", dialCode: "966" },
  { code: "ZA", name: "South Africa", domain: "google.co.za", dialCode: "27" },
  { code: "KE", name: "Kenya", domain: "google.co.ke", dialCode: "254" },
  { code: "NG", name: "Nigeria", domain: "google.com.ng", dialCode: "234" },
  // "Other" has no dialling code, so a supplier number there must be typed with its own +.
  { code: "OTHER", name: "Other", domain: "google.com" },
];

/** Default India. */
export const DEFAULT_COUNTRY: Country = COUNTRIES[0]!;

/** An unknown or missing code falls back to the default; it is never an error. */
export function resolveCountry(code: string | null): Country {
  const wanted = (code ?? "").trim().toUpperCase();
  return COUNTRIES.find((c) => c.code === wanted) ?? DEFAULT_COUNTRY;
}

/** Caps every text field on every page under /parts, keeping one request inside the CPU budget. */
export const MAX_QUERY_LENGTH = 5000;

/** At most this many spellings per number, in the search link and in the WhatsApp message. */
const MAX_SPELLINGS = 6;

/** Rendered cards per page, to keep one request inside the 10 ms CPU budget. */
export const MAX_CARDS = 50;

/** Target length of the WhatsApp message, in characters. */
export const WHATSAPP_LIMIT = 1000;

export const BASIS_TEXT = "Guess from number format only. Not confirmed.";
export const NOT_DETERMINED = "Not determined: no known number format matched.";

const STRENGTH_TEXT = {
  distinctive: "usually unique to this manufacturer",
  shared: "shared with other manufacturers",
} as const;

/** Shown when a number fits more than one manufacturer: the hint field can settle it. */
export const NARROW_PROMPT = "Add the brand or machine to narrow this.";

/**
 * A bare digit run shaped like a phone number: 10 digits starting 0 or 6 to 9, or 11 to 15
 * digits. "Bare" means the user typed no separators, so 6754-61-1102 is never phone-shaped.
 */
const PHONE_SHAPED = /^(?:[06-9]\d{9}|\d{11,15})$/;

/** Why a number stayed on the page but out of the WhatsApp message. */
export const OUTBOUND_NOTES = {
  phone:
    "Looks like a phone number, so it's left out of the WhatsApp message. " +
    "Type it with dashes if it's a part number.",
  noFormat:
    "No format matched, so it's left out of the WhatsApp message. " +
    "Add it yourself if it's a part number.",
} as const;

export const NOTHING_TO_SEND = "Nothing to send: no part number was recognised.";

/**
 * Why this number is left out of the WhatsApp message, or null when it goes in.
 *
 * A number leaves this page only if it was recognised and is not phone-shaped. Everything the
 * user pasted is shown to them; only what Partfinder is confident is a part number is put in a
 * message to a third party. A phone-shaped run is checked first, because "looks like a phone
 * number" explains a bare 12-digit run better than "no format matched" does.
 */
function outboundNote(result: ParseResult): string | null {
  if (PHONE_SHAPED.test(result.input)) return OUTBOUND_NOTES.phone;
  if (result.candidates.length === 0) return OUTBOUND_NOTES.noFormat;
  return null;
}

/** The numbers the WhatsApp message and its back-link may carry. */
export function outbound(results: readonly ParseResult[]): ParseResult[] {
  return results.filter((r) => outboundNote(r) === null);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape for both text nodes and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/**
 * Every spelling of one number worth searching: the number as typed, then each candidate's
 * canonical form and alternates, with the suffix put back. Deduplicated, capped at MAX_SPELLINGS.
 */
export function spellings(result: ParseResult): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s && !out.includes(s) && out.length < MAX_SPELLINGS) out.push(s);
  };
  add(result.input);
  for (const c of result.candidates) {
    const withSuffix = (s: string) => (c.suffix ? s + c.suffix : s);
    add(withSuffix(c.canonical));
    for (const alternate of c.alternates) add(withSuffix(alternate));
  }
  return out;
}

/** Every spelling of one number, quoted and joined with OR: the query behind every Check link. */
export function spellingQuery(result: ParseResult): string {
  return spellings(result)
    .map((s) => `"${s}"`)
    .join(" OR ");
}

/** A Google query on the country's own domain. Nothing is fetched; this is a link out. */
function googleUrl(country: Country, query: string, extra = ""): string {
  return `https://www.${country.domain}/search?q=${encodeURIComponent(query)}${extra}`;
}

/** Every spelling quoted and joined with OR, on the country's search domain. */
export function searchUrl(result: ParseResult, country: Country): string {
  return googleUrl(country, spellingQuery(result));
}

/** The same query on Google Images: a photograph settles a shape faster than a description. */
export function imagesUrl(result: ParseResult, country: Country): string {
  return googleUrl(country, spellingQuery(result), "&tbm=isch");
}

/** What the part fits. "fits models" is the wording sellers and forums actually use. */
export function fitsUrl(result: ParseResult, country: Country): string {
  return googleUrl(country, `${spellingQuery(result)} fits models`);
}

/** Manufacturer links per card, so a two-candidate number does not become a wall of buttons. */
const MAX_OEM_LINKS = 2;

/** A general supplier search, narrowed by city when the user gave one. */
export function suppliersUrl(result: ParseResult, country: Country, city: string): string {
  const query = [spellingQuery(result), "supplier", city.trim(), country.name]
    .filter((part) => part !== "")
    .join(" ");
  return googleUrl(country, query);
}

/**
 * Shops on Google Maps. With a city this searches that city by name; without one it falls back
 * to "near me", which Maps resolves on the user's device, not here.
 */
export function mapsUrl(oem: string, country: Country, city: string): string {
  const where = city.trim();
  const query = where === ""
    ? `${oem} spare parts near me`
    : `${oem} spare parts ${where} ${country.name}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** The manufacturers a number could be, in ranked order, without duplicates. */
function oems(result: ParseResult): string[] {
  return [...new Set(result.candidates.map((c) => c.oem))];
}

function messageBlock(result: ParseResult, index: number, maxSpellings: number): string {
  const makers = oems(result).join(" or ");
  const lines = [`${index + 1}. ${result.input}: likely ${makers} (from number format, unconfirmed)`];
  const others = spellings(result)
    .filter((s) => s !== result.input)
    .slice(0, maxSpellings);
  if (others.length > 0) lines.push(`   Also written: ${others.join(", ")}`);
  return lines.join("\n");
}

/**
 * The requirement, in plain text. The same string goes in the textarea, in both wa.me links and
 * in the email body, so whatever the user reads is exactly what the supplier gets.
 *
 * Only the numbers outbound() passed are in it, and the back-link carries only those numbers:
 * never the pasted text, the note, the city or the supplier's number. What a user pastes can
 * hold a customer name, a phone number or a price, and none of that may leave in a message to a
 * third party. Numbers trimmed out for length still appear in the link, because the link is how
 * the reader gets back to the full page.
 *
 * Kept within WHATSAPP_LIMIT by trimming spellings first, then whole numbers off the end.
 */
export function requirementMessage(results: readonly ParseResult[], note = ""): string {
  const tokens = results.map((r) => r.input).join(" ");
  const tail = [
    ...(note.trim() === "" ? [] : [`Note: ${note.trim()}`]),
    "Please share availability, price and delivery time.",
    `Details: https://rohitrao.in/parts/?q=${encodeURIComponent(tokens)}`,
  ];
  const assemble = (count: number, maxSpellings: number): string => {
    const blocks = results.slice(0, count).map((r, i) => messageBlock(r, i, maxSpellings));
    const omitted = results.length - count;
    if (omitted > 0) blocks.push(`(+${omitted} more on the page)`);
    return ["Hi, we have a requirement for:", ...blocks, ...tail].join("\n");
  };

  for (let maxSpellings = MAX_SPELLINGS; maxSpellings >= 0; maxSpellings--) {
    const message = assemble(results.length, maxSpellings);
    if (message.length <= WHATSAPP_LIMIT) return message;
  }
  for (let count = results.length - 1; count >= 1; count--) {
    const message = assemble(count, 0);
    if (message.length <= WHATSAPP_LIMIT) return message;
  }
  return assemble(1, 0);
}

/** Roughly the length an email subject can be before clients start truncating it. */
const SUBJECT_LIMIT = 80;

/** "Requirement: " and the numbers, cut on a whole number rather than mid-digit. */
export function emailSubject(results: readonly ParseResult[]): string {
  const prefix = "Requirement: ";
  const kept: string[] = [];
  for (const result of results) {
    const next = [...kept, result.input].join(", ");
    if (prefix.length + next.length > SUBJECT_LIMIT) break;
    kept.push(result.input);
  }
  if (kept.length === 0) return (prefix + results[0]!.input).slice(0, SUBJECT_LIMIT);
  return prefix + kept.join(", ") + (kept.length < results.length ? ", ..." : "");
}

/**
 * The supplier's number as wa.me wants it: digits only, no plus. Null means "not a number we can
 * dial", which is an answer, not an error: the user is offered the contact picker instead.
 *
 * Everything but digits and a leading + is stripped first. A leading + means the user typed the
 * country themselves. Otherwise the selected country supplies the code, and a leading trunk 0 is
 * dropped. The number is used to build the link and nothing else: it is never logged or stored.
 */
export function normaliseWhatsapp(raw: string, country: Country): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;
  const inRange = (value: string) => value.length >= 11 && value.length <= 15;
  if (trimmed.startsWith("+")) return inRange(digits) ? digits : null;
  if (country.dialCode === undefined) return null;
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  // India's mobile numbers are ten digits starting 6 to 9; anything else is a landline or a typo.
  if (country.code === "IN" && !/^[6-9]\d{9}$/.test(local)) return null;
  const full = country.dialCode + local;
  return inRange(full) ? full : null;
}

/** The same digits, spaced after the dialling code, for a label a person can check at a glance. */
export function formatWhatsapp(digits: string): string {
  const codes = COUNTRIES.map((c) => c.dialCode)
    .filter((c): c is string => c !== undefined)
    .sort((a, b) => b.length - a.length);
  const code = codes.find((c) => digits.startsWith(c));
  return code === undefined ? `+${digits}` : `+${code} ${digits.slice(code.length)}`;
}

export function whatsappUrl(message: string, to = ""): string {
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}

/** encodeURIComponent never emits "+" for a space, so a mail client cannot misread the body. */
export function mailtoUrl(subject: string, message: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

export const FIND_VENDORS = "Find vendors for these parts";

/**
 * The way in to /parts/vendors. It carries only the numbers outbound() passed, exactly as the
 * WhatsApp message and its back-link do: never the pasted text, which can hold a customer name or
 * a price. The city and country are the user's own settings, and the vendor page needs both.
 */
export function vendorsUrl(sending: readonly ParseResult[], country: Country, city: string): string {
  const tokens = sending.map((r) => r.input).join(" ");
  return (
    `/parts/vendors/?q=${encodeURIComponent(tokens)}` +
    `&city=${encodeURIComponent(city.trim())}&country=${encodeURIComponent(country.code)}`
  );
}

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 1rem;
  font: 1rem/1.5 system-ui, sans-serif;
  max-width: 40rem;
}
h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
h2 { font-size: 1.1rem; margin: 1.5rem 0 .5rem; }
p { margin: .5rem 0; }
.lede { margin-bottom: 1.25rem; }
form { display: flex; flex-direction: column; gap: .35rem; }
label { font-weight: 600; }
textarea, input, select, button {
  font: inherit;
  width: 100%;
  padding: .6rem;
  border: 1px solid currentColor;
  border-radius: .4rem;
  background: transparent;
  color: inherit;
}
textarea { min-height: 6rem; resize: vertical; }
button { margin-top: .75rem; font-weight: 700; cursor: pointer; }
.hints { font-size: .9rem; opacity: .8; }
.card { border: 1px solid currentColor; border-radius: .5rem; padding: .75rem; margin: 1rem 0; }
.card h2 { margin-top: 0; font-family: ui-monospace, monospace; word-break: break-all; }
.candidate { border-top: 1px dashed currentColor; padding-top: .6rem; margin-top: .6rem; }
.candidate:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.oem { font-weight: 700; margin: 0; }
.canonical { font-family: ui-monospace, monospace; margin: .15rem 0; word-break: break-all; }
.basis, .strength, .suffix { font-size: .9rem; margin: .15rem 0; opacity: .85; }
.warnings { font-size: .9rem; margin: .35rem 0 0; padding-left: 1.1rem; }
.narrow { font-size: .9rem; font-weight: 600; margin: .75rem 0 0; }
.excluded { font-size: .9rem; margin: .75rem 0 0; opacity: .85; }
.nothing { text-align: center; font-weight: 700; margin: 1.25rem 0; }
.answer { margin: 0; }
.answer .reason { font-size: .9rem; opacity: .85; margin: .15rem 0 0; }
.group { margin-top: .9rem; }
.group h3 { font-size: .95rem; margin: 0 0 .4rem; text-transform: uppercase; letter-spacing: .04em; }
.grouphint { font-size: .85rem; opacity: .8; margin: .35rem 0; }
.link {
  display: block;
  margin-top: .4rem;
  padding: .55rem .8rem;
  border: 1px solid currentColor;
  border-radius: .4rem;
  text-decoration: none;
  color: inherit;
}
.search, .whatsapp {
  display: inline-block;
  margin-top: .75rem;
  padding: .55rem .8rem;
  border: 1px solid currentColor;
  border-radius: .4rem;
  text-decoration: none;
  color: inherit;
}
.whatsapp { display: block; text-align: center; font-weight: 700; margin: 1.25rem 0; }
.send { margin-top: 2rem; }
.send h2 { margin-bottom: .75rem; }
.send label { display: block; margin-top: .75rem; font-weight: 600; }
.send textarea { min-height: 0; margin-top: .35rem; font-size: .95rem; }
.notes { font-size: .9rem; opacity: .85; margin-top: 2rem; }
.note { font-size: .9rem; opacity: .85; }
@media (min-width: 40rem) { body { margin: 0 auto; padding: 2rem 1rem; } }
`.trim();

function renderForm(q: string, hint: string, country: Country, city: string): string {
  const options = COUNTRIES.map(
    (c) =>
      `<option value="${escapeHtml(c.code)}"${c.code === country.code ? " selected" : ""}>` +
      `${escapeHtml(c.name)} (${escapeHtml(c.domain)})</option>`,
  ).join("\n        ");
  return `<form method="GET" action="/parts/">
      <label for="q">Paste part numbers or a WhatsApp message</label>
      <textarea id="q" name="q" rows="4" placeholder="Paste part numbers or a WhatsApp message">${escapeHtml(q)}</textarea>
      <label for="hint">Brand or machine (optional)</label>
      <input id="hint" name="hint" type="text" value="${escapeHtml(hint)}" placeholder="Brand or machine (optional)">
      <label for="city">City (optional)</label>
      <input id="city" name="city" type="text" value="${escapeHtml(city)}" placeholder="City (optional)">
      <label for="country">Country</label>
      <select id="country" name="country">
        ${options}
      </select>
      <button type="submit">Identify</button>
    </form>`;
}

function renderCandidate(candidate: ParseResult["candidates"][number]): string {
  const parts = [
    `<p class="oem">${escapeHtml(candidate.oem)}</p>`,
    `<p class="canonical">${escapeHtml(candidate.canonical)}</p>`,
  ];
  if (candidate.suffix) {
    parts.push(`<p class="suffix">Suffix: ${escapeHtml(candidate.suffix)}</p>`);
  }
  parts.push(`<p class="basis">${BASIS_TEXT}</p>`);
  parts.push(`<p class="strength">Format: ${STRENGTH_TEXT[candidate.strength]}.</p>`);
  if (candidate.warnings.length > 0) {
    const items = candidate.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
    parts.push(`<ul class="warnings">${items}</ul>`);
  }
  return `<div class="candidate">\n          ${parts.join("\n          ")}\n        </div>`;
}

function link(href: string, text: string): string {
  return `<a class="link" href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}

/**
 * Check: is this the right part, and what does it fit? Three link-outs, no fetching. A card with
 * no candidate has no spellings worth searching, so it gets no group at all.
 */
function renderCheck(result: ParseResult, country: Country): string {
  return `<div class="group">
          <h3>Check</h3>
          ${link(searchUrl(result, country), "Search all spellings")}
          ${link(imagesUrl(result, country), "See images")}
          <p class="grouphint">Compare the shape before ordering.</p>
          ${link(fitsUrl(result, country), "Check which machines it fits")}
        </div>`;
}

/**
 * Where to buy: a supplier search, shops on Maps, and the manufacturer's own dealer locator
 * where one has been confirmed. Every one of these is a link out. Partfinder holds no supplier
 * list, fetches none of these sites, and vets nobody.
 */
export function renderWhereToBuy(
  result: ParseResult,
  country: Country,
  city: string,
  dealers: readonly DealerLocator[] = DEALER_LOCATORS,
): string {
  const makers = oems(result).slice(0, MAX_OEM_LINKS);
  const links = [link(suppliersUrl(result, country, city), `Find suppliers in ${country.name}`)];
  for (const oem of makers) {
    links.push(link(mapsUrl(oem, country, city), `${oem} parts shops on Google Maps`));
  }
  for (const oem of makers) {
    const locator = findDealerLocator(oem, country.code, dealers);
    if (locator) links.push(link(locator.url, `Authorised ${oem} dealers`));
  }
  return `<div class="group">
          <h3>Where to buy</h3>
          ${links.join("\n          ")}
          <p class="grouphint">These links open other sites. Partfinder doesn't store or vet
          suppliers.</p>
        </div>`;
}

function renderCard(result: ParseResult, country: Country, city: string): string {
  const body =
    result.candidates.length > 0
      ? result.candidates.map(renderCandidate).join("\n        ")
      : `<div class="answer">
          <p class="oem">${NOT_DETERMINED}</p>
          <p class="reason">No manufacturer format rule matched this number. It may still be a real
          part number; Partfinder simply has no rule for its shape.</p>
        </div>`;
  const narrow =
    oems(result).length > 1 ? `\n        <p class="narrow">${NARROW_PROMPT}</p>` : "";
  const note = outboundNote(result);
  const excluded = note === null ? "" : `\n        <p class="excluded">${note}</p>`;
  const groups =
    result.candidates.length > 0
      ? `\n        ${renderCheck(result, country)}\n        ${renderWhereToBuy(result, country, city)}`
      : "";
  return `<section class="card">
        <h2>${escapeHtml(result.input)}</h2>
        ${body}${narrow}${excluded}${groups}
      </section>`;
}

function renderResults(results: readonly ParseResult[], country: Country, city: string): string {
  if (results.length === 0) {
    return `<section class="card">
        <p class="answer">Not determined: nothing in what you pasted looks like a part number.</p>
      </section>`;
  }
  return results.map((r) => renderCard(r, country, city)).join("\n      ");
}

const INVALID_NUMBER =
  "That doesn't look like a WhatsApp number, so pick the contact in WhatsApp instead.";

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

/**
 * Send the requirement: one message, four ways out. The message is shown in full before any of
 * them, because the user is the one sending it and should read it first.
 *
 * The form is a GET back to this same page carrying what the user already typed, so preparing a
 * message never loses the search. Nothing here is stored: the supplier's number and the note
 * live in the URL of the user's own browser and in the links this builds, nowhere else.
 */
function renderSend(input: PageInput, results: readonly ParseResult[]): string {
  const sending = outbound(results);
  if (sending.length === 0) {
    return `<section class="send">
        <h2>Send the requirement</h2>
        <p class="nothing">${NOTHING_TO_SEND}</p>
      </section>`;
  }

  const { q, hint, country, city, to, note } = input;
  const message = requirementMessage(sending, note);
  const digits = to.trim() === "" ? null : normaliseWhatsapp(to, country);
  const rows = Math.min(20, Math.max(6, message.split("\n").length + 1));

  const parts = [
    `<form method="GET" action="/parts/">
          ${hidden("q", q)}
          ${hidden("hint", hint)}
          ${hidden("country", country.code)}
          ${hidden("city", city)}
          <label for="to">Supplier's WhatsApp number (optional)</label>
          <input id="to" name="to" type="text" value="${escapeHtml(to)}" placeholder="Supplier's WhatsApp number (optional)">
          <label for="note">Note to supplier, e.g. quantity (optional)</label>
          <input id="note" name="note" type="text" value="${escapeHtml(note)}" placeholder="Note to supplier, e.g. quantity (optional)">
          <button type="submit">Prepare message</button>
        </form>`,
    `<label for="message">Your message (copy it into any app)</label>`,
    `<textarea id="message" rows="${rows}" readonly>${escapeHtml(message)}</textarea>`,
  ];
  if (digits !== null) {
    parts.push(
      `<a class="whatsapp" href="${escapeHtml(whatsappUrl(message, digits))}">` +
        `Open WhatsApp chat with ${escapeHtml(formatWhatsapp(digits))}</a>`,
    );
  }
  parts.push(link(whatsappUrl(message), "Or pick a contact in WhatsApp"));
  parts.push(link(mailtoUrl(emailSubject(sending), message), "Send by email"));
  if (to.trim() !== "" && digits === null) {
    parts.push(`<p class="note">${INVALID_NUMBER}</p>`);
  }
  parts.push(link(vendorsUrl(sending, country, city), FIND_VENDORS));

  return `<section class="send">
        <h2>Send the requirement</h2>
        ${parts.join("\n        ")}
      </section>`;
}

/**
 * The shared HTML shell for every page under /parts: one head, one stylesheet, no client-side
 * JavaScript. `main` is the whole <main> element, indented to sit at four spaces. `extraStyle` is
 * for rules only one page needs, so the public page does not carry the vendor pages' CSS.
 */
export function renderDocument(main: string, extraStyle = ""): string {
  const style = extraStyle === "" ? STYLE : `${STYLE}\n${extraStyle.trim()}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <meta name="theme-color" content="${THEME_COLOR}">
    <meta name="apple-mobile-web-app-title" content="Partfinder">
    <link rel="manifest" href="/parts/manifest.webmanifest">
    <link rel="apple-touch-icon" href="/parts/icon-192.png">
    <title>Partfinder</title>
    <style>${style}</style>
  </head>
  <body>
    ${main}
  </body>
</html>
`;
}

export interface PageInput {
  q: string;
  hint: string;
  country: Country;
  /** Narrows the supplier and Maps searches. Never stored, and never put in the back-link. */
  city: string;
  /** The supplier's WhatsApp number, as typed. Used to build the link, and nothing else. */
  to: string;
  /** A line for the supplier, e.g. a quantity. Goes in the message, never in the back-link. */
  note: string;
  /** Shown above the form, e.g. when the input was too long. Not user text. */
  notice?: string;
}

/** The whole page, as one HTML document. */
export function renderPage(input: PageInput): string {
  const { q, hint, country, city } = input;
  const trimmed = q.trim();
  let results: ParseResult[] = [];
  let hints: string[] = [];
  let truncated = 0;

  if (trimmed !== "") {
    hints = [...extractHints(q)];
    for (const h of extractHints(hint)) if (!hints.includes(h)) hints.push(h);
    const tokens = extractTokens(q);
    truncated = Math.max(0, tokens.length - MAX_CARDS);
    results = tokens.slice(0, MAX_CARDS).map((token) => parse(token, hints));
  }

  const sections: string[] = [];
  if (input.notice) sections.push(`<p class="note">${escapeHtml(input.notice)}</p>`);
  sections.push(renderForm(q, hint, country, city));
  if (trimmed !== "") {
    if (hints.length > 0) {
      sections.push(`<p class="hints">Hints used: ${escapeHtml(hints.join(", "))}</p>`);
    }
    if (truncated > 0) {
      sections.push(
        `<p class="note">Showing the first ${MAX_CARDS} numbers. ${truncated} more were not read.</p>`,
      );
    }
    sections.push(renderResults(results, country, city));
    sections.push(renderSend(input, results));
  }

  return renderDocument(`<main>
      <h1>Partfinder</h1>
      <p class="lede">Paste a part number, a list, or a WhatsApp message. Partfinder identifies the
      likely manufacturer, helps you check the part and find where to buy it, and drafts the
      requirement for WhatsApp or email.</p>
      ${sections.join("\n      ")}
      <section class="notes">
        <h2>How to read this</h2>
        <p>A format guess means the number matches a manufacturer's known numbering format, and
        nothing more. No catalogue, document or page has been checked, so it is not a confirmed
        identification.</p>
        <p>No prices, stock or lead times are shown: industrial spares are quoted per account,
        never published.</p>
        <p>Identification aid only. Confirm fitment with your supplier.</p>
        <p>Not affiliated with any manufacturer. Brand names identify the parts they make.</p>
      </section>
    </main>`);
}
