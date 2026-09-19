// Worker entry and routing under /parts. Every response carries X-Robots-Tag: noindex.
// q and hint are never logged.

import { extractHints, extractTokens, parse } from "./parse";
import { renderPage, resolveCountry } from "./page";

/** Keeps a single request well inside the 10 ms CPU budget. */
const MAX_QUERY_LENGTH = 5000;

const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
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
  const country = resolveCountry(url.searchParams.get("country"));
  const tooLong = q.length > MAX_QUERY_LENGTH || hint.length > MAX_QUERY_LENGTH;
  const html = renderPage({
    q: tooLong ? "" : q,
    hint: tooLong ? "" : hint,
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

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/parts/api/parse") {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return handleParse(url);
    }
    if (url.pathname === "/parts") {
      if (request.method !== "GET") return respond(405, { error: "method not allowed" }, { Allow: "GET" });
      return handlePage(url);
    }
    return respond(404, { error: "not found" });
  },
} satisfies ExportedHandler;
