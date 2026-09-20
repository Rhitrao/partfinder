// Response headers, in one place, because every page under /parts must carry the same set.
//
// noindex is on everything until a step prompt lifts it. The CSP allows no script at all: these
// pages are server-rendered HTML and nothing else.

export const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; manifest-src 'self'; " +
    "form-action 'self'; base-uri 'none'",
  "Referrer-Policy": "no-referrer",
};

/**
 * The vendor pages carry everything above plus Cache-Control: no-store. Their URLs hold the part
 * numbers and the city, and their bodies hold vendor names and phone numbers, so no cache -
 * shared, browser or back-forward - may keep a copy.
 */
export const VENDOR_PAGE_HEADERS: Record<string, string> = {
  ...PAGE_HEADERS,
  "Cache-Control": "no-store",
};

/** The same no-store policy on a redirect, which carries no body but still ends a vendor request. */
export const VENDOR_REDIRECT_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};
