// Worker entry and routing under /parts. Every response carries X-Robots-Tag: noindex.
// q, hint, city, to and note are never logged.
//
// The page is served at /parts/, with a trailing slash, and /parts redirects to it. That is a
// routing constraint, not a preference: a Cloudflare route pattern with no trailing "*" matches
// the bare path only, and a pattern may not contain query parameters, so the page has to sit
// under "rohitrao.in/parts/*" for /parts/?q=... to reach the Worker at all. See wrangler.toml.

import { ICON_192_BASE64, ICON_512_BASE64 } from "./icons";
import { MANIFEST_JSON } from "./manifest";
import { extractHints, extractTokens, parse } from "./parse";
import { renderPage, resolveCountry } from "./page";

/** Keeps a single request well inside the 10 ms CPU budget. */
const MAX_QUERY_LENGTH = 5000;

const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; manifest-src 'self'; " +
    "form-action 'self'; base-uri 'none'",
  "Referrer-Policy": "no-referrer",
};

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

function handlePage(url: URL): Response {
  const q = url.searchParams.get("q") ?? "";
  const hint = url.searchParams.get("hint") ?? "";
  const city = url.searchParams.get("city") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const note = url.searchParams.get("note") ?? "";
  const country = resolveCountry(url.searchParams.get("country"));
  // Every text field is capped, not just q: each one is rendered, and the budget is the request's.
  const fields = [q, hint, city, to, note];
  const tooLong = fields.some((value) => value.length > MAX_QUERY_LENGTH);
  const html = renderPage({
    q: tooLong ? "" : q,
    hint: tooLong ? "" : hint,
    city: tooLong ? "" : city,
    to: tooLong ? "" : to,
    note: tooLong ? "" : note,
    country,
    ...(tooLong
      ? { notice: `That is longer than ${MAX_QUERY_LENGTH} characters. Paste a shorter list.` }
      : {}),
  });
  return new Response(html, { status: tooLong ? 400 : 200, headers: PAGE_HEADERS });
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

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const asset = ASSETS[url.pathname];
    if (asset !== undefined) {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return new Response(asset.body(), {
        headers: { "Content-Type": asset.type, ...ASSET_HEADERS },
      });
    }
    if (url.pathname === "/parts/api/parse") {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return handleParse(url);
    }
    if (url.pathname === "/parts/") {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return handlePage(url);
    }
    if (url.pathname === "/parts") {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return redirectToPage(url);
    }
    return respond(404, { error: "not found" });
  },
} satisfies ExportedHandler;
