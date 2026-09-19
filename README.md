# Partfinder

Partfinder identifies industrial part numbers. You paste a part number, a list of them, or a whole
WhatsApp message from a customer, and it tells you which manufacturer's numbering format each
number matches, every other way that number is written, and what it could not work out.

It runs as a Cloudflare Worker at `rohitrao.in/parts/`. The repo is public.

"The workflow is old: I've looked up part numbers manually since 2020. This tool is new, built in September 2026."

## What it does today

Phase 0 is an offline page. Everything on it is computed from the number you typed and a table of
manufacturer format rules. Nothing is fetched, nothing is stored, and no paid API is called.

**The page, `GET /parts/`.** `GET /parts` redirects to it. One server-rendered HTML document,
with no client-side JavaScript at all, because it is mostly read on a phone on a site or in a
yard. Paste into the box, optionally
add a brand or machine, pick a country, and press Identify. You get:

- one card per number found in what you pasted, with the manufacturer or manufacturers it could be,
  the canonical spelling, any suffix, and any warning about the reading;
- a "Search all spellings" link that searches every spelling of that number at once, quoted and
  joined with OR, on your country's search domain;
- one WhatsApp button, which opens a message you can send to any supplier you choose. Partfinder
  has no phone number of its own and no supplier list.

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
- **What you paste stays yours.** Neither the pasted text nor the hint is logged, and the link in
  the WhatsApp message carries only the part numbers Partfinder extracted, never the message you
  pasted into it.

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
src/index.ts      Worker entry and routing under /parts/
src/page.ts       the /parts/ page: form, cards, search link, WhatsApp handoff
src/parse.ts      token and hint extraction, normalisation, candidate ranking
src/rules.ts      manufacturer format rules, as data
src/hints.ts      brand and model words that hint at a manufacturer
scripts/sample.ts regenerates docs/sample-page.html
test/             vitest; no network; public part numbers only
```

Format rules are hypotheses, and are written as data so they can be corrected without touching
code. `docs/sample-page.html` is the page's exact output for one query, committed so it can be read
without deploying.

## Development

```
npm install
npm test              run the test suite (no network, no paid API calls)
npm run typecheck     strict TypeScript check
npm run sample        regenerate docs/sample-page.html
npx wrangler dev      run the Worker locally
```

Work on a branch and open a pull request. Tests and the typecheck run on every pull request.
Nobody runs `wrangler deploy`: merging into `main` deploys, through Cloudflare's Git integration.
See [docs/DEPLOY.md](docs/DEPLOY.md).
