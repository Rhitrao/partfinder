// Routing for /parts/vendors.
//
// Every path here is behind the passcode gate except the gate itself. Nothing on these paths is
// logged: not the passcode, not q, not the city, not a place id, not a phone number.

import type { Env } from "../env";
import { VENDOR_PAGE_HEADERS, VENDOR_REDIRECT_HEADERS } from "../headers";
import { MAX_QUERY_LENGTH, resolveCountry } from "../page";
import { checkPasscode, clearCookie, isSignedIn, setCookie } from "./auth";
import { fetchPicked, picksFrom, renderContact, tooManyPicked } from "./contact";
import {
  CITY_REQUIRED,
  NOTHING_TO_SEARCH,
  NO_VENDOR_PICKED,
  QUOTA_REACHED,
  UNAVAILABLE,
  WRONG_PASSCODE,
  renderFallback,
  renderGate,
  renderVendorList,
  renderVendorSearch,
} from "./page";
import { MAX_LISTED, MAX_PICKS, findVendors, groupByOem, partsFor } from "./search";

export const VENDORS_PATH = "/parts/vendors/";
const LOGIN_PATH = "/parts/vendors/login";
const LOGOUT_PATH = "/parts/vendors/logout";
export const CONTACT_PATH = "/parts/vendors/contact";

/** The only paths a successful login may send a browser to. */
const RETURNABLE_PATHS: readonly string[] = [VENDORS_PATH, CONTACT_PATH];

/**
 * Bounds the work one request can ask for. A full vendor list submits one scope field per shop
 * whether or not it was ticked, so a twenty-shop page can reach forty-three parameters; this sits
 * above that and well below anything a browser would send by accident.
 */
const MAX_PARAMS = 64;

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...VENDOR_PAGE_HEADERS, ...extra } });
}

function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 303,
    headers: { ...VENDOR_REDIRECT_HEADERS, Location: location, ...extra },
  });
}

function notAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
      Allow: allow,
    },
  });
}

/**
 * The query string rebuilt from the parameters these pages actually use, each within the length
 * cap. Anything else a URL is carrying is dropped rather than copied forward, so nothing unknown
 * ever reaches a Location header or a form.
 */
export function vendorQuery(params: URLSearchParams): string {
  const out = new URLSearchParams();
  let seen = 0;
  for (const [key, value] of params) {
    if (seen++ >= MAX_PARAMS) break;
    if (value.length > MAX_QUERY_LENGTH) continue;
    const known =
      key === "q" || key === "city" || key === "country" || key === "v" || key.startsWith("scope_");
    if (known) out.append(key, value);
  }
  return out.toString();
}

/**
 * Where to send a browser after it signs in. The value comes from a form field, so it is read as
 * a relative URL against this origin and then rebuilt from a fixed list of paths and parameters.
 * Anything else, including an absolute URL to another site, becomes the vendor search page.
 */
export function safeNext(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw, "https://rohitrao.in");
  } catch {
    return VENDORS_PATH;
  }
  const path = RETURNABLE_PATHS.includes(parsed.pathname) ? parsed.pathname : VENDORS_PATH;
  const search = vendorQuery(parsed.searchParams);
  return search === "" ? path : `${path}?${search}`;
}

/** The path and query the browser asked for, safe to put in a hidden field and redirect back to. */
function nextFor(url: URL): string {
  return safeNext(url.pathname + url.search);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return html(renderGate(VENDORS_PATH, WRONG_PASSCODE), 401);
  }
  const passcode = String(form.get("passcode") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  const token = await checkPasscode(passcode, env);
  // No detail: a wrong passcode and a Worker with no passcode set look exactly the same.
  if (token === null) return html(renderGate(next, WRONG_PASSCODE), 401);
  return redirect(next, { "Set-Cookie": setCookie(token) });
}

/**
 * The vendor search page: the form, then at most four Text Search calls and the merged list.
 *
 * Nothing is fetched until there is a city and at least one recognised part number, so an empty
 * or half-filled form costs no Google call at all.
 */
async function handleSearch(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams.get("q") ?? "";
  const city = url.searchParams.get("city") ?? "";
  const country = resolveCountry(url.searchParams.get("country"));
  if (q.length > MAX_QUERY_LENGTH || city.length > MAX_QUERY_LENGTH) {
    return html(
      renderVendorSearch({
        q: "",
        city: "",
        country,
        notice: `That is longer than ${MAX_QUERY_LENGTH} characters. Paste a shorter list.`,
      }),
      400,
    );
  }
  if (city.trim() === "") {
    return html(renderVendorSearch({ q, city, country, notice: CITY_REQUIRED }));
  }
  const { groups, notSearched } = groupByOem(partsFor(q));
  if (groups.length === 0) {
    return html(renderVendorSearch({ q, city, country, notice: NOTHING_TO_SEARCH }));
  }

  const { vendors, failure } = await findVendors(env.GOOGLE_PLACES_KEY, groups, country, city);
  if (failure !== null) {
    return html(
      renderVendorSearch({
        q,
        city,
        country,
        notice: failure === "quota" ? QUOTA_REACHED : UNAVAILABLE,
        body: renderFallback(groups, country, city),
      }),
    );
  }
  const listed = vendors.slice(0, MAX_LISTED);
  return html(
    renderVendorSearch({
      q,
      city,
      country,
      body: renderVendorList({
        vendors: listed,
        groups,
        notSearched,
        omitted: vendors.length - listed.length,
        q,
        city,
        country,
      }),
    }),
  );
}

/**
 * The contact page: Place Details for the vendors the user ticked, and a message for each.
 *
 * At most MAX_PICKS vendors, so a hand-written URL with fifty place ids costs five calls, not
 * fifty, and says so on the page rather than quietly dropping the rest.
 */
async function handleContact(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams.get("q") ?? "";
  const city = url.searchParams.get("city") ?? "";
  const country = resolveCountry(url.searchParams.get("country"));
  if (q.length > MAX_QUERY_LENGTH || city.length > MAX_QUERY_LENGTH) {
    return html(
      renderContact({
        vendors: [],
        parts: [],
        q: "",
        city: "",
        country,
        notice: `That is longer than ${MAX_QUERY_LENGTH} characters. Paste a shorter list.`,
      }),
      400,
    );
  }
  const picks = picksFrom(url.searchParams);
  const parts = partsFor(q);
  const tooMany = picks.length > MAX_PICKS ? tooManyPicked(picks.length) : "";
  // With no recognised number there is no requirement to write, so there is nothing to ask for.
  if (parts.length === 0) {
    return html(
      renderContact({ vendors: [], parts, q, city, country, notice: NOTHING_TO_SEARCH }),
    );
  }
  if (picks.length === 0) {
    return html(
      renderContact({ vendors: [], parts, q, city, country, notice: NO_VENDOR_PICKED }),
    );
  }

  const { vendors, failure } = await fetchPicked(env.GOOGLE_PLACES_KEY, picks);
  if (failure !== null) {
    const { groups } = groupByOem(parts);
    return html(
      renderContact({
        vendors: [],
        parts,
        q,
        city,
        country,
        notice: failure === "quota" ? QUOTA_REACHED : UNAVAILABLE,
        body: renderFallback(groups, country, city),
      }),
    );
  }
  return html(
    renderContact({ vendors, parts, q, city, country, ...(tooMany ? { notice: tooMany } : {}) }),
  );
}

/**
 * Routes every /parts/vendors path, or returns null when the path is not one of ours.
 *
 * POST is allowed on the login path and nowhere else. GET on the login path is a browser
 * reloading a form post, so it goes to the search page rather than to an error.
 */
export async function handleVendors(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/parts/vendors" && !path.startsWith(VENDORS_PATH)) return null;

  if (path === LOGIN_PATH) {
    if (request.method === "POST") return handleLogin(request, env);
    if (request.method === "GET") return redirect(VENDORS_PATH);
    return notAllowed("POST");
  }
  if (request.method !== "GET") return notAllowed("GET");

  if (path === "/parts/vendors") {
    const search = vendorQuery(url.searchParams);
    return redirect(search === "" ? VENDORS_PATH : `${VENDORS_PATH}?${search}`);
  }
  if (path === LOGOUT_PATH) return redirect(VENDORS_PATH, { "Set-Cookie": clearCookie() });
  if (path !== VENDORS_PATH && path !== CONTACT_PATH) return null;

  if (!(await isSignedIn(request, env))) return html(renderGate(nextFor(url)));
  return path === CONTACT_PATH ? handleContact(url, env) : handleSearch(url, env);
}
