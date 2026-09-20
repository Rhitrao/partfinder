// The two cookies Partfinder sets, and nothing else.
//
// Both hold only what the user typed or picked, so a returning phone does not have to type it
// again. Neither is a secret, neither is joined to anything, and neither is read by any script:
// they are HttpOnly, and the page carries the same values in its own fields already.
//
// There is no session cookie any more. The supplier list is public, and the browser proves it is
// a browser with a Turnstile token per search rather than with anything stored here.

/**
 * Path=/parts/ keeps these off the rest of rohitrao.in. SameSite=Lax still sends them when the
 * user follows a link from another page of the site, which is how they arrive.
 */
const COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Lax; Path=/parts/";

/** 30 days. */
export const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export const CITY_COOKIE = "pf_city";
export const COUNTRY_COOKIE = "pf_country";

/** Cities and country codes are short. A longer value is somebody's idea, not either of those. */
const MAX_REMEMBERED = 80;

/** One cookie's value from a Cookie header, or null. */
export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function readRemembered(request: Request, name: string): string {
  const value = readCookie(request.headers.get("Cookie"), name);
  if (value === null) return "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "";
  }
  return decoded.length > MAX_REMEMBERED ? "" : decoded.trim();
}

function setRemembered(name: string, value: string): string {
  return (
    `${name}=${encodeURIComponent(value.trim().slice(0, MAX_REMEMBERED))}; ` +
    `${COOKIE_ATTRIBUTES}; Max-Age=${COOKIE_MAX_AGE}`
  );
}

export const readCity = (request: Request): string => readRemembered(request, CITY_COOKIE);
export const setCity = (city: string): string => setRemembered(CITY_COOKIE, city);

export const readCountry = (request: Request): string => readRemembered(request, COUNTRY_COOKIE);
export const setCountry = (code: string): string => setRemembered(COUNTRY_COOKIE, code);
