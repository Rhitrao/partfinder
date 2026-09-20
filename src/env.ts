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
   * Missing means the vendor search shows its fallback links, not an error.
   */
  GOOGLE_PLACES_KEY?: string;
  /**
   * The shared passcode for /parts/vendors. It is also the HMAC key behind the pf_vendor cookie,
   * so changing it signs everybody out. Missing means nobody can sign in.
   */
  VENDOR_PASSCODE?: string;
}
