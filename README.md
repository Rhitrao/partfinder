# Partfinder

Partfinder identifies part numbers from public sources. Paste a part number, a list, or a WhatsApp
message, and it returns:

- the likely manufacturer
- what the part is
- its category and the industries it's used in
- known equivalents
- what it could not determine

Every field carries a source link and a basis (its source tier). The one action is a wa.me link that
pre-fills the result as a message to a supplier.

Partfinder covers any industry. Each part has one record, with exactly one category and one
sub-category for what it is. Where it's used (applications, industries, tags) is stored as links to
that record, so a part used in mining and in construction is still one part, never two.

It shows no prices, stock or lead times. Industrial spares are quoted per account, never published.

"The workflow is old: I've looked up part numbers manually since 2020. This tool is new, built in September 2026."

## Principles

- **Normalisation never destroys information.** Keep the original input, canonical form, base,
  suffix and every alternate spelling.
- **Ambiguity is reported, not resolved.** Return every matching candidate, ranked, with warnings.
- **"Not determined" is an answer.** Every unresolved field carries a reason code:
  `no_public_source | login_required | only_excluded_sources | ambiguous_format |
  no_rule_matched | cap_reached`.
- **Conflicts are shown side by side** with their sources. Never pick one silently.
- **Sources count as independent only across different domains.** The same listing reposted on
  five domains counts once.

## Source tiers

| Tier | Basis |
| --- | --- |
| T1 | OEM catalogue or OEM document |
| T2 | Aftermarket maker's own cross-reference for its product |
| T3 | Two or more independent domains agree |
| T4 | One seller or one tender claims it (shown only beside a T1 to T3 identity) |
| T5 | Number format only (a guess, never a public page) |

## Status

Step 1: offline parsing, normalisation and ranking. Every candidate is T5, a format match only.
No network, search, LLM or database calls yet.

```
GET /parts/api/parse?q=<text>   ->   { hints, results: [parse(token, hints) ...] }
```

## Development

```
npm install
npm test              run the test suite (no network)
npm run typecheck     strict TypeScript check
npx wrangler dev      run the Worker locally
```
