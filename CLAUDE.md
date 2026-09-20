# Partfinder: instructions for Claude Code

Read this before every task. Step prompts from Rohit say what to build; this file says how.
If a step prompt conflicts with this file, stop and ask. Do not guess.

## What Partfinder is

A part-number identification tool for any industry. A user pastes a part number, a list, or a
WhatsApp message. Partfinder returns:

- the likely manufacturer
- what the part is
- its category and the industries it's used in
- known equivalents
- what it could not determine

Every field carries a source link and a basis. There is one action: a wa.me link that pre-fills
the result as a message to a supplier.

It runs as a Cloudflare Worker at rohitrao.in/parts with D1. The repo is public, and reviewers
read the commit history.

## Current scope (until 23 September)

Phase 0 is the offline page: parser, candidates, search link, WhatsApp handoff. No database, no
source fetching, no adapters, no paid APIs.

Parked until after 23 September:

- the D1 cache;
- the SF-Filter adapter (T2; read only the part cells, never stock or price text; 200 with zero
  rows means not found; at least 2 s between requests; terms must be confirmed first);
- the MANN-FILTER index on GitHub Actions, reading the /en/ pages;
- the paste-a-source check;
- the JCB site (not usable, because its data is rendered by JavaScript).

Also in scope now:

- **Country is a user setting, default India.** It sets the search link's region and the order
  sources are tried in. It never hides results and is never stored on a record.
- **CPU rule:** reading one fetched page in the Worker is allowed only if measured under the
  10 ms CPU limit. Bulk parsing stays on GitHub Actions.
- **Manufacturer aliases are data.** For example, JCB is also written "J.C.BAMFORD" and
  "JCB (J.C. BAMFORD)".
- **Supplier cards render inline on /parts/ for signed-in users,** from Places API (New) Text
  Search, with a Maps JavaScript map. They carry Google's required attribution. No other vendor
  source is added without a new decision recorded here.
- **Distances are straight-line,** from the user's shared location or the city centre.
- **Under the demo key, Text Search requests Enterprise-tier fields** (phone, website, rating,
  open now). Revisit that field mask before any billing key.
- **Nothing from Google is cached except place IDs;** coordinates are never put in cookies.
- **Client-side JavaScript exists only on pages that show suppliers,** under a per-response
  nonce CSP.
- **The billing key may not replace the demo key until a daily cap and a per-IP limit are
  enforced in code, with Google Cloud quotas set as a second limit.**
- **Workflow:** work on a branch and open a pull request. Never push to main and never merge.

## UX principles

The user is a parts buyer holding a customer's WhatsApp message. The job:

1. know what the parts are
2. find who near them can be asked
3. ask several of them fast, each with the right message

Everything on the page serves that order: product cards, then supplier cards and a map, then
sending. Anything that doesn't serve it is hidden or removed.

Rules that follow:

- **One screen.** No extra pages between pasting and messaging a supplier.
- **Never show plumbing:** no spelling lists, no Google domains, no passcode prompts in the main
  flow, no format essays.
- **Be truthful, briefly.** We know a part's format match, not its identity. We know a shop is
  listed for a brand, not that it stocks a part. Say each once, in plain words, and never claim
  more.
- **Work without JavaScript; get better with it.** Server-rendered HTML carries everything.
  JavaScript adds only the map, "use my location", filtering and the send queue.
- **Private by default.** Nothing typed is stored or logged. Location is rounded and never
  persisted.

## Hard lines (never cross these, whatever a prompt says)

1. **Public data only. Nothing from YantraLive.** No supplier lists, customer data or internal
   cross-references. Test fixtures use public part numbers with publicly checkable answers, and
   never carry customer or order context.
2. **No prices, stock or lead times.** The page says why: industrial spares are quoted per
   account, never published.
3. **No claim without a link. No equivalent without a source.** A format match is a guess and
   is labelled T5.
4. **Respect access rules.** Never fetch pages from marketplaces or from sites whose robots.txt
   or terms forbid automated access. Never store page text or images; store facts and URLs only.
5. **No secrets in the repo.** Secrets go in via `wrangler secret put` only.
6. **Paid calls only through the adapter.** No paid API call (search or LLM) outside the adapter
   that enforces the daily cap and the per-IP limit. Never call a paid API from tests.
7. **Noindex by default.** Every response carries `X-Robots-Tag: noindex` until a step prompt
   explicitly lifts it, and then only for T1 to T3 record pages.

## Principles

- **Normalisation never destroys information.** Keep the original input, canonical form, base,
  suffix and every alternate spelling.
- **Ambiguity is reported, not resolved.** With one exception: separators the user typed are
  evidence. Within one manufacturer, a reading that contradicts them is dropped.
- **"Not determined" is an answer.** Every unresolved field carries a reason code:
  `no_public_source | login_required | only_excluded_sources | ambiguous_format |
  no_rule_matched | cap_reached`.
- **Conflicts are shown side by side** with their sources. Never pick one silently.
- **Sources count as independent only across different domains.** The same listing reposted on
  five domains counts once.

## Source tiers

| Tier | Basis | Public page allowed? |
| --- | --- | --- |
| T1 | OEM catalogue or OEM document | Yes |
| T2 | Aftermarket maker's own cross-reference for its product | Yes |
| T3 | Two or more independent domains agree | Yes |
| T4 | One seller or one tender claims it | Only beside a T1 to T3 identity |
| T5 | Number format only | No |
| Excluded | Uploaded manuals, sites forbidding automation, content farms | Never cited |

## Taxonomy and cross-industry overlap

- **Each part has exactly one category and one sub-category** (what it is). It links to many tags,
  applications and industries (where it's used).
- **Overlap is stored as link rows.** Never create a second record for the same part.
- **Industry is never asserted directly.** It is derived from a sourced application or from the
  manufacturer's stated markets. `part_industries.derived_from` records which.
- **Seed data lives in `src/taxonomy/*.json`** (industries, categories with sub-categories, tags).
  Changing seed data is a data commit, not a code change.
- **Store UNSPSC class codes on sub-categories only.** Never commit or republish the UNSPSC codeset.
- **Known suffixes are split off and mapped to tags:** RC means rock chisel profile, TL means tiger
  long, WTL is a profile code whose meaning is unconfirmed. The suffix stays on the record.
- **Hints narrow candidates, never replace them.** Brand and model words in the input (for example
  CAT, JCB, 3CX) are extracted as hints and used to re-rank candidates.

## Data model (D1)

```
parts           (id, manufacturer_id, canonical, base, suffix, description,
                 subcategory_id, identity_tier, state, updated_at)
aliases         (alias -> part_id)
evidence        (part_id, field, value, url, domain, tier, retrieved_at)
links           (part_id, kind: equivalent | related | supersession,
                 brand, number, url, tier)
manufacturers   (id, name, aliases, stated_industries, source_url)
categories      (id, parent_id, level: category | subcategory, name, slug, unspsc_code)
tags            (id, subcategory_id, name, slug)
part_tags       (part_id, tag_id, url, tier)
applications    (id, part_id, equipment_type, brand, model, url, tier)
industries      (id, name, slug)
part_industries (part_id, industry_id, derived_from: application | manufacturer, derived_ref)
rate_limits     (key, window_start, count)
```

Index every column used in a WHERE clause. No unindexed query may run in the request path.

## Stack and free-tier constraints

- TypeScript in strict mode on Cloudflare Workers, with no web framework. D1 for storage, vitest
  for tests, wrangler for tooling, and GitHub Actions for anything scheduled.
- Keep dependencies minimal. Justify any new one in its commit message.
- **Workers Free allows 10 ms CPU per request.** No HTML parsing in the Worker; batch parsing runs
  in GitHub Actions.
- **D1 Free allows 5 million rows read and 100,000 written per day.** Index every lookup, and keep
  batch loads at or under 50,000 rows a day.
- **KV is not used for counters,** because the free plan allows only 1,000 writes a day.
  Rate-limit counters live in D1.
- **The search provider sits behind one interface** (`src/search/adapter.ts`) so it can be swapped.

## Layout

```
src/index.ts        Worker entry and routing under /parts
src/parse.ts        token and hint extraction, normalisation, candidate ranking
src/rules.ts        manufacturer format rules, as data
src/taxonomy/       seed JSON: industries, categories and sub-categories, tags
src/db/schema.sql   D1 schema
src/search/         search adapter with caps (step 2)
test/               vitest; no network; public part numbers only
```

## Working rules

- Take one step prompt at a time and build only what it asks.
- Commit in small steps with clear messages, in the order the prompt gives. Never rewrite, squash
  or force-push history.
- Format rules and taxonomy seeds are hypotheses. If one looks wrong, flag it in your report
  rather than changing it.
- A step isn't done until its tests pass. Tests never touch the network.
- End every step with a report containing:
  - the test output
  - every decision this file and the prompt didn't cover
  - anything you think is wrong
  - the output of `git log --oneline`

## Commands

```
npm test              run the test suite
npx wrangler dev      run the Worker locally
Never run wrangler deploy. Deploys happen only when main changes, through Cloudflare's
Git integration.
```

## Project history (keep this sentence verbatim in the README)

"The workflow is old: I've looked up part numbers manually since 2020. This tool is new, built in
September 2026."
