// Worker bindings.
//
// Every value here is a Cloudflare Worker secret. They are set with `wrangler secret put` and
// never live in the repo; .dev.vars.example lists the names for local development, and .dev.vars
// itself stays ignored. All of them are optional on purpose: a Worker deployed without them must
// still serve the page, so every use site has to handle "missing" rather than assume the secret
// is there.

export interface Env {
  /**
   * A Google Maps key restricted to Places API (New). Today it is a demo key, meant for
   * prototyping; after 23 September it is replaced by a billing key with a hard daily cap.
   * Missing means the supplier endpoint answers {error:"unavailable"}, not an error page. This
   * one is a server secret and must never reach a response body or a response header;
   * GOOGLE_MAPS_BROWSER_KEY is the one that does.
   */
  GOOGLE_PLACES_KEY?: string;
  /**
   * A Google Maps browser key, restricted to https://rohitrao.in/parts/* and the Maps JavaScript
   * API. Unlike GOOGLE_PLACES_KEY this one is meant to be read: it goes into the page as the src
   * of the Maps script, where any visitor can see it. Its restrictions are what protect it.
   * Missing means the map is not drawn and the list stands on its own.
   */
  GOOGLE_MAPS_BROWSER_KEY?: string;
  /**
   * The Cloudflare Turnstile site key. Public by design: it is rendered into the page as the
   * widget's data-sitekey, which is where Turnstile expects it. Missing means the widget cannot
   * render, so the page shows its link-outs and never calls the supplier endpoint.
   */
  TURNSTILE_SITE_KEY?: string;
  /**
   * The Cloudflare Turnstile secret key, used server-side to call siteverify. It is a server
   * secret and must never reach a response body or a response header. Missing means no token can
   * be verified, so the endpoint refuses every request rather than letting one through unchecked.
   */
  TURNSTILE_SECRET_KEY?: string;
}
