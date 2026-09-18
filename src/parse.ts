// Token and hint extraction, normalisation and candidate ranking. Pure functions: no I/O.
// Normalisation never destroys information: the input, compact form, canonical form, base,
// suffix and alternate spellings are all returned.

import { HINT_WORDS } from "./hints";
import { RULES, SUFFIXES, UNCONFIRMED_SUFFIXES, type FormatRule, type Strength } from "./rules";

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
}

const TOKEN_SPLIT = /[\s,;]+/;
const EDGE_PUNCTUATION = /^[^0-9A-Z]+|[^0-9A-Z]+$/g;
const SEPARATORS = /[\s\-./\\]/g;
const TRAILING_SEPARATORS = /[\s\-./\\]+$/;

/** Split free text into candidate part-number tokens, uppercased. */
export function extractTokens(text: string): string[] {
  return text
    .toUpperCase()
    .split(TOKEN_SPLIT)
    .map((t) => t.replace(EDGE_PUNCTUATION, ""))
    .filter((t) => t.length >= 5 && /\d/.test(t));
}

const HINT_PATTERNS = HINT_WORDS.map((h) => ({
  hints: h.hints,
  patterns: h.words.map(
    (w) => new RegExp(`(?<![0-9A-Z])${w.split(" ").join("\\s+")}(?![0-9A-Z])`, "i"),
  ),
}));

/** Manufacturer hints from brand and model words, in hint-table order, without duplicates. */
export function extractHints(text: string): string[] {
  const found: string[] = [];
  for (const { hints, patterns } of HINT_PATTERNS) {
    if (!patterns.some((p) => p.test(text))) continue;
    for (const h of hints) if (!found.includes(h)) found.push(h);
  }
  return found;
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
  if (v.suffix && !rule.suffixes) return [];
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
  return groupSets.map((groups) => ({
    oem: rule.oem,
    canonical: expand(rule.canonical, groups),
    base: v.compact,
    ...(v.suffix ? { suffix: v.suffix } : {}),
    alternates: rule.alternates.map((a) => expand(a, groups)),
    basis: "T5" as const,
    ruleId: rule.id,
    strength: rule.strength,
    warnings: [...warnings],
    hintMatched: hints.includes(rule.oem),
  }));
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
 * Hints re-rank; they never remove a candidate.
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

  if (result.candidates.length === 0) result.reason = "no_rule_matched";
  return result;
}
