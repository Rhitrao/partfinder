// Worker entry and routing under /parts. Every response carries X-Robots-Tag: noindex.

import { extractHints, extractTokens, parse } from "./parse";

/** Keeps a single request well inside the 10 ms CPU budget. */
const MAX_QUERY_LENGTH = 5000;

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
    return respond(404, { error: "not found" });
  },
} satisfies ExportedHandler;
