// Worker entry and routing under /parts. Every response carries X-Robots-Tag: noindex.
// q, hint, city, to and note are never logged.
//
// The page is served at /parts/, with a trailing slash, and /parts redirects to it. That is a
// routing constraint, not a preference: a Cloudflare route pattern with no trailing "*" matches
// the bare path only, and a pattern may not contain query parameters, so the page has to sit
// under "rohitrao.in/parts/*" for /parts/?q=... to reach the Worker at all. See wrangler.toml.

import type { Env } from "./env";
import { PAGE_HEADERS, mapPageHeaders, newNonce } from "./headers";
import { ICON_192_BASE64, ICON_512_BASE64 } from "./icons";
import { renderPrivacy, renderTerms } from "./legal";
import { MANIFEST_JSON } from "./manifest";
import { extractHints, extractTokens, parse } from "./parse";
import { MAX_QUERY_LENGTH, outbound, readQuery, renderPage, resolveCountry } from "./page";
import { handleVendors } from "./vendors";
import { isSignedIn, readCity, readCountry, setCity, setCountry } from "./vendors/auth";
import { MAX_LISTED, findVendors, groupByOem } from "./vendors/search";
import {
  pinsFor,
  renderMapBox,
  renderMapScripts,
  renderSignIn,
  renderSuppliers,
} from "./vendors/suppliers";

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
 * The page. Since step 6 it also carries the Suppliers section, so it can reach Google and has to
 * know who is asking.
 *
 * Nothing is fetched unless all three hold: the browser has a valid passcode cookie, there is a
 * city, and at least one number passed the outbound rule. A signed-out visitor gets exactly
 * today's page plus one line offering the passcode form.
 */
async function handlePage(request: Request, url: URL, env: Env): Promise<Response> {
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
  const sending = outbound(parsed.results);
  const extra: Record<string, string> = {};
  // Only what the user actually typed or picked: a page view that merely read a cookie need not
  // rewrite it. Two Set-Cookie headers need an array, which Headers.append builds below.
  const cookies: string[] = [];
  if (typedCity !== null && typedCity.trim() !== "") cookies.push(setCity(typedCity));
  if (typedCountry !== null && typedCountry.trim() !== "") cookies.push(setCountry(country.code));

  let suppliers: string | undefined;
  let nonce: string | undefined;
  let tail: string | undefined;
  if (sending.length > 0) {
    if (!(await isSignedIn(request, env))) {
      suppliers = renderSignIn(q, city, country);
    } else if (city.trim() !== "") {
      const { groups } = groupByOem(sending);
      if (groups.length > 0) {
        const { vendors, failure } = await findVendors(
          env.GOOGLE_PLACES_KEY,
          groups,
          country,
          city,
        );
        const listed = vendors.slice(0, MAX_LISTED);
        // The map is drawn only when there is a key to draw it with and a shop to pin. Without
        // either, the section is the list, which is the part that carries the phone numbers.
        const pins = pinsFor(listed);
        const mapsKey = env.GOOGLE_MAPS_BROWSER_KEY;
        const withMap = failure === null && pins.length > 0 && mapsKey !== undefined && mapsKey !== "";
        if (withMap) {
          nonce = newNonce();
          tail = renderMapScripts(pins, mapsKey, nonce);
        }
        suppliers = renderSuppliers({
          vendors: listed,
          groups,
          parts: sending,
          city,
          country,
          failure,
          omitted: vendors.length - listed.length,
          ...(withMap ? { map: renderMapBox() } : {}),
        });
        // Supplier data, and who asked for it, are on this page. No cache may keep a copy.
        extra["Cache-Control"] = "no-store";
      }
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
    ...(suppliers === undefined ? {} : { suppliers }),
    ...(nonce === undefined ? {} : { nonce }),
    ...(tail === undefined ? {} : { tail }),
  });
  // Only a page that actually runs the Maps script relaxes the CSP for it. Every other page,
  // including a signed-in page whose search found nothing to pin, keeps today's headers.
  const base = nonce === undefined ? PAGE_HEADERS : mapPageHeaders(nonce);
  const headers = new Headers({ ...base, ...extra });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(html, { status: 200, headers });
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
    // /parts/vendors is passcode-gated and has its own method rules, so it is routed first.
    const vendors = await handleVendors(request, url, env);
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
