// Token and hint extraction, normalisation and candidate ranking. Pure functions: no I/O.
// Normalisation never destroys information: the input, compact form, canonical form, base,
// suffix and alternate spellings are all returned.

import { HINT_WORDS } from "./hints";
import { MAX_NAME_WORDS, isStopword } from "./words";
import { RULES, SUFFIXES, UNCONFIRMED_SUFFIXES, oemsOf, type FormatRule, type Strength } from "./rules";

export interface Candidate {
  oem: string;
  /** Canonical spelling of the number, without any suffix. */
  canonical: string;
  /** Lookup key: the number with separators and suffix removed. */
  base: string;
  suffix?: string;
  alternates: string[];
  basis: "T5";
  ruleId: string;
  strength: Strength;
  warnings: string[];
  hintMatched: boolean;
}

export interface ParseResult {
  input: string;
  compact: string;
  candidates: Candidate[];
  reason?: string;
  /** Set when this card is a part the message described rather than numbered. */
  described?: DescribedPart;
  /** The descriptive words the message carried, for the card's queries and its message line. */
  words?: string[];
  /**
   * A token that reads as a part number but that no rule places.
   *
   * It is still a part. The buyer typed it because a customer asked for it, and "we do not
   * recognise the manufacturer" is an answer - one that leaves the number searchable and
   * sendable. Without this the number fell off the page into a "Not recognised" line and out of
   * every message, which is the one thing it must not do.
   */
  unplaced?: boolean;
}

/**
 * A bare digit run shaped like a phone number: 10 digits starting 0 or 6 to 9, or 11 to 15
 * digits. "Bare" means the user typed no separators, so 6754-61-1102 is never phone-shaped.
 *
 * It lives here rather than in the page because it is a statement about a token, and both the
 * page and the parser have to agree on it.
 */
export const PHONE_SHAPED = /^(?:[06-9]\d{9}|\d{11,15})$/;

/**
 * Whether a token nobody could place still reads as a part number.
 *
 * Six characters, at least one digit, and either a letter or a separator. The letter-or-separator
 * test is what keeps a bare run of digits out: a year, an invoice number and a quantity are all
 * digits and nothing else, and none of them is a part. Prices never reach here - they are blanked
 * before the text is tokenised - and a phone number is excluded outright.
 */
export function looksLikePartNumber(token: string): boolean {
  const upper = token.trim().toUpperCase();
  if (upper.length < 6) return false;
  if (!/\d/.test(upper)) return false;
  if (PHONE_SHAPED.test(upper)) return false;
  return /[A-Z]/.test(upper) || /[-/.]/.test(upper);
}

const TOKEN = /[^\s,;]+/g;
/**
 * A number right after a currency marker is a price, not a part number. The marker may be
 * attached or separated by one space, and commas inside the number belong to it, so "Rs 4500",
 * "Rs.125000" and "\u20b945,000" are all prices. Matched case-insensitively, and never in the middle
 * of a word: the RS in CARS starts nothing.
 *
 * The cost is a part number written as a currency marker followed by digits. RS4500 would be
 * read as a price. No format rule matches that shape today.
 */
const PRICE =
  /(?<![0-9A-Z])(?:RS\.?|INR|US\$|USD|AED|SAR|KES|KSH|NGN|ZAR|[\u20b9\u20a6$]) ?\d[\d,]*(?:\.\d+)?/gi;

/** Blank out every price, so the digits in one are never read as a part number. */
function withoutPrices(text: string): string {
  return text.replace(PRICE, " ");
}
const EDGE_PUNCTUATION = /^[^0-9A-Z]+|[^0-9A-Z]+$/g;
const LEADING_PUNCTUATION = /^[^0-9A-Z]*/;
const SEPARATORS = /[\s\-./\\]/g;
const TRAILING_SEPARATORS = /[\s\-./\\]+$/;

interface RawToken {
  text: string;
  /** Offset of the trimmed token in the input. */
  index: number;
}

/** Split on whitespace, commas and semicolons, uppercase, and trim punctuation from each end. */
function rawTokens(text: string): RawToken[] {
  const upper = text.toUpperCase();
  return [...upper.matchAll(TOKEN)].map((m) => ({
    text: m[0].replace(EDGE_PUNCTUATION, ""),
    index: m.index + (LEADING_PUNCTUATION.exec(m[0])?.[0].length ?? 0),
  }));
}

/** Hint words that can stand alone as a token. Such a token is a hint, never a part number. */
const HINT_TOKENS = new Set(HINT_WORDS.flatMap((h) => h.words).map((w) => w.toUpperCase()));

/** Model-number patterns from the hint table, each with its hint-table row. */
const MODEL_PATTERNS = HINT_WORDS.flatMap((h, row) =>
  (h.patterns ?? []).map((pattern) => ({ row, pattern })),
);

function isHintToken(token: string): boolean {
  return HINT_TOKENS.has(token) || MODEL_PATTERNS.some(({ pattern }) => pattern.test(token));
}

/**
 * Split free text into candidate part-number tokens, uppercased.
 * "VOE" followed by an 8-digit token merges into one token. Hint words and model numbers
 * (e.g. PC200-8) are dropped. Tokens are deduplicated by compact form, keeping the first
 * spelling in order of appearance.
 *
 * A number shaped like a phone number is still a token: 6754611102 is a readable Komatsu number.
 * Keeping it off the WhatsApp message is the page's job, not this one's. A number after a
 * currency marker is not a token at all: it is a price, and prices are never part numbers.
 */
export function extractTokens(text: string): string[] {
  const raw = rawTokens(withoutPrices(text)).map((t) => t.text);

  const merged: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] ?? "";
    const next = raw[i + 1];
    if (t === "VOE" && next !== undefined && /^\d{8}$/.test(next)) {
      merged.push(t + next);
      i++;
    } else {
      merged.push(t);
    }
  }

  const seen = new Set<string>();
  return merged.filter((t) => {
    if (t.length < 5 || !/\d/.test(t) || isHintToken(t)) return false;
    const key = compact(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every hint word with its hint-table row, longest word first. */
const WORD_PATTERNS = HINT_WORDS.flatMap((h, row) =>
  h.words.map((w) => ({
    row,
    length: w.length,
    pattern: new RegExp(`(?<![0-9A-Z])${w.split(" ").join("\\s+")}(?![0-9A-Z])`, "gi"),
  })),
).sort((a, b) => b.length - a.length);

/**
 * Manufacturer hints from brand words and model numbers, in the order they first appear in the
 * text, without duplicates. Model patterns match whole tokens. Words match longest first; text
 * consumed by an earlier match is not matched again, so "TATA HITACHI" hints Tata Hitachi only.
 */
export function extractHints(text: string): string[] {
  const matches: { start: number; end: number; row: number }[] = [];
  const free = (start: number, end: number) => !matches.some((m) => start < m.end && end > m.start);

  for (const token of rawTokens(text)) {
    const model = MODEL_PATTERNS.find(({ pattern }) => pattern.test(token.text));
    if (!model) continue;
    matches.push({ start: token.index, end: token.index + token.text.length, row: model.row });
  }
  // Offsets come from the uppercased text, as rawTokens' do (uppercasing can change length).
  const upper = text.toUpperCase();
  for (const { row, pattern } of WORD_PATTERNS) {
    for (const m of upper.matchAll(pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (free(start, end)) matches.push({ start, end, row });
    }
  }

  const found: string[] = [];
  for (const { row } of matches.sort((a, b) => a.start - b.start)) {
    for (const hint of HINT_WORDS[row]?.hints ?? []) if (!found.includes(hint)) found.push(hint);
  }
  return found;
}

/**
 * A part described rather than numbered: "pin pivot for EX200".
 *
 * Half the messages a parts buyer gets name no number at all. The customer knows the machine and
 * what the thing is called, and that is enough to search with and more than enough to forward to
 * a supplier. Before step 9 such a message produced an empty page.
 */
export interface DescribedPart {
  /** The model word, uppercased: "EX200". Empty when the message named a brand but no model. */
  machine: string;
  /** The manufacturers the machine or brand word hints at. */
  brands: string[];
  /** At most five words, lowercased, in the order they were typed. */
  name: string;
}

/**
 * The words in a message that are not doing another job.
 *
 * Everything with a job is taken out first: prices, part-number tokens, phone numbers, brand and
 * model words, bare digit runs, and the stopwords in src/words.ts. What is left is what the
 * customer called the thing.
 *
 * One rule here is not on that list. The word immediately before a phone number is dropped as
 * well, because in these messages that is a person - "Ramesh 9876543210" - and a customer's name
 * has no business in a card, a search or a message to a third party. It costs a real word only
 * when a part name ends immediately before a bare ten-digit run, which is not a thing people
 * write.
 */
export function descriptiveWords(text: string): string[] {
  const tokens = rawTokens(withoutPrices(text)).map((t) => t.text).filter((t) => t !== "");
  const partTokens = new Set(extractTokens(text));
  const drop = new Set<number>();
  tokens.forEach((token, at) => {
    if (PHONE_SHAPED.test(token)) {
      drop.add(at);
      // Whoever is named right before a number is a contact, not a part.
      drop.add(at - 1);
    }
  });
  const words: string[] = [];
  tokens.forEach((token, at) => {
    if (drop.has(at)) return;
    if (partTokens.has(token)) return;
    if (isHintToken(token)) return;
    if (!/[A-Z]/.test(token)) return;
    if (isStopword(token)) return;
    words.push(token.toLowerCase());
  });
  return words;
}

/**
 * The one part a message describes, or null when it describes none.
 *
 * Null in three cases, and each is deliberate. No brand or model word: there is nothing to say
 * the words are about a machine at all, and "please send urgently" is not a part. Any
 * part-number token: the numbers are the parts, and the machine word is only a hint that
 * re-ranks them - a message with both does not also describe a third thing. And no words left
 * after the padding is removed: a bare "EX200" names a machine, not a part on it.
 *
 * Phone-shaped tokens do not count as part numbers for the second test. "Ramesh 9876543210
 * EX200 pivot pin" describes a part; the number in it is a person's.
 */
export function describedPart(text: string): DescribedPart | null {
  const brands = extractHints(text);
  if (brands.length === 0) return null;
  const numbers = extractTokens(text).filter((token) => !PHONE_SHAPED.test(token));
  if (numbers.length > 0) return null;
  const words = descriptiveWords(text);
  if (words.length === 0) return null;
  const model = rawTokens(text)
    .map((t) => t.text)
    .find((token) => MODEL_PATTERNS.some(({ pattern }) => pattern.test(token)));
  return {
    machine: model ?? "",
    brands,
    name: words.slice(0, MAX_NAME_WORDS).join(" "),
  };
}

/** A described part as a card: the same shape as a number's, with no candidates to rank. */
export function describedResult(part: DescribedPart): ParseResult {
  const input = describedInput(part);
  return { input, compact: compact(input.toUpperCase()), candidates: [], described: part };
}

/** What a described part is called in a query, a card title's URL and the back-link. */
export function describedInput(part: DescribedPart): string {
  return [part.machine, part.name].filter((piece) => piece !== "").join(" ");
}

/** Remove spaces, dashes, dots, slashes and backslashes. */
export function compact(token: string): string {
  return token.replace(SEPARATORS, "");
}

interface Variant {
  typed: string;
  compact: string;
  suffix?: string;
}

/** The token as typed, plus one variant per known suffix it ends in, with that suffix split off.
 * Only rules with `suffixes: true` match the split variants. */
function variants(upper: string): Variant[] {
  const out: Variant[] = [{ typed: upper, compact: compact(upper) }];
  for (const suffix of SUFFIXES) {
    if (!upper.endsWith(suffix)) continue;
    const typed = upper.slice(0, -suffix.length).replace(TRAILING_SEPARATORS, "");
    if (typed) out.push({ typed, compact: compact(typed), suffix });
  }
  return out;
}

function expand(template: string, groups: readonly (string | undefined)[]): string {
  return template.replace(/\$(\d)/g, (_, n: string) => groups[Number(n)] ?? "");
}

/**
 * Where separators sit, counted in letters and digits before each run of separators.
 * "320-0677" and "320/0677" -> "3"; "205-70-19570" -> "3,5"; "3200677" -> "".
 */
function separatorPositions(s: string): string {
  const positions: number[] = [];
  let alnum = 0;
  let inSeparator = false;
  for (const ch of s) {
    if (/[0-9A-Z]/.test(ch)) {
      alnum++;
      inSeparator = false;
    } else if (!inSeparator) {
      positions.push(alnum);
      inSeparator = true;
    }
  }
  return positions.join(",");
}

interface Ranked extends Candidate {
  order: number;
  /** The user typed separators in this reading of the token. */
  typedSeparators: boolean;
  /** The canonical form equals the token as typed, suffix aside. */
  exactTyped: boolean;
  /** The canonical form puts separators where the user typed them. */
  positionMatch: boolean;
  ignoresSeparators: boolean;
}

function candidatesFor(rule: FormatRule, v: Variant, hints: readonly string[]): Candidate[] {
  const oems = oemsOf(rule);
  if (v.suffix && !rule.suffixes) return [];
  if (rule.requiresHint && !oems.some((oem) => hints.includes(oem))) return [];
  const m = rule.regex.exec(rule.matchOn === "typed" ? v.typed : v.compact);
  if (!m) return [];
  let groupSets: (string | undefined)[][] = [[...m]];
  if (rule.prefixSplits) {
    const g = m[1] ?? "";
    const [min, max] = rule.splitBodyLength ?? [0, Infinity];
    groupSets = rule.prefixSplits
      .filter((n) => g.length - n >= min && g.length - n <= max)
      .map((n) => [m[0], g.slice(0, n), g.slice(n)]);
  }
  const warnings: string[] = [];
  if (rule.warning) warnings.push(rule.warning);
  if (v.suffix && UNCONFIRMED_SUFFIXES.includes(v.suffix)) warnings.push("suffix meaning unconfirmed");
  // One candidate per manufacturer the rule speaks for: the same reading, offered under each
  // name, because the number itself does not say which.
  return groupSets.flatMap((groups) =>
    oems.map((oem) => ({
      oem,
      canonical: expand(rule.canonical, groups),
      base: v.compact,
      ...(v.suffix ? { suffix: v.suffix } : {}),
      alternates: rule.alternates.map((a) => expand(a, groups)),
      basis: "T5" as const,
      ruleId: rule.id,
      strength: rule.strength,
      warnings: [...warnings],
      hintMatched: hints.includes(oem),
    })),
  );
}

/**
 * Match one token against every format rule and rank the candidates.
 *
 * When the user typed separators, they are evidence:
 * - a manufacturer with any candidate that puts separators where the user typed them keeps only
 *   those candidates;
 * - candidates that put separators elsewhere (or nowhere) are warned
 *   "ignores the separators you typed".
 *
 * Ranking, in order:
 * 1. canonical form equals the token as typed (only when separators were typed);
 * 2. candidates that ignore the typed separators go last;
 * 3. a hint match;
 * 4. distinctive before shared, where a distinctive rule only counts as distinctive
 *    when no other manufacturer's rule also matched the token;
 * 5. separators in the typed positions;
 * 6. rule-table order.
 * Hints re-rank; they never remove a candidate. A rule marked requiresHint runs only when its
 * manufacturer is hinted.
 */
export function parse(token: string, hints: readonly string[] = []): ParseResult {
  const upper = token.trim().toUpperCase();
  const result: ParseResult = { input: token, compact: compact(upper), candidates: [] };

  const vs = variants(upper);
  let found: Ranked[] = [];
  RULES.forEach((rule) => {
    for (const v of vs) {
      const typedPositions = separatorPositions(v.typed);
      const typedSeparators = typedPositions !== "";
      for (const c of candidatesFor(rule, v, hints)) {
        found.push({
          ...c,
          order: found.length,
          typedSeparators,
          exactTyped: typedSeparators && c.canonical === v.typed,
          positionMatch: typedSeparators && separatorPositions(c.canonical) === typedPositions,
          ignoresSeparators: false,
        });
      }
    }
  });

  const matchedOems = new Set(found.filter((c) => c.positionMatch).map((c) => c.oem));
  found = found.filter((c) => c.positionMatch || !matchedOems.has(c.oem));
  for (const c of found) {
    if (c.typedSeparators && !c.positionMatch) {
      c.ignoresSeparators = true;
      c.warnings.push("ignores the separators you typed");
    }
  }

  const oems = [...new Set(found.map((c) => c.oem))];
  if (oems.length > 1) {
    for (const c of found) {
      const others = oems.filter((o) => o !== c.oem).join(", ");
      c.warnings.push(`ambiguous format: also fits ${others}`);
    }
  }
  const distinctive = (c: Ranked) => oems.length === 1 && c.strength === "distinctive";

  found.sort(
    (a, b) =>
      Number(b.exactTyped) - Number(a.exactTyped) ||
      Number(a.ignoresSeparators) - Number(b.ignoresSeparators) ||
      Number(b.hintMatched) - Number(a.hintMatched) ||
      Number(distinctive(b)) - Number(distinctive(a)) ||
      Number(b.positionMatch) - Number(a.positionMatch) ||
      a.order - b.order,
  );

  // The same reading can come from two rules (e.g. jcb-slash and jcb-compact); keep the best-ranked.
  const seen = new Set<string>();
  for (const { order, typedSeparators, exactTyped, positionMatch, ignoresSeparators, ...c } of found) {
    const key = `${c.oem}|${c.canonical}|${c.suffix ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.candidates.push(c);
  }

  if (result.candidates.length === 0) {
    result.reason = "no_rule_matched";
    if (looksLikePartNumber(upper)) result.unplaced = true;
  }
  return result;
}
