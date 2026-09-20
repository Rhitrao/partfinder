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

**1. Paste.** One box, one city, one button. Country, a brand hint and a note for suppliers sit
behind "More options"; none of them is needed to get an answer.

**2. Parts.** One card per number: the canonical form large, how you typed it underneath when they
differ, the manufacturer with a small "format match" badge, the suffix as a tag, and the quantity
read out of your message - "2 nos 1u3352" and "40/300893 x1" both count, "1u3352 2023" does not.
Each card has a quantity box you can correct, and every message updates. A number that fits two
manufacturers offers a chip for each, which re-runs the search with that one hinted.

One line under the cards says the whole truth about them: the manufacturer is matched from the
number's format, not confirmed, and suppliers confirm fitment. Anything unrecognised is named in
one line. "Check this part" is collapsed: images, fitment, a plain search.

**3. Suppliers.** Signed in, with a city, the shops appear under the cards: a Google map with
numbered pins and matching numbered cards. Each card carries how far away it is - from you if you
shared your location, otherwise from the city centre - its rating, whether Google says it is open,
and which of your parts it can be asked about, with the brand Google listed it under. Then Select,
WhatsApp with the requirement already written, Call, Website and Map.

Tick several and a bar appears: "3 selected - Message selected". The panel opens each chat in
turn, marks the ones you have done, and can copy any message instead. WhatsApp opens one chat at a
time, so that is how the panel works.

Every WhatsApp link is a plain link with the message already in it, so all of that works with
JavaScript off. JavaScript adds the map, "Use my location", the filter chips and the send queue,
and nothing else - it never writes a message.

Being listed by Google is not a claim that a shop has your part. The page says so, above the list.
Nothing is stored: a place id travels in a link and nowhere else, a shared location is rounded to
about a hundred metres and lives in one page address, no page is scraped, and no vendor list is
kept. When Google will not answer, the page says "Supplier list unavailable right now" and falls
back to per-brand link-outs, which need no key.

Signed out, the section is those link-outs. Supplier search costs money per view, so it is behind
a passcode; the only way in is "Owner sign-in" in the footer.

**4. Other ways to send.** Collapsed under the suppliers, open when there are none: the message to
copy, the WhatsApp contact picker, email, and a box for a supplier's own number. All four carry
exactly the same text.

**5. Keep it.** `/parts/` has a web app manifest and icons, so it saves to a home screen as
"Partfinder" and opens straight back to the page. There is no service worker: it is a shortcut,
not offline mode.

**Terms and privacy, `GET /parts/terms` and `GET /parts/privacy`.** Public, static, linked from
the footer of every page. Google's Places API policies require an app using its data to publish
both, incorporating Google's own terms and privacy policy, so these are a condition of the vendor
pages rather than decoration. The privacy page is the short list of what Partfinder keeps, which
is nothing you type, and the one cookie it sets.

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
src/env.ts        the three Worker secrets, all optional: the page works without any of them
src/legal.ts      the public Terms and Privacy pages
src/page.ts       the /parts/ page: form, cards, link-outs, the requirement and its handoffs
src/headers.ts    the response headers, including the map page's nonce CSP
src/quantity.ts   how many, read out of the pasted message
src/vendors/      the suppliers behind the passcode
  auth.ts         the passcode gate and the remembered city and country, nothing stored
  places.ts       the Google Places API (New) client, and the only fetch in the Worker
  search.ts       the origin, the brand groups, distances, and merging what came back
  phone.ts        what can be done with a number: WhatsApp, a call, or neither
  suppliers.ts    the Suppliers section on /parts/ and the fallback links
  script.ts       the only client-side JavaScript: map, location, filters, send queue
  page.ts         the passcode form
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

`GOOGLE_MAPS_BROWSER_KEY` is a browser key and is rendered into the page on purpose; its Google
Cloud restrictions are what protect it. Restrict it by **origin** (`https://rohitrao.in/*`), not
by path: the map page sends `Referrer-Policy: strict-origin-when-cross-origin`, so Google receives
`https://rohitrao.in/` and never the path or the query string. That is deliberate - the query
string holds what you pasted, and it must not reach Google in a `Referer` header - but it means a
path-scoped restriction such as `https://rohitrao.in/parts/*` can never match, and the map would
silently fail to load.

Work on a branch and open a pull request. Tests and the typecheck run on every pull request.
Nobody runs `wrangler deploy`: merging into `main` deploys, through Cloudflare's Git integration.
See [docs/DEPLOY.md](docs/DEPLOY.md).
