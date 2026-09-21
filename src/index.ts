// Worker entry and routing under /parts. Every response carries X-Robots-Tag: noindex.
// q, hint, city, to and note are never logged.
//
// The page is served at /parts/, with a trailing slash, and /parts redirects to it. That is a
// routing constraint, not a preference: a Cloudflare route pattern with no trailing "*" matches
// the bare path only, and a pattern may not contain query parameters, so the page has to sit
// under "rohitrao.in/parts/*" for /parts/?q=... to reach the Worker at all. See wrangler.toml.

import { readCity, readCountry, setCity, setCountry } from "./cookies";
import type { Env } from "./env";
import { handleHealth, supplierGate } from "./health";
import { PAGE_HEADERS, newNonce, supplierPageHeaders } from "./headers";
import { ICON_192_BASE64, ICON_512_BASE64 } from "./icons";
import { renderPrivacy, renderTerms } from "./legal";
import { MANIFEST_JSON } from "./manifest";
import { extractHints, extractTokens, parse } from "./parse";
import { MAX_QUERY_LENGTH, partKey, readQuery, renderPage, resolveCountry } from "./page";
import { handleVendors } from "./vendors/index";
import { handleSupplierApi } from "./vendors/api";
import { renderScripts } from "./vendors/script";
import { linkOutsFor, resolveScope } from "./vendors/search";
import { NOT_CONFIGURED, renderLinkOuts, renderPending } from "./vendors/suppliers";

function respond(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Robots-Tag": "noindex",
      ...extra,
    },
  });
}

/**
 * The page.
 *
 * It calls nothing. Since step 7 the Suppliers section is filled by the page's own script from
 * POST /parts/api/suppliers, so rendering this page never reaches Google and never reaches
 * Cloudflare's siteverify: a crawler, a bot or a WhatsApp link preview costs nothing.
 */
function handlePage(request: Request, url: URL, env: Env): Response {
  const q = url.searchParams.get("q") ?? "";
  const hint = url.searchParams.get("hint") ?? "";
  const typedCity = url.searchParams.get("city");
  const to = url.searchParams.get("to") ?? "";
  const note = url.searchParams.get("note") ?? "";
  const typedCountry = url.searchParams.get("country");
  // What the user chose wins; otherwise what this browser last chose, so a phone that has been
  // here before does not have to type or pick either again.
  const country = resolveCountry(typedCountry ?? readCountry(request));
  const city = typedCity ?? readCity(request);
  // Every text field is capped, not just q: each one is rendered, and the budget is the request's.
  const fields = [q, hint, city, to, note];
  const tooLong = fields.some((value) => value.length > MAX_QUERY_LENGTH);
  if (tooLong) {
    const html = renderPage({
      q: "",
      hint: "",
      city: "",
      to: "",
      note: "",
      country,
      notice: `That is longer than ${MAX_QUERY_LENGTH} characters. Paste a shorter list.`,
    });
    return new Response(html, { status: 400, headers: PAGE_HEADERS });
  }

  const parsed = readQuery(q, hint);
  // One decision, made in src/health.ts, so that GET /parts/api/health can report exactly what
  // this page would do rather than its own guess at it.
  const gate = supplierGate({ results: parsed.results, siteKey: env.TURNSTILE_SITE_KEY ?? "" });
  // Near the city the buyer typed, or the whole country when they typed none. Derived here and
  // sent to nobody: no cookie, no record, nothing but this render and the request the page makes.
  const scope = resolveScope(city, url.searchParams.get("scope") ?? "");
  const { sending, groups, cards } = gate;
  // Quantities the user typed on a card, one field per part key, capped like everything else.
  const typedQuantities: Record<string, number> = {};
  for (const [name, value] of url.searchParams) {
    if (!name.startsWith("qty_") || name.length > 64) continue;
    const amount = Number(value);
    if (Number.isInteger(amount) && amount >= 1 && amount <= 9999) {
      typedQuantities[name.slice("qty_".length)] = amount;
    }
  }
  // Only what the user actually typed or picked: a page view that merely read a cookie need not
  // rewrite it. Two Set-Cookie headers need an array, which Headers.append builds below.
  const cookies: string[] = [];
  if (typedCity !== null && typedCity.trim() !== "") cookies.push(setCity(typedCity));
  if (typedCountry !== null && typedCountry.trim() !== "") cookies.push(setCountry(country.code));

  let suppliers: string | undefined;
  let nonce: string | undefined;
  let tail: string | undefined;
  // "Other ways to send" is the only way out when there is no Suppliers section, so it opens
  // then, and stays collapsed when the section is there to be used instead.
  let sendOpen = true;
  // A card a supplier search can act on, and a site key - without one no token can be minted and
  // the endpoint would refuse every request the script made. supplierGate decides both, and the
  // endpoint's search plan reads the same definition of a searchable card, so the section cannot
  // promise a list nobody will look for or refuse one somebody would have.
  if (cards.length > 0) {
    const blocks = linkOutsFor(sending, groups);
    if (gate.render) {
      nonce = newNonce();
      suppliers = renderPending({
        blocks,
        country,
        city,
        scope,
        query: pageQuery(q, hint, city, country.code, scope),
        siteKey: env.TURNSTILE_SITE_KEY ?? "",
        map: (env.GOOGLE_MAPS_BROWSER_KEY ?? "") !== "",
      });
      // The script is told the part keys and nothing else. Everything about a shop arrives
      // from the endpoint, already escaped and with its messages already written.
      tail = renderScripts(
        { parts: sending.map(partKey), scope },
        env.GOOGLE_MAPS_BROWSER_KEY,
        nonce,
      );
      sendOpen = false;
    } else {
      // Never silently. Nothing but the configuration can stop the search now - a missing city
      // means All India rather than nothing - so the page says that much rather than showing the
      // link-outs bare, which is what a working page with nothing nearby would look like.
      suppliers = renderLinkOuts(blocks, country, city, NOT_CONFIGURED);
    }
  }

  const html = renderPage({
    q,
    hint,
    city,
    to,
    note,
    country,
    parsed,
    typedQuantities,
    sendOpen,
    ...(suppliers === undefined ? {} : { suppliers }),
    ...(nonce === undefined ? {} : { nonce }),
    ...(tail === undefined ? {} : { tail }),
  });
  // Only a page with a Suppliers section runs a script, and only it relaxes the CSP for one.
  const headers = new Headers(nonce === undefined ? PAGE_HEADERS : supplierPageHeaders(nonce));
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(html, { status: 200, headers });
}

/** The parameters a scope chip has to carry to land on the same page it was rendered beside. */
function pageQuery(
  q: string,
  hint: string,
  city: string,
  country: string,
  scope: string,
): Record<string, string> {
  const query: Record<string, string> = { q };
  if (hint !== "") query.hint = hint;
  if (city.trim() !== "") query.city = city.trim();
  query.country = country;
  if (scope === "india") query.scope = "india";
  return query;
}

function handleParse(url: URL): Response {
  const q = url.searchParams.get("q");
  if (q === null) return respond(400, { error: "missing q" });
  if (q.length > MAX_QUERY_LENGTH) {
    return respond(400, { error: `q longer than ${MAX_QUERY_LENGTH} characters` });
  }
  const hints = extractHints(q);
  const results = extractTokens(q).map((token) => parse(token, hints));
  return respond(200, { hints, results });
}

/**
 * The manifest and the icons are the only static bytes this Worker serves, and they change only
 * when scripts/icons.ts is run, so a day of caching costs nothing. noindex still applies: an
 * icon is not a page, but nothing under /parts is indexable yet.
 */
const ASSET_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex",
  "Cache-Control": "public, max-age=86400",
};

/** Workers have no filesystem, so the icons ride in the bundle as base64. See scripts/icons.ts. */
function iconBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const ASSETS: Record<string, { type: string; body: () => BodyInit }> = {
  "/parts/manifest.webmanifest": {
    type: "application/manifest+json",
    body: () => MANIFEST_JSON,
  },
  "/parts/icon-192.png": { type: "image/png", body: () => iconBytes(ICON_192_BASE64) },
  "/parts/icon-512.png": { type: "image/png", body: () => iconBytes(ICON_512_BASE64) },
};

/**
 * 301 from /parts to /parts/, keeping the query string, so an old or hand-typed link still
 * reaches the page. The query string is copied from the parsed URL, which cannot hold a CR or
 * LF; control characters are dropped anyway, because this value goes into a response header.
 */
function redirectToPage(url: URL): Response {
  const search = url.search.replace(/[\u0000-\u001f\u007f]/g, "");
  return new Response(null, {
    status: 301,
    headers: { Location: `/parts/${search}`, "X-Robots-Tag": "noindex" },
  });
}

const LEGAL_PAGES: Record<string, () => string> = {
  "/parts/terms": renderTerms,
  "/parts/privacy": renderPrivacy,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // /parts/vendors is gone: every path under it redirects to the page that replaced it.
    const vendors = handleVendors(url);
    if (vendors !== null) return vendors;

    const asset = ASSETS[url.pathname];
    if (asset !== undefined) {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return new Response(asset.body(), {
        headers: { "Content-Type": asset.type, ...ASSET_HEADERS },
      });
    }
    // Public, static and required by Google's Places API policies. Still noindex: nothing under
    // /parts is indexable until a step prompt lifts it.
    const legal = LEGAL_PAGES[url.pathname];
    if (legal !== undefined) {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return new Response(legal(), { headers: PAGE_HEADERS });
    }
    // The only path that reaches Google, and only with a Turnstile token. It sets its own
    // method rules, because a wrong method here has to say 405 with the right Allow.
    if (url.pathname === "/parts/api/suppliers") {
      return handleSupplierApi(request, env);
    }
    // What is set on this Worker and what the render path would do with it. It calls nothing.
    if (url.pathname === "/parts/api/health") {
      return handleHealth(request, env);
    }
    if (url.pathname === "/parts/api/parse") {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return handleParse(url);
    }
    if (url.pathname === "/parts/") {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return handlePage(request, url, env);
    }
    if (url.pathname === "/parts") {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return redirectToPage(url);
    }
    return respond(404, { error: "not found" });
  },
} satisfies ExportedHandler<Env>;
