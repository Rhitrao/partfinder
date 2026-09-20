// Shared fixtures for the supplier tests. Not a suite: vitest collects test/**/*.test.ts only,
// and importing one test file from another would run its cases twice.

import { vi } from "vitest";
import worker from "../src/index";

export const env = {
  GOOGLE_PLACES_KEY: "places-key-must-never-be-rendered",
  GOOGLE_MAPS_BROWSER_KEY: "browser-key-meant-to-be-rendered",
  TURNSTILE_SITE_KEY: "turnstile-site-key-meant-to-be-rendered",
  TURNSTILE_SECRET_KEY: "turnstile-secret-must-never-be-rendered",
};

/** The two numbers the step prompt names: one Caterpillar, one JCB. */
export const Q = "1u3352 40/300893";
export const SEARCH = `?q=${encodeURIComponent(Q)}&city=Bengaluru&country=IN`;

export const get = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://rohitrao.in${path}`, init), env);

export function unescapeHtml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

export const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map((m) => unescapeHtml(m[1]!));

/** The message behind a wa.me link whose visible label is exactly this. */
export function whatsappMessage(html: string, label: string): string | undefined {
  const href = html.match(new RegExp(`href="(https://wa\\.me/[^"]*)"[^>]*>${label}<`))?.[1];
  if (href === undefined) return undefined;
  const url = unescapeHtml(href);
  return decodeURIComponent(url.slice(url.indexOf("?text=") + "?text=".length));
}

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** Google is sent JSON; Cloudflare's siteverify is sent a form. Both read back as one record. */
function readBody(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(body));
  }
}

/** Records every fetch and answers it with `reply`. Nothing leaves the process. */
export function stubFetch(reply: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const call: Call = {
        url: String(input),
        method: init.method ?? "GET",
        headers: { ...((init.headers ?? {}) as Record<string, string>) },
        body: init.body === undefined ? null : readBody(String(init.body)),
      };
      calls.push(call);
      return reply(call);
    }),
  );
  return calls;
}

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const isVerifyCall = (call: Call): boolean => call.url === SITEVERIFY_URL;

/** Every call that went to Google, which is every call that costs anything. */
export const placesCalls = (calls: readonly Call[]): Call[] =>
  calls.filter((c) => c.url.startsWith("https://places.googleapis.com/"));

/** Cloudflare says yes (or no), and Google answers as it does for the two sample numbers. */
export function apiReply(verified = true): (call: Call) => Response {
  return (call) =>
    isVerifyCall(call)
      ? new Response(JSON.stringify({ success: verified }), { status: 200 })
      : searchReply(call);
}

/** A POST to the endpoint, shaped as the page's script shapes it. */
export function postSuppliers(
  body: Record<string, unknown>,
  init: { origin?: string | null; method?: string; contentType?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const contentType = init.contentType === undefined ? "application/json" : init.contentType;
  if (contentType !== null) headers["Content-Type"] = contentType;
  const origin = init.origin === undefined ? "https://rohitrao.in" : init.origin;
  if (origin !== null) headers.Origin = origin;
  const method = init.method ?? "POST";
  return worker.fetch(
    new Request("https://rohitrao.in/parts/api/suppliers", {
      method,
      headers,
      ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
}

export const place = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: { text: name, languageCode: "en" },
  formattedAddress: `${name}, Indiranagar, Bengaluru 560038, India`,
  shortFormattedAddress: `${name}, Indiranagar`,
  location: { latitude: 12.978, longitude: 77.64 },
  googleMapsUri: `https://maps.google.com/?cid=${id}`,
  internationalPhoneNumber: "+91 98765 43210",
  nationalPhoneNumber: "098765 43210",
  websiteUri: `https://${id}.example`,
  rating: 4.3,
  userRatingCount: 120,
  currentOpeningHours: { openNow: true },
  ...extra,
});

/** Bengaluru's centre, for the origin call. */
export const CITY_CENTRE = { latitude: 12.9716, longitude: 77.5946 };

/** True for the one call that places the city rather than searching for shops. */
export function isOriginCall(call: Call): boolean {
  return call.headers["X-Goog-FieldMask"] === "places.location";
}

/**
 * The origin call answers with the city centre. Caterpillar and JCB both return "Shared Spares";
 * Caterpillar also returns one of its own, and the multi-brand search returns a third.
 */
export function searchReply(call: Call): Response {
  if (isOriginCall(call)) {
    return new Response(JSON.stringify({ places: [{ location: CITY_CENTRE }] }), { status: 200 });
  }
  const query = String((call.body as { textQuery?: unknown } | null)?.textQuery ?? "");
  const places = query.startsWith("Caterpillar")
    ? [place("shared", "Shared Spares"), place("cat-only", "Cat Corner")]
    : query.startsWith("JCB")
      ? [place("shared", "Shared Spares")]
      : [place("multi", "Multi Brand Traders")];
  return new Response(JSON.stringify({ places }), { status: 200 });
}

/** Every call that searched for shops, in order, leaving out the one that placed the city. */
export const shopSearches = (calls: readonly Call[]): Call[] =>
  placesCalls(calls).filter((c) => !isOriginCall(c));
