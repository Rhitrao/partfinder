// The /parts page: one server-rendered HTML document, no client-side JavaScript.
// Offline only. Everything on the page comes from the parser in parse.ts; nothing is fetched,
// stored or logged. Every piece of user input is HTML-escaped wherever it appears.

import { extractHints, extractTokens, parse, type ParseResult } from "./parse";

export interface Country {
  /** Form value. */
  code: string;
  name: string;
  /** Search domain, without the leading "www.". */
  domain: string;
}

/** Country is a user setting. It only picks the search region; it never hides a result. */
export const COUNTRIES: readonly Country[] = [
  { code: "IN", name: "India", domain: "google.co.in" },
  { code: "AE", name: "UAE", domain: "google.ae" },
  { code: "SA", name: "Saudi Arabia", domain: "google.com.sa" },
  { code: "ZA", name: "South Africa", domain: "google.co.za" },
  { code: "KE", name: "Kenya", domain: "google.co.ke" },
  { code: "NG", name: "Nigeria", domain: "google.com.ng" },
  { code: "OTHER", name: "Other", domain: "google.com" },
];

/** Default India. */
export const DEFAULT_COUNTRY: Country = COUNTRIES[0]!;

/** An unknown or missing code falls back to the default; it is never an error. */
export function resolveCountry(code: string | null): Country {
  const wanted = (code ?? "").trim().toUpperCase();
  return COUNTRIES.find((c) => c.code === wanted) ?? DEFAULT_COUNTRY;
}

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

/** Every spelling quoted and joined with OR, on the country's search domain. */
export function searchUrl(result: ParseResult, country: Country): string {
  const query = spellings(result)
    .map((s) => `"${s}"`)
    .join(" OR ");
  return `https://www.${country.domain}/search?q=${encodeURIComponent(query)}`;
}

/** The manufacturers a number could be, in ranked order, without duplicates. */
function oems(result: ParseResult): string[] {
  return [...new Set(result.candidates.map((c) => c.oem))];
}

function messageBlock(result: ParseResult, index: number, maxSpellings: number): string {
  const lines = [`${index + 1}. ${result.input}`];
  const makers = oems(result);
  lines.push(
    makers.length > 0
      ? `   Likely: ${makers.join(" or ")} (from number format, unconfirmed)`
      : `   ${NOT_DETERMINED}`,
  );
  const others = spellings(result)
    .filter((s) => s !== result.input)
    .slice(0, maxSpellings);
  if (others.length > 0) lines.push(`   Other spellings: ${others.join(", ")}`);
  return lines.join("\n");
}

/**
 * The plain-text message the wa.me link pre-fills. There is no phone number: the user picks the
 * contact. Kept within WHATSAPP_LIMIT by trimming spellings first, then whole numbers off the end.
 *
 * Both the message and the back-link carry only the numbers outbound() passed, never the pasted
 * text. What a user pastes can hold a customer name, a phone number or a price, and none of that
 * may leave in a message to a supplier. Numbers trimmed out of the message for length still
 * appear in the link, because the link is how the reader gets back to the full page.
 */
export function whatsappMessage(results: readonly ParseResult[]): string {
  const tokens = results.map((r) => r.input).join(" ");
  const link = `Details: https://rohitrao.in/parts?q=${encodeURIComponent(tokens)}`;
  const assemble = (count: number, maxSpellings: number): string => {
    const blocks = results.slice(0, count).map((r, i) => messageBlock(r, i, maxSpellings));
    const omitted = results.length - count;
    if (omitted > 0) blocks.push(`(+${omitted} more on the page)`);
    return ["Part numbers:", ...blocks, link].join("\n\n");
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

export function whatsappUrl(results: readonly ParseResult[]): string {
  return `https://wa.me/?text=${encodeURIComponent(whatsappMessage(results))}`;
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
.notes { font-size: .9rem; opacity: .85; margin-top: 2rem; }
.note { font-size: .9rem; opacity: .85; }
@media (min-width: 40rem) { body { margin: 0 auto; padding: 2rem 1rem; } }
`.trim();

function renderForm(q: string, hint: string, country: Country): string {
  const options = COUNTRIES.map(
    (c) =>
      `<option value="${escapeHtml(c.code)}"${c.code === country.code ? " selected" : ""}>` +
      `${escapeHtml(c.name)} (${escapeHtml(c.domain)})</option>`,
  ).join("\n        ");
  return `<form method="GET" action="/parts">
      <label for="q">Paste part numbers or a WhatsApp message</label>
      <textarea id="q" name="q" rows="4" placeholder="Paste part numbers or a WhatsApp message">${escapeHtml(q)}</textarea>
      <label for="hint">Brand or machine (optional)</label>
      <input id="hint" name="hint" type="text" value="${escapeHtml(hint)}" placeholder="Brand or machine (optional)">
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

function renderCard(result: ParseResult, country: Country): string {
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
  return `<section class="card">
        <h2>${escapeHtml(result.input)}</h2>
        ${body}${narrow}${excluded}
        <a class="search" href="${escapeHtml(searchUrl(result, country))}">Search all spellings</a>
      </section>`;
}

function renderResults(results: readonly ParseResult[], country: Country): string {
  const cards =
    results.length > 0
      ? results.map((r) => renderCard(r, country)).join("\n      ")
      : `<section class="card">
        <p class="answer">Not determined: nothing in what you pasted looks like a part number.</p>
      </section>`;
  const sending = outbound(results);
  const action =
    sending.length > 0
      ? `<a class="whatsapp" href="${escapeHtml(whatsappUrl(sending))}">` +
        `Send this to a supplier on WhatsApp</a>`
      : `<p class="nothing">${NOTHING_TO_SEND}</p>`;
  return `${cards}\n      ${action}`;
}

export interface PageInput {
  q: string;
  hint: string;
  country: Country;
  /** Shown above the form, e.g. when the input was too long. Not user text. */
  notice?: string;
}

/** The whole page, as one HTML document. */
export function renderPage(input: PageInput): string {
  const { q, hint, country } = input;
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
  sections.push(renderForm(q, hint, country));
  if (trimmed !== "") {
    if (hints.length > 0) {
      sections.push(`<p class="hints">Hints used: ${escapeHtml(hints.join(", "))}</p>`);
    }
    if (truncated > 0) {
      sections.push(
        `<p class="note">Showing the first ${MAX_CARDS} numbers. ${truncated} more were not read.</p>`,
      );
    }
    sections.push(renderResults(results, country));
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Partfinder</title>
    <style>${STYLE}</style>
  </head>
  <body>
    <main>
      <h1>Partfinder</h1>
      <p class="lede">Paste a part number, a list, or a WhatsApp message. Partfinder says which
      manufacturer's number format it matches, and gives you every spelling to search.</p>
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
    </main>
  </body>
</html>
`;
}
