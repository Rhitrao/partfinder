// Brand and model words that hint at a manufacturer. Hints re-rank candidates; they never remove one.
// Words match whole words only, case-insensitive. A space inside a word matches any run of whitespace.
// The longest word matches first, and text it consumes is not matched again.
// Patterns match a whole token (e.g. PC200-8, SK210LC-8). A token that is exactly a hint word or
// matches a pattern is a hint only, never a part number.
// Hints come back in the order they first appear in the text.
// Model patterns claim whole tokens. A real part number shaped like PC plus 2 to 4 digits would be
// read as a hint. No current rule matches that shape.
// CAT is also an English word; hints only re-rank, so a stray English 'cat' costs nothing.

export interface HintWord {
  words: string[];
  /** Matched against a whole uppercased token, e.g. machine model numbers. */
  patterns?: RegExp[];
  hints: string[];
}

export const HINT_WORDS: readonly HintWord[] = [
  { words: ["CAT", "CATERPILLAR"], hints: ["Caterpillar"] },
  { words: ["KOMATSU"], patterns: [/^PC\d{2,4}[A-Z]{0,3}(-\d{1,2})?$/], hints: ["Komatsu"] },
  { words: ["JCB"], patterns: [/^[34]CX[A-Z]{0,3}$/], hints: ["JCB"] },
  { words: ["KOBELCO"], patterns: [/^SK\d{2,4}[A-Z]{0,3}(-\d{1,2})?$/], hints: ["Kobelco"] },
  { words: ["TATA HITACHI", "TELCON"], hints: ["Tata Hitachi"] },
  {
    words: ["HITACHI"],
    patterns: [/^EX\d{2,4}[A-Z]{0,3}(-\d{1,2})?$/],
    hints: ["Hitachi", "Tata Hitachi"],
  },
  { words: ["VOLVO"], hints: ["Volvo CE"] },
];
