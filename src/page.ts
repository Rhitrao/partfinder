// The /parts page: one server-rendered HTML document, no client-side JavaScript.
// Offline only. Everything on the page comes from the parser in parse.ts; nothing is fetched,
// stored or logged. Every piece of user input is HTML-escaped wherever it appears.

import { DEALER_LOCATORS, findDealerLocator, type DealerLocator } from "./dealers";
import { findFitment, machineCount, sourceLabel, type Fitment } from "./fitments";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "./manifest";
import {
  PHONE_SHAPED,
  describedPart,
  describedResult,
  descriptiveWords,
  extractHints,
  extractTokens,
  parse,
  type ParseResult,
} from "./parse";
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

/**
 * Everything that gets a card: a placed number, one nobody could place but that reads as one, or
 * a part the message described rather than numbered.
 */
export function isPart(result: ParseResult): boolean {
  return result.candidates.length > 0 || result.unplaced === true || result.described !== undefined;
}

/**
 * The parts that may leave this page: anything with a card, and not shaped like a phone number.
 *
 * What a user pastes can hold a customer's name and number; only what Partfinder reads as a part
 * goes into a message to a third party, or onto a card, or into the "Not recognised" line. Since
 * step 9 a number no rule placed is one of those - it is still what the customer asked for, and
 * dropping it from the message was the surest way to lose an order.
 */
export function outbound(results: readonly ParseResult[]): ParseResult[] {
  return results.filter((r) => isPart(r) && !PHONE_SHAPED.test(r.input));
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
  // A description is searched as a phrase, unquoted: "EX200 pin pivot". Quoting a description
  // asks Google for those words in that order and nothing else, which is the opposite of what
  // somebody looking for a part by name wants. A number is quoted, because there it is the point.
  if (result.described) return result.input;
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
/**
 * One part, as a supplier reads it.
 *
 * A number is followed by whatever the customer called it and then by its likely makers:
 * "24370-2E000 CVVT (likely Hyundai / Kia or Toyota)". The word is the customer's own, not a
 * guess about the part, and it is worth more to a supplier than either half alone - a
 * counterman who does not stock that number may well know the CVVT sensor for it. Every card
 * gets it, placed or not; a card with no words left reads exactly as it did before.
 *
 * A described part is the exception, and only because it would be saying the same thing twice:
 * its name is already those words. It reads as the sentence it is instead: "Pin pivot for EX200
 * (Hitachi or Tata Hitachi)".
 *
 * No spellings anywhere. A supplier reading "1U-3352" does not need to be told it is also
 * written 1U3352.
 */
export function describeForMessage(result: ParseResult): string {
  if (result.described) {
    const { machine, brands, name } = result.described;
    const title = name.charAt(0).toUpperCase() + name.slice(1);
    const where = machine === "" ? "" : ` for ${machine}`;
    const who = brands.length === 0 ? "" : ` (${brands.join(" or ")})`;
    return `${title}${where}${who}`;
  }
  const words = (result.words ?? []).join(" ").toUpperCase();
  const called = words === "" ? "" : ` ${words}`;
  const makers = [...new Set(result.candidates.map((c) => c.oem))];
  const who = makers.length === 0 ? "" : ` (likely ${makers.join(" or ")})`;
  return `${partKey(result)}${called}${who}`;
}

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
    const amount = quantity === undefined ? "" : `, qty ${quantity}`;
    return `${index + 1}. ${describeForMessage(result)}${amount}`;
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


const STYLE = `
/* ---- Design tokens -----------------------------------------------------------------------
 * rohitrao.in's own stylesheet could not be read from here - the build environment's egress
 * proxy refuses the host - so these are the site's light scheme as the step 8 prompt records
 * it, and they are the single place any colour, radius or step is written down. Dark inverts
 * background and surface and keeps the accents.
 */
:root {
  color-scheme: light dark;

  --bg: #FFFFFF;
  --surface: #F7F7F5;
  --border: #E6E5E1;
  --text: #111111;
  --muted: #5B5B57;

  /* The one high-contrast button: black on white, and white on black in the dark scheme. */
  --btn-bg: #111111;
  --btn-fg: #FFFFFF;
  /* WhatsApp's own green, with black text, in both schemes. */
  --wa-bg: #25D366;
  --wa-fg: #111111;

  --r: 8px;
  --r-sm: 6px;
  --r-pill: 999px;

  --s4: 4px;
  --s8: 8px;
  --s12: 12px;
  --s16: 16px;
  --s24: 24px;
  --s32: 32px;
  --s48: 48px;

  --maxw: 760px;
  /* Smallest comfortable target, and the floor for every control on the page. */
  --tap: 44px;

  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial,
    sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111111;
    --surface: #1B1B19;
    --border: #33322E;
    --text: #F7F7F5;
    --muted: #A5A49E;
    --btn-bg: #F7F7F5;
    --btn-fg: #111111;
  }
}

/* ---- Base --------------------------------------------------------------------------------- */
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  padding: var(--s24) var(--s16);
  font-family: var(--font);
  font-size: 16px;
  line-height: 1.5;
  background: var(--bg);
  color: var(--text);
}
h1, h2, h3 { line-height: 1.25; }
h1 { font-size: 24px; font-weight: 600; margin: 0 0 var(--s4); letter-spacing: -0.01em; }
h2 { font-size: 18px; font-weight: 600; margin: 0 0 var(--s12); }
h3 { font-size: 14px; font-weight: 600; margin: 0 0 var(--s8); }
p { margin: var(--s8) 0; }
a { color: inherit; }
.muted, .note, .hints, .astyped, .asknote, .grouphint, .unrecognised, .excluded,
.basis, .strength, .suffix, .sendparts { color: var(--muted); }
.note, .hints, .astyped, .asknote, .grouphint, .unrecognised, .excluded,
.basis, .strength, .suffix, .sendparts { font-size: 14px; }
.lede { color: var(--muted); margin: 0 0 var(--s24); }
.warn { font-weight: 600; }

/* One visible ring on everything focusable, in the text colour so it reads in both schemes. */
:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; border-radius: var(--r-sm); }

/* ---- Controls ----------------------------------------------------------------------------- */
form { display: flex; flex-direction: column; gap: var(--s4); }
label { font-weight: 600; font-size: 14px; margin-top: var(--s8); }
textarea, input, select {
  font: inherit;
  width: 100%;
  min-height: var(--tap);
  padding: var(--s12);
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--r);
}
textarea { min-height: 7rem; resize: vertical; line-height: 1.5; }
input::placeholder, textarea::placeholder { color: var(--muted); }
button {
  font: inherit;
  font-weight: 600;
  min-height: var(--tap);
  padding: var(--s12) var(--s16);
  border-radius: var(--r);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.primary {
  width: 100%;
  margin-top: var(--s16);
  background: var(--btn-bg);
  color: var(--btn-fg);
  border-color: var(--btn-bg);
  font-size: 16px;
}
.secondary { background: var(--surface); color: var(--text); border-color: var(--border); }

/* A link that looks like a button: the link-outs, the shop actions, the dealer locators. */
.link {
  display: inline-flex;
  align-items: center;
  gap: var(--s8);
  min-height: var(--tap);
  padding: var(--s8) var(--s12);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  text-decoration: none;
  color: var(--text);
}
.whatsapp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s8);
  min-height: var(--tap);
  padding: var(--s12) var(--s16);
  background: var(--wa-bg);
  color: var(--wa-fg);
  border: 1px solid var(--wa-bg);
  border-radius: var(--r);
  font-weight: 600;
  text-decoration: none;
}
/* The mark on every link that leaves this site. Decorative: the label already says where. */
.ext { font-size: 0.85em; line-height: 1; }

details > summary {
  cursor: pointer;
  font-weight: 600;
  min-height: var(--tap);
  display: flex;
  align-items: center;
}
.more { margin-top: var(--s12); }
.more > * { margin-top: var(--s8); }
.how { margin-top: var(--s48); color: var(--muted); font-size: 14px; }
.check summary { font-size: 14px; font-weight: 500; color: var(--muted); }
.check > .link { display: flex; margin-top: var(--s8); }
h4 { font-size: 13px; font-weight: 600; margin: var(--s12) 0 var(--s4); }
.fitline { font-size: 14px; margin: var(--s12) 0 var(--s4); }
.fitline.none { color: var(--muted); }
.fitment { margin: 0 0 var(--s12); }
.fitment summary { font-size: 14px; font-weight: 600; }
.fitgroup h4 { text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.machines { font-family: var(--mono); font-size: 13px; line-height: 1.6; margin: 0; }
.fitnote { font-size: 13px; color: var(--muted); margin: var(--s12) 0 0; }
/* A link inside a sentence, not a button like the link-outs around it. */
.link.inline {
  display: inline;
  min-height: 0;
  padding: 0;
  border: 0;
  background: none;
  text-decoration: underline;
}
.elsewhere { margin-top: var(--s16); }

/* ---- Part cards --------------------------------------------------------------------------- */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: var(--s16);
  margin: var(--s12) 0;
}
.number {
  font-family: var(--mono);
  font-size: 22px;
  font-weight: 600;
  margin: 0;
  word-break: break-all;
}
.maker { font-weight: 600; margin: var(--s8) 0 var(--s4); }
.maker.described, .maker.unplaced { font-weight: 500; color: var(--muted); }
/* A name, not a number: the same size, but set in the page's own face. */
.card .number:not(.plain) { font-family: var(--mono); }
.number.plain { font-family: var(--font); }
.badge {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 2px var(--s8);
  white-space: nowrap;
}
.tag {
  display: inline-block;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 2px var(--s8);
  margin: var(--s4) 0;
}
.chips { display: flex; flex-wrap: wrap; gap: var(--s8); margin: var(--s8) 0; }
.chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: var(--s4) var(--s12);
  font-size: 14px;
  background: var(--bg);
  color: var(--text);
  text-decoration: none;
}
a.chip, button.chip { min-height: var(--tap); }
.caveat { font-size: 14px; color: var(--muted); }
.qty { display: flex; align-items: center; gap: var(--s12); margin: var(--s12) 0 0; }
.qty label { margin: 0; font-weight: 500; color: var(--muted); }
.qtyinput { width: 72px; flex: none; text-align: center; }
/* A correction, not the main action: small, secondary, and only as wide as its label. */
.update { align-self: flex-start; min-height: 36px; padding: var(--s8) var(--s16); font-size: 14px; }
.nothing { font-weight: 600; text-align: center; margin: var(--s24) 0; }
.candidate { border-top: 1px solid var(--border); padding-top: var(--s12); margin-top: var(--s12); }
.candidate:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.oem { font-weight: 600; margin: 0; }
.canonical { font-family: var(--mono); margin: var(--s4) 0; word-break: break-all; }
.warnings { font-size: 14px; margin: var(--s8) 0 0; padding-left: var(--s16); color: var(--muted); }
.narrow { font-size: 14px; font-weight: 600; margin: var(--s12) 0 0; }
.answer { margin: 0; }
.answer .reason { font-size: 14px; color: var(--muted); margin: var(--s4) 0 0; }

/* ---- Link-out groups ------------------------------------------------------------------------ */
.group { margin-top: var(--s16); }
.group h3 { text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.group .link { display: flex; margin-top: var(--s8); }

/* ---- Suppliers ------------------------------------------------------------------------------ */
.suppliers { margin-top: var(--s32); }
.gmaps {
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: var(--s12);
  margin: var(--s16) 0;
  background: var(--surface);
}
.gmaps > :first-child { margin-top: 0; }
.attribution { font-size: 12px; font-weight: 600; color: var(--muted); margin: var(--s12) 0 0; }
.shops { list-style: none; margin: var(--s16) 0 0; padding: 0; }
.shop {
  border-top: 1px solid var(--border);
  padding-top: var(--s16);
  margin-top: var(--s16);
}
.shop:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.shop.here { outline: 2px solid var(--text); outline-offset: 4px; border-radius: var(--r); }
.suphead {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--s8) var(--s12);
}
.suphead h2 { margin: 0; }
/* The count is an aside to the heading, not an announcement of its own. */
.status { font-size: 14px; color: var(--muted); font-weight: 500; margin: 0; }
.sname { font-size: 17px; font-weight: 600; margin: 0; }
.pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  margin-right: var(--s8);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.sfacts, .saddr { font-size: 14px; color: var(--muted); margin: var(--s4) 0; }
/* An address is for recognising a place, not reading in full; two lines is enough to do that. */
.saddr {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sask { font-size: 14px; font-weight: 600; margin: var(--s12) 0 var(--s4); }
.actions { display: flex; flex-wrap: wrap; gap: var(--s8); margin-top: var(--s12); }
.select {
  display: inline-flex;
  align-items: center;
  gap: var(--s8);
  min-height: var(--tap);
  padding: var(--s8) var(--s12);
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--surface);
  font-size: 14px;
  font-weight: 500;
  margin: 0;
  cursor: pointer;
}
.select input { width: auto; min-height: 0; margin: 0; }
.filters, .scopes { display: flex; flex-wrap: wrap; gap: var(--s8); margin: var(--s12) 0; }
.scopes .chip[aria-pressed="true"] {
  background: var(--btn-bg);
  color: var(--btn-fg);
  border-color: var(--btn-bg);
}
.filters:empty { display: none; }
.filter { cursor: pointer; background: var(--bg); }
.filter[aria-pressed="true"] { background: var(--btn-bg); color: var(--btn-fg); border-color: var(--btn-bg); }
.turnstile:empty { display: none; }
.locate, .retry { margin-top: var(--s12); }

/* ---- Other ways to send --------------------------------------------------------------------- */
.send { margin-top: var(--s32); }
.send textarea { min-height: 0; font-size: 14px; }
.sendbar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  padding: var(--s12) var(--s16);
  background: var(--bg);
  border-top: 1px solid var(--border);
}
.sendbar[hidden], .sendpanel[hidden] { display: none; }
.sendbar .primary { margin-top: 0; }
.sendpanel {
  position: fixed;
  inset: auto 0 0 0;
  max-height: 80vh;
  overflow: auto;
  padding: var(--s16);
  background: var(--bg);
  border-top: 1px solid var(--border);
}
.sendhead { display: flex; align-items: center; justify-content: space-between; gap: var(--s16); }
.sendrow { border-top: 1px solid var(--border); padding: var(--s16) 0; }
.sendrow.done { opacity: 0.55; }
.sendrow.next { outline: 2px dashed var(--border); outline-offset: 4px; }
.sr-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

/* ---- The map --------------------------------------------------------------------------------- */
.map {
  height: 220px;
  margin-top: var(--s12);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 14px;
  color: var(--muted);
  padding: var(--s8);
}

/* ---- Placeholders ----------------------------------------------------------------------------- */
.ghosts { list-style: none; margin: var(--s16) 0 0; padding: 0; }
.ghosts[hidden] { display: none; }
.ghost { border-top: 1px solid var(--border); padding-top: var(--s16); margin-top: var(--s16); }
.ghost:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.ghostbar {
  display: block;
  height: 14px;
  margin: var(--s8) 0;
  border-radius: var(--r-sm);
  background: var(--border);
}
.ghostbar.short { width: 45%; }
/* Shaped like the card that replaces it: a 17px name, then the two muted lines, then the
 * actions row, at the heights those occupy. Nothing moves when the real list arrives. */
.ghostbar.name { height: 17px; width: 70%; }
.ghostbar.actions { height: var(--tap); margin-top: var(--s12); border-radius: var(--r); }

/* ---- Footer ------------------------------------------------------------------------------------ */
.notes { font-size: 14px; color: var(--muted); margin-top: var(--s32); }
.footer {
  font-size: 14px;
  color: var(--muted);
  margin-top: var(--s48);
  padding-top: var(--s16);
  border-top: 1px solid var(--border);
}

/* ---- Layout ------------------------------------------------------------------------------------
 * Mobile first: one column, 16px of side padding, capped at 760px and centred. The second column
 * arrives at 960px and only when there is something to put in it - an empty right half would just
 * squeeze the form to half width on a page that has not been searched yet.
 */
.wrap { max-width: var(--maxw); margin: 0 auto; }
.cols { display: grid; gap: var(--s32); }
.col { min-width: 0; }

/* One column's width at the two-column breakpoint. The send bar is fixed, so it cannot inherit
 * the grid's geometry and has to be told it. */
:root {
  --col-w: calc((min(100vw - (2 * var(--s16)), var(--maxw)) - var(--s32)) / 2);
  /* The fixed send bar's height, which is also the room the page leaves under its last card. */
  --bar-h: 72px;
}

@media (min-width: 960px) {
  /*
   * The measure widens with the second column. 760px is right for one column of prose; split in
   * two it leaves 364px a side, which is not enough for a supplier card's actions without them
   * wrapping three deep.
   *
   * This redefines --maxw rather than setting .wrap's max-width directly, because --col-w is
   * derived from --maxw and the send bar is derived from --col-w. Widening only .wrap would
   * leave a 364px bar under a 534px column.
   */
  :root { --maxw: 1100px; }

  .cols.two { grid-template-columns: 1fr 1fr; align-items: start; }
  /*
   * The left column sticks while it is shorter than the viewport, and scrolls with the page once
   * it is taller - which is what position: sticky does on its own, given align-self: start. CSS
   * has no way to ask how tall the column's content is, so this is the behaviour rather than the
   * measurement.
   */
  .cols.two > .left { position: sticky; top: var(--s16); align-self: start; }
  /* Fixed, so it cannot sit inside the column; placed over it instead, to the pixel. */
  .sendbar, .sendpanel {
    left: calc(50% + (var(--s32) / 2));
    right: auto;
    width: var(--col-w);
    border: 1px solid var(--border);
    border-bottom: 0;
    border-radius: var(--r) var(--r) 0 0;
  }
}

/* The map: a strip on a phone, taller on a tablet, and as much of its column as it can have on a
 * desktop, up to 480px. */
@media (min-width: 700px) { .map { height: 320px; } }
@media (min-width: 960px) { .map { height: clamp(320px, 52vh, 480px); } }

/*
 * Safe areas. The viewport meta carries viewport-fit=cover so that env() is not simply zero,
 * which means the page now reaches under a notch and has to hold its own gutters back out of it.
 */
body {
  padding-left: max(var(--s16), env(safe-area-inset-left));
  padding-right: max(var(--s16), env(safe-area-inset-right));
  /* Exactly the bar's height, so a fixed bar never covers the last card. */
  padding-bottom: calc(var(--bar-h) + env(safe-area-inset-bottom));
}
.sendbar { padding-bottom: calc(var(--s12) + env(safe-area-inset-bottom)); }
.sendpanel { padding-bottom: calc(var(--s16) + env(safe-area-inset-bottom)); }
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
      <input id="city" name="city" type="text" value="${escapeHtml(city)}"
        placeholder="Optional, leave empty for all of India"
        autocomplete="address-level2">
      <button type="submit" class="primary">Find parts &amp; suppliers</button>
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
function cardNumber(result: ParseResult): string {
  return result.candidates[0]?.canonical ?? result.input;
}

/** The suffix split off the number, if any. Shown as a tag, kept on the key and in messages. */
function cardSuffix(result: ParseResult): string {
  return result.candidates[0]?.suffix ?? "";
}

/**
 * What a card is called everywhere else: in its quantity field, in the message, and in a
 * supplier's "Ask about" chip. Canonical plus the suffix, so 1U-3352 and 1U-3352RC stay apart.
 */
export function partKey(result: ParseResult): string {
  // A described part has no number to be keyed by, so it is keyed by what it is: the machine and
  // the name. The prefix keeps it out of the way of anything a rule could ever produce.
  if (result.described) return `desc:${result.described.machine}:${result.described.name}`;
  return cardNumber(result) + cardSuffix(result);
}

/** What a card is titled: the number, or the name the customer used. */
export function cardTitle(result: ParseResult): string {
  return result.described ? result.described.name : cardNumber(result);
}

/** The manufacturers a number could be, in ranked order, without duplicates. */
function oems(result: ParseResult): string[] {
  return [...new Set(result.candidates.map((c) => c.oem))];
}

/**
 * True for a link that leaves this site. mailto: and tel: hand off to an app rather than opening
 * a site, and /parts/... stays here, so neither is marked.
 */
export function isExternal(href: string): boolean {
  return href.startsWith("https://") || href.startsWith("http://");
}

/**
 * Every anchor on the page goes through here, so the rule cannot be applied to some link-outs
 * and forgotten on others: a link that leaves the site carries rel="noopener" and a small arrow
 * after its label. The arrow is aria-hidden - it is a sign for the eye, and the label already
 * says where the link goes.
 */
export function anchor(href: string, text: string, className = "link"): string {
  const outward = isExternal(href)
    ? ` rel="noopener"`
    : "";
  const mark = isExternal(href) ? ` <span class="ext" aria-hidden="true">&#8599;</span>` : "";
  return `<a class="${className}" href="${escapeHtml(href)}"${outward}>${escapeHtml(text)}${mark}</a>`;
}

function link(href: string, text: string): string {
  return anchor(href, text);
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

/** How many machines a card names before "and the rest" takes over. */
const FITMENT_PREVIEW = 4;

export const NO_FITMENT = "Fitment not in our list yet";

/**
 * What this part fits, on the card itself rather than folded away.
 *
 * It was inside "Check this part", which is where things go when they are for the moment of
 * doubt. This is not one of those: what a part fits is most of what the buyer is being asked on
 * the phone, and a collapsed <details> with three link-outs in it is not where anybody looks for
 * it. So the first four machines and the count are on the card, and the full grouped list, the
 * note and the sources are one tap behind "See all".
 *
 * Every other card says so and offers the search. Saying nothing would read as "no", and a
 * missing entry means nobody has looked yet - which is a different thing, and the buyer can look.
 */
function renderFitmentLine(result: ParseResult, country: Country): string {
  const fitment = findFitment(partKey(result));
  if (fitment === undefined) {
    return `<p class="fitline none">${NO_FITMENT} &middot; ` +
      `${anchor(fitsUrl(result, country), "Check on Google", "link inline")}</p>`;
  }
  const machines = fitment.machines.flatMap((group) => group.machines);
  const count = machines.length;
  const preview = machines.slice(0, FITMENT_PREVIEW).join(", ");
  const more = count > FITMENT_PREVIEW ? "\u2026" : "";
  return `<p class="fitline">Fits ${count} machine${count === 1 ? "" : "s"}, incl.
            ${escapeHtml(preview)}${more}</p>
          ${renderFitment(fitment)}`;
}

/**
 * "Commonly fitted to (52 machines)", collapsed, with the groups inside and the provenance under
 * them.
 *
 * The note and the source are not a footnote to be tucked away: the list is a compilation of
 * other people's listings, it disagrees with itself between sellers, and it goes stale. So the
 * same line always carries all three - what the list is, where it came from, and when it was
 * read - and it renders from the entry rather than from anything written here.
 */
function renderFitment(fitment: Fitment): string {
  const groups = fitment.machines
    .map(
      (group) => `<div class="fitgroup">
              <h4>${escapeHtml(group.heading)}</h4>
              <p class="machines">${escapeHtml(group.machines.join(", "))}</p>
            </div>`,
    )
    .join("\n            ");
  const count = machineCount(fitment);
  // Each source by its domain, because whether two of them are independent domains is exactly
  // what decides the tier, and a reader can see that for themselves this way.
  const sources = fitment.sources
    .map((url) => anchor(url, sourceLabel(url), "link inline"))
    .join(", ");
  const label = fitment.sources.length === 1 ? "Source" : "Sources";
  return `<details class="fitment">
            <summary>See all ${count} machine${count === 1 ? "" : "s"}</summary>
            ${groups}
            <p class="fitnote">${escapeHtml(fitment.note)}
              ${label}: ${sources}, checked ${escapeHtml(fitment.checkedOn)}.</p>
          </details>`;
}

/**
 * The quantity label: "Qty 2 from message", "Qty 2", or just "Qty".
 *
 * There is no "Qty not given" any more. Nothing was given because the message did not say, which
 * is the ordinary case rather than a finding, and an empty box with "Qty" over it says it better
 * than a sentence does.
 */
function quantityLine(parsed: number | null, typed: boolean): string {
  if (parsed === null) return "Qty";
  return typed ? `Qty ${parsed}` : `Qty ${parsed} from message`;
}

function renderCard(result: ParseResult, input: PageInput, index: number): string {
  const number = cardTitle(result);
  const suffix = cardSuffix(result);
  const key = partKey(result);
  const makers = oems(result);
  const quantity = input.quantities?.[key] ?? null;
  const typed = input.typedQuantities?.[key] !== undefined;

  const titleClass = result.described ? "number plain" : "number";
  const lines = [`<p class="${titleClass}">${escapeHtml(number)}</p>`];
  if (!result.described && result.input !== number) {
    lines.push(`<p class="astyped">as typed: ${escapeHtml(result.input)}</p>`);
  }
  if (suffix !== "") lines.push(`<p class="tag">${escapeHtml(suffix)}</p>`);

  if (result.described) {
    // What it is for, and who makes that. No "format match" badge: nothing was matched, the
    // customer said it.
    const { machine, brands } = result.described;
    const parts = [
      ...(machine === "" ? [] : [escapeHtml(machine)]),
      escapeHtml(brands.join(" or ")),
    ].filter((piece) => piece !== "");
    lines.push(`<p class="maker described">for ${parts.join(" &middot; ")}</p>`);
  } else if (result.unplaced) {
    // No rule placed it, so there is no manufacturer to name and no format match to claim. The
    // number is still the title, and every link-out below still works on it.
    lines.push(`<p class="maker unplaced">${UNPLACED}</p>`);
  } else if (makers.length === 1) {
    lines.push(
      `<p class="maker">${escapeHtml(makers[0]!)} <span class="badge">format match</span></p>`,
    );
  } else {
    // Ambiguity is reported, not resolved: each chip re-runs the same query with one hint.
    const chips = makers
      .map((oem) => anchor(hintUrl(input, oem), oem, "chip"))
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
              placeholder="Qty" aria-label="Quantity for ${escapeHtml(number)}">
          </p>`);

  lines.push(renderFitmentLine(result, input.country));
  lines.push(renderCheck(result, input.country));

  return `<section class="card">
          ${lines.join("\n          ")}
        </section>`;
}

export const UNPLACED = "Manufacturer not recognised";

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
  // Three groups now, not two. A number that reads as a part gets a card whether or not a rule
  // placed it; only what does not read as one at all - too short, or bare digits - is left to
  // the line at the bottom.
  const recognised = shown.filter(isPart);
  const unrecognised = shown.filter((r) => !isPart(r));

  const parts: string[] = ["<h2>Parts</h2>"];
  if (recognised.length === 0) {
    parts.push(`<p class="nothing">${NOTHING_RECOGNISED}</p>`);
  } else {
    parts.push(...recognised.map((r, i) => renderCard(r, input, i)));
    // Directly under the cards, because it acts on them, and small because it is a correction
    // rather than the thing the page is for.
    parts.push(`<button type="submit" class="update secondary">Update</button>`);
    parts.push(`<p class="caveat">${FORMAT_CAVEAT}</p>`);
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
    parts.push(anchor(picker, "Send on WhatsApp", "whatsapp"));
  }
  parts.push(
    `<label for="message">The message</label>`,
    `<textarea id="message" rows="${textareaRows(message)}" readonly>${escapeHtml(message)}</textarea>`,
  );
  if (digits !== null) {
    parts.push(
      anchor(
        whatsappUrl(message, digits),
        `Open WhatsApp chat with ${formatWhatsapp(digits)}`,
        "whatsapp",
      ),
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
 *
 * There is no sign-in link beside them any more: the supplier list is public.
 */
function renderFooter(): string {
  return `<footer class="footer">
      <a href="/parts/terms">Terms</a> &middot; <a href="/parts/privacy">Privacy</a>
    </footer>`;
}

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
  /** Markup just before </body>. The page's scripts, and nothing else so far. */
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
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex">
    <meta name="theme-color" content="${THEME_COLOR_LIGHT}" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="${THEME_COLOR_DARK}" media="(prefers-color-scheme: dark)">
    <meta name="apple-mobile-web-app-title" content="Partfinder">
    <link rel="manifest" href="/parts/manifest.webmanifest">
    <link rel="apple-touch-icon" href="/parts/icon-192.png">
    <title>Partfinder</title>
    <style${styleNonce}>${style}</style>
  </head>
  <body>
    ${main}
    ${renderFooter()}${tail}
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
  // The words the message carried that are not doing another job. They belong to the message
  // rather than to any one number, so every card on it gets the same list: with two numbers and
  // one word like "CVVT", the word is about both of them or about neither.
  const words = descriptiveWords(q);
  const results = tokens.slice(0, MAX_CARDS).map((token) => {
    const parsed = parse(token, hints);
    return words.length > 0 ? { ...parsed, words } : parsed;
  });
  // Only when the message names no number at all. describedPart enforces that itself: with
  // numbers present the machine word stays a hint and nothing new is built.
  const described = describedPart(q);
  if (described !== null) results.push(describedResult(described));
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

  // What the buyer types and what Partfinder read out of it, on the left; who can be asked and
  // how, on the right. On a phone that is one column in that order, which is the order of the
  // job. The right column only exists once there is a search, so the empty page stays one column
  // at every width.
  const left = [
    ...(input.notice ? [`<p class="note">${escapeHtml(input.notice)}</p>`] : []),
    form.join("\n          "),
  ].join("\n          ");
  const right = after.filter((part) => part !== "").join("\n          ");
  const columns = right === "" ? "cols" : "cols two";
  const rightColumn =
    right === ""
      ? ""
      : `\n        <div class="col right">
          ${right}
        </div>`;

  return renderDocument(`<main class="wrap">
      <h1>Partfinder</h1>
      <p class="lede">Paste a customer's message. Get the parts, nearby suppliers, and ready
      WhatsApp messages.</p>
      <div class="${columns}">
        <div class="col left">
          ${left}
        </div>${rightColumn}
      </div>
      ${HOW_IT_WORKS}
    </main>`, {
    ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
    ...(input.tail === undefined ? {} : { tail: input.tail }),
  });
}
