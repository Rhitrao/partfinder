# Partfinder

Partfinder identifies industrial part numbers. You paste a part number, a list of them, or a whole
WhatsApp message from a customer, and it tells you which manufacturer's numbering format each
number matches, every other way that number is written, and what it could not work out.

It runs as a Cloudflare Worker at `rohitrao.in/parts/`. The repo is public.

"The workflow is old: I've looked up part numbers manually since 2020. This tool is new, built in September 2026."

## What it does today

Phase 0 is an offline page. Everything on it is computed from the number you typed and a table of
manufacturer format rules. Nothing is fetched and nothing is stored. The one exception is the
vendor pages below, which are behind a passcode and call Google Places API (New).

**The page, `GET /parts/`.** `GET /parts` redirects to it. One server-rendered HTML document,
with no client-side JavaScript at all, because it is mostly read on a phone on a site or in a
yard. Paste into the box, optionally add a brand or machine and a city, pick a country, and
press Identify.

**1. Identify.** One card per number found in what you pasted, with the manufacturer or
manufacturers it could be, the canonical spelling, any suffix, and any warning about the reading.

**2. Check.** On each card: search every spelling at once, see images of it — compare the shape
before ordering — and search what machines it fits.

**3. Where to buy.** A supplier search narrowed by your city and country, parts shops on Google
Maps, and the manufacturer's own dealer locator where one has been confirmed. Every one of these
is a link out. Partfinder holds no supplier list, fetches none of these sites, and vets nobody.

**4. Send the requirement.** Below the cards, the requirement is drafted for you: a read-only box
you can copy from, a WhatsApp chat straight to a supplier's number if you have one, the WhatsApp
contact picker if you don't, and email. All four carry exactly the same text. You can add a note,
such as a quantity. Partfinder has no phone number of its own; you pick who to send to.

**5. Keep it.** `/parts/` has a web app manifest and icons, so it saves to a home screen as
"Partfinder" and opens straight back to the page. There is no service worker: it is a shortcut,
not offline mode.

**6. Find vendors.** `GET /parts/vendors/`, linked from the bottom of the page and carrying only
the numbers that were recognised, never what you pasted. This page is not public: it costs money
per view, so it is behind a shared passcode. Give it a city and it asks Google Places API (New) for
shops listed for each of your brands, plus one search that names no brand, and merges the answers
into one list. A shop listed for two of your brands says so, and sorts above one listed for one.
Tick up to five, choose whether each is asked about all your parts or only its own brands', and
`GET /parts/vendors/contact` fetches their phone numbers and websites and writes one message per
shop, addressed to it by name, for WhatsApp, a phone call or email.

Being listed by Google is not a claim that a shop has your part. The page says so, above the list.
Nothing is stored: a place id travels in a URL and nowhere else, no page is scraped, and no vendor
list is kept. Google's listings are shown with its attribution. When Google will not answer - the
daily limit, a timeout, no key - the page says so in its own words, never Google's, and falls back
to the link-outs from section 3.

**The API, `GET /parts/api/parse?q=<text>`.** The same parsing as JSON:

```
{ hints: string[], results: [{ input, compact, candidates: [...], reason? }] }
```

## Every result is a guess, and says so

A match means the number fits a manufacturer's known numbering format. That is all it means. No
catalogue, document or web page has been checked, so every candidate is tier **T5**, and every card
says "Guess from number format only. Not confirmed."

When nothing matches, that is an answer too, not an error: the card reads "Not determined: no known
number format matched."

There are no prices, no stock and no lead times anywhere in Partfinder, and there never will be.
Industrial spares are quoted per account, never published.

Partfinder is not affiliated with any manufacturer. Brand names identify the parts they make.

## What is parked, and why

Phase 0 is deliberately the parser and the page, nothing else. Until 23 September these are out of
scope, each with the terms it must be built under when it comes back:

| Parked | Why, and on what terms |
| --- | --- |
| The D1 cache | Nothing is fetched yet, so there is nothing to cache. |
| The SF-Filter adapter | A T2 cross-reference source. Read only the part cells, never stock or price text; a 200 with zero rows means not found; at least 2 s between requests; its terms must be confirmed first. |
| The MANN-FILTER index | Built on GitHub Actions from the `/en/` pages, never in the Worker. |
| The paste-a-source check | Needs the evidence model, which needs the database. |
| The JCB site | Not usable: its data is rendered by JavaScript. |

Country is a user setting, default India. It picks the search link's region and, later, the order
sources are tried in. It never hides a result and is never stored on a record.

## Principles

- **Normalisation never destroys information.** The original input, the compact form, the canonical
  form, the base, the suffix and every alternate spelling are all kept.
- **Ambiguity is reported, not resolved.** A number that fits two manufacturers shows both, side by
  side. The one exception: separators you typed are evidence, so within one manufacturer a reading
  that contradicts them is dropped.
- **"Not determined" is an answer.** Every unresolved field carries a reason code, one of
  `no_public_source`, `login_required`, `only_excluded_sources`, `ambiguous_format`,
  `no_rule_matched` or `cap_reached`.
- **No claim without a link, no equivalent without a source.** A format match is a guess, and is
  labelled T5.
- **Public data only,** and sources count as independent only across different domains. The same
  listing reposted on five domains counts once.
- **What you paste stays yours.** Nothing you type is logged — not the pasted text, the hint, the
  city, the supplier's number or the note — and the link inside the message carries only the part
  numbers Partfinder extracted, never anything else you typed.
- **Suppliers are a link out, never a list.** Google search, Google Images, Google Maps, a
  manufacturer's official dealer locator, or your own contacts. Partfinder never stores, scrapes
  or vets supplier data, and no supplier site is fetched when you load the page.

## Source tiers

| Tier | Basis |
| --- | --- |
| T1 | OEM catalogue or OEM document |
| T2 | Aftermarket maker's own cross-reference for its product |
| T3 | Two or more independent domains agree |
| T4 | One seller or one tender claims it (shown only beside a T1 to T3 identity) |
| T5 | Number format only (a guess, never a public page) |

Everything Partfinder returns today is T5.

## Layout

```
src/index.ts      Worker entry and routing under /parts/, plus the manifest and icons
src/env.ts        the two Worker secrets, both optional: the page works without either
src/headers.ts    the response headers every page under /parts/ carries
src/page.ts       the /parts/ page: form, cards, link-outs, the requirement and its handoffs
src/vendors/      the passcode-gated vendor pages
  auth.ts         the passcode gate: a cookie derived from the passcode, nothing stored
  places.ts       the Google Places API (New) client, and the only fetch in the Worker
  search.ts       grouping the numbers by brand, and merging what came back
  contact.ts      Place Details, the per-vendor message, and WhatsApp or call or email
  page.ts         the vendor pages themselves
  index.ts        routing under /parts/vendors
src/parse.ts      token and hint extraction, normalisation, candidate ranking
src/rules.ts      manufacturer format rules, as data
src/hints.ts      brand and model words that hint at a manufacturer
src/dealers.ts    manufacturers' own dealer locators, as data
src/manifest.ts   the web app manifest and the theme colour
src/icons.ts      generated: the home-screen icons, base64, served from the bundle
scripts/sample.ts regenerates docs/sample-page.html
scripts/icons.ts  draws the icons and regenerates src/icons.ts and docs/icon-*.png
test/             vitest; no network; public part numbers only
```

`src/dealers.ts` is empty until each locator URL has actually been opened and confirmed to be
that manufacturer's own dealer-locator page. "Authorised dealers" is a claim, and a guessed URL
under that label is worse than no link. Adding one is a data commit; the link renders by itself.

Format rules are hypotheses, and are written as data so they can be corrected without touching
code. `docs/sample-page.html` is the page's exact output for one query, committed so it can be read
without deploying.

## Development

```
npm install
cp .dev.vars.example .dev.vars   # then put real values in it; .dev.vars is never committed
npm test              run the test suite (no network, no paid API calls)
npm run typecheck     strict TypeScript check
npm run sample        regenerate docs/sample-page.html
npm run icons         redraw the home-screen icons
npx wrangler dev      run the Worker locally
```

Work on a branch and open a pull request. Tests and the typecheck run on every pull request.
Nobody runs `wrangler deploy`: merging into `main` deploys, through Cloudflare's Git integration.
See [docs/DEPLOY.md](docs/DEPLOY.md).
