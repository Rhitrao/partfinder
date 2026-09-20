// What is left of /parts/vendors: four redirects.
//
// The suppliers moved onto /parts/ itself in step 6, and step 7 removed the passcode gate that
// stood in front of them. Nothing lives here any more. The paths stay only so that a link
// somebody saved, or a browser reloading an old form post, still lands on the page that replaced
// them, with the query it was carrying.

import { REDIRECT_HEADERS } from "../headers";
import { MAX_QUERY_LENGTH } from "../page";

/** Where the suppliers live. */
export const PAGE_PATH = "/parts/";

const VENDORS_PATH = "/parts/vendors/";

/** Bounds the work one request can ask for; a browser never sends more than a handful. */
const MAX_PARAMS = 64;

/** The only parameters /parts/ reads, and so the only ones worth carrying to it. */
const CARRIED: readonly string[] = ["q", "city", "country"];

/**
 * The query string rebuilt from those three, each within the length cap. Anything else a URL is
 * carrying is dropped rather than copied forward, so nothing unknown ever reaches a Location
 * header.
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

/** 302 for a path that moved: the browser keeps using the URL it was given, and no cache keeps it. */
function found(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...REDIRECT_HEADERS, Location: location },
  });
}

/**
 * Sends every /parts/vendors path to /parts/, or returns null when the path is not one of ours.
 *
 * Every method redirects, including the POST an old passcode form would send: there is nothing
 * here to post to, and answering 405 would leave a browser stranded on a page that no longer
 * exists.
 */
export function handleVendors(request: Request, url: URL): Response | null {
  const path = url.pathname;
  if (path !== "/parts/vendors" && !path.startsWith(VENDORS_PATH)) return null;
  const search = vendorQuery(url.searchParams);
  return found(search === "" ? PAGE_PATH : `${PAGE_PATH}?${search}`);
}
