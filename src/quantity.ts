// Reading "how many" out of the message the user pasted.
//
// A customer writes "2 nos 1u3352" or "40/300893 x1", and that number is worth carrying into the
// supplier's message. It is also the easiest thing on this page to get wrong: a part number
// followed by a year, a price or a model number looks exactly like a part number followed by a
// quantity. So a run of digits counts only when a unit word or an x says it is a count. Anything
// else leaves the quantity unknown, which the card says plainly.
//
// Nothing here is stored; it is read from the text on each render.

/** nos, no, pcs, pc, units, unit. "qty" and "x" are handled separately, as markers not units. */
const UNITS = "(?:nos?|pcs?|units?)";

/** Quantities are small. Four digits is already generous for a spares enquiry. */
const MAX_QUANTITY = 9999;

/** "2 nos ", "4 pcs of ", immediately before the number. */
const BEFORE_UNIT = new RegExp(`(?<!\\d)(\\d{1,4})\\s*${UNITS}\\s*(?:of\\s+)?$`, "i");

/** "qty 4 ", "qty: 4 ", immediately before the number. */
const BEFORE_QTY = /(?:^|[^0-9A-Z])qty\s*[:.]?\s*(\d{1,4})\s*$/i;

/** " x2", " - x2", immediately after the number. */
const AFTER_X = /^\s*[-–—]?\s*x\s*(\d{1,4})(?![0-9A-Z])/i;

/** " 2 pcs", " - 2 pcs", immediately after the number. */
const AFTER_UNIT = new RegExp(`^\\s*[-–—]?\\s*(\\d{1,4})\\s*${UNITS}(?![0-9A-Z])`, "i");

function valid(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY ? value : null;
}

/** The quantity written around one occurrence of a number, or null when none is. */
function quantityAt(text: string, start: number, end: number): number | null {
  const before = text.slice(Math.max(0, start - 24), start);
  const after = text.slice(end, end + 24);
  return (
    valid(BEFORE_QTY.exec(before)?.[1]) ??
    valid(BEFORE_UNIT.exec(before)?.[1]) ??
    valid(AFTER_X.exec(after)?.[1]) ??
    valid(AFTER_UNIT.exec(after)?.[1])
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * The quantity written for one number, or null.
 *
 * Every occurrence of the number is read, and they have to agree: "2 nos 1u3352 ... 1u3352 x5" is
 * two different claims about the same part, and guessing between them is worse than asking. A
 * number that appears once with a quantity and once without still counts, because the second
 * mention is not a contradiction.
 */
export function quantityFor(text: string, token: string): number | null {
  if (token === "") return null;
  const pattern = new RegExp(`(?<![0-9A-Z])${escapeRegExp(token)}(?![0-9A-Z])`, "gi");
  const found = new Set<number>();
  for (const match of text.matchAll(pattern)) {
    const quantity = quantityAt(text, match.index, match.index + match[0].length);
    if (quantity !== null) found.add(quantity);
  }
  return found.size === 1 ? [...found][0]! : null;
}
