// Worker bindings.
//
// Both values are Cloudflare Worker secrets. They are set with `wrangler secret put` and never
// live in the repo; .dev.vars.example lists the names for local development, and .dev.vars itself
// stays ignored. Both are optional on purpose: a Worker deployed without them must still serve
// the page, so every use site has to handle "missing" rather than assume the secret is there.

export interface Env {
  /**
   * A Google Maps key restricted to Places API (New). Today it is a demo key, meant for
   * prototyping; after 23 September it is replaced by a billing key with a hard daily cap.
   * Missing means the vendor search shows its fallback links, not an error. This one is a server
   * secret and must never reach a response body; GOOGLE_MAPS_BROWSER_KEY is the one that does.
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
   * The shared passcode for /parts/vendors. It is also the HMAC key behind the pf_vendor cookie,
   * so changing it signs everybody out. Missing means nobody can sign in.
   */
  VENDOR_PASSCODE?: string;
}
