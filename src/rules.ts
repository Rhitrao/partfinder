// Manufacturer part-number format rules, as data.
// Every rule is a hypothesis about a number format. A match is a T5 guess, never an identity.
// If a rule looks wrong, flag it; do not edit it without a data commit that says why.

export type MatchOn = "typed" | "compact";
export type Strength = "distinctive" | "shared";

export interface FormatRule {
  id: string;
  oem: string;
  /** "typed": match the uppercased token as typed. "compact": match it with separators removed. */
  matchOn: MatchOn;
  regex: RegExp;
  /** Template over the capture groups: $1, $2, ... A missing optional group expands to "". */
  canonical: string;
  strength: Strength;
  /** Templates over the same capture groups, for other spellings of the same number. */
  alternates: string[];
  note: string;
  /** Whether a known suffix (RC, TL, WTL) may be split off before matching. */
  suffixes: boolean;
  /** Run this rule only when the input carries a hint for its manufacturer. Default false. */
  requiresHint?: boolean;
  /** Split capture group 1 after each of these lengths, giving one candidate per split as $1 and $2. */
  prefixSplits?: number[];
  /** With prefixSplits: keep only splits whose body ($2) length is within [min, max]. */
  splitBodyLength?: [number, number];
  /** Warning attached to every candidate this rule produces. */
  warning?: string;
}

export const RULES: readonly FormatRule[] = [
  {
    id: "cat-letter",
    oem: "Caterpillar",
    matchOn: "compact",
    regex: /^(\d[A-Z])(\d{4})$/,
    canonical: "$1-$2",
    strength: "distinctive",
    alternates: ["$1$2"],
    note: "verified: 1U-3352",
    suffixes: true,
  },
  {
    id: "cat-numeric",
    oem: "Caterpillar",
    matchOn: "compact",
    regex: /^(\d{3})(\d{4})$/,
    canonical: "$1-$2",
    strength: "shared",
    alternates: ["$1$2"],
    note: "7 digits also fits Hitachi",
    suffixes: true,
  },
  {
    id: "komatsu-325",
    oem: "Komatsu",
    matchOn: "compact",
    regex: /^(\d{3}|\d{2}[A-Z])(\d{2})(\d{5})$/,
    canonical: "$1-$2-$3",
    strength: "distinctive",
    alternates: ["$1$2$3"],
    note: "verified: 205-70-19570",
    suffixes: true,
  },
  {
    id: "komatsu-424",
    oem: "Komatsu",
    matchOn: "compact",
    regex: /^(\d{4})(\d{2})(\d{4})$/,
    canonical: "$1-$2-$3",
    strength: "shared",
    alternates: ["$1$2$3"],
    note: "hypothesis",
    suffixes: false,
  },
  {
    id: "jcb-slash",
    oem: "JCB",
    matchOn: "typed",
    regex: /^(\d{2,3})[/\\]([0-9A-Z]{4,6})$/,
    canonical: "$1/$2",
    strength: "distinctive",
    alternates: ["$1\\$2", "$1-$2", "$1$2"],
    note: "verified: 40/300893",
    suffixes: false,
  },
  {
    id: "jcb-dash",
    oem: "JCB",
    matchOn: "typed",
    regex: /^(\d{2,3})-([0-9A-Z]{4,6})$/,
    canonical: "$1/$2",
    strength: "shared",
    alternates: ["$1\\$2", "$1-$2", "$1$2"],
    note: "a 3-digit prefix with a dash also fits Caterpillar",
    suffixes: false,
  },
  {
    id: "jcb-compact",
    oem: "JCB",
    matchOn: "compact",
    regex: /^(\d{8,9})$/,
    canonical: "$1/$2",
    strength: "shared",
    alternates: ["$1\\$2", "$1-$2", "$1$2"],
    note: "two candidates: split after 2 digits and after 3",
    suffixes: false,
    prefixSplits: [2, 3],
    splitBodyLength: [4, 6],
    warning: "prefix length ambiguous",
  },
  {
    id: "kobelco",
    oem: "Kobelco",
    matchOn: "compact",
    regex: /^([A-Z]{2}\d{2}[A-Z]\d{5}[A-Z]\d{1,3})$/,
    canonical: "$1",
    strength: "distinctive",
    alternates: [],
    note: "verified: YN32W01029P1",
    suffixes: false,
  },
  {
    id: "tata-hitachi",
    oem: "Tata Hitachi",
    matchOn: "typed",
    regex: /^(T[A-E]\d{5})(\/\d{1,2})?$/,
    canonical: "$1$2",
    strength: "distinctive",
    alternates: [],
    note: "probable, from tenders",
    suffixes: false,
  },
  {
    id: "tata-hitachi-6",
    oem: "Tata Hitachi",
    matchOn: "compact",
    regex: /^(T[A-E]\d{6})$/,
    canonical: "$1",
    strength: "shared",
    alternates: [],
    note: "6 digits where tenders show 5",
    suffixes: false,
    warning: "unusual length, possible typo",
  },
  {
    id: "hitachi-7",
    oem: "Hitachi",
    matchOn: "compact",
    regex: /^(\d{7})$/,
    canonical: "$1",
    strength: "shared",
    alternates: [],
    note: "hypothesis; 7 digits also fits CAT",
    suffixes: false,
  },
  {
    id: "volvo-voe",
    oem: "Volvo CE",
    matchOn: "compact",
    regex: /^VOE(\d{8})$/,
    canonical: "VOE$1",
    strength: "distinctive",
    alternates: ["$1"],
    note: "hypothesis",
    suffixes: false,
  },
  {
    id: "volvo-8",
    oem: "Volvo CE",
    matchOn: "compact",
    regex: /^(\d{8})$/,
    canonical: "$1",
    strength: "shared",
    alternates: ["VOE$1"],
    note: "hypothesis: Volvo CE numbers often written without VOE",
    suffixes: false,
    requiresHint: true,
  },
];

/** Known suffixes, longest first so WTL is tried before TL. Meanings live in the taxonomy, not here.
 * Only rules with `suffixes: true` accept them. */
export const SUFFIXES: readonly string[] = ["WTL", "RC", "TL"];

/** Suffixes whose meaning is not confirmed by a public source. */
export const UNCONFIRMED_SUFFIXES: readonly string[] = ["WTL"];
