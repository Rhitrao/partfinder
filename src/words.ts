// The words a pasted message carries that are not part of the part.
//
// A WhatsApp enquiry is mostly politeness, urgency and units. "Sir, pls send 2 nos EX200 pin
// pivot urgent" names one part in two words; everything else is padding. This is the padding,
// as data, so removing a word is a data commit rather than a change to the parser.
//
// It is deliberately short and deliberately dumb. There is no stemming, no language detection
// and no model: the rule is exact, whole-word and case-insensitive, and a word that is not on
// this list survives. A too-eager list would eat a part name, which is the one thing that must
// not happen here - "pin" and "no" are one letter apart from each other's fate.

/**
 * Words that carry no part name: greetings, politeness, urgency, units, quantities' companions
 * and the smallest English function words.
 *
 * "no" is on it as the unit ("2 no", "nos"), which is how it is used in these messages; the
 * cost is that a part legitimately called "no" is lost, and there is not one.
 */
export const STOPWORDS: readonly string[] = [
  // Asking
  "need", "needed", "required", "require", "want", "send", "kindly",
  // Urgency
  "pls", "please", "urgent", "urgently", "asap",
  // Units and counting
  "nos", "no", "pcs", "pc", "qty", "quantity",
  // Commerce
  "price", "rate", "cost", "available", "availability", "stock",
  // Address and greeting
  "hi", "hello", "sir", "madam", "bhai", "ji", "dear",
  // Function words
  "for", "of", "the", "a", "an", "and", "or", "to",
  "any", "some", "with", "me", "us", "we", "our",
  "is", "are", "this", "that",
];

const LOOKUP = new Set(STOPWORDS);

/** Whether a word carries no part name. Case-insensitive, whole words only. */
export function isStopword(word: string): boolean {
  return LOOKUP.has(word.trim().toLowerCase());
}

/** At most this many words in a part's name. Past five it is a sentence, not a name. */
export const MAX_NAME_WORDS = 5;
