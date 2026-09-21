// GET /parts/api/health: what is set on this Worker, and whether the Suppliers section would
// render. Nothing else.
//
// It exists because step 7 went live configured wrong and said nothing. The page rendered, the
// link-outs rendered, and the one condition that had failed - a Turnstile site key the Worker
// could not read - was invisible from the outside and invisible in the dashboard, which shows
// that a secret exists but never what is in it. Observability is off on purpose (see
// docs/DEPLOY.md), so there were no logs to read either. This endpoint is the answer: one GET
// that says which bindings arrived, how long each value is, and what the render path decided.
//
// Two rules hold. No key, and no part of a key, ever reaches the response: only whether the
// binding arrived and how many characters it holds. And nothing here calls Google or Cloudflare,
// so a health check costs nothing and cannot be used to spend the day's Places allowance.

import type { Env } from "./env";
import { outbound } from "./page";
import type { ParseResult } from "./parse";
import { extractHints, extractTokens, parse } from "./parse";
import { groupByOem, type BrandGroup } from "./vendors/search";

/**
 * Why the live Suppliers section - the status line, the placeholders, the Turnstile container
 * and the script - would not render. One code per condition, in the order handlePage checks them.
 */
export type SupplierBlocker = "no_parts" | "no_brand" | "no_city" | "no_site_key";

/**
 * Plain words for each code, for the health endpoint. The page never shows one of these: a
 * visitor is told the supplier search is not set up, and nothing about which key that was.
 */
export const BLOCKER_REASONS: Record<SupplierBlocker, string> = {
  no_parts:
    "The query holds no number Partfinder recognises, so there is nothing to search for.",
  no_brand:
    "No manufacturer was read from those numbers, so there is no brand to search Google for.",
  no_city:
    "No city was given, so there is nowhere to search near.",
  no_site_key:
    "TURNSTILE_SITE_KEY is missing or empty, so the page cannot mint a token and the supplier " +
    "endpoint would refuse every request the page's script made.",
};

/** What the /parts/ render path decides about the Suppliers section, and why. */
export interface SupplierGate {
  /** The numbers that may leave the page: recognised, and not shaped like a phone number. */
  sending: ParseResult[];
  /** Those numbers grouped by manufacturer, which is what a supplier search searches for. */
  groups: BrandGroup[];
  /** Every condition that failed, in check order. Empty means the live section renders. */
  blockers: SupplierBlocker[];
  /** Whether the live section renders. True exactly when `blockers` is empty. */
  render: boolean;
}

export interface GateInput {
  results: readonly ParseResult[];
  city: string;
  /** TURNSTILE_SITE_KEY as the Worker read it, or "" when the binding never arrived. */
  siteKey: string;
}

/**
 * The one decision, in one place.
 *
 * handlePage and /parts/api/health both call this, so the endpoint cannot report a render the
 * page would not do. Everything it needs is passed in: it reads no environment and fetches
 * nothing. The country setting is deliberately not an input - it picks the search region and the
 * order sources are tried in, and never decides whether the section appears.
 */
export function supplierGate(input: GateInput): SupplierGate {
  const sending = outbound(input.results);
  const { groups } = groupByOem(sending);
  const blockers: SupplierBlocker[] = [];
  if (sending.length === 0) blockers.push("no_parts");
  else if (groups.length === 0) blockers.push("no_brand");
  if (input.city.trim() === "") blockers.push("no_city");
  if (input.siteKey === "") blockers.push("no_site_key");
  return { sending, groups, blockers, render: blockers.length === 0 };
}

/**
 * The query the endpoint answers about: one Caterpillar number, one city, one country.
 *
 * Fixed on purpose. A health check that took a query would be a second way into the parser and a
 * second thing to cap; this one asks the same question every time, so two answers a week apart
 * are comparable. `country` is recorded because the sample is a whole query, not because the
 * country changes the answer - see supplierGate.
 */
export const HEALTH_SAMPLE = { q: "1u3352", city: "Bengaluru", country: "IN" } as const;

/**
 * What a Worker secret looks like from outside: whether the binding arrived, and how long its
 * value is. Never the value, and never a prefix of it.
 *
 * The two fields answer different questions. `present` is false when the binding is not there at
 * all - never set, set on another Worker, or set as a build variable rather than a secret.
 * `present: true` with `length: 0` is the other failure the dashboard hides: a secret that exists
 * and holds nothing.
 */
function keyState(value: string | undefined): { present: boolean; length: number } {
  return { present: value !== undefined, length: (value ?? "").length };
}

const HEALTH_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Robots-Tag": "noindex",
  "Cache-Control": "no-store",
};

/**
 * GET only. A POST here is not a request this endpoint has a safer reading of, so it is refused
 * with the method it does take rather than answered anyway.
 */
export function handleHealth(request: Request, env: Env): Response {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...HEALTH_HEADERS, Allow: "GET" },
    });
  }
  const hints = [...extractHints(HEALTH_SAMPLE.q)];
  const results = extractTokens(HEALTH_SAMPLE.q).map((token) => parse(token, hints));
  const gate = supplierGate({
    results,
    city: HEALTH_SAMPLE.city,
    siteKey: env.TURNSTILE_SITE_KEY ?? "",
  });
  // ok says the Worker is running and this route reached it. It is not a verdict on the
  // configuration: that is what the two blocks below are for.
  const body = {
    ok: true,
    env: {
      placesKey: keyState(env.GOOGLE_PLACES_KEY),
      mapsBrowserKey: keyState(env.GOOGLE_MAPS_BROWSER_KEY),
      turnstileSiteKey: keyState(env.TURNSTILE_SITE_KEY),
      turnstileSecret: keyState(env.TURNSTILE_SECRET_KEY),
    },
    render: {
      suppliersSectionWouldRender: gate.render,
      reasons: gate.blockers.map((blocker) => BLOCKER_REASONS[blocker]),
    },
  };
  return new Response(JSON.stringify(body), { headers: HEALTH_HEADERS });
}
