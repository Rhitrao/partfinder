// Routing for /parts/vendors.
//
// Every path here is behind the passcode gate except the gate itself. Nothing on these paths is
// logged: not the passcode, not q, not the city, not a place id, not a phone number.

import type { Env } from "../env";
import { VENDOR_PAGE_HEADERS, VENDOR_REDIRECT_HEADERS } from "../headers";
import { MAX_QUERY_LENGTH } from "../page";
import { checkPasscode, clearCookie, isSignedIn, setCookie } from "./auth";
import { WRONG_PASSCODE, renderGate } from "./page";

/** Where the suppliers live since step 6. */
export const PAGE_PATH = "/parts/";

export const VENDORS_PATH = "/parts/vendors/";
const LOGIN_PATH = "/parts/vendors/login";
const LOGOUT_PATH = "/parts/vendors/logout";
export const CONTACT_PATH = "/parts/vendors/contact";

/** The only path a successful login may send a browser to. */
const RETURNABLE_PATHS: readonly string[] = [PAGE_PATH];

/** Bounds the work one request can ask for; a browser never sends more than a handful. */
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

/** 302 for a path that moved: the browser keeps using the URL it was given, and no cache keeps it. */
function found(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...VENDOR_REDIRECT_HEADERS, Location: location },
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

/** The only parameters /parts/ reads, and so the only ones worth carrying to it. */
const CARRIED: readonly string[] = ["q", "city", "country"];

/**
 * The query string rebuilt from those three, each within the length cap. Anything else a URL is
 * carrying is dropped rather than copied forward, so nothing unknown ever reaches a Location
 * header or a form.
 */
export function vendorQuery(params: URLSearchParams): string {
  const out = new URLSearchParams();
  let seen = 0;
  for (const [key, value] of params) {
    if (seen++ >= MAX_PARAMS) break;
    if (value.length > MAX_QUERY_LENGTH) continue;
    if (CARRIED.includes(key)) out.append(key, value);
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
    return PAGE_PATH;
  }
  const path = RETURNABLE_PATHS.includes(parsed.pathname) ? parsed.pathname : PAGE_PATH;
  const search = vendorQuery(parsed.searchParams);
  return search === "" ? path : `${path}?${search}`;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return html(renderGate(PAGE_PATH, WRONG_PASSCODE), 401);
  }
  const passcode = String(form.get("passcode") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  const token = await checkPasscode(passcode, env);
  // No detail: a wrong passcode and a Worker with no passcode set look exactly the same.
  if (token === null) return html(renderGate(next, WRONG_PASSCODE), 401);
  return redirect(next, { "Set-Cookie": setCookie(token) });
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
    // GET is the passcode form itself, reached from the "Sign in to see suppliers here" line. It
    // carries q, city and country so that signing in lands back on the page that offered it.
    if (request.method === "GET") {
      const search = vendorQuery(url.searchParams);
      return html(renderGate(safeNext(search === "" ? "/parts/" : `/parts/?${search}`)));
    }
    return notAllowed("POST");
  }
  if (request.method !== "GET") return notAllowed("GET");

  if (path === "/parts/vendors") {
    const search = vendorQuery(url.searchParams);
    return found(search === "" ? PAGE_PATH : `${PAGE_PATH}?${search}`);
  }
  if (path === LOGOUT_PATH) return redirect(PAGE_PATH, { "Set-Cookie": clearCookie() });
  // The suppliers are on /parts/ itself now. The two old pages keep working as links, by
  // sending the browser to the page that replaced them with the same query.
  if (path === VENDORS_PATH || path === CONTACT_PATH) {
    const search = vendorQuery(url.searchParams);
    return found(search === "" ? PAGE_PATH : `${PAGE_PATH}?${search}`);
  }
  return null;
}
