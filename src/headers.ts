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
  // The only powerful feature this page ever asks for, and only from its own code.
  "Permissions-Policy": "geolocation=(self)",
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

/**
 * A fresh nonce per response, which is what makes a nonce CSP worth anything: a nonce reused
 * across responses is a nonce an attacker can read off one page and use on the next.
 */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");
}

/**
 * Headers for the one kind of page that runs a script: /parts/ with a map on it.
 *
 * The CSP is Google's own strict policy from the Maps JavaScript "Content Security Policy guide",
 * with our default-src 'none', form-action, base-uri and manifest-src kept. Our own <style>
 * carries the same nonce, because a nonce in style-src makes the browser ignore 'unsafe-inline'
 * and an unnonced <style> would simply not apply.
 *
 * Referrer-Policy is the one header that differs from every other page, and it is a deliberate
 * trade. GOOGLE_MAPS_BROWSER_KEY is restricted by HTTP referrer, so a request carrying no referrer
 * at all is rejected and no map is drawn. strict-origin-when-cross-origin sends Google
 * "https://rohitrao.in/" and never the path or the query string, so nothing the user pasted
 * leaves in a Referer header - which no-referrer-when-downgrade or unsafe-url would do. See the
 * README: the key's restriction has to be the origin, because no modern browser sends the path.
 */
export function mapPageHeaders(nonce: string): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "X-Robots-Tag": "noindex",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-eval' blob:`,
      "img-src 'self' https://*.googleapis.com https://*.gstatic.com *.google.com " +
        "*.googleusercontent.com data:",
      "frame-src *.google.com",
      "connect-src 'self' https://*.googleapis.com *.google.com https://*.gstatic.com data: blob:",
      "font-src https://fonts.gstatic.com",
      `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
      "worker-src blob:",
      "manifest-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
    ].join("; "),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(self)",
    "Cache-Control": "no-store",
  };
}

/** The same no-store policy on a redirect, which carries no body but still ends a vendor request. */
export const VENDOR_REDIRECT_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};
