// Token and hint extraction, normalisation and candidate ranking. Pure functions: no I/O.
// Normalisation never destroys information: the input, compact form, canonical form, base,
// suffix and alternate spellings are all returned.

import { HINT_WORDS } from "./hints";
import { RULES, SUFFIXES, type FormatRule, type Strength } from "./rules";

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

/** The token as typed, plus one variant per known suffix it ends in, with that suffix split off. */
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

/** Letters and digits become "#", separators stay: "320-0677" -> "###-####". */
function skeleton(s: string): string {
  return s.replace(/[0-9A-Z]/g, "#");
}

interface Ranked extends Candidate {
  order: number;
  separatorMatch: boolean;
}

function candidatesFor(rule: FormatRule, v: Variant, hints: readonly string[]): Candidate[] {
  const m = rule.regex.exec(rule.matchOn === "typed" ? v.typed : v.compact);
  if (!m) return [];
  const groupSets: (string | undefined)[][] = rule.prefixSplits
    ? rule.prefixSplits.map((n) => {
        const g = m[1] ?? "";
        return [m[0], g.slice(0, n), g.slice(n)];
      })
    : [[...m]];
  return groupSets.map((groups) => ({
    oem: rule.oem,
    canonical: expand(rule.canonical, groups),
    base: v.compact,
    ...(v.suffix ? { suffix: v.suffix } : {}),
    alternates: rule.alternates.map((a) => expand(a, groups)),
    basis: "T5" as const,
    ruleId: rule.id,
    strength: rule.strength,
    warnings: rule.warning ? [rule.warning] : [],
    hintMatched: hints.includes(rule.oem),
  }));
}

/**
 * Match one token against every format rule and rank the candidates:
 * 1. a hint match first;
 * 2. then distinctive before shared, where a distinctive rule only counts as distinctive
 *    when no other manufacturer's rule also matched the token;
 * 3. then a candidate whose separators match what the user typed (only when they typed any);
 * 4. then rule-table order.
 * Hints re-rank; they never remove a candidate.
 */
export function parse(token: string, hints: readonly string[] = []): ParseResult {
  const upper = token.trim().toUpperCase();
  const result: ParseResult = { input: token, compact: compact(upper), candidates: [] };

  const vs = variants(upper);
  const found: Ranked[] = [];
  RULES.forEach((rule) => {
    for (const v of vs) {
      for (const c of candidatesFor(rule, v, hints)) {
        const typedHasSeparators = skeleton(v.typed) !== skeleton(v.compact);
        found.push({
          ...c,
          order: found.length,
          separatorMatch: typedHasSeparators && skeleton(v.typed) === skeleton(c.canonical),
        });
      }
    }
  });

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
      Number(b.hintMatched) - Number(a.hintMatched) ||
      Number(distinctive(b)) - Number(distinctive(a)) ||
      Number(b.separatorMatch) - Number(a.separatorMatch) ||
      a.order - b.order,
  );

  // The same reading can come from two rules (e.g. jcb-typed and jcb-compact); keep the best-ranked.
  const seen = new Set<string>();
  for (const { order: _o, separatorMatch: _s, ...c } of found) {
    const key = `${c.oem}|${c.canonical}|${c.suffix ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.candidates.push(c);
  }

  if (result.candidates.length === 0) result.reason = "no_rule_matched";
  return result;
}
