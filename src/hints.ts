// Brand and model words that hint at a manufacturer. Hints re-rank candidates; they never remove one.
// Words match whole words only, case-insensitive. A space inside a word matches any run of whitespace.
// The longest word matches first, and text it consumes is not matched again.
// A token that is exactly a hint word (e.g. PC200) is a hint only, never a part number.
// CAT is also an English word; hints only re-rank, so a stray English 'cat' costs nothing.

export interface HintWord {
  words: string[];
  hints: string[];
}

export const HINT_WORDS: readonly HintWord[] = [
  { words: ["CAT", "CATERPILLAR"], hints: ["Caterpillar"] },
  { words: ["KOMATSU", "PC200", "PC210"], hints: ["Komatsu"] },
  { words: ["JCB", "3CX", "4CX"], hints: ["JCB"] },
  { words: ["KOBELCO", "SK200", "SK210"], hints: ["Kobelco"] },
  { words: ["TATA HITACHI", "TELCON"], hints: ["Tata Hitachi"] },
  { words: ["HITACHI", "EX200"], hints: ["Hitachi", "Tata Hitachi"] },
  { words: ["VOLVO"], hints: ["Volvo CE"] },
];
