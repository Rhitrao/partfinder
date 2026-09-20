// Routing for /parts/vendors.
//
// Every path here is behind the passcode gate except the gate itself. Nothing on these paths is
// logged: not the passcode, not q, not the city, not a place id, not a phone number.

import type { Env } from "../env";
import { VENDOR_PAGE_HEADERS, VENDOR_REDIRECT_HEADERS } from "../headers";
import { MAX_QUERY_LENGTH, resolveCountry } from "../page";
import { checkPasscode, clearCookie, isSignedIn, setCookie } from "./auth";
import { CITY_REQUIRED, WRONG_PASSCODE, renderGate, renderVendorSearch } from "./page";

export const VENDORS_PATH = "/parts/vendors/";
const LOGIN_PATH = "/parts/vendors/login";
const LOGOUT_PATH = "/parts/vendors/logout";
export const CONTACT_PATH = "/parts/vendors/contact";

/** The only paths a successful login may send a browser to. */
const RETURNABLE_PATHS: readonly string[] = [VENDORS_PATH, CONTACT_PATH];

/** Bounds the work one request can ask for; a browser never sends more than a handful. */
const MAX_PARAMS = 40;

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

/** The vendor search page. Text Search is wired up in the next commit. */
function handleSearch(url: URL): Response {
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
  const missingCity = city.trim() === "";
  return html(
    renderVendorSearch({ q, city, country, ...(missingCity ? { notice: CITY_REQUIRED } : {}) }),
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
  return handleSearch(url);
}
