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

There are none in Phase 0. The Worker fetches nothing, stores nothing and calls no paid API, so
there is nothing to authenticate. No secret needs to be set before a deploy, and no secret is
needed for one.

When a step prompt does add one, it goes in with `wrangler secret put`, never into this
repository or into the Cloudflare build configuration.

## Rolling back

Cloudflare keeps previous versions of the Worker.

1. Open the Cloudflare dashboard, then Workers & Pages, then `partfinder`.
2. Go to Deployments, find the last version that was good, and redeploy it.

That is live in seconds and needs no repository change. Then fix the problem on a branch and open
a pull request as usual, so that `main` and what is live agree again.

Rolling back by reverting the commit on `main` also works, and takes as long as a build.
