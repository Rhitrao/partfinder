# Deploying Partfinder

Short version: nobody deploys Partfinder by hand. Merging into `main` deploys it.

## How a deploy happens

Cloudflare's Git integration watches this repository. When `main` changes, Cloudflare builds the
Worker from the repository and puts the new version live. That is the only way anything reaches
production.

Nobody runs `wrangler deploy`, and CI never does either: the `test` workflow runs the test suite
and the typecheck, holds no Cloudflare credentials, and touches nothing on Cloudflare's side.

So the deploy checklist is the pull request checklist. Tests and the typecheck pass, the pull
request is reviewed, it merges into `main`, and the deploy follows.

## The Worker name

The Worker on Cloudflare must be called `partfinder`, because that is the `name` in
`wrangler.toml`:

```toml
name = "partfinder"
```

If the two names differ, the build creates a second Worker under the name from the file, and the
routes stay attached to the old one. The page then does not change and nothing reports an error.
If a deploy seems to do nothing, check this first.

## The two routes

```toml
routes = [
  { pattern = "rohitrao.in/parts", zone_name = "rohitrao.in" },
  { pattern = "rohitrao.in/parts/*", zone_name = "rohitrao.in" },
]
```

The page lives at `rohitrao.in/parts/`, with the trailing slash. `rohitrao.in/parts/*` is what
carries it, along with `/parts/?q=...` and `/parts/api/parse?q=...`. The bare `rohitrao.in/parts`
route exists only so that `/parts` redirects to `/parts/`.

The trailing slash is not a style choice. A Cloudflare route pattern with no `*` at the end
matches the bare path and nothing else: route matching looks at the whole URL including the query
string, and a pattern may not contain query parameters. So `rohitrao.in/parts` would never match
`rohitrao.in/parts?q=1u3352`, and this page is nothing but query string. See
[Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/).

The obvious shortcut, `rohitrao.in/parts*`, is not used. It would match the query string, but it
would also capture unrelated paths on the main site, such as `/partsxyz`.

Everything else on `rohitrao.in` is untouched. Requests outside these two routes never reach the
Worker.

## There is no workers.dev address

```toml
workers_dev = false
preview_urls = false
```

By default a Worker is also served at `partfinder.<subdomain>.workers.dev`, and each version at
its own preview URL. Both are off, so Partfinder has one address.

Two reasons. A second address is a second copy of the same page for search engines to index,
which works against `X-Robots-Tag: noindex`. And a `workers.dev` address has no route in front of
it, so anyone who found it would be pasting part numbers, and whatever else is in the message,
into an address nobody is watching.

## Observability is off

```toml
[observability]
enabled = false
```

Cloudflare's default is on. Workers Logs record the request URL, and this Worker's URLs carry
`q`: whatever the user pasted. That is often a WhatsApp message with a customer's name, a phone
number or a price in it. None of that may be recorded on Cloudflare's side, so the logs are off
rather than sampled or redacted. Logpush is not configured either.

The cost is real: there are no request logs to debug from. Reproduce a problem locally with
`npx wrangler dev` instead.

## Secrets

Four, all optional: a Worker deployed without any of them still serves the page, which is why
every use site handles "missing" rather than assuming the secret is there. They go in with
`wrangler secret put`, never into this repository and never into the Cloudflare build
configuration. `.dev.vars.example` lists the same four names for `npx wrangler dev`.

| Secret | Side | Missing means |
| --- | --- | --- |
| `GOOGLE_PLACES_KEY` | server only, never in a response | the supplier endpoint answers `{error:"unavailable"}` |
| `GOOGLE_MAPS_BROWSER_KEY` | rendered into the page on purpose | no map; the list stands on its own |
| `TURNSTILE_SITE_KEY` | rendered into the page on purpose | no live Suppliers section; the page says so and shows its link-outs |
| `TURNSTILE_SECRET_KEY` | server only, never in a response | the supplier endpoint refuses every request |

A missing `TURNSTILE_SECRET_KEY` refusing everything is deliberate. A Worker that cannot verify a
token has not verified it, and "cannot check" must never fall open onto a paid API.

## Checking what is set, without logs

```
curl -s https://rohitrao.in/parts/api/health
```

The dashboard says a secret exists. It never says what is in it, and there are no request logs
here to read instead, so that answer used to be unobtainable. `GET /parts/api/health` gives it:

```
{ "ok": true,
  "env": { "placesKey": { "present": true, "length": 39 },
           "mapsBrowserKey": { "present": true, "length": 39 },
           "turnstileSiteKey": { "present": false, "length": 0 },
           "turnstileSecret": { "present": true, "length": 32 } },
  "render": { "suppliersSectionWouldRender": false,
              "reasons": ["TURNSTILE_SITE_KEY is missing or empty, ..."] } }
```

Read it in this order:

1. **`ok`** only says the Worker is running and the route reached it. It is not a verdict on the
   configuration.
2. **`present: false`** means the binding never arrived: never set, set on a different Worker (see
   *The Worker name* above), or set as a Cloudflare build variable rather than a Worker secret.
   Build variables exist at build time and are not runtime bindings.
3. **`present: true` with `length: 0`** means a secret that exists and holds nothing - usually a
   `wrangler secret put` that was given an empty line, or a paste that did not take.
4. **A `length` that is not the length of the key you hold** means it was truncated or has a
   newline or a quote in it. Compare it against the real key on your own machine; the endpoint
   will never show you any of it.
5. **`render.reasons`** is the render path's own answer, computed by the function the page calls,
   so it cannot disagree with what the page did.

No key value, and no prefix of one, is ever in that response. It calls neither Google nor
Cloudflare, so a health check spends nothing from the day's Places allowance.

## When the supplier endpoint answers 403

`POST /parts/api/suppliers` refuses with `{"error":"verify","codes":[...]}`. The codes are
Cloudflare's own and name which input was wrong, never what it was.

| Code | What it means | What to do |
| --- | --- | --- |
| `timeout-or-duplicate` | the token was already redeemed, or is more than 300 seconds old | not a key problem. See *Tokens* below |
| `invalid-input-secret` | `TURNSTILE_SECRET_KEY` is not a key Cloudflare recognises | check it is the **secret** key, and that it belongs to the same widget as the site key |
| `missing-input-secret` | the Worker read no secret at all | the binding is not there. `GET /parts/api/health` says which |
| `missing-input-response` / `invalid-input-response` | the token was empty or malformed | the page sent nothing usable; check the browser console |
| `bad-request` | Cloudflare rejected the request shape | the siteverify call itself is wrong |
| `siteverify-unreachable` | ours, not Cloudflare's: a timeout, a dropped connection, an HTTP error, or a body that would not parse | nothing was verified. Cloudflare's status page, or a transient |
| `unknown` | Cloudflare refused and gave no code | as above |

A site key and a secret key from **different widgets** both look present and both have plausible
lengths, so `/parts/api/health` reads normal while every verification fails with
`invalid-input-secret`. That is the one failure the health endpoint cannot see.

### Tokens

A Turnstile token is good for exactly one redemption and for 300 seconds. Two things follow.

The Worker calls siteverify **once** per request and never retries. A retry with the same token
is the classic way to produce `timeout-or-duplicate` from server code; if one is ever added it
needs Turnstile's `idempotency_key`.

The page mints a fresh token for every round. Retry and "Use my location" both go through
`turnstile.reset()`, which is what obtains a new one, and a token is never sent twice. Tests in
`test/script-run.test.ts` run the real script and check it.

### What is not checked

siteverify also returns `hostname`, `action` and `challenge_ts`, and none of them is validated.
The widget sets no `action`, so there is nothing to match. Cloudflare recommends checking
`hostname` as defence in depth; the site key is domain-bound in the dashboard, which is what
stands in for it today.

## Rolling back

Cloudflare keeps previous versions of the Worker.

1. Open the Cloudflare dashboard, then Workers & Pages, then `partfinder`.
2. Go to Deployments, find the last version that was good, and redeploy it.

That is live in seconds and needs no repository change. Then fix the problem on a branch and open
a pull request as usual, so that `main` and what is live agree again.

Rolling back by reverting the commit on `main` also works, and takes as long as a build.
