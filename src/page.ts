// The /parts page: one server-rendered HTML document, no client-side JavaScript.
// Offline only. Everything on the page comes from the parser in parse.ts; nothing is fetched,
// stored or logged. Every piece of user input is HTML-escaped wherever it appears.

import { DEALER_LOCATORS, findDealerLocator, type DealerLocator } from "./dealers";
import { THEME_COLOR } from "./manifest";
import { extractHints, extractTokens, parse, type ParseResult } from "./parse";
import { quantityFor } from "./quantity";

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

export interface MessageOptions {
  /** A line for the supplier, e.g. "urgent". Goes in the message, never in the back-link. */
  note?: string;
  /** The shop's name, when Partfinder knows who the message is going to. */
  name?: string;
  /** Quantity per part key, parsed from the message or typed on a card. */
  quantities?: Record<string, number>;
}

/**
 * The requirement, in plain text. One format, everywhere: the textarea, every wa.me link and the
 * email body all carry this exact string, so what the user reads is what the supplier gets.
 *
 * Only the numbers outbound() passed are in it, and the back-link carries only those numbers -
 * never the pasted text, the note, the quantities, the city, a shared location or a supplier's
 * number. What a user pastes can hold a customer name, a phone number or a price, and none of
 * that may leave in a message to a third party. Numbers trimmed for length still appear in the
 * link, because the link is how the reader gets back to the full page.
 *
 * No spellings. A supplier reading "1U-3352" does not need to be told it is also written 1U3352.
 */
export function requirementMessage(
  results: readonly ParseResult[],
  options: MessageOptions = {},
): string {
  const { note = "", name = "", quantities = {} } = options;
  const tokens = results.map((r) => r.input).join(" ");
  const greeting = name.trim() === "" ? "Hi," : `Hi ${name.trim()},`;
  const tail = [
    ...(note.trim() === "" ? [] : [`Note: ${note.trim()}`]),
    "Please share availability, price and delivery time.",
    `Details: https://rohitrao.in/parts/?q=${encodeURIComponent(tokens)}`,
  ];
  const line = (result: ParseResult, index: number): string => {
    const quantity = quantities[partKey(result)];
    const makers = [...new Set(result.candidates.map((c) => c.oem))].join(" or ");
    const amount = quantity === undefined ? "" : `, qty ${quantity}`;
    return `${index + 1}. ${partKey(result)} (likely ${makers})${amount}`;
  };
  const assemble = (count: number): string => {
    const lines = results.slice(0, count).map(line);
    const omitted = results.length - count;
    if (omitted > 0) lines.push(`(+${omitted} more on the page)`);
    return [greeting, "We have a requirement for:", ...lines, ...tail].join("\n");
  };

  for (let count = results.length; count >= 2; count--) {
    const message = assemble(count);
    if (message.length <= WHATSAPP_LIMIT) return message;
  }
  return assemble(1);
}

/** Enough rows to read the whole message without scrolling, within reason. */
export function textareaRows(message: string): number {
  return Math.min(20, Math.max(6, message.split("\n").length + 1));
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
.ask textarea { min-height: 7rem; }
.primary { font-size: 1.05rem; padding: .85rem; min-height: 44px; }
.more { margin-top: .75rem; }
.more summary { cursor: pointer; font-weight: 600; padding: .4rem 0; min-height: 44px; }
.more > * { margin-top: .5rem; }
.how { margin-top: 2.5rem; font-size: .9rem; opacity: .85; }
.how summary { cursor: pointer; font-weight: 600; padding: .5rem 0; min-height: 44px; }
:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
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
.suppliers { margin-top: 2rem; }
.gmaps { border: 2px solid currentColor; border-radius: .5rem; padding: .75rem; margin: 1.25rem 0; }
.gmaps > :first-child { margin-top: 0; }
.caveat { font-weight: 600; }
.attribution { font-size: .9rem; font-weight: 600; margin: 1rem 0 0; }
.shops { list-style: none; margin: 1rem 0 0; padding: 0; }
.shop { border-top: 1px solid currentColor; padding-top: .75rem; margin-top: .75rem; }
.shop:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.sname { font-weight: 700; margin: 0; }
.saddr, .sfound, .scount, .srating { font-size: .9rem; margin: .15rem 0; opacity: .85; }
.sphone { font-family: ui-monospace, monospace; margin: .35rem 0 .15rem; }
.shop .whatsapp { margin: .4rem 0 0; }
.shop .link { margin-top: .4rem; }
.sfacts { font-size: .9rem; margin: .15rem 0; }
.sask { font-size: .9rem; margin: .5rem 0 .25rem; font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: .4rem; }
.chip {
  display: inline-block;
  border: 1px solid currentColor;
  border-radius: 1rem;
  padding: .3rem .7rem;
  font-size: .9rem;
  text-decoration: none;
  color: inherit;
  min-height: 34px;
}
a.chip { min-height: 44px; padding: .6rem .9rem; }
.actions { display: flex; flex-direction: column; gap: .4rem; margin-top: .6rem; }
.actions .link, .actions .whatsapp { margin: 0; min-height: 44px; }
.select {
  display: block;
  border: 1px solid currentColor;
  border-radius: .4rem;
  padding: .6rem .8rem;
  min-height: 44px;
  cursor: pointer;
}
.select input { width: auto; margin-right: .5rem; }
.pin {
  display: inline-block;
  min-width: 1.6rem;
  text-align: center;
  border: 1px solid currentColor;
  border-radius: .3rem;
  margin-right: .4rem;
}
.number { font-size: 1.5rem; font-weight: 700; font-family: ui-monospace, monospace; margin: 0; }
.astyped, .asknote { font-size: .85rem; opacity: .8; margin: .1rem 0; }
.tag { display: inline-block; border: 1px solid currentColor; border-radius: .3rem;
  padding: .1rem .4rem; font-size: .85rem; margin: .3rem 0; }
.maker { font-weight: 600; margin: .35rem 0 .2rem; }
.badge { font-size: .75rem; font-weight: 400; border: 1px solid currentColor;
  border-radius: .3rem; padding: .1rem .35rem; opacity: .85; }
.qty { display: flex; align-items: center; gap: .5rem; margin: .5rem 0 .25rem; }
.qtyinput { width: 5rem; min-height: 44px; }
.update { margin-top: .5rem; min-height: 44px; }
.unrecognised { font-size: .9rem; opacity: .85; }
.check summary { cursor: pointer; font-size: .9rem; padding: .5rem 0; min-height: 44px; }
.signin { font-weight: 600; }
.filters { display: flex; flex-wrap: wrap; gap: .4rem; }
.filters:empty { display: none; }
.filter { cursor: pointer; }
.filter[aria-pressed="true"] { font-weight: 700; outline: 2px solid currentColor; }
.locate { margin-top: .5rem; min-height: 44px; }
.shop.here { outline: 3px solid currentColor; outline-offset: 3px; }
.sendbar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  padding: .6rem 1rem;
  background: Canvas;
  border-top: 2px solid currentColor;
}
.sendbar[hidden] { display: none; }
.sendpanel {
  position: fixed;
  inset: auto 0 0 0;
  max-height: 80vh;
  overflow: auto;
  padding: 1rem;
  background: Canvas;
  border-top: 2px solid currentColor;
}
.sendpanel[hidden] { display: none; }
.sendrow { border-top: 1px solid currentColor; padding: .75rem 0; }
.sendrow.done { opacity: .6; }
.sendrow.next { outline: 2px dashed currentColor; outline-offset: 2px; }
.sendparts { font-size: .9rem; opacity: .85; margin: .15rem 0; }
.sr-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
/* The send bar is fixed, so the last card needs room to clear it. */
body { padding-bottom: 5rem; }
.map {
  height: 260px;
  margin-top: 1rem;
  border: 1px solid currentColor;
  border-radius: .4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: .9rem;
  padding: .5rem;
}
@media (min-width: 40rem) { .map { height: 340px; } }
.warn { font-weight: 600; }
.notes { font-size: .9rem; opacity: .85; margin-top: 2rem; }
.footer { font-size: .9rem; opacity: .85; margin-top: 2rem; }
.footer a { color: inherit; }
.note { font-size: .9rem; opacity: .85; }
@media (min-width: 40rem) { body { margin: 0 auto; padding: 2rem 1rem; } }
`.trim();

/**
 * The ask: a paste box, a city, one button.
 *
 * Everything else the page can take - country, a brand hint, a note for suppliers - is behind
 * "More options", because none of it is needed to get an answer and all of it competes with the
 * one thing that is. The country list is plain names: which Google domain a link-out uses is
 * plumbing, and the UX principles say plumbing is never shown.
 *
 * The form stays open past this point: the product cards carry a quantity input each, and they
 * have to submit with the query. renderPage closes it after the cards.
 */
function renderAsk(q: string, hint: string, country: Country, city: string, note: string): string {
  const options = COUNTRIES.map(
    (c) =>
      `<option value="${escapeHtml(c.code)}"${c.code === country.code ? " selected" : ""}>` +
      `${escapeHtml(c.name)}</option>`,
  ).join("\n          ");
  return `<form method="GET" action="/parts/" class="ask">
      <label for="q">Paste a WhatsApp message or part numbers</label>
      <textarea id="q" name="q" rows="5" autofocus
        placeholder="Paste a WhatsApp message or part numbers">${escapeHtml(q)}</textarea>
      <label for="city">City</label>
      <input id="city" name="city" type="text" value="${escapeHtml(city)}" placeholder="e.g. Bengaluru"
        autocomplete="address-level2">
      <button type="submit" class="primary">Find parts &amp; suppliers</button>
      <div id="pf-locate"></div>
      <details class="more">
        <summary>More options</summary>
        <label for="country">Country</label>
        <select id="country" name="country">
          ${options}
        </select>
        <label for="hint">Brand or machine</label>
        <input id="hint" name="hint" type="text" value="${escapeHtml(hint)}" placeholder="e.g. JCB 3CX">
        <label for="note">Note for suppliers</label>
        <input id="note" name="note" type="text" value="${escapeHtml(note)}" placeholder="e.g. urgent, need by Friday">
      </details>`;
}

/** The number as the card shows it, large: the first candidate's canonical form. */
export function cardNumber(result: ParseResult): string {
  return result.candidates[0]?.canonical ?? result.input;
}

/** The suffix split off the number, if any. Shown as a tag, kept on the key and in messages. */
export function cardSuffix(result: ParseResult): string {
  return result.candidates[0]?.suffix ?? "";
}

/**
 * What a card is called everywhere else: in its quantity field, in the message, and in a
 * supplier's "Ask about" chip. Canonical plus the suffix, so 1U-3352 and 1U-3352RC stay apart.
 */
export function partKey(result: ParseResult): string {
  return cardNumber(result) + cardSuffix(result);
}

/** The manufacturers a number could be, in ranked order, without duplicates. */
function oems(result: ParseResult): string[] {
  return [...new Set(result.candidates.map((c) => c.oem))];
}

function link(href: string, text: string): string {
  return `<a class="link" href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}

/** The same query with one manufacturer hinted. Hints re-rank candidates; they never remove one. */
function hintUrl(input: PageInput, oem: string): string {
  const params = new URLSearchParams({ q: input.q, hint: oem });
  if (input.city.trim() !== "") params.set("city", input.city.trim());
  params.set("country", input.country.code);
  return `/parts/?${params.toString()}`;
}

/**
 * Is this the right part, and what does it fit? Three link-outs, collapsed, because they are for
 * the moment of doubt and not for the main flow. Each query uses every spelling of the number
 * internally; the spellings themselves are never shown - that is the parser's business.
 */
function renderCheck(result: ParseResult, country: Country): string {
  return `<details class="check">
          <summary>Check this part</summary>
          ${link(imagesUrl(result, country), "See images")}
          ${link(fitsUrl(result, country), "Which machines it fits")}
          ${link(searchUrl(result, country), "Search Google")}
        </details>`;
}

/** "Qty 2 (from message)", "Qty 2", or "Qty not given". */
function quantityLine(parsed: number | null, typed: boolean): string {
  if (parsed === null) return "Qty not given";
  return typed ? `Qty ${parsed}` : `Qty ${parsed} (from message)`;
}

function renderCard(result: ParseResult, input: PageInput, index: number): string {
  const number = cardNumber(result);
  const suffix = cardSuffix(result);
  const key = partKey(result);
  const makers = oems(result);
  const quantity = input.quantities?.[key] ?? null;
  const typed = input.typedQuantities?.[key] !== undefined;

  const lines = [`<p class="number">${escapeHtml(number)}</p>`];
  if (result.input !== number) {
    lines.push(`<p class="astyped">as typed: ${escapeHtml(result.input)}</p>`);
  }
  if (suffix !== "") lines.push(`<p class="tag">${escapeHtml(suffix)}</p>`);

  if (makers.length === 1) {
    lines.push(
      `<p class="maker">${escapeHtml(makers[0]!)} <span class="badge">format match</span></p>`,
    );
  } else {
    // Ambiguity is reported, not resolved: each chip re-runs the same query with one hint.
    const chips = makers
      .map((oem) => `<a class="chip" href="${escapeHtml(hintUrl(input, oem))}">${escapeHtml(oem)}</a>`)
      .join("\n            ");
    lines.push(`<p class="maker">${escapeHtml(makers.join(" or "))}? <span class="badge">format match</span></p>
          <div class="chips">
            ${chips}
          </div>`);
  }

  lines.push(`<p class="qty">
            <label for="qty-${index}">${quantityLine(quantity, typed)}</label>
            <input id="qty-${index}" class="qtyinput" type="number" inputmode="numeric" min="1" max="9999"
              name="qty_${escapeHtml(key)}" value="${quantity === null ? "" : quantity}"
              aria-label="Quantity for ${escapeHtml(number)}">
          </p>`);

  const count = input.supplierCounts?.[key];
  if (count !== undefined) {
    lines.push(`<p class="asknote">Suppliers to ask: ${count}</p>`);
  }
  lines.push(renderCheck(result, input.country));

  return `<section class="card">
          ${lines.join("\n          ")}
        </section>`;
}

export const FORMAT_CAVEAT =
  "Manufacturer matched from the number's format, not confirmed. Suppliers confirm fitment.";

/**
 * The Parts section: one card per recognised number, then one caveat, then one line naming
 * anything that was not recognised.
 *
 * A phone-shaped run is left out of that line entirely. "Ramesh 9876543210" is a person and a
 * phone number, and echoing the number back under "Not recognised" is both noise and a small
 * privacy leak into a page the user may show someone.
 */
function renderResults(results: readonly ParseResult[], input: PageInput): string {
  const shown = results.filter((r) => !PHONE_SHAPED.test(r.input));
  const recognised = shown.filter((r) => r.candidates.length > 0);
  const unrecognised = shown.filter((r) => r.candidates.length === 0);

  const parts: string[] = ["<h2>Parts</h2>"];
  if (recognised.length === 0) {
    parts.push(`<p class="nothing">${NOTHING_RECOGNISED}</p>`);
  } else {
    parts.push(...recognised.map((r, i) => renderCard(r, input, i)));
    parts.push(`<p class="caveat">${FORMAT_CAVEAT}</p>`);
    parts.push(`<button type="submit" class="update">Update quantities</button>`);
  }
  if (unrecognised.length > 0) {
    const names = unrecognised.map((r) => escapeHtml(r.input)).join(", ");
    parts.push(`<p class="unrecognised">Not recognised: ${names}</p>`);
  }
  return `<section class="parts">
        ${parts.join("\n        ")}
      </section>`;
}

export const NOTHING_RECOGNISED = "Nothing here looks like a part number yet.";

const INVALID_NUMBER =
  "That doesn't look like a WhatsApp number, so pick the contact in WhatsApp instead.";

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

/**
 * "Other ways to send": everything that is not a supplier card. Collapsed when there are supplier
 * cards to use instead, open when there are not, because then it is the only way out.
 *
 * The form inside is a GET back to this page carrying what the user already typed, so preparing a
 * message never loses the search. Nothing here is stored: the supplier's number and the note live
 * in the URL of the user's own browser and in the links this builds, nowhere else.
 */
function renderSend(input: PageInput, results: readonly ParseResult[]): string {
  const sending = outbound(results);
  if (sending.length === 0) return "";

  const { q, hint, country, city, to, note } = input;
  const message = requirementMessage(sending, {
    note,
    ...(input.quantities ? { quantities: input.quantities } : {}),
  });
  const digits = to.trim() === "" ? null : normaliseWhatsapp(to, country);
  const open = input.sendOpen ? " open" : "";
  const picker = whatsappUrl(message);

  const parts: string[] = [];
  if (open !== "") {
    parts.push(`<a class="whatsapp" href="${escapeHtml(picker)}">Send on WhatsApp</a>`);
  }
  parts.push(
    `<label for="message">The message</label>`,
    `<textarea id="message" rows="${textareaRows(message)}" readonly>${escapeHtml(message)}</textarea>`,
  );
  if (digits !== null) {
    parts.push(
      `<a class="whatsapp" href="${escapeHtml(whatsappUrl(message, digits))}">` +
        `Open WhatsApp chat with ${escapeHtml(formatWhatsapp(digits))}</a>`,
    );
  }
  if (open === "") parts.push(link(picker, "Pick a contact in WhatsApp"));
  parts.push(link(mailtoUrl(emailSubject(sending), message), "Send by email"));
  parts.push(`<form method="GET" action="/parts/" class="toform">
          ${hidden("q", q)}
          ${hidden("hint", hint)}
          ${hidden("country", country.code)}
          ${hidden("city", city)}
          ${hidden("note", note)}
          <label for="to">Supplier's WhatsApp number</label>
          <input id="to" name="to" type="text" value="${escapeHtml(to)}" inputmode="tel"
            placeholder="Supplier's WhatsApp number">
          <button type="submit">Prepare message</button>
        </form>`);
  if (to.trim() !== "" && digits === null) {
    parts.push(`<p class="note">${INVALID_NUMBER}</p>`);
  }

  return `<details class="send"${open}>
        <summary>Other ways to send</summary>
        ${parts.join("\n        ")}
      </details>`;
}

/**
 * Terms and privacy, on every page under /parts. Google's Places API policies require both to be
 * publicly reachable from anywhere its data is used, and the rest of the site is no worse for it.
 */
const FOOTER = `<footer class="footer">
      <a href="/parts/terms">Terms</a> &middot; <a href="/parts/privacy">Privacy</a>
    </footer>`;

/**
 * The shared HTML shell for every page under /parts: one head, one stylesheet, no client-side
 * JavaScript. `main` is the whole <main> element, indented to sit at four spaces. `extraStyle` is
 * for rules only one page needs, so the public page does not carry the vendor pages' CSS.
 */
export interface DocumentOptions {
  /** Rules only this page needs, so other pages do not carry them. */
  extraStyle?: string;
  /**
   * The CSP nonce, on pages whose Content-Security-Policy carries one. Our own <style> has to
   * have it too: a nonce in script-src or style-src makes the browser ignore 'unsafe-inline',
   * so an unnonced <style> would simply not apply.
   */
  nonce?: string;
  /** Markup just before </body>. The Maps scripts, and nothing else so far. */
  tail?: string;
}

export function renderDocument(main: string, options: DocumentOptions = {}): string {
  const { extraStyle = "", nonce, tail = "" } = options;
  const style = extraStyle === "" ? STYLE : `${STYLE}\n${extraStyle.trim()}`;
  const styleNonce = nonce === undefined ? "" : ` nonce="${escapeHtml(nonce)}"`;
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
    <style${styleNonce}>${style}</style>
  </head>
  <body>
    ${main}
    ${FOOTER}${tail}
  </body>
</html>
`;
}

/** What one query turned into. Computed once per request, because the CPU budget is 10 ms. */
export interface ParsedQuery {
  hints: string[];
  results: ParseResult[];
  /** Tokens past MAX_CARDS, counted so the page can say how many it did not read. */
  truncated: number;
  /** Quantities read out of the pasted message, by part key. */
  quantities: Record<string, number>;
}

/**
 * Read a query into cards. Exported because the supplier search needs the same parse the cards
 * are built from, and parsing twice would spend the request's budget twice.
 */
export function readQuery(q: string, hint: string): ParsedQuery {
  if (q.trim() === "") return { hints: [], results: [], truncated: 0, quantities: {} };
  const hints = [...extractHints(q)];
  for (const h of extractHints(hint)) if (!hints.includes(h)) hints.push(h);
  const tokens = extractTokens(q);
  const results = tokens.slice(0, MAX_CARDS).map((token) => parse(token, hints));
  const quantities: Record<string, number> = {};
  for (const result of results) {
    const quantity = quantityFor(q, result.input);
    if (quantity !== null) quantities[partKey(result)] = quantity;
  }
  return { hints, results, truncated: Math.max(0, tokens.length - MAX_CARDS), quantities };
}

export interface PageInput {
  q: string;
  hint: string;
  country: Country;
  /** Narrows the supplier and Maps searches. Never stored on a record; remembered in a cookie. */
  city: string;
  /** The supplier's WhatsApp number, as typed. Used to build the link, and nothing else. */
  to: string;
  /** A line for the supplier, e.g. a quantity. Goes in the message, never in the back-link. */
  note: string;
  /** Shown above the form, e.g. when the input was too long. Not user text. */
  notice?: string;
  /** Quantity per part key: parsed from the message, or overridden by a qty_ field. */
  quantities?: Record<string, number>;
  /** The subset of `quantities` the user typed, so the card can stop saying "from message". */
  typedQuantities?: Record<string, number>;
  /** Supplier cards matching each part key. Absent when no supplier search ran. */
  supplierCounts?: Record<string, number>;
  /**
   * Open "Other ways to send" and make the WhatsApp picker its primary button. True when there
   * are no supplier cards to use instead, so this block is the only way out.
   */
  sendOpen?: boolean;
  /** The parse, when the caller already has it. Recomputed here when it does not. */
  parsed?: ParsedQuery;
  /** The Suppliers section, rendered by the caller because only it can reach Google. */
  suppliers?: string;
  /** Passed to renderDocument on a page whose CSP carries a nonce. */
  nonce?: string;
  /** Markup just before </body>: the Maps scripts. */
  tail?: string;
}

/** Moved out of the main flow: true, needed once, and not what the user came for. */
const HOW_IT_WORKS = `<details class="how">
        <summary>How it works</summary>
        <p>Partfinder reads each number and matches it against manufacturers' known numbering
        formats. That is a match on the shape of the number, not a confirmed identification: no
        catalogue or document has been checked. Suppliers confirm fitment.</p>
        <p>Suppliers are shops Google lists for those brands in your city. Being listed is not a
        claim that a shop stocks your part.</p>
        <p>No prices, stock or lead times are shown: industrial spares are quoted per account,
        never published.</p>
        <p>Nothing you type is stored or logged. Not affiliated with any manufacturer; brand names
        identify the parts they make.</p>
      </details>`;

/** The whole page, as one HTML document. */
export function renderPage(input: PageInput): string {
  const { q, hint, country, city, note } = input;
  const trimmed = q.trim();
  const parsed = input.parsed ?? readQuery(q, hint);
  const { results, truncated } = parsed;
  // A typed quantity wins over the one read from the message, and stops the card crediting it.
  const quantities = { ...parsed.quantities, ...input.typedQuantities };
  const withQuantities: PageInput = { ...input, quantities };

  // One form from the paste box to the last product card: the quantity inputs live on the cards
  // and have to submit with the query. Anything with a form of its own sits after it closes.
  const form: string[] = [renderAsk(q, hint, country, city, note)];
  if (trimmed !== "") {
    if (truncated > 0) {
      form.push(
        `<p class="note">Showing the first ${MAX_CARDS} numbers. ${truncated} more were not read.</p>`,
      );
    }
    form.push(renderResults(results, withQuantities));
  }
  form.push("</form>");

  const after: string[] = [];
  if (trimmed !== "") {
    if (input.suppliers) after.push(input.suppliers);
    after.push(renderSend(withQuantities, results));
  }

  const sections = [
    ...(input.notice ? [`<p class="note">${escapeHtml(input.notice)}</p>`] : []),
    form.join("\n      "),
    ...after,
  ];

  return renderDocument(`<main>
      <h1>Partfinder</h1>
      <p class="lede">Paste a customer's message. Get the parts, nearby suppliers, and ready
      WhatsApp messages.</p>
      ${sections.join("\n      ")}
      ${HOW_IT_WORKS}
    </main>`, {
    ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
    ...(input.tail === undefined ? {} : { tail: input.tail }),
  });
}
